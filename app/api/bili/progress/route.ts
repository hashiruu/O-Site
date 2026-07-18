import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { resolveUserKeyOrNull } from "@/lib/identity";

export const dynamic = "force-dynamic";

// ── B站嵌入观看进度 ──
// GET    /api/bili/progress            → 当前用户的续看列表（新→旧）
// POST   /api/bili/progress { bvid, title, cover, author, seconds? } → upsert
//        （iframe 跨域读不到播放器进度，seconds 由前端"观看时长心跳"估算 + 手动记录点）
// DELETE /api/bili/progress { bvid }   → 移除一条

let ensured = false;
function ensureTable() {
    if (ensured) return;
    getDb().exec(`
        CREATE TABLE IF NOT EXISTS bili_progress (
            user_id TEXT NOT NULL,
            bvid TEXT NOT NULL,
            title TEXT NOT NULL DEFAULT '',
            cover TEXT,
            author TEXT,
            seconds INTEGER NOT NULL DEFAULT 0,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (user_id, bvid)
        )
    `);
    ensured = true;
}

export async function GET(req: NextRequest) {
    const user = await resolveUserKeyOrNull(req);
    if (!user) return NextResponse.json({ success: true, data: [] });
    ensureTable();
    const rows = getDb().prepare(
        "SELECT bvid, title, cover, author, seconds, updated_at FROM bili_progress WHERE user_id = ? ORDER BY updated_at DESC LIMIT 30"
    ).all(user);
    return NextResponse.json({ success: true, data: rows });
}

export async function POST(req: NextRequest) {
    const user = await resolveUserKeyOrNull(req);
    if (!user) return NextResponse.json({ success: false, error: "LOGIN_REQUIRED" }, { status: 401 });
    ensureTable();
    const body = await req.json();
    const bvid = String(body.bvid || "").replace(/[^a-zA-Z0-9]/g, "");
    if (!bvid) return NextResponse.json({ success: false, error: "BAD_BVID" }, { status: 400 });
    getDb().prepare(
        `INSERT INTO bili_progress (user_id, bvid, title, cover, author, seconds, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(user_id, bvid) DO UPDATE SET
           title = CASE WHEN excluded.title != '' THEN excluded.title ELSE bili_progress.title END,
           cover = COALESCE(excluded.cover, bili_progress.cover),
           author = COALESCE(excluded.author, bili_progress.author),
           seconds = MAX(bili_progress.seconds, excluded.seconds),
           updated_at = datetime('now')`
    ).run(user, bvid, String(body.title || ""), body.cover || null, body.author || null, Math.max(0, Math.floor(Number(body.seconds) || 0)));
    return NextResponse.json({ success: true });
}

export async function DELETE(req: NextRequest) {
    const user = await resolveUserKeyOrNull(req);
    if (!user) return NextResponse.json({ success: false, error: "LOGIN_REQUIRED" }, { status: 401 });
    ensureTable();
    const { bvid } = await req.json();
    getDb().prepare("DELETE FROM bili_progress WHERE user_id = ? AND bvid = ?").run(user, String(bvid || ""));
    return NextResponse.json({ success: true });
}
