"use client";

// 弹窗式 Google 登录：小窗直达 Google 授权（/auth/popup 自动提交，不经过
// NextAuth 默认登录页），完成后 /auth/done 刷新主窗口并自动关闭小窗。
// 弹窗被拦截（iOS PWA/Safari 设置）时回退整页跳转。
/** 退出登录：后台 POST（csrf 走 NextAuth 标准流程），完成后原地刷新——
 *  没有任何中间页面，比弹窗还干净 */
export async function signOutInPlace() {
    try {
        const { csrfToken } = await fetch("/api/auth/csrf").then((r) => r.json());
        await fetch("/api/auth/signout", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ csrfToken, callbackUrl: "/" }),
        });
    } catch { /* 失败也刷新，会话可能已失效 */ }
    window.location.href = "/";
}

export function openLoginPopup() {
    const w = 520;
    const h = 640;
    const left = Math.max(0, (window.screen.width - w) / 2);
    const top = Math.max(0, (window.screen.height - h) / 2);
    const win = window.open(
        "/auth/popup",
        "osite-login",
        `width=${w},height=${h},left=${left},top=${top},resizable=yes,scrollbars=yes`
    );
    if (!win) {
        window.location.href = "/auth/popup"; // 弹窗被拦：整页走同一流程
        return;
    }
    // 轮询小窗关闭：登录成功页会自己关窗，主窗口刷新拿到会话
    const timer = setInterval(() => {
        if (win.closed) {
            clearInterval(timer);
            window.location.reload();
        }
    }, 500);
}
