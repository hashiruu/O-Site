import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getCategoryByPath, PUBLIC_TYPES } from "@/lib/mediaDirs";
import { getAccess, allows } from "@/lib/roles";

export const dynamic = 'force-dynamic';

// 为你推荐：按当前内容的分区过滤——
// context 是敏感分区（travel/private/theater相册/日常）→ 只推同分区，且要求该分区在用户 scope 内；
// 其他/无 context → 只推标准公开影音（movie/series/anime 白名单，永不混入相册类），再叠加用户 scope。
export async function GET(req: NextRequest) {
    try {
        const db = getDb();
        const exclude = req.nextUrl.searchParams.get("exclude") || "";
        const context = req.nextUrl.searchParams.get("context") || "";
        const limitRaw = parseInt(req.nextUrl.searchParams.get("limit") || "10", 10);
        const limit = Math.min(Math.max(Number.isNaN(limitRaw) ? 10 : limitRaw, 1), 24);

        const access = await getAccess(req);

        // 确定 context 的分区
        const contextType = context ? getCategoryByPath(context) : null;

        // 分区过滤条件（值全部来自白名单/DB type，参数化传入）
        let typeClause: string;
        let typeParams: string[];
        if (contextType && !PUBLIC_TYPES.includes(contextType)) {
            // 敏感/相册分区：只推同分区，需 scope
            if (!allows(access, contextType)) return NextResponse.json({ success: true, data: [] });
            typeClause = "type = ?";
            typeParams = [contextType];
        } else {
            // 公开影音：白名单 ∩ 用户 scope
            const pub = PUBLIC_TYPES.filter((t) => allows(access, t));
            if (pub.length === 0) return NextResponse.json({ success: true, data: [] });
            typeClause = `type IN (${pub.map(() => "?").join(",")})`;
            typeParams = pub;
        }

        // 若当前文件是某系列的一集，则同时排除该系列本身
        let excludeMediaId = "";
        if (exclude) {
            const ep = db.prepare(`SELECT media_id FROM episodes WHERE path = ?`).get(exclude) as { media_id: string } | undefined;
            if (ep) excludeMediaId = ep.media_id;
        }

        const firstEpSub = `(SELECT e.path FROM episodes e WHERE e.media_id = media.id ORDER BY e.season ASC, e.episode ASC LIMIT 1)`;
        const items = db.prepare(`
            SELECT id, title, type, path, poster, year, rating,
                   CASE WHEN type IN ('series','anime') THEN ${firstEpSub} END AS firstEpisodePath
            FROM media
            WHERE ${typeClause} AND path != ? AND id != ?
            ORDER BY random()
            LIMIT ?
        `).all(...typeParams, exclude, excludeMediaId || "__none__", limit) as any[];

        return NextResponse.json({ success: true, data: items });
    } catch (error) {
        console.error("Recommend API Error:", error);
        return NextResponse.json({ success: false, error: "Internal Server Error" }, { status: 500 });
    }
}
