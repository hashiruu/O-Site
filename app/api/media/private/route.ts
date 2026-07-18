import { NextRequest, NextResponse } from "next/server";
import { getPrivatePassword, setPrivatePassword, isPrivatePasswordSet } from "@/lib/db";
import { TRUST_COOKIE, TRUST_MAX_AGE, issueTrustToken, verifyTrustToken } from "@/lib/deviceTrust";
import crypto from "crypto";

// 简单哈希函数
function hashPassword(password: string): string {
    return crypto.createHash("sha256").update(password).digest("hex");
}

// POST: 验证密码 / 设置密码
export async function POST(request: NextRequest) {
    try {
        const { action, password } = await request.json();

        if (!password || typeof password !== "string") {
            return NextResponse.json(
                { success: false, error: "密码不能为空" },
                { status: 400 }
            );
        }

        const hashed = hashPassword(password);

        if (action === "setup") {
            // 首次设置密码
            if (isPrivatePasswordSet()) {
                return NextResponse.json(
                    { success: false, error: "密码已设置，请先验证旧密码" },
                    { status: 400 }
                );
            }
            setPrivatePassword(hashed);
            return NextResponse.json({ success: true, data: { message: "密码设置成功" } });
        }

        if (action === "verify") {
            // 验证密码；成功 →
            // ① 种设备信任 cookie（1 年），该设备后续免输；
            // ② 若当前是登录账户，同时记账户级授权（private_grants）：该账户换设备也免输。
            const stored = getPrivatePassword();
            if (!stored) {
                return NextResponse.json(
                    { success: false, error: "尚未设置密码" },
                    { status: 400 }
                );
            }
            const valid = stored === hashed;
            const res = NextResponse.json({
                success: valid,
                error: valid ? undefined : "密码错误",
            });
            if (valid) {
                res.cookies.set(TRUST_COOKIE, issueTrustToken(), {
                    httpOnly: true, sameSite: "lax", path: "/", maxAge: TRUST_MAX_AGE,
                });
                try {
                    const { auth } = await import("@/auth");
                    const { recordPrivateGrant } = await import("@/lib/identity");
                    const email = (await auth())?.user?.email?.toLowerCase();
                    if (email) recordPrivateGrant(email);
                } catch { /* 未配置 auth 时仅设备级记忆 */ }
            }
            return res;
        }

        return NextResponse.json(
            { success: false, error: "无效操作" },
            { status: 400 }
        );
    } catch (error) {
        console.error("私密空间验证失败:", error);
        return NextResponse.json(
            { success: false, error: "验证失败" },
            { status: 500 }
        );
    }
}

// GET: 检查密码是否已设置 + 本请求是否已授权（设备信任 cookie or Google 会话）
export async function GET(request: NextRequest) {
    try {
        const { isPrivilegedRequest } = await import("@/lib/access");
        const hasPassword = isPrivatePasswordSet();
        const trusted = await isPrivilegedRequest(request);
        return NextResponse.json({ success: true, data: { hasPassword, trusted } });
    } catch (error) {
        console.error("检查私密空间状态失败:", error);
        return NextResponse.json(
            { success: false, error: "检查失败" },
            { status: 500 }
        );
    }
}
