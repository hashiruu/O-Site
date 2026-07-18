// /api/auth/me — 返回当前用户身份 + 角色 + 播放授权（前端 Header/页面用）。
// 比 /api/auth/session 多了 role 和 permissions，且未登录返回明确 guest。
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getRoleByEmail, getUserPermission } from "@/lib/roles";

export const dynamic = "force-dynamic";

export async function GET() {
    const session = await auth();
    const email = session?.user?.email;
    if (!email) {
        return NextResponse.json({ user: null, role: "guest", permissions: null });
    }
    const role = getRoleByEmail(email);
    const permissions = role === "boss" || role === "admin" ? "*" : getUserPermission(email);
    return NextResponse.json({
        user: { email, name: session.user.name, image: session.user.image },
        role,
        permissions,
    });
}
