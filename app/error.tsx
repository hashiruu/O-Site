"use client";

// 路由级错误边界：某页崩了不再白屏/Next 默认红页，而是友好可恢复的界面。
import { useEffect } from "react";
import Link from "next/link";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
    useEffect(() => { console.error("[page-error]", error); }, [error]);
    return (
        <div className="animate-fadeIn mx-auto flex min-h-[52vh] w-full max-w-md flex-col items-center justify-center gap-6 py-10 text-center">
            <svg viewBox="0 0 220 150" className="w-52 max-w-full" fill="none" aria-hidden="true">
                <ellipse cx="110" cy="132" rx="70" ry="8" className="fill-[var(--color-bg-hover)]" />
                <rect x="52" y="34" width="116" height="80" rx="10" className="fill-[var(--color-bg-card)] stroke-[var(--color-line)]" strokeWidth="2.5" />
                <path d="M110 54v26" className="stroke-[var(--color-primary)]" strokeWidth="6" strokeLinecap="round" />
                <circle cx="110" cy="96" r="4" className="fill-[var(--color-primary)]" />
            </svg>
            <div>
                <h1 className="font-display text-[22px] text-text-1">这里出了点小状况</h1>
                <p className="mt-2 text-[14px] leading-relaxed text-text-3">页面加载时遇到错误，重试一下通常就好。</p>
            </div>
            <div className="flex gap-3">
                <button onClick={reset} className="rounded-full bg-primary px-5 py-2 text-[14px] font-medium text-white transition-transform hover:scale-105">
                    重试
                </button>
                <Link href="/" className="rounded-full border border-line px-5 py-2 text-[14px] text-text-2 transition-colors hover:border-primary hover:text-primary">
                    回首页
                </Link>
            </div>
        </div>
    );
}
