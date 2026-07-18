import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getAccess, allows } from "@/lib/roles";

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
    try {
        const url = new URL(req.url);
        const type = url.searchParams.get("type");
        if (!type) {
            return NextResponse.json({ success: false, error: "Missing type" });
        }
        // 内容范围守卫：任何分区都要在用户 scope 内（boss/admin 全开；默认用户全拒）
        if (!allows(await getAccess(req), type)) {
            return NextResponse.json({ success: false, error: "UNAUTHORIZED" }, { status: 401 });
        }

        const db = getDb();
        const items = db.prepare(
            `SELECT id, title, type, path, poster, year, rating, duration, created_at
             FROM media WHERE type = ? ORDER BY created_at DESC LIMIT 500`
        ).all(type) as any[];

        // 数据净化：过滤掉那些明明是电视剧/动漫类型，但 path 却指向具体文件的“碎分集”脏数据
        // 真正的剧集根目录在硬盘上必须是一个文件夹
        const fs = require('fs');
        const validItems = items.filter(item => {
            if (type === "series" || type === "anime") {
                try {
                    const stats = fs.statSync(item.path);
                    return stats.isDirectory();
                } catch {
                    return false; // 路径不存在也剔除
                }
            }
            return true;
        });

        // 对于 series/anime 类型，补充剧集数量和第一集路径
        if (type === "series" || type === "anime") {
            const enriched = validItems.map(item => {
                const episodeCount = db.prepare(
                    "SELECT COUNT(*) as count FROM episodes WHERE media_id = ?"
                ).get(item.id) as { count: number };

                const firstEpisode = db.prepare(
                    "SELECT path FROM episodes WHERE media_id = ? ORDER BY season ASC, episode ASC LIMIT 1"
                ).get(item.id) as { path: string } | undefined;

                return {
                    ...item,
                    episodeCount: episodeCount.count,
                    firstEpisodePath: firstEpisode?.path || null,
                };
            });

            return NextResponse.json({ success: true, data: enriched });
        }

        return NextResponse.json({ success: true, data: items });
    } catch (err) {
        console.error("Category API Error:", err);
        return NextResponse.json({ success: false, error: String(err) });
    }
}
