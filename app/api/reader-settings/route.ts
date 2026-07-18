// 阅读器设置持久化（跟账号走，三层方案：书籍默认 < 用户级 < 单本书覆盖）。
// 表结构就地建在本路由内（不动 lib/db.ts，避免与并行改动冲突）。
// book_path = '' 表示用户级方案；非空表示对某一本书的单独覆盖。
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { resolveUserKeyOrNull } from "@/lib/identity";

let ensured = false;
function ensureTable() {
    if (ensured) return;
    getDb().exec(`
        CREATE TABLE IF NOT EXISTS reader_settings (
            user_id TEXT,
            book_path TEXT NOT NULL DEFAULT '',
            settings TEXT NOT NULL,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (user_id, book_path)
        )
    `);
    ensured = true;
}

// 只收白名单字段，防止垃圾数据膨胀
const ALLOWED_KEYS = ["fontSize", "theme", "font", "flow", "margin", "lineHeight", "bold", "ttsVoice", "ttsRate"] as const;
function sanitize(raw: unknown): Record<string, unknown> | null {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
    const src = raw as Record<string, unknown>;
    const clean: Record<string, unknown> = {};
    for (const k of ALLOWED_KEYS) {
        if (k in src) clean[k] = src[k];
    }
    return clean;
}

function parseRow(row: { settings: string } | undefined): unknown {
    if (!row) return null;
    try {
        return JSON.parse(row.settings);
    } catch {
        return null;
    }
}

// GET ?bookPath= → { userScheme, bookScheme }
export async function GET(req: NextRequest) {
    ensureTable();
    const user = await resolveUserKeyOrNull(req);
    // 未登录：无持久化方案，阅读器退回书籍默认（本次会话内可临时调，不落库）
    if (!user) return NextResponse.json({ success: true, userScheme: null, bookScheme: null });
    const bookPath = req.nextUrl.searchParams.get("bookPath") || "";
    const db = getDb();
    const userRow = db
        .prepare("SELECT settings FROM reader_settings WHERE user_id = ? AND book_path = ''")
        .get(user) as { settings: string } | undefined;
    const bookRow = bookPath
        ? (db
              .prepare("SELECT settings FROM reader_settings WHERE user_id = ? AND book_path = ?")
              .get(user, bookPath) as { settings: string } | undefined)
        : undefined;
    return NextResponse.json({
        success: true,
        userScheme: parseRow(userRow),
        bookScheme: parseRow(bookRow),
    });
}

// POST { scope: "user"|"book", bookPath?, settings } → upsert 对应层
export async function POST(req: NextRequest) {
    ensureTable();
    try {
        const { scope, bookPath, settings } = await req.json();
        if (scope !== "user" && scope !== "book") {
            return NextResponse.json({ success: false, error: "Invalid scope" }, { status: 400 });
        }
        if (scope === "book" && !bookPath) {
            return NextResponse.json({ success: false, error: "Missing bookPath" }, { status: 400 });
        }
        const clean = sanitize(settings);
        if (!clean) {
            return NextResponse.json({ success: false, error: "Invalid settings" }, { status: 400 });
        }
        const user = await resolveUserKeyOrNull(req);
        if (!user) return NextResponse.json({ success: false, error: "LOGIN_REQUIRED" }, { status: 401 });
        const keyPath = scope === "book" ? String(bookPath) : "";
        getDb()
            .prepare(
                `INSERT INTO reader_settings (user_id, book_path, settings)
                 VALUES (?, ?, ?)
                 ON CONFLICT(user_id, book_path)
                 DO UPDATE SET settings = excluded.settings, updated_at = CURRENT_TIMESTAMP`
            )
            .run(user, keyPath, JSON.stringify(clean));
        return NextResponse.json({ success: true, scope, settings: clean });
    } catch (error) {
        return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
    }
}

// DELETE { scope: "user"|"book", bookPath? } → 清除某一层方案（恢复到下一层）
export async function DELETE(req: NextRequest) {
    ensureTable();
    try {
        const { scope, bookPath } = await req.json();
        if (scope !== "user" && scope !== "book") {
            return NextResponse.json({ success: false, error: "Invalid scope" }, { status: 400 });
        }
        if (scope === "book" && !bookPath) {
            return NextResponse.json({ success: false, error: "Missing bookPath" }, { status: 400 });
        }
        const user = await resolveUserKeyOrNull(req);
        if (!user) return NextResponse.json({ success: false, error: "LOGIN_REQUIRED" }, { status: 401 });
        const keyPath = scope === "book" ? String(bookPath) : "";
        getDb()
            .prepare("DELETE FROM reader_settings WHERE user_id = ? AND book_path = ?")
            .run(user, keyPath);
        return NextResponse.json({ success: true });
    } catch (error) {
        return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
    }
}
