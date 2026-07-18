// /api/admin/users — boss 专属：用户管理 + 行为统计。
// GET  → 列出所有用户（带观看/收藏/搜索计数 + 最近登录）
// PATCH {email, role} → 改角色（admin/regular/banned；boss 不可改）
import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { getDb } from "@/lib/db";
import { getRole, canManageUsers } from "@/lib/roles";

export const dynamic = "force-dynamic";

const FAVORITES_FILE = path.join(process.cwd(), "list", "favorites.json");
function readFavorites(): Record<string, unknown[]> {
    try {
        const raw = JSON.parse(fs.readFileSync(FAVORITES_FILE, "utf-8"));
        if (raw?.version === 2 && raw.users) return raw.users as Record<string, unknown[]>;
    } catch { /* noop */ }
    return {};
}

export async function GET(req: NextRequest) {
    const role = await getRole(req);
    if (!canManageUsers(role)) return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });

    const db = getDb();
    const users = db.prepare(
        "SELECT email, role, name, avatar, created_at, last_seen FROM users ORDER BY last_seen DESC"
    ).all() as { email: string; role: string; name: string | null; avatar: string | null; created_at: string; last_seen: string }[];

    const watchCounts = Object.fromEntries(
        (db.prepare("SELECT user_id, COUNT(*) c FROM watch_progress GROUP BY user_id").all() as { user_id: string; c: number }[])
            .map((r) => [r.user_id, r.c])
    );
    const searchCounts = Object.fromEntries(
        (db.prepare("SELECT email, COUNT(*) c FROM search_logs GROUP BY email").all() as { email: string; c: number }[])
            .map((r) => [r.email, r.c])
    );
    const favs = readFavorites();
    const lastLogins = Object.fromEntries(
        (db.prepare("SELECT email, MAX(at) at FROM logins GROUP BY email").all() as { email: string; at: string }[])
            .map((r) => [r.email, r.at])
    );

    const data = users.map((u) => ({
        ...u,
        watchCount: watchCounts[u.email] || 0,
        favCount: (favs[u.email]?.length) || 0,
        searchCount: searchCounts[u.email] || 0,
        lastLoginAt: lastLogins[u.email] || null,
    }));

    return NextResponse.json({
        success: true,
        data,
        stats: {
            total: users.length,
            admins: users.filter((u) => u.role === "admin" || u.role === "boss").length,
            regulars: users.filter((u) => u.role === "regular").length,
            banned: users.filter((u) => u.role === "banned").length,
        },
    });
}

export async function PATCH(req: NextRequest) {
    const role = await getRole(req);
    if (!canManageUsers(role)) return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
    const { email, role: newRole } = await req.json();
    if (!email || !newRole) return NextResponse.json({ success: false, error: "Missing email/role" }, { status: 400 });
    if (!["admin", "regular", "banned"].includes(newRole)) {
        return NextResponse.json({ success: false, error: "Invalid role（仅可设 admin/regular/banned，boss 由 env 决定）" }, { status: 400 });
    }
    const db = getDb();
    const target = db.prepare("SELECT role FROM users WHERE email = ?").get((email as string).toLowerCase()) as { role: string } | undefined;
    if (!target) return NextResponse.json({ success: false, error: "用户不存在" }, { status: 404 });
    if (target.role === "boss") return NextResponse.json({ success: false, error: "不能修改 boss" }, { status: 400 });
    db.prepare("UPDATE users SET role = ? WHERE email = ?").run(newRole, (email as string).toLowerCase());
    return NextResponse.json({ success: true, data: { email, role: newRole } });
}
