"use client";

// 点播弹幕控制浮层：触发按钮 + 弹幕偏好面板。
// 开关 / 不透明度 / 字号 / 显示区域 / 速度 / 密度 / 滚动·顶·底过滤 / 屏蔽词。
// 样式复用 /live ControlPanel（bg-bg-nav、RangeSlider、按钮组）。偏好由父组件持久化。
// 浮层用 createPortal 挂到 body：祖先若带 transform/filter/动画会劫持 fixed 的包含块，
// 导致按钮跟着内容滚走而不贴视口（历史 bug 根因），portal 彻底免疫。
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { RangeSlider } from "../live/RangeSlider";

export interface DmTypes { scroll: boolean; top: boolean; bottom: boolean; }

interface Props {
    enabled: boolean; onEnabled: (v: boolean) => void;
    opacity: number; onOpacity: (v: number) => void;
    fontSize: number; onFontSize: (v: number) => void;
    areaFrac: number; onAreaFrac: (v: number) => void;
    speed: number; onSpeed: (v: number) => void;
    density: number; onDensity: (v: number) => void;
    types: DmTypes; onTypes: (v: DmTypes) => void;
    blockwords: string[]; onBlockwords: (v: string[]) => void;
}

export function DanmakuControl(p: Props) {
    const [open, setOpen] = useState(false);
    const [wordInput, setWordInput] = useState("");
    const [mounted, setMounted] = useState(false);
    const wrapRef = useRef<HTMLDivElement>(null);

    // portal 只能在客户端渲染（SSR 无 document）
    useEffect(() => setMounted(true), []);

    // 点外部关闭
    useEffect(() => {
        if (!open) return;
        const h = (e: MouseEvent) => {
            if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener("mousedown", h);
        return () => document.removeEventListener("mousedown", h);
    }, [open]);

    const addWord = () => {
        const w = wordInput.trim();
        if (w && !p.blockwords.includes(w)) p.onBlockwords([...p.blockwords, w]);
        setWordInput("");
    };

    if (!mounted) return null;
    return createPortal(
        <div ref={wrapRef} className="fixed right-4 bottom-24 z-[9999]">
            <button
                type="button"
                onClick={() => setOpen(v => !v)}
                title="弹幕"
                className={`w-11 h-11 rounded-full shadow-xl border flex items-center justify-center transition-all active:scale-95
                    ${open || !p.enabled ? "bg-bg-nav text-text-2 border-line hover:bg-bg-hover" : "bg-primary text-white border-primary"}`}
            >
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 4h18v12H7l-4 4z" />
                </svg>
            </button>

            {open && (
                <div className="absolute bottom-full right-0 mb-2 w-[300px] bg-bg-nav border border-line rounded-lg p-4 shadow-2xl flex flex-col gap-3">
                    <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-text-2">弹幕</span>
                        <label className="relative inline-flex items-center cursor-pointer">
                            <input type="checkbox" className="sr-only peer" checked={p.enabled} onChange={e => p.onEnabled(e.target.checked)} />
                            {/* 轨道 40px、滑块 16px、左缘 2px → 选中位移须 20px（translate-x-5）；
                                translate-x-full 只移滑块自身宽 16px，差 4px 不贴右端（偏移 bug 根因） */}
                            <div className="w-10 h-5 bg-bg-tag rounded-full peer peer-checked:after:translate-x-5 after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary"></div>
                        </label>
                    </div>

                    <div className="h-px bg-line" />

                    <RangeSlider label="不透明度" value={p.opacity} min={0.1} max={1} step={0.05} defaultValue={0.5} onChange={p.onOpacity} format={v => `${Math.round(v * 100)}%`} />
                    <RangeSlider label="字号" value={p.fontSize} min={12} max={36} step={1} defaultValue={28} onChange={p.onFontSize} format={v => `${v}px`} />
                    <RangeSlider label="密度" value={p.density} min={0.1} max={1} step={0.05} defaultValue={1} onChange={p.onDensity} format={v => `${Math.round(v * 100)}%`} />

                    <div className="flex items-center gap-2">
                        <span className="text-xs text-text-3 w-16 shrink-0">显示区域</span>
                        <div className="flex gap-1 flex-1">
                            {([["1/4", 0.25], ["半屏", 0.5], ["3/4", 0.75], ["全屏", 1]] as [string, number][]).map(([l, v]) => (
                                <button key={l} onClick={() => p.onAreaFrac(v)}
                                    className={`flex-1 rounded-full px-2 py-1 text-xs font-medium transition-all active:scale-95 ${Math.abs(p.areaFrac - v) < 0.01 ? "bg-primary text-white" : "bg-bg-tag text-text-2 hover:bg-bg-hover"}`}>{l}</button>
                            ))}
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        <span className="text-xs text-text-3 w-16 shrink-0">弹幕速度</span>
                        <div className="flex gap-1 flex-1">
                            {([["慢", 1.6], ["正常", 1], ["快", 0.55]] as [string, number][]).map(([l, v]) => (
                                <button key={l} onClick={() => p.onSpeed(v)}
                                    className={`flex-1 rounded-full px-2 py-1 text-xs font-medium transition-all active:scale-95 ${Math.abs(p.speed - v) < 0.01 ? "bg-primary text-white" : "bg-bg-tag text-text-2 hover:bg-bg-hover"}`}>{l}</button>
                            ))}
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        <span className="text-xs text-text-3 w-16 shrink-0">类型</span>
                        <div className="flex gap-1 flex-1">
                            {([["滚动", "scroll"], ["顶部", "top"], ["底部", "bottom"]] as [string, keyof DmTypes][]).map(([l, k]) => (
                                <button key={k} onClick={() => p.onTypes({ ...p.types, [k]: !p.types[k] })}
                                    className={`flex-1 rounded-full px-2 py-1 text-xs font-medium transition-all active:scale-95 ${p.types[k] ? "bg-primary text-white" : "bg-bg-tag text-text-3 hover:bg-bg-hover"}`}>{l}</button>
                            ))}
                        </div>
                    </div>

                    <div className="flex flex-col gap-1.5">
                        <span className="text-xs text-text-3">屏蔽词</span>
                        <div className="flex gap-1">
                            <input
                                type="text" value={wordInput}
                                onChange={e => setWordInput(e.target.value)}
                                onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addWord(); } }}
                                placeholder="回车添加"
                                className="flex-1 h-7 px-2 bg-bg-input border border-line rounded text-xs focus:border-primary outline-none min-w-0"
                            />
                            <button onClick={addWord} className="px-2 rounded bg-bg-tag text-text-2 text-xs hover:bg-bg-hover shrink-0">添加</button>
                        </div>
                        {p.blockwords.length > 0 && (
                            <div className="flex flex-wrap gap-1">
                                {p.blockwords.map(w => (
                                    <span key={w} className="inline-flex items-center gap-1 bg-bg-tag text-text-2 text-xs rounded-full pl-2 pr-1 py-0.5">
                                        {w}
                                        <button onClick={() => p.onBlockwords(p.blockwords.filter(x => x !== w))} className="text-text-3 hover:text-bili-pink">✕</button>
                                    </span>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>,
        document.body
    );
}
