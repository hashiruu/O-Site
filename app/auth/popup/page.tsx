"use client";

// 登录弹窗的中转页：拿 csrf 后自动提交表单直达 Google 授权——
// 用户看不到 NextAuth 默认登录页，只会看到一闪而过的"正在连接 Google…"
import { useEffect } from "react";

export default function LoginPopupPage() {
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const res = await fetch("/api/auth/csrf");
                const { csrfToken } = await res.json();
                if (cancelled || !csrfToken) return;
                const form = document.createElement("form");
                form.method = "POST";
                form.action = "/api/auth/signin/google";
                const add = (name: string, value: string) => {
                    const input = document.createElement("input");
                    input.type = "hidden";
                    input.name = name;
                    input.value = value;
                    form.appendChild(input);
                };
                add("csrfToken", csrfToken);
                add("callbackUrl", "/auth/done");
                document.body.appendChild(form);
                form.submit();
            } catch {
                if (!cancelled) window.location.href = "/api/auth/signin"; // 兜底走默认页
            }
        })();
        return () => { cancelled = true; };
    }, []);

    return (
        <div className="flex min-h-screen items-center justify-center bg-bg">
            <div className="flex items-center gap-3 text-[14px] text-text-2">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                正在连接 Google…
            </div>
        </div>
    );
}
