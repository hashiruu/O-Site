"use client";

// 直播控制面板：画中画/全屏/音频开关 + 连接状态 + 亮度/对比度/饱和度/音量滑块 + HDR 观感模拟。
// 所有颜色走语义 token（连接状态也用 primary/bili-pink，不引入裸色值）。
import { RangeSlider } from "./RangeSlider";
import type { SourceStatus } from "../../lib/live/sourceClient";

interface ControlPanelProps {
    brightness: number;
    contrast: number;
    saturate: number;
    volume: number;
    onBrightness: (v: number) => void;
    onContrast: (v: number) => void;
    onSaturate: (v: number) => void;
    onVolume: (v: number) => void;
    hdrMode: boolean;
    onToggleHdr: () => void;
    audioPlaying: boolean;
    onToggleAudio: () => void;
    danmakuStatus: SourceStatus;
    audioStatus: SourceStatus;
    hasDanmakuUrl: boolean;
    hasAudioUrl: boolean;
    pipSupported: boolean;
    pipIsOpen: boolean;
    onTogglePip: () => void;
    onToggleFullscreen: () => void;
    // HLS 流
    hlsMuted: boolean;
    onToggleHlsMute: () => void;
    hasStreamUrl: boolean;
    streamInput: string;
    onStreamInput: (v: string) => void;
    onCaptureStream: (embed?: string) => void;
    onApplyStreamInput: () => void;
    refreshing: boolean;
    // 弹幕子设置
    dmEnabled: boolean;
    onToggleDm: () => void;
    dmOpacity: number;
    onDmOpacity: (v: number) => void;
    dmAreaFrac: number;
    onDmAreaFrac: (v: number) => void;
    dmFontSize: number;
    onDmFontSize: (v: number) => void;
    dmSpeedMul: number;
    onDmSpeedMul: (v: number) => void;
    dmGap: number;
    onDmGap: (v: number) => void;
    dmLineGap: number;
    onDmLineGap: (v: number) => void;
}

const STATUS: Record<SourceStatus, { text: string; dot: string }> = {
    idle: { text: "待机", dot: "bg-text-4" },
    connecting: { text: "连接中", dot: "bg-primary animate-pulse" },
    connected: { text: "已连接", dot: "bg-primary" },
    error: { text: "断开", dot: "bg-bili-pink" },
};

export function ControlPanel(p: ControlPanelProps) {
    const dm = p.hasDanmakuUrl ? STATUS[p.danmakuStatus] : { text: "未配置", dot: "bg-text-4" };
    const au = p.hasAudioUrl ? STATUS[p.audioStatus] : { text: "未配置", dot: "bg-text-4" };

    return (
        <div className="bg-bg-nav border border-line rounded-lg p-4 flex flex-col gap-4">
            {/* 动作按钮 + 连接状态 */}
            <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2">
                    <button
                        onClick={p.onTogglePip}
                        disabled={!p.pipSupported}
                        title={p.pipSupported ? "画中画浮窗（可自由拖拽缩放，控件一同浮起）" : "当前浏览器不支持 Document Picture-in-Picture"}
                        className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed
                            ${p.pipIsOpen ? "bg-primary text-white" : "bg-bg-tag text-text-2 hover:bg-bg-hover"}`}
                    >
                        {p.pipIsOpen ? "退出浮窗" : "画中画"}
                    </button>
                    <button
                        onClick={p.onToggleFullscreen}
                        className="px-3 py-1.5 rounded-full text-xs font-medium bg-bg-tag text-text-2 hover:bg-bg-hover transition-all active:scale-[0.97]"
                    >
                        全屏
                    </button>
                    <button
                        onClick={p.onToggleAudio}
                        disabled={!p.hasAudioUrl}
                        title={p.hasAudioUrl ? "播放/暂停本地音频流" : "未配置音频流地址（请在设置页填写）"}
                        className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed
                            ${p.audioPlaying ? "bg-primary text-white" : "bg-bg-tag text-text-2 hover:bg-bg-hover"}`}
                    >
                        {p.audioPlaying ? "🔊 音频开" : "🔈 音频关"}
                    </button>
                    {p.hasStreamUrl && (
                        <button
                            onClick={p.onToggleHlsMute}
                            title={p.hlsMuted ? "取消静音直播流" : "静音直播流（音频由本地流承载）"}
                            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all active:scale-[0.97]
                                ${p.hlsMuted ? "bg-bili-pink text-white" : "bg-bg-tag text-text-2 hover:bg-bg-hover"}`}
                        >{p.hlsMuted ? "🔇 已静音" : "🔊 直播声"}</button>
                    )}
                </div>
                <div className="flex items-center gap-3 text-[11px] text-text-3">
                    <span className="flex items-center gap-1.5"><span className={`w-1.5 h-1.5 rounded-full ${dm.dot}`} />弹幕·{dm.text}</span>
                    <span className="flex items-center gap-1.5"><span className={`w-1.5 h-1.5 rounded-full ${au.dot}`} />音频·{au.text}</span>
                </div>
            </div>

            {/* 流地址：输入 + 抓取 + 应用 */}
            <div className="flex items-center gap-2">
                <input
                    type="text"
                    value={p.streamInput}
                    onChange={(e) => p.onStreamInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") p.onApplyStreamInput(); }}
                    placeholder="贴入 timstreams 页面链接或 m3u8 流地址"
                    className="flex-1 h-8 px-3 bg-bg-input border border-line rounded-full text-xs focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all min-w-0"
                />
                <button onClick={() => p.onCaptureStream()}
                    disabled={p.refreshing}
                    className="px-3 py-1 rounded-full text-xs font-medium bg-primary/15 text-primary hover:bg-primary/25 transition-all active:scale-[0.97] disabled:opacity-50 shrink-0"
                >{p.refreshing ? "抓取中" : "抓取"}</button>
                <button onClick={p.onApplyStreamInput}
                    className="px-3 py-1 rounded-full text-xs font-medium bg-bg-tag text-text-2 hover:bg-bg-hover transition-all active:scale-[0.97] shrink-0"
                >应用</button>
            </div>

            <div className="h-px bg-line" />

            {/* 滤镜 + 音量 */}
            <div className="flex gap-5 flex-wrap">
                <RangeSlider label="亮度" value={p.brightness} min={0.5} max={2} step={0.01} defaultValue={1} onChange={p.onBrightness} />
                <RangeSlider label="对比度" value={p.contrast} min={0.5} max={1.5} step={0.01} defaultValue={1} onChange={p.onContrast} />
                <RangeSlider label="饱和度" value={p.saturate} min={0} max={2} step={0.01} defaultValue={1} onChange={p.onSaturate} />
                <RangeSlider label="音量" value={p.volume} min={0} max={1} step={0.01} defaultValue={1} onChange={p.onVolume} format={(v) => `${Math.round(v * 100)}%`} />
            </div>

            {/* HDR 观感模拟 */}
            <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                    <div className="text-sm font-medium text-text-2">HDR 观感模拟</div>
                    <div className="text-[11px] text-text-3 mt-0.5">叠加对比度 / 饱和度 / 亮度增强 · 非 真 HDR（真 HDR 由源与显示器决定）</div>
                </div>
                <label className="relative inline-flex items-center cursor-pointer shrink-0">
                    <input type="checkbox" className="sr-only peer" checked={p.hdrMode} onChange={p.onToggleHdr} />
                    <div className="w-11 h-6 bg-bg-tag rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:border after:border-line after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
                </label>
            </div>

            <div className="h-px bg-line" />

            {/* 弹幕设置 */}
            <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                    <div className="text-sm font-medium text-text-2">弹幕设置</div>
                    <div className="text-[11px] text-text-3 mt-0.5">开关 · 横屏区域 · 不透明度 · 字号 · 速度 · 间隔 · 行距</div>
                </div>
                <label className="relative inline-flex items-center cursor-pointer shrink-0">
                    <input type="checkbox" className="sr-only peer" checked={p.dmEnabled} onChange={p.onToggleDm} />
                    <div className="w-11 h-6 bg-bg-tag rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:border after:border-line after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
                </label>
            </div>

            <div className="flex items-center gap-3 flex-wrap">
                <span className="text-xs text-text-3 w-16 shrink-0">横屏区域</span>
                <div className="flex gap-1">
                    {([["1/4屏",0.25],["1/2屏",0.5],["3/4屏",0.75],["全屏",1]] as [string,number][]).map(([label,val]) => (
                        <button key={label} onClick={() => p.onDmAreaFrac(val)}
                            className={`rounded-full px-2.5 py-1 text-xs font-medium transition-all active:scale-[0.97] ${Math.abs(p.dmAreaFrac - val) < 0.01 ? "bg-primary text-white" : "bg-bg-tag text-text-2 hover:bg-bg-hover"}`}
                        >{label}</button>
                    ))}
                </div>
            </div>

            <RangeSlider label="弹幕不透明度" value={p.dmOpacity} min={0} max={1} step={0.05} defaultValue={1} onChange={p.onDmOpacity} format={(v) => `${Math.round(v * 100)}%`} />

            <RangeSlider label="弹幕字号" value={p.dmFontSize} min={10} max={36} step={1} defaultValue={15} onChange={p.onDmFontSize} format={(v) => `${v}px`} />

            <div className="flex items-center gap-3 flex-wrap">
                <span className="text-xs text-text-3 w-16 shrink-0">弹幕速度</span>
                <div className="flex gap-1">
                    {([["慢",1.6],["正常",1],["快",0.55]] as [string,number][]).map(([label,val]) => (
                        <button key={label} onClick={() => p.onDmSpeedMul(val)}
                            className={`rounded-full px-2.5 py-1 text-xs font-medium transition-all active:scale-[0.97] ${Math.abs(p.dmSpeedMul - val) < 0.01 ? "bg-primary text-white" : "bg-bg-tag text-text-2 hover:bg-bg-hover"}`}
                        >{label}</button>
                    ))}
                </div>
            </div>

            <RangeSlider label="弹幕间隔" value={p.dmGap} min={0.3} max={4} step={0.1} defaultValue={1} onChange={p.onDmGap} format={(v) => `${v.toFixed(1)}×`} />
            <RangeSlider label="弹幕行距" value={p.dmLineGap} min={1} max={6} step={0.1} defaultValue={1} onChange={p.onDmLineGap} format={(v) => `${Math.max(2, Math.min(14, Math.round(14 / v)))} 行`} />
        </div>
    );
}
