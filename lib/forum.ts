// 论坛地基：建表 + 限流 + 计分。
// 权限模型：登录即可用（不走内容 scope 授权）；guest 一律 401（全站铁律）。
// 限流：10 分钟滑动窗口，按用户按动作计数（forum_actions 流水，写时顺带清理 1 天前的旧行）。
import { getDb } from "./db";

let ensured = false;
export function ensureForumSchema(): void {
    if (ensured) return;
    const db = getDb();
    db.exec(`
        CREATE TABLE IF NOT EXISTS forum_posts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            author_name TEXT NOT NULL,
            title TEXT NOT NULL,
            body TEXT NOT NULL DEFAULT '',
            score INTEGER NOT NULL DEFAULT 0,
            comment_count INTEGER NOT NULL DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS forum_comments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            post_id INTEGER NOT NULL,
            parent_id INTEGER,
            user_id TEXT NOT NULL,
            author_name TEXT NOT NULL,
            body TEXT NOT NULL,
            score INTEGER NOT NULL DEFAULT 0,
            deleted INTEGER NOT NULL DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS forum_votes (
            user_id TEXT NOT NULL,
            target_type TEXT NOT NULL CHECK (target_type IN ('post','comment')),
            target_id INTEGER NOT NULL,
            value INTEGER NOT NULL CHECK (value IN (-1, 1)),
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (user_id, target_type, target_id)
        );
        CREATE TABLE IF NOT EXISTS forum_actions (
            user_id TEXT NOT NULL,
            kind TEXT NOT NULL,
            at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_forum_posts_created ON forum_posts(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_forum_comments_post ON forum_comments(post_id);
        CREATE INDEX IF NOT EXISTS idx_forum_actions_user ON forum_actions(user_id, kind, at);
    `);
    ensured = true;
}

// 10 分钟窗口内各动作的上限（家庭站规模，防手滑/防脚本刷屏）
export const RATE_LIMITS: Record<string, number> = { post: 3, comment: 15, vote: 60 };

/** 超限返回 true。未超限时记一笔动作流水（即"检查即消费"）。 */
export function rateLimitHit(userId: string, kind: "post" | "comment" | "vote"): boolean {
    ensureForumSchema();
    const db = getDb();
    const n = (db.prepare(
        "SELECT COUNT(*) c FROM forum_actions WHERE user_id = ? AND kind = ? AND at > datetime('now','-10 minutes')"
    ).get(userId, kind) as { c: number }).c;
    if (n >= RATE_LIMITS[kind]) return true;
    db.prepare("INSERT INTO forum_actions (user_id, kind) VALUES (?, ?)").run(userId, kind);
    // 顺带清理：流水只为限流服务，1 天前的没意义
    db.prepare("DELETE FROM forum_actions WHERE at < datetime('now','-1 day')").run();
    return false;
}

/** 重算某个对象的得分（票数和），并回写到 posts/comments.score，返回新分 */
export function recomputeScore(targetType: "post" | "comment", targetId: number): number {
    const db = getDb();
    const score = (db.prepare(
        "SELECT COALESCE(SUM(value), 0) s FROM forum_votes WHERE target_type = ? AND target_id = ?"
    ).get(targetType, targetId) as { s: number }).s;
    const table = targetType === "post" ? "forum_posts" : "forum_comments";
    db.prepare(`UPDATE ${table} SET score = ? WHERE id = ?`).run(score, targetId);
    return score;
}

/** Reddit 式热度：score / (小时龄 + 2)^1.5（JS 计算，避免依赖 SQLite pow） */
export function hotRank(score: number, createdAt: string): number {
    const ageHours = Math.max(0, (Date.now() - new Date(createdAt.replace(" ", "T") + "Z").getTime()) / 3600000);
    return score / Math.pow(ageHours + 2, 1.5);
}
