import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import path from "path";

export async function GET(request: NextRequest) {
    const searchParams = request.nextUrl.searchParams;
    const filePath = searchParams.get("filePath");

    if (!filePath) {
        return NextResponse.json({ success: false, error: "Missing filePath" }, { status: 400 });
    }

    // 内容范围守卫：随所查文件的类别走（默认拒绝）
    const { getCategoryByPath } = await import("@/lib/mediaDirs");
    const { getAccess, allows } = await import("@/lib/roles");
    if (!allows(await getAccess(request), getCategoryByPath(filePath))) {
        return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
    }

    try {
        const db = getDb();
        const tmdbRow = db.prepare("SELECT value FROM settings WHERE key = 'tmdb_api_key'").get() as { value: string } | undefined;
        const apiKey = tmdbRow?.value;

        if (!apiKey) {
            return NextResponse.json({ success: false, error: "TMDB API 配置未填写或不生效" });
        }

        // ====== 1. 抽取影片关键词 ======
        let query = "";
        let year = "";

        // 优先从数据库中获取净化好的 title
        let media = db.prepare("SELECT title FROM media WHERE path = ?").get(filePath) as { title: string } | undefined;

        if (!media) {
            // 如果是电视剧单集，则它不在 media 表而在 episodes 表，我们需要顺藤摸瓜找到它所属的父级剧集名字
            const ep = db.prepare("SELECT media_id FROM episodes WHERE path = ?").get(filePath) as { media_id: string } | undefined;
            if (ep) {
                media = db.prepare("SELECT title FROM media WHERE id = ?").get(ep.media_id) as { title: string } | undefined;
            }
        }

        if (media && media.title) {
            query = media.title;
        } else {
            // 兜底方案：从文件名硬拆
            const fileName = path.basename(filePath);
            query = fileName
                .replace(/\.[^/.]+$/, "") // 去掉后缀
                .replace(/[_\.]/g, " ") // 将点和下划线转为空格
                .replace(/1080p|2160p|720p|4k|x264|x265|hevc|web-dl|webrip|bluray|bdrip/ig, "")
                .trim();

            const yearMatch = query.match(/(19\d{2}|20\d{2})/);
            if (yearMatch) {
                year = yearMatch[1];
                query = query.substring(0, yearMatch.index).trim();
            }

            query = query.replace(/\[.*?\]|\(.*?\)/g, "").trim();

            if (!query) {
                query = fileName.replace(/\.[^/.]+$/, ""); // 最终兜底
            }
        }

        // ====== 2. 请求 TMDB api ======
        // search/multi 可以同时搜电影和剧集
        let tmdbUrl = `https://api.themoviedb.org/3/search/multi?api_key=${apiKey}&language=zh-CN&query=${encodeURIComponent(query)}&page=1`;
        if (year) {
            tmdbUrl += `&primary_release_year=${year}`;
        }

        const res = await fetch(tmdbUrl, { next: { revalidate: 3600 } });
        const data = await res.json();

        if (data.results && data.results.length > 0) {
            // 取第一条最匹配的结果
            const match = data.results[0];
            return NextResponse.json({
                success: true,
                data: {
                    id: match.id,
                    title: match.title || match.name, // 电影是 title，剧集是 name
                    media_type: match.media_type,
                    overview: match.overview,
                    poster_path: match.poster_path ? `https://image.tmdb.org/t/p/w500${match.poster_path}` : null,
                    backdrop_path: match.backdrop_path ? `https://image.tmdb.org/t/p/w1280${match.backdrop_path}` : null,
                    vote_average: match.vote_average,
                    release_date: match.release_date || match.first_air_date,
                }
            });
        }

        return NextResponse.json({ success: true, data: null }); // 没搜到

    } catch (error) {
        console.error("TMDB 刮削失败:", error);
        return NextResponse.json({ success: false, error: "刮削请求发生错误" });
    }
}
