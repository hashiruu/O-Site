"use client";

// 全站"回到顶部"：滚过一屏后右下角渐显圆钮，点击平滑滚回。
// 阅读器路由不显示（阅读器是 fixed 全屏、自己管滚动）；移动端抬高避开底部 TabBar。
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useLang } from "../lib/i18n";

export function BackToTop() {
    const pathname = usePathname();
    const [show, setShow] = useState(false);
    const { t } = useLang();

    useEffect(() => {
        const onScroll = () => setShow(window.scrollY > window.innerHeight * 0.8);
        onScroll();
        window.addEventListener("scroll", onScroll, { passive: true });
        return () => window.removeEventListener("scroll", onScroll);
    }, []);

    if (pathname.startsWith("/reader") || pathname.startsWith("/watch")) return null;

    return (
        <button
            onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
            aria-label={t("回到顶部")}
            className={`fixed bottom-20 right-4 z-40 flex h-11 w-11 cursor-pointer items-center justify-center rounded-full border border-line bg-bg-card/90 text-text-2 shadow-[0_4px_16px_rgba(0,0,0,0.12)] backdrop-blur transition-all duration-300 hover:-translate-y-0.5 hover:text-primary md:bottom-8 md:right-6 ${
                show ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-3 opacity-0"
            }`}
        >
            <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current">
                <path d="M12 4l-8 8 1.41 1.41L11 7.83V20h2V7.83l5.59 5.58L20 12z" />
            </svg>
        </button>
    );
}
