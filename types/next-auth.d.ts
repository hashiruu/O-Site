// NextAuth 类型增强：Session/JWT 加 role 字段（来自 lib/roles.ts 的 Role）
import type { DefaultSession } from "next-auth";

declare module "next-auth" {
    interface Session {
        user: {
            role?: "boss" | "admin" | "regular" | "guest";
        } & DefaultSession["user"];
    }
}

declare module "next-auth/jwt" {
    interface JWT {
        role?: string;
    }
}
