"use client";

// 直播舞台：fetch embed HTML → Blob URL → <iframe src={blobUrl}>（纯 React，不手动操作 DOM）
// + 实时弹幕层 + 本地音频流。
// filter 只作用于 iframe 本身，弹幕层不受滤镜影响。
import { forwardRef, useEffect, useRef, useState } from "react";
import { DanmakuTrack, DanmakuHandle, DanmakuSettings } from "./DanmakuTrack";
import { attachAudio, createDanmakuSource, DanmakuSource, SourceStatus } from "../../lib/live/sourceClient";

interface LiveStageProps {
    iframeSrc: string;
    streamUrl?: string;
    hlsMuted?: boolean;
    filter: string;
    audioUrl: string;
    audioEnabled: boolean;
    volume: number;
    danmakuUrl: string;
    danmakuSettings: DanmakuSettings;
    onDanmakuStatus?: (s: SourceStatus) => void;
    onAudioStatus?: (s: SourceStatus) => void;
}

export const LiveStage = forwardRef<HTMLDivElement, LiveStageProps>(function LiveStage({
    iframeSrc, streamUrl, hlsMuted, filter, audioUrl, audioEnabled, volume, danmakuUrl, danmakuSettings, onDanmakuStatus, onAudioStatus,
}, ref) {
    const danmakuRef = useRef<DanmakuHandle>(null);
    const audioRef = useRef<HTMLVideoElement>(null);
    const hlsVideoRef = useRef<HTMLVideoElement>(null);
    const hlsRef = useRef<any>(null);
    const danmakuSourceRef = useRef<DanmakuSource | null>(null);
    const [blobUrl, setBlobUrl] = useState<string | null>(null);

    // === fetch embed → Blob URL ===
    useEffect(() => {
        let cancelled = false;
        setBlobUrl(null);
        fetch(iframeSrc)
            .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.text(); })
            .then(html => {
                if (cancelled) return;
                const blob = new Blob([html], { type: "text/html" });
                const url = URL.createObjectURL(blob);
                setBlobUrl(url);
            })
            .catch(() => { if (!cancelled) setBlobUrl(""); });
        return () => { cancelled = true; };
    }, [iframeSrc]);

    // cleanup blob URL on unmount / change
    useEffect(() => {
        return () => { if (blobUrl) URL.revokeObjectURL(blobUrl); };
    }, [blobUrl]);

    // === 直连 HLS 流（优先于 iframe） ===
    useEffect(() => {
        const video = hlsVideoRef.current;
        if (!streamUrl || !video) return;
        let cancelled = false;
        (async () => {
            try {
                const Hls = (await import("hls.js")).default;
                if (!Hls.isSupported() || cancelled) return;
                // 不按播放器尺寸压码率；锁定最高画质 variant（带宽充足，默认 4K，不自动降）
                const hls = new Hls({ lowLatencyMode: true, capLevelToPlayerSize: false });
                hlsRef.current = hls;
                hls.loadSource(streamUrl);
                hls.attachMedia(video);
                hls.on((Hls as any).Events?.MANIFEST_PARSED ?? "hlsManifestParsed", () => {
                    if (cancelled) return;
                    const lv = hls.levels;
                    if (lv.length) {
                        let mi = 0;
                        for (let i = 1; i < lv.length; i++) if ((lv[i].bitrate || 0) > (lv[mi].bitrate || 0)) mi = i;
                        hls.currentLevel = mi; // 锁最高码率（关闭 ABR 自动降档）
                    }
                    video.play().catch(() => {});
                });
            } catch { /* hls.js not available */ }
        })();
        return () => { cancelled = true; hlsRef.current?.destroy(); hlsRef.current = null; };
    }, [streamUrl]);

    // === 弹幕源 ===
    useEffect(() => {
        const url = (danmakuUrl || "").trim();
        if (!url) { onDanmakuStatus?.("idle"); return; }
        const src = createDanmakuSource(url, {
            onItem: (it) => danmakuRef.current?.push(it),
            onStatus: (s) => onDanmakuStatus?.(s),
        });
        danmakuSourceRef.current = src;
        return () => { src.close(); danmakuSourceRef.current = null; danmakuRef.current?.clear(); };
    }, [danmakuUrl, onDanmakuStatus]);

    // === 音频源 ===
    useEffect(() => {
        const audio = audioRef.current;
        const url = (audioUrl || "").trim();
        if (!audio) return;
        if (!audioEnabled || !url) {
            onAudioStatus?.("idle");
            audio.pause(); audio.removeAttribute("src");
            try { audio.load(); } catch { /* noop */ }
            return;
        }
        let cancelled = false;
        let detach: () => void = () => {};
        onAudioStatus?.("connecting");
        attachAudio(audio, url).then((d) => {
            if (cancelled) { d(); return; }
            detach = d;
            audio.volume = volume;
            audio.play().then(() => { if (!cancelled) onAudioStatus?.("connected"); })
                .catch(() => { if (!cancelled) onAudioStatus?.("connected"); });
        }).catch(() => { if (!cancelled) onAudioStatus?.("error"); });
        return () => { cancelled = true; detach(); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [audioUrl, audioEnabled]);

    useEffect(() => { if (audioRef.current) audioRef.current.volume = volume; }, [volume]);

    // HLS 流静音
    useEffect(() => { if (hlsVideoRef.current) hlsVideoRef.current.muted = !!hlsMuted; }, [hlsMuted]);

    return (
        <div ref={ref} className="live-stage-root relative w-full bg-black overflow-hidden rounded-lg" style={{ aspectRatio: "16/9" }}>
            {/* 加载态 */}
            {blobUrl === null && (
                <div className="absolute inset-0 flex items-center justify-center bg-black z-10">
                    <div className="flex flex-col items-center gap-3">
                        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                        <span className="text-text-3 text-sm">加载直播...</span>
                    </div>
                </div>
            )}
            {blobUrl && (
                <iframe
                    key={blobUrl}
                    src={blobUrl}
                    title="Live TV"
                    width="100%"
                    height="100%"
                    frameBorder="0"
                    scrolling="no"
                    allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
                    allowFullScreen
                    style={{ filter }}
                />
            )}
            {/* 直连 HLS 播放器（优先于 iframe） */}
            <video ref={hlsVideoRef} className="absolute inset-0 w-full h-full object-contain bg-black" playsInline style={{ display: streamUrl ? "block" : "none", filter }} />
            <DanmakuTrack ref={danmakuRef} settings={danmakuSettings} className="z-20" />
            <video ref={audioRef} className="hidden" playsInline />
            <style jsx global>{`
                .live-stage-root:fullscreen { width: 100vw !important; height: 100vh !important; aspect-ratio: auto !important; border-radius: 0 !important; }
                .live-stage-root:-webkit-full-screen { width: 100vw !important; height: 100vh !important; aspect-ratio: auto !important; border-radius: 0 !important; }
            `}</style>
        </div>
    );
});
