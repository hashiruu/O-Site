import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import path from "path";

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
    try {
        const filePath = req.nextUrl.searchParams.get("filePath");
        if (!filePath) {
            return NextResponse.json({ success: false, error: "Missing filePath" }, { status: 400 });
        }

        // 内容范围守卫：选集导航跟随所属内容的类别（默认拒绝）
        const { getCategoryByPath } = await import("@/lib/mediaDirs");
        const { getAccess, allows } = await import("@/lib/roles");
        if (!allows(await getAccess(req), getCategoryByPath(filePath))) {
            return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
        }

        const db = getDb();

        // 1. 检查是否是属于某个系列的 Episode
        const episodeInfo = db.prepare(`
            SELECT media_id FROM episodes WHERE path = ?
        `).get(filePath) as { media_id: string } | undefined;

        if (episodeInfo) {
            // 是剧集中的一集，返回同系列的所有剧集
            const siblings = db.prepare(`
                SELECT id, title, path, season, episode 
                FROM episodes 
                WHERE media_id = ? 
                ORDER BY season ASC, episode ASC, title ASC
            `).all(episodeInfo.media_id) as any[];

            return NextResponse.json({
                success: true,
                type: 'series',
                data: siblings.map(s => ({
                    id: s.id,
                    title: s.title,
                    path: s.path,
                    season: s.season,
                    episode: s.episode
                }))
            });
        }

        // 2. 检查 filePath 是否是 media 表中的 series/anime 目录路径
        const mediaInfo = db.prepare(`
            SELECT id, type FROM media WHERE path = ?
        `).get(filePath) as { id: string; type: string } | undefined;

        if (mediaInfo && (mediaInfo.type === 'series' || mediaInfo.type === 'anime')) {
            // filePath 是系列目录或单独的 series 文件
            const episodes = db.prepare(`
                SELECT id, title, path, season, episode
                FROM episodes
                WHERE media_id = ?
                ORDER BY season ASC, episode ASC, title ASC
            `).all(mediaInfo.id) as any[];

            // 如果有剧集记录，返回剧集列表
            if (episodes.length > 0) {
                return NextResponse.json({
                    success: true,
                    type: 'series',
                    isDirectory: true,
                    data: episodes.map(s => ({
                        id: s.id,
                        title: `P${s.episode}: ${s.title}`,
                        path: s.path
                    }))
                });
            }
            // 如果没有剧集记录（文件直接平铺在目录中），回退到目录级兄弟匹配
        }

        // 3. 针对非剧集类型 (Movie, Travel, Private)，不展示右侧选集导航
        return NextResponse.json({
            success: true,
            type: 'standalone',
            data: []
        });

    } catch (error) {
        console.error("Related Media API Error:", error);
        return NextResponse.json({ success: false, error: "Internal Server Error" }, { status: 500 });
    }
}
