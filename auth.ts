// NextAuth v5 配置：Google 登录 + role 注入 session + 登录留痕。
// 三层身份见 lib/roles.ts。登录即注册为 regular（boss 邮箱强制 boss）。
//
// AUTH_URL 不再硬编码（.env.local 已删此行）。
// 由 middleware 在 /api/auth/* 路径上把真实入口域名注入 x-forwarded-host，
// NextAuth v5 trustHost 模式据此自动生成正确回调 URL（tailnet / 公网域名 / 局域网各自对）。
import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { getRoleByEmail, upsertUserOnLogin } from "@/lib/roles";

export const { handlers, auth, signIn, signOut } = NextAuth({
    providers: [Google],
    trustHost: true,
    callbacks: {
        // session 注入 role：每次请求按 email 查 DB（轻量，可接受）
        async session({ session }) {
            if (session.user?.email) {
                (session.user as { role?: string }).role = getRoleByEmail(session.user.email);
            }
            return session;
        },
    },
    events: {
        // 登录成功：upsert 用户 + 写 logins 留痕（IP/UA 在 callback 里用 headers() 补）
        async signIn({ user }) {
            if (user?.email) {
                try {
                    const { headers } = await import("next/headers");
                    const h = await headers();
                    const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim()
                        || h.get("x-real-ip") || null;
                    const ua = h.get("user-agent") || null;
                    upsertUserOnLogin(user.email, user.name, user.image, ip, ua);
                } catch { /* 留痕失败不阻断登录 */ }
            }
        },
    },
});
