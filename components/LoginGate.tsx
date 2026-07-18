"use client";

// 个人化页面的未登录挡板：说明该功能需要账号，并给出 Google 登录入口（弹窗式）。
// 用法：const { loading, loggedIn } = useMe(); 未登录时 return <LoginGate feature="观看历史" />
import { openLoginPopup } from "./loginPopup";

export function LoginGate({ feature }: { feature: string }) {
    return (
        <div className="flex flex-col items-center gap-4 py-24 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-bg-hover">
                <svg viewBox="0 0 24 24" className="h-8 w-8 text-text-3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                    <circle cx="12" cy="7" r="4" />
                </svg>
            </div>
            <div>
                <p className="text-base font-semibold text-text-1">登录后使用「{feature}」</p>
                <p className="mt-1 text-sm text-text-3">未登录时不提供个人化功能，也不会记录你的任何数据</p>
            </div>
            <button
                onClick={openLoginPopup}
                className="cursor-pointer rounded-full bg-primary px-6 py-2 text-sm font-medium text-white transition-transform duration-200 hover:scale-105"
            >
                使用 Google 登录
            </button>
        </div>
    );
}
