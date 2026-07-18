import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getRole, canAdminSite } from "@/lib/roles";
import { MUSICALS } from "@/lib/musicals";

export const dynamic = "force-dynamic";

// ── 关键词添加：搜索候选 ──
// GET /api/external/search?type=movie|series|anime|musical|book&q=关键词
// 影视/动漫 → TMDB search；音乐剧 → 本地精选清单模糊匹配 + TMDB 兜底；书 → 豆瓣搜索建议。
// 返回统一候选结构，前端点选后走 POST /api/external { type, item } 单条入库。
// 仅管理员（与随机添加同权）。

const FETCH_TIMEOUT_MS = 12000;
const proxy = (u: string) => `/api/discover/img?u=${encodeURIComponent(u)}`;

export interface Candidate {
    key: string;
    title: string;
    poster: string | null;
    overview: string;
    year: number | null;
    rating: number | null;
    tmdbId: number | null;
}

export async function GET(req: NextRequest) {
    if (!canAdminSite(await getRole(req))) return NextResponse.json({ success: false, error: "ADMIN_ONLY" }, { status: 403 });
    const type = req.nextUrl.searchParams.get("type") || "";
    const q = (req.nextUrl.searchParams.get("q") || "").trim();
    if (!q) return NextResponse.json({ success: true, data: [] });

    const out: Candidate[] = [];
    try {
        if (type === "book") {
            // 豆瓣搜索建议（免 key，中文书友好）
            const res = await fetch(
                `https://m.douban.com/rexxar/api/v2/search?q=${encodeURIComponent(q)}&type=book&count=10`,
                {
                    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
                    headers: {
                        Referer: "https://m.douban.com/search/",
                        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
                    },
                }
            );
            if (res.ok) {
                const j = await res.json();
                const items = (j?.subjects?.items || j?.items || []) as { target?: { id?: string; title?: string; cover_url?: string; rating?: { value?: number }; card_subtitle?: string } }[];
                for (const it of items) {
                    const t = it.target;
                    if (!t?.title) continue;
                    out.push({
                        key: `book-${t.id || t.title}`,
                        title: t.title,
                        poster: t.cover_url ? proxy(t.cover_url) : null,
                        overview: t.card_subtitle || "",
                        year: null,
                        rating: t.rating?.value ?? null,
                        tmdbId: null,
                    });
                    if (out.length >= 10) break;
                }
            }
        } else {
            // musical：先在精选清单里模糊匹配（中英文名），命中则置顶
            if (type === "musical") {
                const ql = q.toLowerCase();
                for (const m of MUSICALS) {
                    if (m.title.includes(q) || m.en.toLowerCase().includes(ql)) {
                        out.push({ key: `mus-${m.id}`, title: m.title, poster: null, overview: m.overview, year: m.year, rating: null, tmdbId: null });
                    }
                }
            }
            // TMDB search（movie/series/anime 主路径；musical 兜底补充）
            const keyRow = getDb().prepare("SELECT value FROM settings WHERE key = 'tmdb_api_key'").get() as { value: string } | undefined;
            if (keyRow?.value) {
                const media = type === "series" || type === "anime" ? "tv" : "movie";
                const res = await fetch(
                    `https://api.themoviedb.org/3/search/${media}?api_key=${keyRow.value}&language=zh-CN&include_adult=false&query=${encodeURIComponent(q)}&page=1`,
                    { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }
                );
                if (res.ok) {
                    const j = await res.json();
                    const rows = (j.results || []) as {
                        id: number; title?: string; name?: string; overview?: string;
                        poster_path?: string | null; release_date?: string; first_air_date?: string;
                        vote_average?: number; genre_ids?: number[];
                    }[];
                    for (const r of rows) {
                        const t = (r.title || r.name || "").trim();
                        if (!t) continue;
                        if (type === "anime" && !(r.genre_ids || []).includes(16)) continue; // 动漫只留动画类
                        const y = (r.release_date || r.first_air_date || "").slice(0, 4);
                        out.push({
                            key: `tmdb-${r.id}`,
                            title: t,
                            poster: r.poster_path ? proxy(`https://image.tmdb.org/t/p/w500${r.poster_path}`) : null,
                            overview: r.overview || "",
                            year: y ? Number(y) : null,
                            rating: r.vote_average ?? null,
                            tmdbId: r.id,
                        });
                        if (out.length >= 12) break;
                    }
                }
            }
        }
        return NextResponse.json({ success: true, data: out.slice(0, 12) });
    } catch {
        return NextResponse.json({ success: true, data: [] });
    }
}
