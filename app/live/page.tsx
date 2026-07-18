"use client";

// Live TV 板块主页：编排舞台与控制面板。
// - 滤镜/音量/HDR 偏好 → localStorage（个人、前端）
// - 音频流/弹幕流地址 → settings API（全局、持久）
// - 画中画 → useDocumentPiP，把整个 stage（视频+控件）移入浮窗
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PageHeader } from "../../components/PageHeader";
import { LiveStage } from "../../components/live/LiveStage";
import { ControlPanel } from "../../components/live/ControlPanel";
import { ChannelPanel } from "../../components/live/ChannelPanel";
import { useDocumentPiP } from "../../lib/live/useDocumentPiP";
import type { SourceStatus } from "../../lib/live/sourceClient";

const EMBED_ID = "fox4k-usa"; // 默认 embed（FOX 4K）
const LS_KEY = "nas-live-prefs";
const REFRESH_INTERVAL = 3 * 60 * 1000; // 自动续期：3 分钟

// 偏好默认值：audioPlaying/hlsMuted = 默认 开xhs音频 / 关直播音频
const DEFAULTS = { brightness: 1, contrast: 1, saturate: 1, volume: 1, hdrMode: false, dmEnabled: true, dmOpacity: 1, dmFontSize: 15, dmSpeedMul: 1, dmAreaFrac: 1, dmGap: 1, dmLineGap: 1, audioPlaying: true, hlsMuted: true };

export default function LivePage() {
    const [brightness, setBrightness] = useState<number>(DEFAULTS.brightness);
    const [contrast, setContrast] = useState<number>(DEFAULTS.contrast);
    const [saturate, setSaturate] = useState<number>(DEFAULTS.saturate);
    const [volume, setVolume] = useState<number>(DEFAULTS.volume);
    const [hdrMode, setHdrMode] = useState<boolean>(DEFAULTS.hdrMode);
    const [dmEnabled, setDmEnabled] = useState<boolean>(DEFAULTS.dmEnabled);
    const [dmOpacity, setDmOpacity] = useState<number>(DEFAULTS.dmOpacity);
    const [dmFontSize, setDmFontSize] = useState<number>(DEFAULTS.dmFontSize);
    const [dmSpeedMul, setDmSpeedMul] = useState<number>(DEFAULTS.dmSpeedMul);
    const [dmAreaFrac, setDmAreaFrac] = useState<number>(DEFAULTS.dmAreaFrac);
    const [dmGap, setDmGap] = useState<number>(DEFAULTS.dmGap);
    const [dmLineGap, setDmLineGap] = useState<number>(DEFAULTS.dmLineGap);

    const [audioUrl, setAudioUrl] = useState("");
    const [danmakuUrl, setDanmakuUrl] = useState("");

    const [streamUrl, setStreamUrl] = useState("");
    const [streamInput, setStreamInputState] = useState("");
    // captureStream 通过 ref 读最新输入，而不是把 streamInput 放进 useCallback 依赖。
    // 否则输入框每敲一个字符都会重建 captureStream → 首屏/续期 effect 重跑 → 对半截地址抓流切台。
    const streamInputRef = useRef("");
    const setStreamInput = useCallback((v: string) => {
        setStreamInputState(v);
        streamInputRef.current = v;
    }, []);
    const [embedId, setEmbedId] = useState(EMBED_ID);
    const [refreshing, setRefreshing] = useState(false);
    const [danmakuStatus, setDanmakuStatus] = useState<SourceStatus>("idle");
    const [audioStatus, setAudioStatus] = useState<SourceStatus>("idle");
    const [audioPlaying, setAudioPlaying] = useState<boolean>(DEFAULTS.audioPlaying);
    const [hlsMuted, setHlsMuted] = useState<boolean>(DEFAULTS.hlsMuted);

    // 服务器同步哨兵：服务器权威偏好读回前不向服务器回写，避免本地 DEFAULTS 覆盖服务器真值
    const serverSyncedRef = useRef(false);

    // 1) 首屏即时：先读 localStorage（无延迟，防滤镜/弹幕跳变）
    useEffect(() => {
        try {
            const raw = localStorage.getItem(LS_KEY);
            if (!raw) return;
            const p = { ...DEFAULTS, ...JSON.parse(raw) };
            setBrightness(p.brightness); setContrast(p.contrast); setSaturate(p.saturate);
            setVolume(p.volume); setHdrMode(p.hdrMode);
            setDmEnabled(p.dmEnabled); setDmOpacity(p.dmOpacity); setDmFontSize(p.dmFontSize);
            setDmSpeedMul(p.dmSpeedMul); setDmAreaFrac(p.dmAreaFrac); setDmGap(p.dmGap);
            setDmLineGap(p.dmLineGap); setAudioPlaying(p.audioPlaying); setHlsMuted(p.hlsMuted);
        } catch { /* noop */ }
    }, []);

    // 2) 服务器权威：GET /api/settings 取 livePrefs 覆盖本地 + 回写 localStorage；同时取信号源地址
    useEffect(() => {
        fetch("/api/settings")
            .then((r) => r.json())
            .then((d) => {
                serverSyncedRef.current = true; // 服务器已响应，权威值就位（或确认无存）
                if (!d.success || !d.data) return;
                setAudioUrl(d.data.liveTvAudioUrl || "");
                setDanmakuUrl(d.data.liveTvDanmakuUrl || "");
                if (!d.data.livePrefs) return;
                try {
                    const p = { ...DEFAULTS, ...JSON.parse(d.data.livePrefs) };
                    setBrightness(p.brightness); setContrast(p.contrast); setSaturate(p.saturate);
                    setVolume(p.volume); setHdrMode(p.hdrMode);
                    setDmEnabled(p.dmEnabled); setDmOpacity(p.dmOpacity); setDmFontSize(p.dmFontSize);
                    setDmSpeedMul(p.dmSpeedMul); setDmAreaFrac(p.dmAreaFrac); setDmGap(p.dmGap);
                    setDmLineGap(p.dmLineGap); setAudioPlaying(p.audioPlaying); setHlsMuted(p.hlsMuted);
                    try { localStorage.setItem(LS_KEY, JSON.stringify(p)); } catch { /* noop */ }
                } catch { /* noop */ }
            })
            .catch(() => { serverSyncedRef.current = true; });
    }, []);

    // 3) 写入：立即回写 localStorage + 防抖 800ms POST 到服务器（拖滑块时不狂打 API）
    const prefsObj = { brightness, contrast, saturate, volume, hdrMode, dmEnabled, dmOpacity, dmFontSize, dmSpeedMul, dmAreaFrac, dmGap, dmLineGap, audioPlaying, hlsMuted };
    useEffect(() => {
        try { localStorage.setItem(LS_KEY, JSON.stringify(prefsObj)); } catch { /* noop */ }
        if (!serverSyncedRef.current) return; // 服务器权威值就位前不回写服务器（本地缓存照写）
        const h = setTimeout(() => {
            fetch("/api/settings", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "save_config", livePrefs: JSON.stringify(prefsObj) }),
            }).catch(() => { /* noop */ });
        }, 800);
        return () => clearTimeout(h);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [brightness, contrast, saturate, volume, hdrMode, dmEnabled, dmOpacity, dmFontSize, dmSpeedMul, dmAreaFrac, dmGap, dmLineGap, audioPlaying, hlsMuted]);

    // 合成 CSS filter（HDR 模式叠加增强系数）
    const filter = useMemo(() => {
        const b = brightness * (hdrMode ? 1.05 : 1);
        const c = contrast * (hdrMode ? 1.15 : 1);
        const s = saturate * (hdrMode ? 1.25 : 1);
        return `brightness(${b.toFixed(3)}) contrast(${c.toFixed(3)}) saturate(${s.toFixed(3)})`;
    }, [brightness, contrast, saturate, hdrMode]);

    // iframe 跟随解析出的 embed id：贴链接 → stream-refresh 解析 → 切频道
    const iframeSrc = `/api/embed-proxy/${embedId}`;

    const danmakuSettings = useMemo(() => ({
        enabled: dmEnabled, opacity: dmOpacity, fontSize: dmFontSize, speedMul: dmSpeedMul, areaFrac: dmAreaFrac, gap: dmGap, lineGap: dmLineGap,
    }), [dmEnabled, dmOpacity, dmFontSize, dmSpeedMul, dmAreaFrac, dmGap, dmLineGap]);

    // 当前正在播的 slug（从 streamInput 解析，供 ChannelPanel 高亮）
    const currentSlug = useMemo(() => {
        const m = (streamInput || "").match(/timstreams\.st\/watch\/([a-zA-Z0-9_-]+)/);
        return m ? m[1] : "";
    }, [streamInput]);

    const pip = useDocumentPiP();
    const stageRef = useRef<HTMLDivElement>(null);
    const liveStageRef = useRef<HTMLDivElement>(null);

    const handleTogglePip = useCallback(async () => {
        if (pip.isOpen) pip.close();
        else if (stageRef.current) await pip.open(stageRef.current);
    }, [pip]);

    const handleToggleFullscreen = useCallback(() => {
        const el = liveStageRef.current;
        if (!el) return;
        if (document.fullscreenElement) document.exitFullscreen();
        else el.requestFullscreen?.();
    }, []);

    const toggleAudio = useCallback(() => setAudioPlaying((v) => !v), []);
    const toggleHdr = useCallback(() => setHdrMode((v) => !v), []);

    // === 抓取流地址 ===
    const captureStream = useCallback(async (inputUrl?: string) => {
        setRefreshing(true);
        const src = inputUrl || streamInputRef.current || `https://timstreams.st/watch/${EMBED_ID}`;
        // 1. 立即解析 embed → iframe 兜底切换（瞬时，CDN 海报级响应）
        try {
            const r1 = await fetch(`/api/stream-refresh?url=${encodeURIComponent(src)}`);
            const d1 = await r1.json();
            if (d1.embed) { setEmbedId(d1.embed); setStreamInput(src); }
        } catch { /* noop */ }
        // 2. 模拟 timstreams 抓 m3u8 → HLS 自播（音量/画中画可控，约 10-15s）
        try {
            const r2 = await fetch(`/api/stream-capture?url=${encodeURIComponent(src)}`);
            const d2 = await r2.json();
            if (d2.url) setStreamUrl(d2.url);
        } catch { /* noop */ }
        finally { setRefreshing(false); }
    }, [setStreamInput]);

    // 手动提交输入框的地址（走解析）
    const applyStreamInput = useCallback(() => {
        const u = streamInput.trim();
        if (u) captureStream(u);
    }, [streamInput, captureStream]);

    // 首次加载：自动抓取
    useEffect(() => { captureStream(); }, [captureStream]);

    // 自动续期：定时刷新
    useEffect(() => {
        const timer = setInterval(() => captureStream(), REFRESH_INTERVAL);
        return () => clearInterval(timer);
    }, [captureStream]);

    return (
        <div className="w-full text-text-1">
            <PageHeader title="直播" eyebrow="Live TV" description="嵌入直播画面 · 本地音频与实时弹幕叠加 · 自由大小的画中画浮窗。" />

            <div
                ref={stageRef}
                data-pip-stage
                className="flex flex-col gap-4"
                style={{ minHeight: "calc(100vh - 220px)" }}
            >
                <div className="flex-1 min-h-[360px]">
                    <LiveStage
                        ref={liveStageRef}
                        iframeSrc={iframeSrc}
                        streamUrl={streamUrl || undefined}
                        hlsMuted={hlsMuted}
                        filter={filter}
                        audioUrl={audioUrl}
                        audioEnabled={audioPlaying}
                        volume={volume}
                        danmakuUrl={danmakuUrl}
                        danmakuSettings={danmakuSettings}
                        onDanmakuStatus={setDanmakuStatus}
                        onAudioStatus={setAudioStatus}
                    />
                </div>
                <ChannelPanel
                    currentSlug={currentSlug}
                    onPick={(slug) => captureStream(`https://timstreams.st/watch/${slug}`)}
                />
                <ControlPanel
                    brightness={brightness}
                    contrast={contrast}
                    saturate={saturate}
                    volume={volume}
                    onBrightness={setBrightness}
                    onContrast={setContrast}
                    onSaturate={setSaturate}
                    onVolume={setVolume}
                    hdrMode={hdrMode}
                    onToggleHdr={toggleHdr}
                    audioPlaying={audioPlaying}
                    onToggleAudio={toggleAudio}
                    danmakuStatus={danmakuStatus}
                    audioStatus={audioStatus}
                    hasDanmakuUrl={!!danmakuUrl}
                    hasAudioUrl={!!audioUrl}
                    pipSupported={pip.supported}
                    pipIsOpen={pip.isOpen}
                    onTogglePip={handleTogglePip}
                    onToggleFullscreen={handleToggleFullscreen}
                    // HLS 流
                    hlsMuted={hlsMuted} onToggleHlsMute={() => setHlsMuted(v => !v)} hasStreamUrl={!!streamUrl}
                    streamInput={streamInput} onStreamInput={setStreamInput} onCaptureStream={captureStream}
                    onApplyStreamInput={applyStreamInput} refreshing={refreshing}
                    // 弹幕
                    dmEnabled={dmEnabled} onToggleDm={() => setDmEnabled(v => !v)}
                    dmOpacity={dmOpacity} onDmOpacity={setDmOpacity}
                    dmAreaFrac={dmAreaFrac} onDmAreaFrac={setDmAreaFrac}
                    dmFontSize={dmFontSize} onDmFontSize={setDmFontSize}
                    dmSpeedMul={dmSpeedMul} onDmSpeedMul={setDmSpeedMul}
                    dmGap={dmGap} onDmGap={setDmGap}
                    dmLineGap={dmLineGap} onDmLineGap={setDmLineGap}
                />
            </div>
        </div>
    );
}
