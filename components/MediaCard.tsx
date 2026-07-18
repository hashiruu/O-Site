"use client";

import Link from "next/link";
import type { ReactNode } from "react";

// 卡片占位图（与首页 FALLBACK_IMG 同源，独立自带以便其他页面复用）
const FALLBACK_IMG = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjM2YzZjQ2IiBzdHJva2Utd2lkdGg9IjIiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCI+PHJlY3QgeD0iMyIgeT0iMyIgd2lkdGg9IjE4IiBoZWlnaHQ9IjE4IiByeD0iMiIgcnk9IjIiPjwvcmVjdD48Y2lyY2xlIGN4PSI4LjUiIGN5PSI4LjUiIHI9IjEuNSI+PC9jaXJjbGU+PHBvbHlsaW5lIHBvaW50cz0iMjEgMTUgMTYgMTAgNSAyMSI+PC9wb2x5bGluZT48L3N2Zz4=';

export interface MediaCardItem {
    id: string;
    title: string;
    /** 已算好的缩略图 URL（媒体缓存铁律：网格/列表走 thumbnail/photo-thumb，禁止原图） */
    thumb: string;
    rating?: number | null;
    year?: number | null;
    type?: string;
}

interface MediaCardProps {
    item: MediaCardItem;
    /** 点击跳转地址（调用方按场景算好：影剧→detail，可直接播→watch） */
    href: string;
    variant: "landscape" | "portrait" | "square";
    /** 封面右下角角标（时长 / 集数标签），黑 60% 底白字 12px */
    badge?: string;
    /** 封面底部渐隐区白字 stats（年份/评分/进度文字），13px */
    coverStats?: ReactNode;
    /** 0-100，封面底部粉色进度条（继续观看用）；非全宽时右侧余量为 line 色 */
    progress?: number;
    /** 封面下方标题下的 meta 行，13px #text-3 */
    meta?: ReactNode;
    /** 图片 eager 加载（feed 首屏大推荐位用） */
    priority?: boolean;
}

/**
 * B 站风格媒体卡 —— spec §5
 * - 规则 4：portrait（movie/series/anime，2:3 海报）/ landscape（travel/录播/继续观看，16:9）
 * - 规则 5：hover 只"标题变粉 + 封面 brightness 1.05"，不 scale、不加阴影
 * - 规则 6：圆角阶梯 6（封面 rounded-md）/ 8（面板 rounded-lg）/ 999（按钮 rounded-full）
 * - 卡片本体无边框、无阴影、无底色，直接坐在页面灰底上
 */
export function MediaCard({
    item,
    href,
    variant,
    badge,
    coverStats,
    progress,
    meta,
    priority,
}: MediaCardProps) {
    const aspectClass = variant === "portrait" ? "aspect-[2/3]" : variant === "square" ? "aspect-square" : "aspect-video";
    const showRatingBadge = variant === "portrait" && item.rating != null && item.rating >= 7;

    return (
        <Link
            href={href}
            prefetch={false}
            className="group block cursor-pointer rounded-md"
        >
            <div
                className={`relative w-full overflow-hidden rounded-md transition-transform duration-250 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:-translate-y-1 group-hover:shadow-[0_12px_28px_rgba(0,0,0,0.14)] ${aspectClass}`}
                style={{ background: "linear-gradient(135deg, #1a1a2e, #16213e)" }}
            >
                {variant === "landscape" ? (
                    <>
                        {/* 横版卡遇到竖版海报（TMDB 2:3）时 object-cover 会裁掉大半张脸。
                            改为：底层同图高斯模糊放大铺满补色，前景 object-contain 完整显示。
                            图源本就是 16:9 时 contain 与 cover 视觉一致，无回归。 */}
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                            src={item.thumb}
                            alt=""
                            aria-hidden
                            loading={priority ? "eager" : "lazy"}
                            className="absolute inset-0 h-full w-full scale-110 object-cover opacity-60 blur-2xl"
                            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                        />
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                            src={item.thumb}
                            alt={item.title}
                            loading={priority ? "eager" : "lazy"}
                            className="relative h-full w-full object-contain object-[center_30%] transition-[filter] duration-200 group-hover:brightness-105"
                            onError={(e) => { (e.target as HTMLImageElement).src = FALLBACK_IMG; }}
                        />
                    </>
                ) : (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                        src={item.thumb}
                        alt={item.title}
                        loading={priority ? "eager" : "lazy"}
                        className="h-full w-full object-cover transition-[filter] duration-200 group-hover:brightness-105"
                        onError={(e) => { (e.target as HTMLImageElement).src = FALLBACK_IMG; }}
                    />
                )}

                {/* 底部渐隐 stats 条（.card-stats-mask） */}
                {coverStats && (
                    <div className="card-stats-mask absolute inset-x-0 bottom-0 text-[13px] leading-tight text-white">
                        {coverStats}
                    </div>
                )}

                {/* 右下角角标：时长 / 集数（黑 60% 底白字 12px） */}
                {badge && (
                    <div className="absolute bottom-1.5 right-1.5 rounded bg-black/60 px-1.5 py-0.5 text-[12px] leading-none text-white">
                        {badge}
                    </div>
                )}

                {/* 右上角评分角标：仅竖版 + rating≥7（粉底白字，避免满屏角标） */}
                {showRatingBadge && (
                    <div className="absolute right-1.5 top-1.5 rounded-full bg-primary px-1.5 py-0.5 text-[12px] font-medium leading-none text-white">
                        {Number(item.rating).toFixed(1)}
                    </div>
                )}

                {/* 底部进度条（继续观看）：高 3px，前景 primary，余量 line */}
                {progress != null && (
                    <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-line">
                        <div
                            className="h-full bg-primary transition-[width] duration-300"
                            style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
                        />
                    </div>
                )}
            </div>

            {/* 文字块：封面下方 10px（mt-2.5） */}
            <div className="mt-2.5">
                <h3
                    className="line-clamp-2 text-[15px] font-normal leading-[22px] text-text-1 transition-colors duration-200 group-hover:text-primary"
                    title={item.title}
                >
                    {item.title}
                </h3>
                {meta && (
                    <div className="mt-1 line-clamp-1 text-[13px] text-text-3">{meta}</div>
                )}
            </div>
        </Link>
    );
}

/** 骨架屏：灰块（--color-bg-hover）+ 轻呼吸（B 站 skeleton 同款思路） */
export function MediaCardSkeleton({ variant = "landscape" }: { variant?: "landscape" | "portrait" }) {
    return (
        <div>
            <div className={`w-full animate-pulse rounded-md bg-bg-hover ${variant === "portrait" ? "aspect-[2/3]" : "aspect-video"}`} />
            <div className="mt-2.5 space-y-1.5">
                <div className="h-[15px] w-[85%] animate-pulse rounded bg-bg-hover" />
                <div className="h-[13px] w-[50%] animate-pulse rounded bg-bg-hover" />
            </div>
        </div>
    );
}
