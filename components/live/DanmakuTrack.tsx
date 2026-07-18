"use client";

// 实时弹幕渲染层：DOM 轨道 + CSS transform 滚动（GPU 友好）。
// 支持三种 type：0=滚动 / 1=顶部固定 / 2=底部固定（ass 已解析区分）。
// 轨道间距 = 字号驱动（单倍行距 fontSize*1.4），字号调大行距跟着大，不允许重叠。
// 高频推送下用 ref + 直接 DOM 操作，避免 React 重渲染。限流防卡顿。
import { forwardRef, useImperativeHandle, useRef } from "react";
import type { DanmakuItem } from "../../lib/live/sourceClient";

export interface DanmakuHandle {
    push: (item: DanmakuItem) => void;
    clear: () => void;
    /** 冻结/恢复屏上所有弹幕动画（点播随视频暂停/播放调用；直播不用） */
    setPaused: (paused: boolean) => void;
}

export interface DanmakuSettings {
    enabled: boolean;
    opacity: number;    // 0–1
    fontSize: number;   // px
    speedMul: number;   // 动画时长倍率（>1 慢）
    areaFrac: number;   // 0–1 画面垂直占比
    gap: number;        // 间隔倍率：防重叠缓冲（时间维度）
    lineGap: number;    // 行距倍率：>1 用更少轨道（更稀疏）
}

const TRACKS = 40;          // 滚动轨道数上限（字号越小轨道越多）
const MAX_ONSCREEN = 100;   // 同屏弹幕上限，超出丢弃

export const DanmakuTrack = forwardRef<DanmakuHandle, { className?: string; settings: DanmakuSettings }>(({ className, settings }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const settingsRef = useRef(settings);
    settingsRef.current = settings;
    const active = useRef(0);
    const trackNext = useRef<number[]>(Array.from({ length: TRACKS }, () => 0));
    const fixedNext = useRef<{ top: number[]; bottom: number[] }>({ top: [], bottom: [] });
    const lastTrack = useRef(0);
    const pausedAt = useRef<number | null>(null);

    useImperativeHandle(ref, () => ({
        push(item: DanmakuItem) {
            const container = containerRef.current;
            if (!container) return;
            const s = settingsRef.current;
            if (!s.enabled) return;
            if (active.current >= MAX_ONSCREEN) return;
            const text = item.text;
            if (!text) return;

            const el = document.createElement("span");
            el.className = "live-dm-item";
            el.textContent = text;
            el.style.opacity = String(s.opacity);
            el.style.fontSize = `${s.fontSize}px`;
            if (item.color) el.style.color = item.color;

            // 单倍行距（字号驱动）：字号大 → 行高大 → 轨道间距大，相邻弹幕不重叠
            const lineHeight = Math.max(s.fontSize * 1.4, s.fontSize + 8);
            const rect = container.getBoundingClientRect();
            const areaH = (rect.height || 400) * s.areaFrac;
            const now = performance.now();

            const attach = () => { container.appendChild(el); active.current += 1; };

            // 顶部 / 底部固定弹幕（type 1/2）：居中、定时消失，不滚动
            if (item.type === 1 || item.type === 2) {
                const key = item.type === 1 ? "top" : "bottom";
                const slot = fixedNext.current[key];
                const maxSlot = Math.max(2, Math.floor(areaH / lineHeight / 2));
                let i = 0;
                for (; i < maxSlot; i++) if ((slot[i] ?? 0) <= now) break;
                if (i >= maxSlot) { el.remove(); return; }
                slot[i] = now + 4000 * (s.gap || 1);
                el.classList.add(item.type === 1 ? "live-dm-top" : "live-dm-bottom", "live-dm-hold");
                if (item.type === 1) el.style.top = `${i * lineHeight + 4}px`;
                else el.style.bottom = `${i * lineHeight + 4}px`;
                // 存活期用 CSS 动画而非 setTimeout：setPaused 冻结动画时固定弹幕也一起冻结，
                // 且后台标签页不会因 timer 到期而在冻结期间消失
                el.style.animationDuration = `${4000 * s.speedMul}ms`;
                attach();
                el.addEventListener("animationend", () => { el.remove(); active.current -= 1; });
                return;
            }

            // 滚动弹幕（type 0 / 默认）
            el.classList.add("live-dm-scroll");
            const maxTracks = Math.max(2, Math.floor(areaH / lineHeight));
            const effectiveTracks = Math.max(2, Math.min(TRACKS, maxTracks, Math.round(maxTracks / (s.lineGap || 1))));
            const start = (lastTrack.current + 1) % effectiveTracks;
            let track = -1;
            for (let k = 0; k < effectiveTracks; k++) {
                const i = (start + k) % effectiveTracks;
                if (trackNext.current[i] <= now) { track = i; break; }
            }
            if (track < 0) { el.remove(); return; } // 所有轨道被占用，丢弃
            lastTrack.current = track;
            el.style.top = `${track * lineHeight + 2}px`;
            const duration = (Math.max(6, 6 + text.length * 0.12)) * s.speedMul;
            el.style.animationDuration = `${duration.toFixed(1)}s`;
            attach();
            el.addEventListener("animationend", () => { el.remove(); active.current -= 1; });

            // 精确防重叠：文本宽度 / (屏宽 + 文本宽度) * 动画时长 + 缓冲
            const screenW = rect.width || 1920;
            const elemW = text.length * s.fontSize * 0.72;
            const clearTimeMs = (duration * 1000 * (elemW / (screenW + elemW)) + 250) * (s.gap || 1);
            trackNext.current[track] = now + clearTimeMs;
        },
        clear() {
            if (containerRef.current) containerRef.current.innerHTML = "";
            active.current = 0;
            trackNext.current = Array.from({ length: TRACKS }, () => 0);
            fixedNext.current = { top: [], bottom: [] };
        },
        setPaused(paused: boolean) {
            const c = containerRef.current;
            if (!c) return;
            if (paused) {
                if (pausedAt.current == null) pausedAt.current = performance.now();
                c.classList.add("live-dm-paused");
            } else {
                if (pausedAt.current != null) {
                    // 轨道占用记录的是 performance.now() 时刻，冻结期间墙钟继续走。
                    // 恢复时把"冻结时还没到期"的占用整体顺延，否则新弹幕会压在刚解冻的旧弹幕上
                    const start = pausedAt.current;
                    const delta = performance.now() - start;
                    pausedAt.current = null;
                    trackNext.current = trackNext.current.map((v) => (v > start ? v + delta : v));
                    fixedNext.current.top = fixedNext.current.top.map((v) => (v > start ? v + delta : v));
                    fixedNext.current.bottom = fixedNext.current.bottom.map((v) => (v > start ? v + delta : v));
                }
                c.classList.remove("live-dm-paused");
            }
        },
    }), []);

    return (
        <>
            <div ref={containerRef} className={`absolute inset-0 overflow-hidden pointer-events-none ${className ?? ""}`} aria-hidden />
            <style jsx global>{`
                @keyframes live-dm-scroll {
                    from { transform: translateX(0); }
                    to { transform: translateX(calc(-100vw - 100%)); }
                }
                .live-dm-item {
                    position: absolute;
                    left: 100%;
                    white-space: nowrap;
                    color: #fff;
                    line-height: 1.3;
                    font-weight: 600;
                    font-family: "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji","Twemoji Mozilla",system-ui,sans-serif;
                    padding: 1px 4px;
                    text-shadow: 0 0 3px rgba(0,0,0,.9), 1px 1px 2px rgba(0,0,0,.8), -1px -1px 2px rgba(0,0,0,.8);
                }
                .live-dm-scroll {
                    animation-name: live-dm-scroll;
                    animation-timing-function: linear;
                    animation-fill-mode: forwards;
                    will-change: transform;
                }
                .live-dm-top, .live-dm-bottom {
                    left: 0; right: 0; text-align: center;
                }
                /* 固定弹幕存活期：空跑动画只为拿到 animationend + 可被 play-state 冻结 */
                @keyframes live-dm-hold {
                    from { visibility: visible; }
                    to { visibility: visible; }
                }
                .live-dm-hold {
                    animation-name: live-dm-hold;
                    animation-timing-function: linear;
                    animation-fill-mode: forwards;
                }
                /* 视频暂停 → 全部弹幕动画冻结 */
                .live-dm-paused .live-dm-item {
                    animation-play-state: paused !important;
                }
            `}</style>
        </>
    );
});

DanmakuTrack.displayName = "DanmakuTrack";
