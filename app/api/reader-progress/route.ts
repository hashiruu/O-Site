// 阅读进度持久化（每用户一份，铁律：未登录不落库不提供）。
// GET  ?bookPath=   → { cfi, percent } 单本进度（续读用）
// GET  （无参数）    → { items: [{bookPath, title, percent, updatedAt}] } 全部进度（书架/正在阅读/首页续播用）
// POST { bookPath, cfi, percent, title } → upsert（percent 0-100）
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { resolveUserKeyOrNull } from "@/lib/identity";

export const dynamic = "force-dynamic";

let ensured = false;
function ensureTable() {
    if (ensured) return;
    getDb().exec(`
        CREATE TABLE IF NOT EXISTS reading_progress (
            user_id TEXT NOT NULL,
            book_path TEXT NOT NULL,
            title TEXT NOT NULL DEFAULT '',
            cfi TEXT NOT NULL DEFAULT '',
            percent REAL NOT NULL DEFAULT 0,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (user_id, book_path)
        )
    `);
    ensured = true;
}

export async function GET(req: NextRequest) {
    ensureTable();
    const user = await resolveUserKeyOrNull(req);
    // 未登录：无进度可言（阅读器照常从头看，不报错）
    if (!user) return NextResponse.json({ success: true, cfi: null, percent: 0, items: [] });

    const bookPath = req.nextUrl.searchParams.get("bookPath");
    const db = getDb();
    if (bookPath) {
        const row = db.prepare(
            "SELECT cfi, percent FROM reading_progress WHERE user_id = ? AND book_path = ?"
        ).get(user, bookPath) as { cfi: string; percent: number } | undefined;
        return NextResponse.json({ success: true, cfi: row?.cfi || null, percent: row?.percent || 0 });
    }
    const items = db.prepare(
        "SELECT book_path AS bookPath, title, percent, updated_at AS updatedAt FROM reading_progress WHERE user_id = ? ORDER BY updated_at DESC"
    ).all(user);
    return NextResponse.json({ success: true, items });
}

export async function POST(req: NextRequest) {
    ensureTable();
    const user = await resolveUserKeyOrNull(req);
    if (!user) return NextResponse.json({ success: false, error: "LOGIN_REQUIRED" }, { status: 401 });
    try {
        const { bookPath, cfi, percent, title } = await req.json();
        if (!bookPath || typeof bookPath !== "string") {
            return NextResponse.json({ success: false, error: "缺少 bookPath" }, { status: 400 });
        }
        const p = Math.min(100, Math.max(0, Number(percent) || 0));
        getDb().prepare(`
            INSERT INTO reading_progress (user_id, book_path, title, cfi, percent, updated_at)
            VALUES (?, ?, ?, ?, ?, datetime('now'))
            ON CONFLICT(user_id, book_path) DO UPDATE SET
              cfi = excluded.cfi,
              percent = excluded.percent,
              title = CASE WHEN excluded.title != '' THEN excluded.title ELSE reading_progress.title END,
              updated_at = excluded.updated_at
        `).run(user, bookPath, String(title || ""), String(cfi || ""), p);
        return NextResponse.json({ success: true });
    } catch (e) {
        return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
    }
}
