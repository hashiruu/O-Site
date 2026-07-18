import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getAccess, allows } from "@/lib/roles";

export const dynamic = 'force-dynamic';

// 首页 feed 候选类型（个人相册类 theater相册/日常/private 即使授权也不混进首页流，走各自栏目页）
const FEED_TYPES = ["movie", "series", "anime", "travel"];

export async function GET(request: NextRequest) {
    try {
        const db = getDb();
        const url = new URL(request.url);
        const rand = url.searchParams.get("random") === "1";
        const targetType = url.searchParams.get("type");

        // 内容范围：boss/admin 全开；regular/guest 按 boss 分配的 scope，默认空白
        const access = await getAccess(request);
        const feedTypes = FEED_TYPES.filter((t) => allows(access, t));
        if (targetType && targetType !== "recommended" && !allows(access, targetType)) {
            return NextResponse.json({ success: false, error: "UNAUTHORIZED" }, { status: 401 });
        }
        const types = targetType && targetType !== "recommended" ? [targetType] : feedTypes;
        const results: Record<string, any[]> = {};

        let totalItems = 0;

        // 第一集路径用关联子查询一次取回（用于缩略图和播放入口），
        // 避免每个 series/anime 再单独查一次的 N+1
        const firstEpSub = `(SELECT e.path FROM episodes e WHERE e.media_id = media.id ORDER BY e.season ASC, e.episode ASC LIMIT 1)`;

        for (const type of types) {
            const orderSql = rand ? "ORDER BY random()" : "ORDER BY created_at DESC";
            const epCol = (type === "series" || type === "anime") ? `, ${firstEpSub} AS firstEpisodePath` : "";
            const items = db.prepare(`SELECT id, title, type, path, poster, backdrop, overview, year, rating, created_at${epCol} FROM media WHERE type = ? ${orderSql} LIMIT 7`).all(type) as any[];

            results[type] = items;
            totalItems += items.length;
        }

        if (!targetType || targetType === "recommended") {
            // 白名单：推荐只出 feed 类型（挡住 theater相册/日常 等杂项 type），再叠加用户 scope
            const recTypes = feedTypes;
            if (recTypes.length > 0) {
                const placeholders = recTypes.map(() => "?").join(",");
                const recItems = db.prepare(`SELECT id, title, type, path, poster, backdrop, overview, year, rating, created_at, CASE WHEN type IN ('series','anime') THEN ${firstEpSub} END AS firstEpisodePath FROM media WHERE type IN (${placeholders}) ORDER BY random() LIMIT 7`).all(...recTypes) as any[];
                results["recommended"] = recItems;
                totalItems += recItems.length;
            } else {
                results["recommended"] = [];
            }
        }

        return NextResponse.json({ success: true, data: results, count: totalItems });
    } catch (err) {
        console.error("Latest API Error:", err);
        return NextResponse.json({ success: false, error: String(err) });
    }
}
