import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { MUSICALS } from "@/lib/musicals";

export const dynamic = "force-dynamic";

// ── 音乐剧每日推荐（首页/音乐剧页） ──
// GET /api/discover/musicals
// 数据源是 lib/musicals.ts 的舞台音乐剧清单（stage musical：Hamilton/歌剧魅影…），
// 不是 TMDB 的音乐电影分类。每天用日期种子从清单轮换取 10 部、洗牌出场顺序。
// 海报按英文名去 TMDB search 借影视版/官摄版封面（Hamilton 2020、Phantom 2004…），
// 图走 /api/discover/img 代理；查不到海报的剧留 null（前端兜底显示剧名）。
// 按天缓存：清单 + 海报当天零重复请求。

const FETCH_TIMEOUT_MS = 10000;
const proxy = (u: string) => `/api/discover/img?u=${encodeURIComponent(u)}`;

interface Pick {
    id: string; title: string; en: string; overview: string;
    poster: string | null; year: number;
}

let cache: { day: string; data: Pick[] } | null = null;

function mulberry32(seed: number) {
    return () => {
        seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

async function fetchPoster(en: string, apiKey: string): Promise<string | null> {
    try {
        const r = await fetch(
            `https://api.themoviedb.org/3/search/multi?api_key=${apiKey}&query=${encodeURIComponent(en)}&language=zh-CN&page=1`,
            { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }
        );
        if (!r.ok) return null;
        const j = await r.json();
        const hit = (j.results || []).find((x: { poster_path?: string | null; media_type?: string }) =>
            x.poster_path && (x.media_type === "movie" || x.media_type === "tv"));
        return hit ? proxy(`https://image.tmdb.org/t/p/w500${hit.poster_path}`) : null;
    } catch { return null; }
}

export async function GET() {
    const day = new Date().toISOString().slice(0, 10);
    if (cache?.day === day) return NextResponse.json({ success: true, data: cache.data });

    const keyRow = getDb().prepare("SELECT value FROM settings WHERE key = 'tmdb_api_key'").get() as { value: string } | undefined;
    const apiKey = keyRow?.value;

    // 日期种子：选 10 部 + 洗牌（同一天稳定）
    const rand = mulberry32(Math.floor(Date.parse(day) / 86400000) * 13 + 5);
    const shuffled = [...MUSICALS].map((m) => ({ m, k: rand() })).sort((a, b) => a.k - b.k).map(({ m }) => m);
    const today = shuffled.slice(0, Math.min(10, shuffled.length));

    const picks: Pick[] = await Promise.all(today.map(async (m) => ({
        id: m.id, title: m.title, en: m.en, overview: m.overview, year: m.year,
        poster: apiKey ? await fetchPoster(m.en, apiKey) : null,
    })));

    cache = { day, data: picks };
    return NextResponse.json({ success: true, data: picks });
}
