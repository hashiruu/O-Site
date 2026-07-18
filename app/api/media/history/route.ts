import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { resolveUserKeyOrNull } from "@/lib/identity";
import { getAccess, typeFilterSql } from "@/lib/roles";

export const dynamic = 'force-dynamic';

// GET: 当前用户的观看历史（按 last_watched 倒序，分页），用于「观看历史」页
// 历史条目跟随用户当前 scope 过滤（授权被收回后旧记录也不再展示）
export async function GET(req: NextRequest) {
    try {
        const db = getDb();
        const user = await resolveUserKeyOrNull(req);
        if (!user) return NextResponse.json({ success: false, error: "LOGIN_REQUIRED" }, { status: 401 });
        const typeFilter = typeFilterSql(await getAccess(req), "m.type");
        const page = Math.max(1, parseInt(req.nextUrl.searchParams.get("page") || "1"));
        const limit = 50;
        const offset = (page - 1) * limit;

        const rows = db.prepare(`
            SELECT
                wp.id AS wp_id, wp.position, wp.duration, wp.completed, wp.last_watched, wp.episode_id,
                m.id AS media_id, m.title, m.type, m.path AS media_path, m.poster, m.year,
                e.path AS episode_path, e.season, e.episode, e.title AS episode_title
            FROM watch_progress wp
            JOIN media m ON m.id = wp.media_id
            LEFT JOIN episodes e ON e.id = wp.episode_id
            WHERE ${typeFilter} AND wp.user_id = ?
            ORDER BY wp.last_watched DESC
            LIMIT ? OFFSET ?
        `).all(user, limit, offset) as any[];

        const total = (db.prepare(
            `SELECT COUNT(*) c FROM watch_progress wp JOIN media m ON m.id = wp.media_id WHERE ${typeFilter} AND wp.user_id = ?`
        ).get(user) as any).c;

        // ── 阅读足迹并入（与首页"继续观看"同源；此前历史页只有影音 → 两页不同步的主因）──
        let books: any[] = [];
        try {
            const { allows } = await import("@/lib/roles");
            if (allows(await getAccess(req), "book")) {
                books = (db.prepare(
                    `SELECT book_path, title, percent, updated_at FROM reading_progress
                     WHERE user_id = ? ORDER BY updated_at DESC LIMIT 50`
                ).all(user) as any[]).map((b) => ({
                    kind: "book",
                    path: b.book_path,
                    title: b.title || b.book_path.split("/").pop(),
                    poster: `/api/books/cover?path=${encodeURIComponent(b.book_path)}`,
                    progressPct: Math.round(b.percent),
                    completed: b.percent >= 98,
                    lastAt: b.updated_at,
                }));
            }
        } catch { /* reading_progress 未建则只出影音 */ }

        // ── dashboard 统计 ──
        const weekAgo = new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 19).replace("T", " ");
        const stats = {
            totalWatch: total,
            totalBooks: books.length,
            weekActive: (db.prepare(
                `SELECT COUNT(*) c FROM watch_progress wp JOIN media m ON m.id = wp.media_id
                 WHERE ${typeFilter} AND wp.user_id = ? AND wp.last_watched >= ?`
            ).get(user, weekAgo) as any).c + books.filter((b) => b.lastAt >= weekAgo).length,
            finished: (db.prepare(
                `SELECT COUNT(*) c FROM watch_progress wp JOIN media m ON m.id = wp.media_id
                 WHERE ${typeFilter} AND wp.user_id = ? AND wp.completed = 1`
            ).get(user) as any).c + books.filter((b) => b.completed).length,
            watchSeconds: (db.prepare(
                `SELECT COALESCE(SUM(wp.position), 0) s FROM watch_progress wp JOIN media m ON m.id = wp.media_id
                 WHERE ${typeFilter} AND wp.user_id = ?`
            ).get(user) as any).s,
        };

        const data = rows.map(r => {
            const pct = r.duration > 0 ? Math.min(100, Math.max(0, Math.round((r.position / r.duration) * 100))) : 0;
            let episodeLabel: string | null = null;
            if (r.episode_id) {
                if (r.season && r.season > 1 && r.episode) episodeLabel = `S${r.season} E${r.episode}`;
                else if (r.episode) episodeLabel = `第 ${r.episode} 集`;
            }
            return {
                wpId: r.wp_id,
                mediaId: r.media_id,
                title: r.title,
                type: r.type,
                path: r.episode_path || r.media_path,
                poster: r.poster,
                year: r.year,
                progressPct: pct,
                completed: !!r.completed,
                position: r.position,
                duration: r.duration,
                lastWatched: r.last_watched,
                episodeLabel,
            };
        });

        return NextResponse.json({ success: true, data, books, stats, total, page, hasMore: offset + limit < total });
    } catch (e: any) {
        console.error("History API error:", e);
        return NextResponse.json({ success: false, error: e.message }, { status: 500 });
    }
}

// POST: 标记为已看（completed=1）—— 只能改自己的记录
export async function POST(req: NextRequest) {
    try {
        const { wpId } = await req.json();
        if (!wpId) return NextResponse.json({ success: false, error: "Missing wpId" }, { status: 400 });
        const user = await resolveUserKeyOrNull(req);
        if (!user) return NextResponse.json({ success: false, error: "LOGIN_REQUIRED" }, { status: 401 });
        getDb().prepare("UPDATE watch_progress SET completed = 1 WHERE id = ? AND user_id = ?").run(wpId, user);
        return NextResponse.json({ success: true });
    } catch (e: any) {
        return NextResponse.json({ success: false, error: e.message }, { status: 500 });
    }
}

// DELETE: 移除一条历史记录 —— 只能删自己的记录
export async function DELETE(req: NextRequest) {
    try {
        const { wpId } = await req.json();
        if (!wpId) return NextResponse.json({ success: false, error: "Missing wpId" }, { status: 400 });
        const user = await resolveUserKeyOrNull(req);
        if (!user) return NextResponse.json({ success: false, error: "LOGIN_REQUIRED" }, { status: 401 });
        getDb().prepare("DELETE FROM watch_progress WHERE id = ? AND user_id = ?").run(wpId, user);
        return NextResponse.json({ success: true });
    } catch (e: any) {
        return NextResponse.json({ success: false, error: e.message }, { status: 500 });
    }
}
