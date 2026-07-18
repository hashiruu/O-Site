"use client";

// 登录完成页（弹窗回调落点）：是弹窗就自动关闭（主窗口轮询到关闭后刷新会话）；
// 整页流程（弹窗被拦回退）则直接回首页。
import { useEffect } from "react";

export default function LoginDonePage() {
    useEffect(() => {
        if (window.opener && window.opener !== window) {
            window.close();
        } else {
            window.location.replace("/");
        }
    }, []);

    return (
        <div className="flex min-h-screen items-center justify-center bg-bg">
            <p className="text-[14px] text-text-2">登录成功，正在返回…</p>
        </div>
    );
}
