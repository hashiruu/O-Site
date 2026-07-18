import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { resolveUserKeyOrNull } from "@/lib/identity";
import crypto from "crypto";

export const dynamic = "force-dynamic";

// ── 笔记（iPad 备忘录式，每用户私有） ──
// GET    /api/notes            → 我的笔记列表（新→旧）+ 书籍笔记 ref（只读并入）
// POST   /api/notes            → { id?, title, content } 建/改（upsert，自动保存友好）
// DELETE /api/notes { id }     → 删一条
// 书籍笔记同步：book_notes（阅读器荧光笔/图片）以 ref 形式出现在列表——
// 按书聚合成"一本书一条"，只读，点击跳回阅读器原位。

let ensured = false;
function ensureTable() {
    if (ensured) return;
    getDb().exec(`
        CREATE TABLE IF NOT EXISTS user_notes (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            title TEXT NOT NULL DEFAULT '',
            content TEXT NOT NULL DEFAULT '',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_user_notes ON user_notes(user_id, updated_at DESC);
    `);
    ensured = true;
}

export async function GET(req: NextRequest) {
    const user = await resolveUserKeyOrNull(req);
    if (!user) return NextResponse.json({ success: false, error: "LOGIN_REQUIRED" }, { status: 401 });
    ensureTable();
    const db = getDb();
    const notes = db.prepare(
        "SELECT id, title, content, created_at, updated_at FROM user_notes WHERE user_id = ? ORDER BY updated_at DESC"
    ).all(user);

    // 书籍笔记 ref：按书聚合（书名取 reading_progress 里的 title，兜底文件名）
    let bookRefs: { bookPath: string; bookTitle: string; count: number; latest: string; preview: string }[] = [];
    try {
        const rows = db.prepare(
            `SELECT bn.book_path AS bookPath,
                    COALESCE(NULLIF(rp.title, ''), bn.book_path) AS bookTitle,
                    COUNT(*) AS count,
                    MAX(bn.created_at) AS latest,
                    (SELECT text FROM book_notes b2 WHERE b2.user_id = bn.user_id AND b2.book_path = bn.book_path AND b2.text != '' ORDER BY b2.id DESC LIMIT 1) AS preview
             FROM book_notes bn
             LEFT JOIN reading_progress rp ON rp.user_id = bn.user_id AND rp.book_path = bn.book_path
             WHERE bn.user_id = ?
             GROUP BY bn.book_path
             ORDER BY latest DESC`
        ).all(user) as typeof bookRefs;
        bookRefs = rows.map((r) => ({
            ...r,
            bookTitle: r.bookTitle.includes("/") ? (r.bookTitle.split("/").pop() || r.bookTitle).replace(/\.(epub|pdf|md|mobi)$/i, "") : r.bookTitle,
            preview: (r.preview || "").slice(0, 80),
        }));
    } catch { /* book_notes 表不存在时忽略 */ }

    return NextResponse.json({ success: true, data: { notes, bookRefs } });
}

export async function POST(req: NextRequest) {
    const user = await resolveUserKeyOrNull(req);
    if (!user) return NextResponse.json({ success: false, error: "LOGIN_REQUIRED" }, { status: 401 });
    ensureTable();
    const body = await req.json();
    const db = getDb();
    const id = String(body.id || "") || crypto.randomUUID();
    const title = String(body.title || "").slice(0, 200);
    const content = String(body.content || "").slice(0, 100_000);
    // 只允许改自己的：upsert 带 user_id 条件（他人 id 撞进来会因主键冲突且 user 不符而拒绝）
    const exist = db.prepare("SELECT user_id FROM user_notes WHERE id = ?").get(id) as { user_id: string } | undefined;
    if (exist && exist.user_id !== user) return NextResponse.json({ success: false, error: "FORBIDDEN" }, { status: 403 });
    db.prepare(
        `INSERT INTO user_notes (id, user_id, title, content, updated_at) VALUES (?, ?, ?, ?, datetime('now'))
         ON CONFLICT(id) DO UPDATE SET title = excluded.title, content = excluded.content, updated_at = datetime('now')`
    ).run(id, user, title, content);
    return NextResponse.json({ success: true, id });
}

export async function DELETE(req: NextRequest) {
    const user = await resolveUserKeyOrNull(req);
    if (!user) return NextResponse.json({ success: false, error: "LOGIN_REQUIRED" }, { status: 401 });
    ensureTable();
    const { id } = await req.json();
    getDb().prepare("DELETE FROM user_notes WHERE id = ? AND user_id = ?").run(String(id || ""), user);
    return NextResponse.json({ success: true });
}
