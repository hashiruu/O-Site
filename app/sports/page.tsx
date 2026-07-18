"use client";

// /sports 体育主页：赛程 dashboard + 点击比赛自动匹配直播源就地播放。
// 引导不再自动弹出，只能从顶部全景条「❓重看引导」手动打开。
import { useCallback, useEffect, useRef, useState } from "react";
import Hls from "hls.js";
import { ScheduleDashboard } from "../../components/sports/ScheduleDashboard";
import { OnboardingTour } from "../../components/sports/OnboardingTour";
import { GroupStandings } from "../../components/sports/GroupStandings";
import { isKnockoutPlaceholder } from "../../lib/sports/bracket";
import type { MatchEvent } from "../../lib/sports/types";
import { PageHeader } from "../../components/PageHeader";
import { useLang } from "../../lib/i18n";

export default function SportsPage() {
    const { t } = useLang();
    const [tourOpen, setTourOpen] = useState(false);
    const [standingsOpen, setStandingsOpen] = useState(false);
    const [stream, setStream] = useState<string | null>(null);
    const [streamTitle, setStreamTitle] = useState("");
    const [fallbackUrl, setFallbackUrl] = useState("");
    const [matching, setMatching] = useState(false);
    const [notice, setNotice] = useState<string | null>(null);

    const closeTour = useCallback(() => setTourOpen(false), []);
    const openTour = useCallback(() => setTourOpen(true), []);

    // 点击比赛 → 队名匹配直播源 → 就地播放
    const handleWatch = useCallback(async (ev: MatchEvent) => {
        // 淘汰赛占位符对阵未定
        if (isKnockoutPlaceholder(ev.home.name) || isKnockoutPlaceholder(ev.away.name)) {
            setNotice("淘汰赛对阵未定 —— 小组赛结束后自动填充。");
            return;
        }
        setMatching(true);
        setNotice(null);
        setFallbackUrl("");
        let resolved: { url?: string; watchUrl?: string } | null = null;
        for (const n of [ev.home.name, ev.away.name]) {
            try {
                const r = await fetch(`/api/sports/watch?name=${encodeURIComponent(n)}`);
                const d = await r.json();
                if (d.success && d.url) { resolved = d; break; }
                if (d.watchUrl && !resolved) resolved = d; // 暂存 fallback
            } catch { /* try next name */ }
        }
        setMatching(false);
        if (resolved?.url) {
            setStream(resolved.url);
            setStreamTitle(`${ev.home.name} vs ${ev.away.name}`);
        } else if (resolved?.watchUrl) {
            setNotice("直播源未就绪（抓流失败），点下方链接去 Live TV 手动粘贴：");
            setFallbackUrl(resolved.watchUrl);
        } else {
            setNotice("未匹配到直播源，请到 Live TV 手动粘贴该比赛链接。");
        }
    }, []);

    return (
        <div className="w-full text-text-1">
            <PageHeader title={t("体育")} eyebrow="Sports" description={t("世界杯赛程 · 美东时间 · 点击比赛自动匹配直播源。")} />

            <ScheduleDashboard onWatch={handleWatch} onReplayTour={openTour} />

            {matching && (
                <div className="fixed bottom-6 right-6 bg-bg-nav border border-line rounded-xl px-4 py-3 shadow-2xl flex items-center gap-3 z-50">
                    <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                    <span className="text-sm text-text-2">匹配直播源...</span>
                </div>
            )}
            {notice && (
                <div className="fixed bottom-6 right-6 bg-bg-nav border border-bili-pink/40 rounded-xl px-4 py-3 shadow-2xl z-50 max-w-xs">
                    <div className="text-sm text-text-2 mb-1">{notice}</div>
                    {fallbackUrl && (
                        <a href={fallbackUrl} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline break-all">{fallbackUrl}</a>
                    )}
                    <button type="button" onClick={() => setNotice(null)} className="block text-[10px] text-text-3 mt-1 hover:text-text-1">关闭</button>
                </div>
            )}

            {stream && <SportsPlayer src={stream} title={streamTitle} onClose={() => setStream(null)} />}

            <button
                type="button"
                onClick={() => setStandingsOpen(true)}
                title="小组积分榜"
                className="fixed right-4 top-1/2 -translate-y-1/2 z-40 bg-bg-nav border border-line text-text-1 rounded-full shadow-xl w-12 h-12 flex items-center justify-center text-xl hover:bg-bg-hover hover:border-primary transition-all"
            >
                📊
            </button>
            <GroupStandings open={standingsOpen} onClose={() => setStandingsOpen(false)} />
            <OnboardingTour open={tourOpen} onClose={closeTour} />
        </div>
    );
}

function SportsPlayer({ src, title, onClose }: { src: string; title: string; onClose: () => void }) {
    const ref = useRef<HTMLVideoElement>(null);
    useEffect(() => {
        const v = ref.current;
        if (!v) return;
        let hls: Hls | null = null;
        if (src.includes(".m3u8") && Hls.isSupported()) {
            hls = new Hls({ lowLatencyMode: true });
            hls.loadSource(src);
            hls.attachMedia(v);
        } else {
            v.src = src;
        }
        v.play().catch(() => { /* autoplay 可能被拦 */ });
        return () => { hls?.destroy(); };
    }, [src]);

    return (
        <div className="fixed inset-0 z-[90] bg-black/85 flex items-center justify-center p-4" onClick={onClose}>
            <div className="max-w-5xl w-full" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-text-2">{title}</span>
                    <button type="button" onClick={onClose} className="text-text-3 hover:text-text-1 text-sm">✕ 关闭</button>
                </div>
                <video ref={ref} controls autoPlay className="w-full max-h-[80vh] rounded-xl bg-black" />
            </div>
        </div>
    );
}
