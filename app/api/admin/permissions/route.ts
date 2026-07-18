// /api/admin/permissions — boss 专属：管理用户内容范围授权（user_permissions 表）。
// scope = 用户可见的栏目类别集合，覆盖全站：媒体类型 + 书架/直播/体育/Missed 栏目。
// GET  ?email= → 返回某用户授权 scope；不带 email → 列出所有授权
// POST {email, scope} → 设授权（scope="*" 全放；"movie,book" 多类；空串=删授权→回到空白网站）
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getRole, canManageUsers, getUserPermission, setUserPermission } from "@/lib/roles";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
    const role = await getRole(req);
    if (!canManageUsers(role)) return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
    const email = req.nextUrl.searchParams.get("email");
    if (email) {
        return NextResponse.json({ success: true, data: { email, scope: getUserPermission(email) } });
    }
    const rows = getDb().prepare("SELECT user_id, scope, granted_at FROM user_permissions ORDER BY granted_at DESC").all();
    return NextResponse.json({ success: true, data: rows });
}

export async function POST(req: NextRequest) {
    const role = await getRole(req);
    if (!canManageUsers(role)) return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
    const { email, scope } = await req.json();
    if (!email || typeof email !== "string") return NextResponse.json({ success: false, error: "Missing email" }, { status: 400 });
    // scope 校验：允许 "*" 或逗号分隔的类别；空串=删除授权。
    // private/travel/theater相册/日常 是 boss 专属（BOSS_ONLY_TYPES），不可授权，不在此列
    const validTypes = ["movie", "series", "anime", "book", "live", "sports", "missed", "musical", "notes"];
    let cleanScope: string | null = null;
    if (typeof scope === "string" && scope.trim()) {
        if (scope.trim() === "*") cleanScope = "*";
        else {
            const parts = scope.split(",").map((s) => s.trim().toLowerCase()).filter((s) => validTypes.includes(s));
            if (parts.length === 0) return NextResponse.json({ success: false, error: "Invalid scope" }, { status: 400 });
            cleanScope = parts.join(",");
        }
    }
    setUserPermission(email, cleanScope);
    return NextResponse.json({ success: true, data: { email, scope: cleanScope } });
}
