"use client";

// 全屏照片查看器：大图居中 + 左右切换 + 键盘 ← → ESC + 计数。
// portal 到 body：travel 页容器链上有入场动画 transform，fixed 会被劫持包含块
// （曾致整个 lightbox 遮罩/图/按钮全体错位）——顶层渲染一了百了。
import { useEffect, useCallback } from "react";
import { createPortal } from "react-dom";

interface Photo { name: string; url: string; }
interface Props {
    photos: Photo[];
    index: number;
    onClose: () => void;
    onIndex: (i: number) => void;
}

export function Lightbox({ photos, index, onClose, onIndex }: Props) {
    const go = useCallback((delta: number) => {
        onIndex((index + delta + photos.length) % photos.length);
    }, [index, photos.length, onIndex]);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
            else if (e.key === "ArrowLeft") go(-1);
            else if (e.key === "ArrowRight") go(1);
        };
        window.addEventListener("keydown", onKey);
        // 锁滚动
        const prev = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        return () => {
            window.removeEventListener("keydown", onKey);
            document.body.style.overflow = prev;
        };
    }, [go, onClose]);

    if (!photos.length) return null;
    const cur = photos[index];

    return createPortal(
        <div className="fixed inset-0 z-[100] bg-black/95 flex items-center justify-center select-none" onClick={onClose}>
            {/* 计数 */}
            <div className="absolute top-4 left-1/2 -translate-x-1/2 text-white/70 text-sm tabular-nums bg-white/10 px-3 py-1 rounded-full">
                {index + 1} / {photos.length}
            </div>
            {/* 关闭 */}
            <button
                onClick={onClose}
                className="absolute top-4 right-4 w-10 h-10 flex items-center justify-center text-white/80 hover:text-white text-2xl bg-white/10 hover:bg-white/20 rounded-full transition-colors"
                aria-label="关闭"
            >✕</button>

            {/* 左 */}
            {photos.length > 1 && (
                <button
                    onClick={(e) => { e.stopPropagation(); go(-1); }}
                    className="absolute left-3 sm:left-5 top-1/2 -translate-y-1/2 w-11 h-11 flex items-center justify-center text-white/80 hover:text-white text-3xl bg-white/10 hover:bg-white/20 rounded-full transition-colors"
                    aria-label="上一张"
                >‹</button>
            )}

            {/* 图 */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
                key={cur.url}
                src={cur.url}
                alt={cur.name}
                onClick={(e) => e.stopPropagation()}
                className="max-w-[92vw] max-h-[88vh] object-contain rounded-md fade-in"
            />

            {/* 右 */}
            {photos.length > 1 && (
                <button
                    onClick={(e) => { e.stopPropagation(); go(1); }}
                    className="absolute right-3 sm:right-5 top-1/2 -translate-y-1/2 w-11 h-11 flex items-center justify-center text-white/80 hover:text-white text-3xl bg-white/10 hover:bg-white/20 rounded-full transition-colors"
                    aria-label="下一张"
                >›</button>
            )}
        </div>,
        document.body
    );
}
