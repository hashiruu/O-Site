// 书籍笔记（Notes）：每用户每书一份。两类：
//   highlight — 荧光笔标注：{ cfi, text, color }（cfi 用于跳转回原位、重绘高亮）
//   image     — 从正文拖入的图片：{ src(dataURL 或书内路径), cfi?, caption? }
// GET  ?bookPath=        → 该书全部笔记（新→旧）
// POST { bookPath, note } → 新增一条，返回带 id 的完整记录
// DELETE { bookPath, id } → 删一条
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { resolveUserKeyOrNull } from "@/lib/identity";

export const dynamic = "force-dynamic";

let ensured = false;
function ensureTable() {
    if (ensured) return;
    getDb().exec(`
        CREATE TABLE IF NOT EXISTS book_notes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            book_path TEXT NOT NULL,
            kind TEXT NOT NULL,          -- highlight | image
            cfi TEXT NOT NULL DEFAULT '',
            text TEXT NOT NULL DEFAULT '',
            color TEXT NOT NULL DEFAULT '',
            src TEXT NOT NULL DEFAULT '', -- 图片 dataURL / 书内路径
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_book_notes_user_book ON book_notes(user_id, book_path, id);
    `);
    ensured = true;
}

const MAX_IMG = 3_000_000; // 单图上限 ~3MB（dataURL 长度）

export async function GET(req: NextRequest) {
    ensureTable();
    const user = await resolveUserKeyOrNull(req);
    if (!user) return NextResponse.json({ success: true, notes: [] }); // 未登录：无笔记
    const bookPath = req.nextUrl.searchParams.get("bookPath") || "";
    const rows = getDb().prepare(
        "SELECT id, kind, cfi, text, color, src, created_at AS createdAt FROM book_notes WHERE user_id = ? AND book_path = ? ORDER BY id DESC"
    ).all(user, bookPath);
    return NextResponse.json({ success: true, notes: rows });
}

export async function POST(req: NextRequest) {
    ensureTable();
    const user = await resolveUserKeyOrNull(req);
    if (!user) return NextResponse.json({ success: false, error: "LOGIN_REQUIRED" }, { status: 401 });
    try {
        const { bookPath, note } = await req.json();
        if (!bookPath || !note?.kind) return NextResponse.json({ success: false, error: "参数缺失" }, { status: 400 });
        const kind = note.kind === "image" ? "image" : "highlight";
        const src = String(note.src || "");
        if (kind === "image" && src.length > MAX_IMG) {
            return NextResponse.json({ success: false, error: "图片过大（超 3MB）" }, { status: 400 });
        }
        const info = getDb().prepare(
            "INSERT INTO book_notes (user_id, book_path, kind, cfi, text, color, src) VALUES (?, ?, ?, ?, ?, ?, ?)"
        ).run(user, String(bookPath), kind, String(note.cfi || ""), String(note.text || "").slice(0, 4000), String(note.color || ""), src);
        const row = getDb().prepare(
            "SELECT id, kind, cfi, text, color, src, created_at AS createdAt FROM book_notes WHERE id = ?"
        ).get(Number(info.lastInsertRowid));
        return NextResponse.json({ success: true, note: row });
    } catch (e) {
        return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
    }
}

export async function DELETE(req: NextRequest) {
    ensureTable();
    const user = await resolveUserKeyOrNull(req);
    if (!user) return NextResponse.json({ success: false, error: "LOGIN_REQUIRED" }, { status: 401 });
    try {
        const { id } = await req.json();
        getDb().prepare("DELETE FROM book_notes WHERE id = ? AND user_id = ?").run(Number(id), user);
        return NextResponse.json({ success: true });
    } catch (e) {
        return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
    }
}
