import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

// ── Everyday Different：首页右侧轮播的每日新鲜推荐 ──
// GET /api/discover/daily
// 每天按日期轮换一个"主题频道"（全部健康阳光向），从 TMDB discover 拉高分作品，
// 再用日期做种子确定性洗牌取 8 条 → 同一天所有人看到同一批，第二天自动换。
// 服务端按天缓存（内存）；TMDB 无 key / 请求失败返回空数组，前端回落库内轮播。

const FETCH_TIMEOUT_MS = 12000;

// 主题频道表：TMDB genre + 媒介。排除恐怖(27)/惊悚(53)/犯罪(80)/战争(10752)，
// include_adult=false + 高分高票数过滤，保证"健康、阳光"。
const THEMES: { label: string; media: "movie" | "tv"; genres: string }[] = [
    { label: "治愈家庭日", media: "movie", genres: "10751" },
    { label: "冒险精神", media: "movie", genres: "12" },
    { label: "开怀喜剧", media: "movie", genres: "35" },
    { label: "动画世界", media: "movie", genres: "16" },
    { label: "纪录之眼", media: "movie", genres: "99" },
    { label: "奇幻之门", media: "movie", genres: "14" },
    { label: "星辰科幻", media: "movie", genres: "878" },
    { label: "音乐时刻", media: "movie", genres: "10402" },
    { label: "温暖剧集", media: "tv", genres: "18,10751" },
    { label: "动画剧场", media: "tv", genres: "16" },
    { label: "喜剧片场", media: "tv", genres: "35" },
    { label: "历史长河", media: "movie", genres: "36" },
];

interface DailyPick {
    id: number;
    title: string;
    overview: string;
    backdrop: string;
    poster: string | null;
    year: number | null;
    rating: number | null;
    media: string;
    theme: string;
}

let cache: { day: string; data: DailyPick[] } | null = null;

// 确定性伪随机（同一天结果稳定）
function mulberry32(seed: number) {
    return () => {
        seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export async function GET() {
    const now = new Date();
    const day = now.toISOString().slice(0, 10);
    if (cache?.day === day) return NextResponse.json({ success: true, data: cache.data });

    const keyRow = getDb().prepare("SELECT value FROM settings WHERE key = 'tmdb_api_key'").get() as { value: string } | undefined;
    const apiKey = keyRow?.value;
    if (!apiKey) return NextResponse.json({ success: true, data: [] });

    // 日序号驱动一切"每天不一样"：主题轮换 + 翻页错位 + 洗牌种子
    const dayNum = Math.floor(Date.parse(day) / 86400000);
    const theme = THEMES[dayNum % THEMES.length];
    const page = 1 + (dayNum % 4); // 同主题下每轮换到还翻不同页
    const rand = mulberry32(dayNum);

    try {
        const dateField = theme.media === "movie" ? "primary_release_date" : "first_air_date";
        const url =
            `https://api.themoviedb.org/3/discover/${theme.media}?api_key=${apiKey}` +
            `&language=zh-CN&include_adult=false&sort_by=vote_average.desc` +
            `&vote_count.gte=400&vote_average.gte=7.2` +
            `&with_genres=${encodeURIComponent(theme.genres)}&without_genres=27,53,80,10752` +
            `&${dateField}.gte=1990-01-01&page=${page}`;
        const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
        if (!res.ok) throw new Error(`TMDB ${res.status}`);
        const json = await res.json();
        const rows = (json.results || []) as {
            id: number; title?: string; name?: string; overview?: string;
            backdrop_path?: string | null; poster_path?: string | null;
            release_date?: string; first_air_date?: string; vote_average?: number;
        }[];

        const picks: DailyPick[] = rows
            .filter((r) => r.backdrop_path && (r.title || r.name))
            .map((r) => ({
                id: r.id,
                title: (r.title || r.name)!,
                overview: r.overview || "",
                // 走自家代理：TMDB 图床对部分用户网络不可达，直链会白屏（见 /api/discover/img）
                backdrop: `/api/discover/img?u=${encodeURIComponent(`https://image.tmdb.org/t/p/w1280${r.backdrop_path}`)}`,
                poster: r.poster_path ? `/api/discover/img?u=${encodeURIComponent(`https://image.tmdb.org/t/p/w500${r.poster_path}`)}` : null,
                year: (r.release_date || r.first_air_date || "").slice(0, 4) ? Number((r.release_date || r.first_air_date || "").slice(0, 4)) : null,
                rating: r.vote_average ?? null,
                media: theme.media,
                theme: theme.label,
            }))
            // 日期种子洗牌 → 同页内容每天出场顺序也不同
            .map((p) => ({ p, k: rand() }))
            .sort((a, b) => a.k - b.k)
            .map(({ p }) => p)
            .slice(0, 8);

        cache = { day, data: picks };
        return NextResponse.json({ success: true, data: picks });
    } catch {
        return NextResponse.json({ success: true, data: [] }); // 失败静默回落，前端用库内轮播
    }
}
