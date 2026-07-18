import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { resolveUserKeyOrNull } from "@/lib/identity";
import crypto from "crypto";
import path from "path";

// 播放列表条目直接按文件路径存储（媒体库以剧集文件为最小播放单元）
function ensureTables() {
    const db = getDb();
    db.exec(`
        CREATE TABLE IF NOT EXISTS playlist_items (
            playlist_id TEXT NOT NULL,
            path TEXT NOT NULL,
            title TEXT NOT NULL,
            sort_order INTEGER NOT NULL DEFAULT 0,
            added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (playlist_id, path),
            FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE
        )
    `);
    return db;
}

// GET: 不带 id 返回当前用户的全部列表（含条目数与封面缩略路径），带 id 返回单个列表详情（须归属本人）
export async function GET(req: NextRequest) {
    try {
        const db = ensureTables();
        const user = await resolveUserKeyOrNull(req);
        if (!user) return NextResponse.json({ success: false, error: "LOGIN_REQUIRED" }, { status: 401 });
        const id = req.nextUrl.searchParams.get("id");

        if (id) {
            const playlist = db.prepare("SELECT * FROM playlists WHERE id = ? AND user_id = ?").get(id, user);
            if (!playlist) {
                return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });
            }
            const items = db.prepare(
                "SELECT path, title, sort_order, added_at FROM playlist_items WHERE playlist_id = ? ORDER BY sort_order ASC, added_at ASC"
            ).all(id);
            return NextResponse.json({ success: true, data: { ...playlist, items } });
        }

        const playlists = db.prepare(`
            SELECT p.*,
                   (SELECT COUNT(*) FROM playlist_items pi WHERE pi.playlist_id = p.id) AS itemCount,
                   (SELECT pi.path FROM playlist_items pi WHERE pi.playlist_id = p.id ORDER BY pi.sort_order ASC, pi.added_at ASC LIMIT 1) AS firstItemPath
            FROM playlists p
            WHERE p.user_id = ?
            ORDER BY p.created_at DESC
        `).all(user);
        return NextResponse.json({ success: true, data: playlists });
    } catch (error) {
        console.error("Playlists GET error:", error);
        return NextResponse.json({ success: false, error: "Internal Server Error" }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    try {
        const db = ensureTables();
        const user = await resolveUserKeyOrNull(req);
        if (!user) return NextResponse.json({ success: false, error: "LOGIN_REQUIRED" }, { status: 401 });
        const body = await req.json();
        const { action } = body;

        // 归属校验：改/删/加条目前确认列表属于当前用户
        const owns = (id: string) => !!db.prepare("SELECT 1 FROM playlists WHERE id = ? AND user_id = ?").get(id, user);

        if (action === "create") {
            const name = (body.name || "").trim();
            if (!name) return NextResponse.json({ success: false, error: "名称不能为空" }, { status: 400 });
            const id = crypto.randomUUID();
            db.prepare("INSERT INTO playlists (id, name, user_id) VALUES (?, ?, ?)").run(id, name, user);
            return NextResponse.json({ success: true, data: { id, name } });
        }

        if (action === "rename") {
            const name = (body.name || "").trim();
            if (!body.id || !name) return NextResponse.json({ success: false, error: "缺少参数" }, { status: 400 });
            if (!owns(body.id)) return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });
            db.prepare("UPDATE playlists SET name = ? WHERE id = ?").run(name, body.id);
            return NextResponse.json({ success: true });
        }

        if (action === "delete") {
            if (!body.id) return NextResponse.json({ success: false, error: "缺少 id" }, { status: 400 });
            if (!owns(body.id)) return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });
            db.prepare("DELETE FROM playlist_items WHERE playlist_id = ?").run(body.id);
            db.prepare("DELETE FROM playlists WHERE id = ?").run(body.id);
            return NextResponse.json({ success: true });
        }

        if (action === "add") {
            const { id, filePath, title } = body;
            if (!id || !filePath) return NextResponse.json({ success: false, error: "缺少参数" }, { status: 400 });
            if (!owns(id)) return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });
            const maxOrder = (db.prepare(
                "SELECT COALESCE(MAX(sort_order), -1) AS m FROM playlist_items WHERE playlist_id = ?"
            ).get(id) as { m: number }).m;
            db.prepare(
                "INSERT OR IGNORE INTO playlist_items (playlist_id, path, title, sort_order) VALUES (?, ?, ?, ?)"
            ).run(id, filePath, title || path.basename(filePath), maxOrder + 1);
            return NextResponse.json({ success: true });
        }

        if (action === "remove") {
            const { id, filePath } = body;
            if (!id || !filePath) return NextResponse.json({ success: false, error: "缺少参数" }, { status: 400 });
            if (!owns(id)) return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });
            db.prepare("DELETE FROM playlist_items WHERE playlist_id = ? AND path = ?").run(id, filePath);
            return NextResponse.json({ success: true });
        }

        return NextResponse.json({ success: false, error: "Invalid action" }, { status: 400 });
    } catch (error) {
        console.error("Playlists POST error:", error);
        return NextResponse.json({ success: false, error: "Internal Server Error" }, { status: 500 });
    }
}
