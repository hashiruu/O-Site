"use client";

// 全站登录态 hook：包一层 /api/auth/me。
// 铁律：未登录（guest）不记录任何数据、不提供个人化功能——
// 个人页面用 loggedIn 决定是否渲染功能本体（false 时上 <LoginGate />）。
import { useEffect, useState } from "react";

export interface Me {
    user: { email: string; name?: string | null; image?: string | null } | null;
    role: "boss" | "admin" | "regular" | "guest";
    permissions: string | null;
}

export function useMe() {
    const [me, setMe] = useState<Me | null>(null); // null = 还在查
    useEffect(() => {
        let alive = true;
        fetch("/api/auth/me")
            .then((r) => r.json())
            .then((d) => { if (alive) setMe(d); })
            .catch(() => { if (alive) setMe({ user: null, role: "guest", permissions: null }); });
        return () => { alive = false; };
    }, []);
    return {
        me,
        loading: me === null,
        loggedIn: !!me?.user,
    };
}
