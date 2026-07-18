// /api/admin/activity — boss 专属：查某用户的四类行为。
// GET ?email=X&type=watch|favorites|playlists|search|logins&limit=50
import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { getDb } from "@/lib/db";
import { getRole, canManageUsers } from "@/lib/roles";

export const dynamic = "force-dynamic";

const FAVORITES_FILE = path.join(process.cwd(), "list", "favorites.json");

export async function GET(req: NextRequest) {
    const role = await getRole(req);
    if (!canManageUsers(role)) return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });

    const email = (req.nextUrl.searchParams.get("email") || "").toLowerCase();
    const type = req.nextUrl.searchParams.get("type") || "watch";
    const limit = Math.min(parseInt(req.nextUrl.searchParams.get("limit") || "50", 10) || 50, 200);
    if (!email) return NextResponse.json({ success: false, error: "Missing email" }, { status: 400 });

    const db = getDb();

    if (type === "watch") {
        const rows = db.prepare(`
            SELECT wp.id, wp.position, wp.duration, wp.completed, wp.last_watched,
                   m.title, m.type, m.poster, m.year,
                   e.season, e.episode, e.title AS episode_title
            FROM watch_progress wp
            JOIN media m ON m.id = wp.media_id
            LEFT JOIN episodes e ON e.id = wp.episode_id
            WHERE wp.user_id = ?
            ORDER BY wp.last_watched DESC LIMIT ?
        `).all(email, limit);
        return NextResponse.json({ success: true, data: rows });
    }

    if (type === "favorites") {
        try {
            const raw = JSON.parse(fs.readFileSync(FAVORITES_FILE, "utf-8"));
            const items = raw?.users?.[email] || [];
            return NextResponse.json({ success: true, data: items.slice(0, limit) });
        } catch {
            return NextResponse.json({ success: true, data: [] });
        }
    }

    if (type === "playlists") {
        const lists = db.prepare("SELECT id, name, created_at FROM playlists WHERE user_id = ? ORDER BY created_at DESC").all(email);
        return NextResponse.json({ success: true, data: lists });
    }

    if (type === "search") {
        const rows = db.prepare("SELECT query, at FROM search_logs WHERE email = ? ORDER BY at DESC LIMIT ?").all(email, limit);
        return NextResponse.json({ success: true, data: rows });
    }

    if (type === "logins") {
        const rows = db.prepare("SELECT ip, ua, at FROM logins WHERE email = ? ORDER BY at DESC LIMIT ?").all(email, limit);
        return NextResponse.json({ success: true, data: rows });
    }

    return NextResponse.json({ success: false, error: "Invalid type" }, { status: 400 });
}
