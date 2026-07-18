import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const dynamic = 'force-dynamic';

async function getApiKey(): Promise<string | null> {
    const row = getDb().prepare("SELECT value FROM settings WHERE key = 'tmdb_api_key'").get() as { value: string } | undefined;
    return row?.value || null;
}

// GET: TMDB 搜索多条候选，供 detail 页「重新刮削」弹窗人工选择正确条目
// （修复 scanner/tmdb route 只取第一条导致匹配错的问题，如 House M.D. 被匹配成别的剧）
export async function GET(req: NextRequest) {
    // 重刮削是后台功能，仅 admin/boss
    const { getAccess, canAdminSite } = await import("@/lib/roles");
    if (!canAdminSite((await getAccess(req)).role)) {
        return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
    }
    const query = req.nextUrl.searchParams.get("query");
    if (!query) return NextResponse.json({ success: false, error: "Missing query" }, { status: 400 });

    const apiKey = await getApiKey();
    if (!apiKey) return NextResponse.json({ success: false, error: "TMDB API 未配置" });

    try {
        const url = `https://api.themoviedb.org/3/search/multi?api_key=${apiKey}&language=zh-CN&query=${encodeURIComponent(query)}&page=1`;
        const res = await fetch(url, { next: { revalidate: 60 } });
        const data = await res.json();
        const candidates = (data.results || [])
            .filter((r: any) => r.media_type === "movie" || r.media_type === "tv")
            .slice(0, 12)
            .map((r: any) => ({
                tmdbId: r.id,
                mediaType: r.media_type,
                title: r.title || r.name,
                year: (r.release_date || r.first_air_date || "").substring(0, 4) || null,
                overview: r.overview,
                poster: r.poster_path ? `https://image.tmdb.org/t/p/w300${r.poster_path}` : null,
                rating: r.vote_average ?? null,
            }));
        return NextResponse.json({ success: true, data: candidates });
    } catch (e: any) {
        console.error("Rescrape search error:", e);
        return NextResponse.json({ success: false, error: e.message }, { status: 500 });
    }
}

// POST: 用用户选定的 tmdbId 重新刮削，覆盖 media 表的 poster/backdrop/overview/year/rating/metadata
export async function POST(req: NextRequest) {
    try {
        // 重刮削覆盖元数据，仅 admin/boss
        const { getAccess, canAdminSite } = await import("@/lib/roles");
        if (!canAdminSite((await getAccess(req)).role)) {
            return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
        }
        const { mediaId, tmdbId, mediaType } = await req.json();
        if (!mediaId || !tmdbId || !mediaType) {
            return NextResponse.json({ success: false, error: "Missing mediaId/tmdbId/mediaType" }, { status: 400 });
        }
        const apiKey = await getApiKey();
        if (!apiKey) return NextResponse.json({ success: false, error: "TMDB API 未配置" });

        // 用详情接口（比 search 准）+ append_to_response 顺带抓 credits
        const endpoint = mediaType === "movie" ? "movie" : "tv";
        const url = `https://api.themoviedb.org/3/${endpoint}/${tmdbId}?api_key=${apiKey}&language=zh-CN&append_to_response=credits`;
        const res = await fetch(url, { next: { revalidate: 60 } });
        const d = await res.json();

        const poster = d.poster_path ? `https://image.tmdb.org/t/p/w500${d.poster_path}` : null;
        const backdrop = d.backdrop_path ? `https://image.tmdb.org/t/p/w1280${d.backdrop_path}` : null;
        const overview = d.overview || null;
        const yearStr = (d.release_date || d.first_air_date || "").substring(0, 4);
        const year = yearStr ? parseInt(yearStr) : null;
        const rating = d.vote_average ?? null;
        const genres = (d.genres || []).map((g: any) => g.name);
        const cast = (d.credits?.cast || []).slice(0, 8).map((c: any) => c.name);
        const metadata = JSON.stringify({ tmdbId: d.id, mediaType, genres, cast });

        const db = getDb();
        const existing = db.prepare("SELECT id FROM media WHERE id = ?").get(mediaId);
        if (!existing) return NextResponse.json({ success: false, error: "Media not found" }, { status: 404 });

        db.prepare(
            `UPDATE media SET poster=?, backdrop=?, overview=?, year=?, rating=?, metadata=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`
        ).run(poster, backdrop, overview, year, rating, metadata, mediaId);

        return NextResponse.json({
            success: true,
            data: { poster, backdrop, overview, year, rating, genres, cast, metadata },
        });
    } catch (e: any) {
        console.error("Rescrape POST error:", e);
        return NextResponse.json({ success: false, error: e.message }, { status: 500 });
    }
}
