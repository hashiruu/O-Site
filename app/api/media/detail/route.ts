import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { resolveUserKeyOrNull } from "@/lib/identity";

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
    try {
        const url = new URL(req.url);
        const id = url.searchParams.get("id");
        if (!id) {
            return NextResponse.json({ success: false, error: "Missing id payload" }, { status: 400 });
        }

        const db = getDb();
        // 未登录不查任何观看进度（旧宽松版会把所有游客并到共享 'guest' 键上）
        const user = await resolveUserKeyOrNull(req);
        const media = db.prepare(`SELECT id, title, type, path, poster, backdrop, overview, year, rating, duration, created_at, updated_at FROM media WHERE id = ?`).get(id) as any;

        if (!media) {
            return NextResponse.json({ success: false, error: "Media not found in archive" }, { status: 404 });
        }

        // 内容范围守卫：任何类型都要在用户 scope 内（boss/admin 全开；默认用户全拒）
        const { getAccess, allows } = await import("@/lib/roles");
        if (!allows(await getAccess(req), media.type)) {
            return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
        }

        // 如果是剧集或动漫，顺带扒出它的所有分集子节点
        if (media.type === "series" || media.type === "anime") {
            const episodes = db.prepare(
                `SELECT id, season, episode, title, path, duration 
                 FROM episodes 
                 WHERE media_id = ? 
                 ORDER BY season ASC, episode ASC`
            ).all(id) as any[];

            // 获取当前用户最后观看的剧集及进度（未登录 → 无）
            const lastWatched = user ? db.prepare(`
                SELECT wp.episode_id, wp.position, wp.last_watched, e.season, e.episode, e.path
                FROM watch_progress wp
                JOIN episodes e ON wp.episode_id = e.id
                WHERE e.media_id = ? AND wp.user_id = ?
                ORDER BY wp.last_watched DESC LIMIT 1
            `).get(id, user) as any : null;

            return NextResponse.json({ success: true, data: { ...media, episodes, lastWatched } });
        }
        // 对于单体文件获取当前用户的观看进度（未登录 → 无）
        const lastWatched = user ? db.prepare(`
            SELECT wp.position, wp.duration, wp.completed, wp.last_watched
            FROM watch_progress wp
            WHERE wp.media_id = ? AND wp.user_id = ?
            ORDER BY wp.last_watched DESC LIMIT 1
        `).get(id, user) as any : null;

        return NextResponse.json({ success: true, data: { ...media, lastWatched } });
    } catch (err) {
        console.error("Detail API Error:", err);
        return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
    }
}
