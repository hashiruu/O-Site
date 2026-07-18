import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

// ── 每日热搜（首页右侧 25% 栏） ──
// GET /api/discover/hot
// 影视/动漫：TMDB trending all/day（当日全球趋势，zh-CN 标题）；
// 中文书：Apple iTunes 中国区图书畅销榜（官方 RSS，免 key，天然中文）。
// 两源各自 try/catch 互不拖累；按天缓存；全挂返回空数组，前端整栏隐藏。

const FETCH_TIMEOUT_MS = 12000;

interface HotItem { rank: number; title: string; kind: string; heat: number | null; overview: string }

let cache: { day: string; data: HotItem[] } | null = null;

export async function GET() {
    const day = new Date().toISOString().slice(0, 10);
    if (cache?.day === day) return NextResponse.json({ success: true, data: cache.data });

    const out: { title: string; kind: string; heat: number | null; overview: string }[] = [];

    // 源1：TMDB 当日趋势（电影/剧集/动漫标注区分）
    try {
        const keyRow = getDb().prepare("SELECT value FROM settings WHERE key = 'tmdb_api_key'").get() as { value: string } | undefined;
        if (keyRow?.value) {
            const res = await fetch(
                `https://api.themoviedb.org/3/trending/all/day?api_key=${keyRow.value}&language=zh-CN`,
                { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }
            );
            if (res.ok) {
                const json = await res.json();
                const rows = (json.results || []) as {
                    title?: string; name?: string; media_type?: string; overview?: string;
                    genre_ids?: number[]; popularity?: number; adult?: boolean;
                }[];
                for (const r of rows) {
                    if (r.adult || !(r.title || r.name)) continue;
                    const anime = (r.genre_ids || []).includes(16);
                    out.push({
                        title: (r.title || r.name)!,
                        kind: anime ? "动漫" : r.media_type === "tv" ? "剧集" : "电影",
                        heat: r.popularity ? Math.round(r.popularity) : null,
                        overview: r.overview || "",
                    });
                    if (out.length >= 7) break;
                }
            }
        }
    } catch { /* 单源失败不拖累 */ }

    // 源2：豆瓣图书畅销榜（中文书热搜；iTunes 中国区图书店已关、feed 恒空，弃用）
    try {
        const res = await fetch(
            "https://m.douban.com/rexxar/api/v2/subject_collection/book_bestseller/items?start=0&count=8",
            {
                signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
                headers: {
                    Referer: "https://m.douban.com/subject_collection/book_bestseller",
                    "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
                },
            }
        );
        if (res.ok) {
            const json = await res.json();
            const items = (json?.subject_collection_items || []) as { title?: string; type?: string; description?: string; info?: string }[];
            let added = 0;
            for (const it of items) {
                const t = it.title?.trim();
                if (!t) continue;
                out.push({ title: t, kind: "书", heat: null, overview: it.description || it.info || "" });
                if (++added >= 3) break;
            }
        }
    } catch { /* 单源失败不拖累 */ }

    const data: HotItem[] = out.slice(0, 10).map((x, i) => ({ rank: i + 1, ...x }));
    if (data.length > 0) cache = { day, data };
    return NextResponse.json({ success: true, data });
}
