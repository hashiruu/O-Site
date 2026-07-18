import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { resolveUserKeyOrNull } from "@/lib/identity";
import { getAccess, typeFilterSql } from "@/lib/roles";

export const dynamic = 'force-dynamic';

// 首页「继续观看」货架数据源（按当前用户隔离）
// 影音：watch_progress 未看完条目；书籍：reading_progress 在读条目（type='book'，
// 前端据此改跳阅读器）。两类按最近活动时间合并倒序，共 12 个。
export async function GET(req: NextRequest) {
    try {
        const db = getDb();
        const user = await resolveUserKeyOrNull(req);
        if (!user) return NextResponse.json({ success: true, data: [] }); // 未登录：首页不出续播货架
        const typeFilter = typeFilterSql(await getAccess(req), "m.type");

        // completed=0：未看完（progress API 在 position/duration>0.9 时置 completed=1）
        // 过滤"点开几秒就退"的噪音：长视频用绝对秒数(position>30)，
        // 短视频(travel 相册可能只有几十秒)用比例(已看>5%)，两者满足其一即算"在看"
        // type!='private'：私密内容不上首页
        const rows = db.prepare(`
            SELECT
                wp.position, wp.duration, wp.last_watched, wp.episode_id,
                m.id   AS media_id,
                m.title, m.type, m.path AS media_path,
                m.poster, m.backdrop, m.year, m.rating,
                e.path AS episode_path, e.season, e.episode, e.title AS episode_title
            FROM watch_progress wp
            JOIN media m     ON m.id = wp.media_id
            LEFT JOIN episodes e ON e.id = wp.episode_id
            WHERE wp.completed = 0
              AND wp.user_id = ?
              AND ${typeFilter}
              AND (
                wp.position > 30
                OR (wp.duration > 0 AND wp.position * 1.0 / wp.duration > 0.05)
              )
            ORDER BY wp.last_watched DESC
            LIMIT 12
        `).all(user) as any[];

        // ── 在读书籍：reading_progress（0<percent<100 或刚开卷），跟影音同台竞位 ──
        // 书籍 scope 没开的用户不出书
        interface Shelf { sortAt: string; item: any }
        const bookRows: Shelf[] = [];
        try {
            const { allows } = await import("@/lib/roles");
            const access = await (await import("@/lib/roles")).getAccess(req);
            if (allows(access, "book")) {
                const books = db.prepare(`
                    SELECT book_path, title, percent, updated_at FROM reading_progress
                    WHERE user_id = ? AND percent < 100
                    ORDER BY updated_at DESC LIMIT 6
                `).all(user) as any[];
                for (const b of books) {
                    bookRows.push({
                        sortAt: b.updated_at,
                        item: {
                            id: `book:${b.book_path}`,
                            mediaId: null,
                            title: b.title || b.book_path.split("/").pop(),
                            type: "book",
                            path: b.book_path,
                            poster: `/api/books/cover?path=${encodeURIComponent(b.book_path)}`,
                            backdrop: null,
                            year: null,
                            rating: null,
                            progressPct: Math.round(b.percent),
                            episodeLabel: null,
                        },
                    });
                }
            }
        } catch { /* reading_progress 表还没建（没人读过书）→ 只出影音 */ }

        const data = rows.map(r => {
            const pct = r.duration > 0
                ? Math.min(100, Math.max(0, Math.round((r.position / r.duration) * 100)))
                : 0;
            // 续播入口：剧集用「上次看的那一集」path，电影用 media.path 本体
            // （watch 页的 progress GET 会按 filePath 查 position 并自动 seek）
            const resumePath = r.episode_path || r.media_path;

            let episodeLabel: string | null = null;
            if (r.episode_id) {
                // 多季剧显示 S2 E5；单季/绝对集数（如柯南 538 集）显示「第 N 集」更直观
                if (r.season && r.season > 1 && r.episode) episodeLabel = `S${r.season} E${r.episode}`;
                else if (r.episode) episodeLabel = `第 ${r.episode} 集`;
                else if (r.episode_title) episodeLabel = r.episode_title;
            }

            return {
                sortAt: r.last_watched as string,
                item: {
                    id: r.media_id,
                    mediaId: r.media_id,
                    title: r.title,
                    type: r.type,
                    path: resumePath,
                    poster: r.poster,
                    backdrop: r.backdrop,
                    year: r.year,
                    rating: r.rating,
                    progressPct: pct,
                    episodeLabel,
                },
            };
        });

        // 影音 + 书籍按最近活动时间合并，取前 12
        const merged = [...data, ...bookRows]
            .sort((a, b) => (b.sortAt || "").localeCompare(a.sortAt || ""))
            .slice(0, 12)
            .map((x) => x.item);

        return NextResponse.json({ success: true, data: merged });
    } catch (e: any) {
        console.error('Continue Watching API Error:', e);
        return NextResponse.json({ success: false, error: e.message }, { status: 500 });
    }
}
