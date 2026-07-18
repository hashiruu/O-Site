"use client";

// 视频源右侧抽屉：本站没有/播不了的内容，从右侧滑出候选源菜单——
// B站站内嵌入（可登录/高画质/记进度）置顶，再列合法外站平台 + 站内搜索。
// 用于 watch 页未收录目录、播放失败等场景；portal 到 body 防 transform 劫持。
import { createPortal } from "react-dom";
import { fetchOutLinks } from "../lib/fetch-out";
import { useLang } from "../lib/i18n";

export function SourceDrawer({ title, kind = "series", open, onClose }: {
    title: string;
    kind?: string;
    open: boolean;
    onClose: () => void;
}) {
    const { t } = useLang();
    if (!open) return null;
    const links = fetchOutLinks(title, kind);

    return createPortal(
        <div className="fixed inset-0 z-[220]" role="dialog" aria-modal>
            <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={onClose} />
            {/* 右侧抽屉 */}
            <div className="animate-drawerIn absolute right-0 top-0 flex h-full w-[340px] max-w-[88vw] flex-col border-l border-line bg-bg-card shadow-2xl">
                <div className="border-b border-line/70 px-5 pb-4 pt-5">
                    <div className="text-[11px] font-semibold tracking-[0.22em] text-text-3">{t("视频源 · 站外观看")}</div>
                    <div className="mt-1.5 line-clamp-2 text-[17px] font-semibold text-text-1">《{title}》</div>
                    <p className="mt-1.5 text-[12px] leading-relaxed text-text-3">
                        {t("这部内容本站还没有可播放的文件。挑一个平台接着看：")}
                    </p>
                </div>
                <div className="scrollbar-hide min-h-0 flex-1 space-y-2 overflow-y-auto p-4">
                    {links.map((l) => {
                        const internal = l.url.startsWith("/");
                        return (
                            <a
                                key={l.name}
                                href={l.url}
                                target={internal ? undefined : "_blank"}
                                rel={internal ? undefined : "noopener noreferrer"}
                                className={`flex cursor-pointer items-center justify-between rounded-xl border px-4 py-3 text-[14px] transition-all hover:-translate-y-px ${
                                    internal
                                        ? "border-primary/40 bg-primary/8 font-medium text-primary hover:border-primary"
                                        : "border-line bg-bg-input text-text-1 hover:border-primary/50 hover:text-primary"
                                }`}
                            >
                                <span>{l.name}</span>
                                <span className="flex items-center gap-1.5 text-[11px] text-text-3">
                                    {l.en && <span className="rounded bg-bg-tag px-1.5 py-0.5">{t("英文平台")}</span>}
                                    {internal ? (
                                        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
                                    ) : (
                                        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6m4-3h6m0 0v6m0-6L10 14" />
                                        </svg>
                                    )}
                                </span>
                            </a>
                        );
                    })}
                    <a
                        href={`/search?q=${encodeURIComponent(title)}`}
                        className="flex cursor-pointer items-center justify-between rounded-xl border border-dashed border-line px-4 py-3 text-[14px] text-text-2 transition-colors hover:border-primary/50 hover:text-primary"
                    >
                        {t("先搜搜本站有没有")}
                        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
                        </svg>
                    </a>
                </div>
                <div className="border-t border-line/70 p-4">
                    <button onClick={onClose} className="w-full cursor-pointer rounded-full border border-line py-2 text-[13px] text-text-3 transition-colors hover:bg-bg-hover hover:text-text-1">
                        {t("关闭")}
                    </button>
                </div>
            </div>
            <style>{`
                @keyframes drawerIn { from { transform: translateX(100%); } to { transform: translateX(0); } }
                .animate-drawerIn { animation: drawerIn 0.26s cubic-bezier(0.22, 1, 0.36, 1) both; }
                @media (prefers-reduced-motion: reduce) { .animate-drawerIn { animation: none; } }
            `}</style>
        </div>,
        document.body
    );
}
