"use client";

// Fetch out 跳转菜单：本站没有的内容，点开先看简介、再选一个合法外站过去看。
// 桌面：popover 从鼠标点击处按「八方位展开规则」弹出（EPUB 注解浮窗同款）——
// 屏幕 3×3 分区：四角对角展开、四边朝屏内、正中向下，transform 百分比让浏览器
// 自解算尺寸，前后左右永不越出视口；入场只淡入（anchorPop），绝不覆盖翻转 transform。
// 手机：底部抽屉。点卡片绝不直接跳走——简介读完、平台选定，才离站。
import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { fetchOutLinks } from "../lib/fetch-out";

/** 八方位展开（与 EPUB 阅读器 anchorFlip 同一规则，锚点为点击坐标点） */
function anchorFlip(x: number, y: number, gap = 10) {
    const W = window.innerWidth, H = window.innerHeight;
    const col = x < W / 3 ? "L" : x > (W * 2) / 3 ? "R" : "C";
    const row = y < H / 3 ? "T" : y > (H * 2) / 3 ? "B" : "C";
    let top: number, left: number, tx: string, ty: string;
    if (row === "C" && col !== "C") {
        // 纯左右边缘：横向展开、纵向居中
        if (col === "L") { left = x + gap; tx = "0"; }
        else { left = x - gap; tx = "-100%"; }
        top = y; ty = "-50%";
    } else {
        // 四角 + 上/下边缘 + 正中：纵向带间隙，横向对齐
        if (row === "B") { top = y - gap; ty = "-100%"; }
        else { top = y + gap; ty = "0"; }
        if (col === "L") { left = x; tx = "0"; }
        else if (col === "R") { left = x; tx = "-100%"; }
        else { left = x; tx = "-50%"; }
    }
    return { top: Math.max(6, Math.min(top, H - 6)), left: Math.max(6, Math.min(left, W - 6)), tx, ty };
}

export function FetchOutMenu({ title, kind, overview, anchor, onClose, extraActions }: {
    title: string;
    kind: string;
    overview?: string | null;
    anchor?: { x: number; y: number } | null;  // 点击坐标（视口系）；不给则居中
    onClose: () => void;
    extraActions?: { label: string; run: () => void }[];
}) {
    const links = fetchOutLinks(title, kind);
    const [expand, setExpand] = useState(false);
    // 八方位位置只算一次（打开瞬间的视口与点击点）；SSR/手机不走浮窗
    const pos = useMemo(() => {
        if (typeof window === "undefined" || !anchor) return null;
        if (!window.matchMedia("(min-width: 640px)").matches) return null;
        return anchorFlip(anchor.x, anchor.y);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [anchor?.x, anchor?.y]);
    const floating = pos !== null;

    // portal 到 body：调用方可能身处 scroll-reveal/动画 transform 容器，
    // fixed 会被 transform 父级劫持包含块（浮窗"不知道跑哪去"的根因）——顶层渲染一了百了
    return createPortal(
        <div className="fixed inset-0 z-[210]" role="dialog" aria-modal>
            <div className={`absolute inset-0 ${floating ? "bg-black/25" : "bg-black/50 backdrop-blur-sm"}`} onClick={onClose} />
            <div
                className={`absolute border border-line bg-bg-card p-5 shadow-2xl ${
                    floating
                        ? "w-[360px] max-w-[calc(100vw-24px)] rounded-2xl"
                        : "animate-fadeIn inset-x-0 bottom-0 w-full rounded-t-2xl sm:bottom-auto sm:left-1/2 sm:top-[18vh] sm:w-[380px] sm:-translate-x-1/2 sm:rounded-2xl"
                }`}
                style={floating ? {
                    left: pos.left, top: pos.top,
                    transform: `translate(${pos.tx}, ${pos.ty})`,
                    maxHeight: "calc(100vh - 24px)", overflowY: "auto",
                    animation: "anchorPop 0.18s ease both", // 只淡入，不覆盖八方位 transform
                } : undefined}
            >
                <div className="text-[11px] font-semibold tracking-[0.22em] text-text-3">FETCH OUT · 站外观看</div>
                <div className="mt-1.5 line-clamp-2 text-[16px] font-semibold text-text-1">《{title}》</div>
                {/* 简介：先看讲什么，再决定去哪看（可展开全文） */}
                {overview ? (
                    <button
                        onClick={() => setExpand((v) => !v)}
                        className={`mt-1.5 block w-full cursor-pointer text-left text-[12.5px] leading-relaxed text-text-2 ${expand ? "" : "line-clamp-3"}`}
                        title={expand ? "收起" : "展开全文"}
                    >
                        {overview}
                    </button>
                ) : (
                    <p className="mt-1 text-[12px] leading-relaxed text-text-3">本站暂无此资源，可以去这些平台找找：</p>
                )}
                <div className="mt-3.5 space-y-2">
                    {links.map((l) => (
                        <a
                            key={l.name}
                            href={l.url}
                            target={l.url.startsWith("/") ? undefined : "_blank"}
                            rel={l.url.startsWith("/") ? undefined : "noopener noreferrer"}
                            className="flex cursor-pointer items-center justify-between rounded-xl border border-line bg-bg-input px-4 py-2.5 text-[14px] text-text-1 transition-all hover:-translate-y-px hover:border-primary/50 hover:text-primary"
                        >
                            <span>{l.name}</span>
                            <span className="flex items-center gap-1.5 text-[11px] text-text-3">
                                {l.en && <span className="rounded bg-bg-tag px-1.5 py-0.5">英文平台</span>}
                                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6m4-3h6m0 0v6m0-6L10 14" />
                                </svg>
                            </span>
                        </a>
                    ))}
                    {(extraActions || []).map((a) => (
                        <button
                            key={a.label}
                            onClick={a.run}
                            className="flex w-full cursor-pointer items-center justify-between rounded-xl border border-dashed border-line px-4 py-2.5 text-[14px] text-text-2 transition-colors hover:border-primary/50 hover:text-primary"
                        >
                            {a.label}
                            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
                            </svg>
                        </button>
                    ))}
                </div>
                <button onClick={onClose} className="mt-4 w-full cursor-pointer rounded-full border border-line py-2 text-[13px] text-text-3 transition-colors hover:bg-bg-hover hover:text-text-1">
                    关闭
                </button>
            </div>
        </div>,
        document.body
    );
}
