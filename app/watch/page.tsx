"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useMe } from "@/components/useMe";
// 仅导入类型：hls.js（~100KB）只在真正走 HLS 播放时动态加载，不进首屏 bundle
import type Hls from "hls.js";
import { DanmakuControl } from "@/components/watch/DanmakuControl";
import { DanmakuTrack, type DanmakuHandle, type DanmakuSettings } from "@/components/live/DanmakuTrack";
import { SourceDrawer } from "../../components/SourceDrawer";

// ---- 浏览器解码能力探测：决定 direct（直连）/ remux（视频复制+音频转AAC）/ hls（完整转码）----
function canBrowserPlayVideo(codec: string, pixFmt: string): boolean {
    const c = (codec || "").toLowerCase();
    if (!c) return true; // 未知编码先尝试直连
    const is10bit = (pixFmt || "").includes("10");
    if (c === "h264") return !is10bit; // Hi10P 无浏览器硬解
    if (c === "hevc" || c === "h265") {
        // 依赖平台硬解（Mac/部分 Windows 支持，Linux Chrome 通常不支持）
        try {
            return typeof MediaSource !== "undefined" &&
                (MediaSource.isTypeSupported('video/mp4; codecs="hvc1.1.6.L153.B0"') ||
                 MediaSource.isTypeSupported('video/mp4; codecs="hev1.1.6.L153.B0"'));
        } catch { return false; }
    }
    if (c === "vp8") return true;
    if (c === "vp9") {
        try { return MediaSource.isTypeSupported(`video/webm; codecs="vp9${is10bit ? ".2" : ""}"`); } catch { return false; }
    }
    if (c === "av1") {
        try { return MediaSource.isTypeSupported('video/mp4; codecs="av01.0.05M.08"'); } catch { return false; }
    }
    return false; // mpeg2/vc1/rv 等一律转码
}

function canBrowserPlayAudio(codec: string): boolean {
    const c = (codec || "").toLowerCase();
    if (!c) return true;
    const supported = ["aac", "mp3", "opus", "vorbis", "flac", "alac", "pcm"];
    return supported.some(k => c === k || c.startsWith(k));
}

type DecodeDecision = { mode: "direct" | "hls"; remux: boolean; reason: string };

function decidePlayStrategy(videoCodec: string, videoPixFmt: string, audioCodec: string): DecodeDecision {
    const videoOk = canBrowserPlayVideo(videoCodec, videoPixFmt);
    const audioOk = canBrowserPlayAudio(audioCodec);
    if (videoOk && audioOk) return { mode: "direct", remux: false, reason: "浏览器原生支持" };
    if (videoOk && !audioOk && (videoCodec || "").toLowerCase() === "h264") {
        // 视频无损复制，仅音频转 AAC，几乎零开销
        return { mode: "hls", remux: true, reason: `音频 ${audioCodec} 不支持，智能转封装` };
    }
    return { mode: "hls", remux: false, reason: `视频 ${videoCodec}${!audioOk ? ` / 音频 ${audioCodec}` : ""} 需要转码` };
}

function BackIcon() {
    return (
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
            <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" />
        </svg>
    );
}

// 点播弹幕偏好默认值（云端持久化，复用 /live 模式）
// v2：2026-07-05 弹幕默认值改版（50%/28px/100%/半屏），bump key 让旧偏好作废、全员回落新默认
const WATCH_PREFS_KEY = "nas-watch-prefs-v2";
type DmTypes = { scroll: boolean; top: boolean; bottom: boolean };
// 全站统一弹幕默认：不透明度 50% / 字号 28 / 密度 100% / 显示区域半屏
const DM_DEFAULTS = {
    dmEnabled: true,
    dmOpacity: 0.5,
    dmFontSize: 28,
    dmAreaFrac: 0.5,
    dmSpeed: 1,
    dmDensity: 1,
    dmTypes: { scroll: true, top: true, bottom: true } as DmTypes,
    dmBlockwords: [] as string[],
    autoPlayNext: true,   // 片尾自动连播下一集（仅剧集有效，电影无下一集）
    playbackRate: 1,      // 视频倍速，跨集持久化
};

function WatchContent() {
    const searchParams = useSearchParams();
    const router = useRouter();
    const filePath = searchParams.get("filePath");

    const containerRef = useRef<HTMLDivElement>(null);
    const dpRef = useRef<any>(null);
    const theaterBtnRef = useRef<HTMLDivElement | null>(null);

    const [playMode, setPlayMode] = useState<"direct" | "hls">("direct");
    const [isTheaterMode, setIsTheaterMode] = useState(false);
    // 网页全屏：自研实现，不用 DPlayer 的 dplayer-fulled。
    // DPlayer 原生方案给 body 挂 position:fixed（dplayer-web-fullscreen-fix）且 destroy() 不清理，
    // 回退首页后 body 仍 fixed → 全站无法滚动；且 fixed body 无宽高声明，iPad 上布局崩坏。
    // 自研方案：播放器 wrapper（本就同时包住 DPlayer 与弹幕层）fixed 铺满 + body overflow 锁，
    // 弹幕无需 reparent，退出/卸载路径都有确定清理。
    const [isWebFull, setIsWebFull] = useState(false);
    const [isInitializingHls, setIsInitializingHls] = useState(false);
    const [hlsSession, setHlsSession] = useState<string | null>(null);
    const hlsSessionRef = useRef<string | null>(null);
    const hlsRef = useRef<Hls | null>(null);
    const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
    // 在 HLS 模式下切音轨/字幕时强制重建播放器（playMode 不变时 effect 不会自动重跑）
    const [reloadToken, setReloadToken] = useState(0);
    // 解码自适应：每个文件只自动决策一次，之后尊重用户手动选择
    const autoDecidedForRef = useRef<string | null>(null);
    const hlsRemuxRef = useRef(false);
    const [decodeReason, setDecodeReason] = useState("");
    // 省流量通道：mcvale.net 外网访问的受限用户只能走 HLS 转码（服务端同规则兜底，
    // 直连 stream 会 403）。域名命中先置 true，/api/auth/me 确认 boss/admin 后解除。
    const limitedChannelRef = useRef(false);
    useEffect(() => {
        const host = window.location.hostname.toLowerCase();
        if (host !== "mcvale.net" && !host.endsWith(".mcvale.net")) return;
        limitedChannelRef.current = true;
        fetch("/api/auth/me")
            .then((r) => r.json())
            .then((d) => { if (d.role === "boss" || d.role === "admin") limitedChannelRef.current = false; })
            .catch(() => { /* 保持受限 */ });
    }, []);
    // 收集播放器初始化过程中注册的全局副作用，统一在 cleanup 时撤销
    const playerCleanupsRef = useRef<(() => void)[]>([]);
    const subtitleBlobRef = useRef<string | null>(null);

    // 把 VTT 文本挂载为原生 <track>：只管理我们自己注入的 track，不碰 DPlayer 的
    const mountNasTrack = (videoEl: HTMLVideoElement, vttText: string, label: string, lang: string) => {
        if (subtitleBlobRef.current) {
            URL.revokeObjectURL(subtitleBlobRef.current);
            subtitleBlobRef.current = null;
        }
        videoEl.querySelectorAll('track[data-nas-track]').forEach(tr => tr.remove());
        const blobUrl = URL.createObjectURL(new Blob([vttText], { type: 'text/vtt' }));
        subtitleBlobRef.current = blobUrl;
        const track = document.createElement('track');
        track.setAttribute('data-nas-track', '1');
        track.kind = 'subtitles';
        track.label = label;
        track.src = blobUrl;
        track.srclang = lang;
        track.default = true;
        videoEl.appendChild(track);
        const textTrack = videoEl.textTracks[videoEl.textTracks.length - 1];
        if (textTrack) textTrack.mode = 'showing';
    };

    const unmountNasTrack = (videoEl: HTMLVideoElement | null) => {
        if (subtitleBlobRef.current) {
            URL.revokeObjectURL(subtitleBlobRef.current);
            subtitleBlobRef.current = null;
        }
        videoEl?.querySelectorAll('track[data-nas-track]').forEach(tr => tr.remove());
    };

    // 音轨与字幕轨道
    const [audioTracks, setAudioTracks] = useState<{ index: number; title: string; language: string; codec: string }[]>([]);
    const [subtitleTracks, setSubtitleTracks] = useState<{ index: number; title: string; language: string; codec: string; isImage: boolean }[]>([]);
    const [selectedAudioIndex, setSelectedAudioIndex] = useState<number | null>(null);
    const [selectedSubtitleIndex, setSelectedSubtitleIndex] = useState<number | null>(null);
    const audioTracksRef = useRef(audioTracks);
    const subtitleTracksRef = useRef(subtitleTracks);
    const selectedAudioRef = useRef(selectedAudioIndex);
    const selectedSubtitleRef = useRef(selectedSubtitleIndex);
    audioTracksRef.current = audioTracks;
    subtitleTracksRef.current = subtitleTracks;
    selectedAudioRef.current = selectedAudioIndex;
    selectedSubtitleRef.current = selectedSubtitleIndex;

    // 收藏与分享状态
    const [isFavorite, setIsFavorite] = useState(false);
    const [showShareTip, setShowShareTip] = useState(false);
    // 铁律：未登录不提供个人化功能——收藏/加列表按钮隐藏（进度上报后端已 401 兜底）
    const { loggedIn } = useMe();

    // 弹幕偏好（开关/不透明度/字号/显示区域/速度/密度/类型过滤/屏蔽词）
    const [dmEnabled, setDmEnabled] = useState(DM_DEFAULTS.dmEnabled);
    const [dmOpacity, setDmOpacity] = useState(DM_DEFAULTS.dmOpacity);
    const [dmFontSize, setDmFontSize] = useState(DM_DEFAULTS.dmFontSize);
    const [dmAreaFrac, setDmAreaFrac] = useState(DM_DEFAULTS.dmAreaFrac);
    const [dmSpeed, setDmSpeed] = useState(DM_DEFAULTS.dmSpeed);
    const [dmDensity, setDmDensity] = useState(DM_DEFAULTS.dmDensity);
    const [dmTypes, setDmTypes] = useState<DmTypes>(DM_DEFAULTS.dmTypes);
    const [dmBlockwords, setDmBlockwords] = useState<string[]>(DM_DEFAULTS.dmBlockwords);
    // 连播与倍速（与弹幕偏好共用 watch-prefs 持久化管道）
    const [autoPlayNext, setAutoPlayNext] = useState(DM_DEFAULTS.autoPlayNext);
    const [playbackRate, setPlaybackRate] = useState(DM_DEFAULTS.playbackRate);
    const autoPlayNextRef = useRef(autoPlayNext);
    const playbackRateRef = useRef(playbackRate);
    autoPlayNextRef.current = autoPlayNext;
    playbackRateRef.current = playbackRate;
    const danmakuRef = useRef<DanmakuHandle>(null);   // 自研弹幕引擎（/live DanmakuTrack，替代 DPlayer 弹幕层）
    const dmHostRef = useRef<HTMLDivElement>(null);        // 弹幕层宿主：真全屏时 reparent 进 DPlayer container
    const playerWrapperRef = useRef<HTMLDivElement>(null); // 播放器外层（DPlayer container + 弹幕层）
    const danmakuListRef = useRef<[number, number, number, string, string][]>([]);  // 全量 [time,type,color,author,text]
    const filteredListRef = useRef<typeof danmakuListRef.current>([]);              // 过滤后（密度/屏蔽词/类型）
    const dmIndexRef = useRef(0);                     // 时间轴调度游标
    const dmServerSyncedRef = useRef(false);          // 服务器权威偏好就位哨兵
    // HLS 转码流时间轴从 0 重置（ffmpeg -ss startTime），需 +startTime 才是绝对弹幕时间；direct 模式为 0
    const dmTimeOffsetRef = useRef(0);

    // 播放列表菜单状态
    const [showPlaylistMenu, setShowPlaylistMenu] = useState(false);
    const [availablePlaylists, setAvailablePlaylists] = useState<{ id: string; name: string; itemCount: number }[]>([]);
    const [playlistTip, setPlaylistTip] = useState("");

    const handleAddToPlaylist = async (playlistId: string, playlistName: string) => {
        if (!filePath) return;
        setShowPlaylistMenu(false);
        try {
            const res = await fetch('/api/playlists', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'add', id: playlistId, filePath, title: fileName })
            });
            const data = await res.json();
            setPlaylistTip(data.success ? `已加入「${playlistName}」` : '加入失败');
        } catch {
            setPlaylistTip('加入失败');
        }
        setTimeout(() => setPlaylistTip(""), 2000);
    };

    // 点击页面其他位置关闭播放列表菜单
    useEffect(() => {
        if (!showPlaylistMenu) return;
        const close = () => setShowPlaylistMenu(false);
        document.addEventListener('click', close);
        return () => document.removeEventListener('click', close);
    }, [showPlaylistMenu]);

    // 关联剧集数据
    const [relatedMedia, setRelatedMedia] = useState<any[]>([]);
    const relatedMediaRef = useRef<any[]>(relatedMedia);
    relatedMediaRef.current = relatedMedia;
    const [loadingRelated, setLoadingRelated] = useState(false);
    // 为你推荐：普通视频（无分集）时右侧栏改为随机站内推荐
    const [recommendMedia, setRecommendMedia] = useState<any[]>([]);
    const [activeSeason, setActiveSeason] = useState<number>(1);
    const [episodeViewMode, setEpisodeViewMode] = useState<'grid' | 'list'>('grid');
    const [episodeSortAsc, setEpisodeSortAsc] = useState(true);

    // TMDB 刮削数据
    const [tmdbData, setTmdbData] = useState<any>(null);
    const [loadingTmdb, setLoadingTmdb] = useState(false);

    // 分类移动功能状态
    const [mediaDirs, setMediaDirs] = useState<{ key: string; path: string; name: string; type: string }[]>([]);
    const [movePhase, setMovePhase] = useState<'idle' | 'copying' | 'confirm_delete' | 'deleting' | 'done' | 'error'>('idle');
    const [moveProgress, setMoveProgress] = useState(0);
    const [moveMessage, setMoveMessage] = useState('');
    const [moveSessionId, setMoveSessionId] = useState('');
    const [moveDeleteCmd, setMoveDeleteCmd] = useState('');
    const [moveSourcePath, setMoveSourcePath] = useState('');
    const [moveTargetPath, setMoveTargetPath] = useState('');
    const [moveSourceSize, setMoveSourceSize] = useState('');
    const [moveError, setMoveError] = useState('');

    const fileName = filePath ? filePath.split(/[/\\]/).pop() || "未知视频" : "未知视频";

    // 未收录/播不了 → 右侧"视频源"抽屉（fetch-out 平台 + B站站内嵌入）
    const [sourceDrawer, setSourceDrawer] = useState(false);
    useEffect(() => {
        if (!filePath) return;
        // 目录路径（无扩展名）= 没有可播文件,立即弹;文件路径给 5s 探测,视频元数据仍没就绪才弹
        const looksLikeDir = !/\.[a-zA-Z0-9]{2,5}$/.test(filePath);
        const t = setTimeout(() => {
            const v = document.querySelector("video");
            const noMedia = !v || !v.duration || Number.isNaN(v.duration);
            if (looksLikeDir || noMedia) setSourceDrawer(true);
        }, looksLikeDir ? 600 : 5000);
        return () => clearTimeout(t);
    }, [filePath]);

    useEffect(() => {
        if (!filePath) return;
        // AbortController：切集时 abort 旧请求，防慢的旧响应覆盖新结果（报告 #13）
        const ac = new AbortController();
        const onErr = (err: any) => { if ((err as Error).name !== 'AbortError') console.error(err); };

        // 检查收藏状态（服务端共享）
        fetch(`/api/favorites`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'check', filePath }), signal: ac.signal })
            .then(res => res.json())
            .then(data => { if (data.success) setIsFavorite(data.isFavorite); })
            .catch(onErr);

        // 拉取关联剧集
        setLoadingRelated(true);
        setRecommendMedia([]);
        fetch(`/api/media/related?filePath=${encodeURIComponent(filePath)}`, { signal: ac.signal })
            .then(res => res.json())
            .then(data => {
                if (data.success) {
                    setRelatedMedia(data.data);
                    // 尝试自动定位到当前播放的季
                    const currentItem = data.data.find((i: any) => i.path === filePath);
                    if (currentItem) {
                        setActiveSeason(currentItem.season || 1);
                    } else if (data.data.length > 0) {
                        setActiveSeason(data.data[0].season || 1);
                    }
                    // 普通视频没有分集 → 右侧栏改为"为你推荐"（随机站内其他视频）
                    if (data.data.length === 0) {
                        fetch(`/api/media/recommend?exclude=${encodeURIComponent(filePath)}&limit=10`, { signal: ac.signal })
                            .then(res => res.json())
                            .then(rec => { if (rec.success) setRecommendMedia(rec.data); })
                            .catch(onErr);
                    }
                }
            })
            .catch(onErr)
            .finally(() => { if (!ac.signal.aborted) setLoadingRelated(false); });
        // 拉取可用的媒体目录（用于分类移动）
        fetch('/api/settings', { signal: ac.signal })
            .then(res => res.json())
            .then(data => {
                if (data.success && data.data?.mediaDirs) {
                    setMediaDirs(data.data.mediaDirs);
                }
            })
            .catch(onErr);

        // 获取 TMDB 刮削信息
        setLoadingTmdb(true);
        fetch(`/api/media/tmdb?filePath=${encodeURIComponent(filePath)}`, { signal: ac.signal })
            .then(res => res.json())
            .then(data => {
                if (data.success) {
                    setTmdbData(data.data);
                }
            })
            .catch(onErr)
            .finally(() => { if (!ac.signal.aborted) setLoadingTmdb(false); });

        return () => ac.abort();
    }, [filePath]);

    // 剧院模式全局样式切换
    useEffect(() => {
        // 网页全屏：body 锁滚动（overflow，不用 position:fixed → 不跳顶、不破坏布局）+ ESC 退出
        if (isWebFull) {
            const prevOverflow = document.body.style.overflow;
            document.body.style.overflow = 'hidden';
            const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setIsWebFull(false); };
            document.addEventListener('keydown', onKey);
            return () => {
                document.body.style.overflow = prevOverflow;
                document.removeEventListener('keydown', onKey);
            };
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isWebFull]);

    useEffect(() => {
        if (isTheaterMode) {
            document.body.classList.add('theater-mode-active');
        } else {
            document.body.classList.remove('theater-mode-active');
        }
        return () => document.body.classList.remove('theater-mode-active');
    }, [isTheaterMode]);

    // 弹幕层随全屏迁移：DanmakuTrack 与 DPlayer 容器是兄弟，全屏只包住容器不带弹幕层，
    // 必须把弹幕层 reparent 进「全屏视口」。两种全屏都要覆盖：
    //   - 浏览器全屏：container.requestFullscreen() → document.fullscreenElement 命中 + fullscreenchange 触发
    //   - 网页全屏：DPlayer 给 .dplayer 加 .dplayer-fulled（CSS fixed 铺满），**不触发 fullscreenchange**
    // DPlayer 把 .dplayer 类加在 containerRef 元素本身上，故用 MutationObserver 监听其 class 变化捕捉网页全屏。
    const syncDanmakuHost = useCallback(() => {
        const host = dmHostRef.current;
        const wrapper = playerWrapperRef.current;
        const dplayerEl = containerRef.current;
        if (!host || !wrapper || !dplayerEl) return;
        const fsEl = document.fullscreenElement as HTMLElement | null;
        const browserFull = !!fsEl && (fsEl === dplayerEl || fsEl.contains(dplayerEl));
        const webFull = dplayerEl.classList.contains('dplayer-fulled');
        const target: HTMLElement = (browserFull || webFull) ? dplayerEl : wrapper;
        if (host.parentElement !== target) target.appendChild(host);
    }, []);

    useEffect(() => {
        document.addEventListener('fullscreenchange', syncDanmakuHost);
        const el = containerRef.current;
        const mo = el ? new MutationObserver(syncDanmakuHost) : null;
        mo?.observe(el!, { attributes: true, attributeFilter: ['class'] });
        return () => {
            document.removeEventListener('fullscreenchange', syncDanmakuHost);
            mo?.disconnect();
        };
    }, [syncDanmakuHost]);

    // 弹幕本地过滤：类型过滤 + 屏蔽词 + 密度抽样（按索引步长均匀取样；弹幕按时排序 ≈ 均匀时间）
    // 弹幕本地过滤：类型 + 屏蔽词 + 密度抽样 → 写入 filteredListRef 并重置游标
    const applyFilter = () => {
        let arr = danmakuListRef.current.filter((d) => {
            if (d[1] === 0) return dmTypes.scroll;
            if (d[1] === 1) return dmTypes.top;
            if (d[1] === 2) return dmTypes.bottom;
            return true;
        });
        if (dmBlockwords.length) arr = arr.filter((d) => !dmBlockwords.some((w) => String(d[4]).includes(w)));
        if (dmDensity < 1) {
            const stride = Math.max(1, Math.round(1 / dmDensity));
            arr = arr.filter((_, i) => i % stride === 0);
        }
        filteredListRef.current = arr;
        // 游标对齐当前播放点而非归零：播放中途弹幕才加载完/改密度时，归零会让下一次
        // timeupdate 把 0→当前时刻 的全部弹幕一口气喷出来（同屏上限内全爆）
        const v: HTMLVideoElement | undefined = dpRef.current?.video;
        const t = v ? v.currentTime + dmTimeOffsetRef.current : 0;
        let lo = 0, hi = arr.length;
        while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m][0] < t) lo = m + 1; else hi = m; }
        dmIndexRef.current = lo;
        danmakuRef.current?.clear();
    };

    // 加载该集 ASS 弹幕（/api/danmaku/ass 已按集号匹配 + 解析 + 磁盘缓存）
    // signal 用于切集时中止飞行中的请求，防止旧集弹幕晚 resolve 覆盖新集（报告 #12）。
    const loadDanmaku = async (signal?: AbortSignal) => {
        if (!filePath) return;
        try {
            const r = await fetch(`/api/danmaku/ass?filePath=${encodeURIComponent(filePath)}`, { signal });
            const d = await r.json();
            danmakuListRef.current = ((d.data || []) as [number, number, number, string, string][]).slice().sort((a, b) => a[0] - b[0]);
            applyFilter();
        } catch { /* noop（含 abort） */ }
    };

    // === 弹幕偏好：持久化（localStorage 即时 + settings 权威 + debounce 写）===
    useEffect(() => {
        try {
            const raw = localStorage.getItem(WATCH_PREFS_KEY);
            if (!raw) return;
            const p = { ...DM_DEFAULTS, ...JSON.parse(raw) };
            setDmEnabled(p.dmEnabled); setDmOpacity(p.dmOpacity); setDmFontSize(p.dmFontSize);
            setDmAreaFrac(p.dmAreaFrac); setDmSpeed(p.dmSpeed); setDmDensity(p.dmDensity);
            setDmTypes(p.dmTypes); setDmBlockwords(p.dmBlockwords);
            setAutoPlayNext(p.autoPlayNext); setPlaybackRate(p.playbackRate);
        } catch { /* noop */ }
    }, []);
    useEffect(() => {
        fetch("/api/settings").then((r) => r.json()).then((d) => {
            dmServerSyncedRef.current = true;
            if (!d.success || !d.data?.watchPrefs) return;
            try {
                const p = { ...DM_DEFAULTS, ...JSON.parse(d.data.watchPrefs) };
                setDmEnabled(p.dmEnabled); setDmOpacity(p.dmOpacity); setDmFontSize(p.dmFontSize);
                setDmAreaFrac(p.dmAreaFrac); setDmSpeed(p.dmSpeed); setDmDensity(p.dmDensity);
                setDmTypes(p.dmTypes); setDmBlockwords(p.dmBlockwords);
                setAutoPlayNext(p.autoPlayNext); setPlaybackRate(p.playbackRate);
                try { localStorage.setItem(WATCH_PREFS_KEY, JSON.stringify(p)); } catch { /* noop */ }
            } catch { /* noop */ }
        }).catch(() => { dmServerSyncedRef.current = true; });
    }, []);
    const dmPrefsObj = { dmEnabled, dmOpacity, dmFontSize, dmAreaFrac, dmSpeed, dmDensity, dmTypes, dmBlockwords, autoPlayNext, playbackRate };
    useEffect(() => {
        try { localStorage.setItem(WATCH_PREFS_KEY, JSON.stringify(dmPrefsObj)); } catch { /* noop */ }
        if (!dmServerSyncedRef.current) return;
        const h = setTimeout(() => {
            fetch("/api/settings", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "save_config", watchPrefs: JSON.stringify(dmPrefsObj) }),
            }).catch(() => { /* noop */ });
        }, 800);
        return () => clearTimeout(h);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [dmEnabled, dmOpacity, dmFontSize, dmAreaFrac, dmSpeed, dmDensity, dmTypes, dmBlockwords, autoPlayNext, playbackRate]);

    // === 弹幕引擎（/live DanmakuTrack）settings + 时间轴调度 ===
    const danmakuSettings: DanmakuSettings = useMemo(() => ({
        enabled: dmEnabled, opacity: dmOpacity, fontSize: dmFontSize,
        speedMul: dmSpeed, areaFrac: dmAreaFrac, gap: 1, lineGap: 1,
    }), [dmEnabled, dmOpacity, dmFontSize, dmSpeed, dmAreaFrac]);

    // 该集弹幕加载（filePath 变）
    useEffect(() => {
        const ac = new AbortController();
        danmakuListRef.current = []; filteredListRef.current = []; dmIndexRef.current = 0;
        danmakuRef.current?.clear();
        loadDanmaku(ac.signal);
        return () => ac.abort();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [filePath]);

    // 偏好变化（密度/屏蔽词/类型）→ 重新过滤
    useEffect(() => { applyFilter(); /* eslint-disable-next-line */ }, [dmDensity, dmBlockwords, dmTypes]);
    // 注：弹幕时间轴调度（timeupdate/seeking）在 DPlayer 装配完成的 then 里绑定（此时 video 才就绪）

    const handleFavorite = async () => {
        if (!filePath) return;
        try {
            const res = await fetch('/api/favorites', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: isFavorite ? 'remove' : 'add',
                    filePath,
                    title: fileName
                })
            });
            const data = await res.json();
            if (data.success) setIsFavorite(data.isFavorite);
        } catch (err) { console.error('收藏操作失败:', err); }
    };

    const handleShare = () => {
        const url = window.location.href;

        const showSuccess = () => {
            setShowShareTip(true);
            setTimeout(() => setShowShareTip(false), 2000);
        };

        if (navigator.clipboard && window.isSecureContext) {
            navigator.clipboard.writeText(url)
                .then(showSuccess)
                .catch(err => {
                    console.error('Modern copy failed, trying fallback', err);
                    fallbackCopy(url, showSuccess);
                });
        } else {
            fallbackCopy(url, showSuccess);
        }
    };

    const fallbackCopy = (text: string, callback: () => void) => {
        try {
            const textArea = document.createElement("textarea");
            textArea.value = text;
            textArea.style.position = "fixed";
            textArea.style.left = "-9999px";
            textArea.style.top = "0";
            document.body.appendChild(textArea);
            textArea.focus();
            textArea.select();
            const successful = document.execCommand('copy');
            document.body.removeChild(textArea);
            if (successful) {
                callback();
            } else {
                alert("浏览器拒绝复制，请手动复制地址栏链接。");
            }
        } catch (err) {
            console.error('Fallback copy error:', err);
            alert("复制失败，请尝试手动复制地址栏。");
        }
    };

    const handlePlay = (path: string) => {
        router.push(`/watch?filePath=${encodeURIComponent(path)}`);
    };

    // 计算下一集（跨季）：整个系列剧集按 season/episode 排序，取当前集的下一条
    const computeNextEpisode = () => {
        const list = relatedMediaRef.current;
        if (!list || list.length === 0 || !filePath) return null;
        const sorted = [...list].sort((a: any, b: any) => (a.season - b.season) || (a.episode - b.episode));
        const idx = sorted.findIndex((e: any) => e.path === filePath);
        if (idx === -1 || idx >= sorted.length - 1) return null;
        return sorted[idx + 1];
    };

    const goNextEpisode = () => {
        const next = computeNextEpisode();
        if (next) router.push(`/watch?filePath=${encodeURIComponent(next.path)}`);
    };

    // 应用倍速到当前播放器实例（装配后 / 用户切换时调用）
    const applyPlaybackRate = (rate: number) => {
        const dp: any = dpRef.current;
        if (!dp) return;
        try { dp.speed?.(rate); } catch { /* 某些 DPlayer 版本无 speed 方法 */ }
        try { if (dp.video) dp.video.playbackRate = rate; } catch { /* noop */ }
    };

    // --- 分类移动逻辑 ---
    const currentDirType = mediaDirs.find(d => filePath?.startsWith(d.path))?.type || '';
    const typeLabels: Record<string, string> = {
        movie: '电影', series: '电视剧', anime: '动漫', travel: '旅行相册', private: '私密空间'
    };

    const handleMoveStart = async (targetDirKey: string) => {
        if (!filePath) return;
        setMovePhase('copying');
        setMoveProgress(0);
        setMoveMessage('正在准备...');
        setMoveError('');

        try {
            const res = await fetch('/api/media/move', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filePath, targetDirKey })
            });

            if (!res.ok || !res.body) {
                const err = await res.json().catch(() => ({ error: '请求失败' }));
                setMovePhase('error');
                setMoveError(err.error || '请求失败');
                return;
            }

            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });

                const lines = buffer.split('\n\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        try {
                            const data = JSON.parse(line.slice(6));
                            if (data.phase === 'copying') {
                                setMoveProgress(data.progress || 0);
                                setMoveMessage(data.message || '');
                            } else if (data.phase === 'verifying') {
                                setMoveMessage(data.message || '校验中...');
                            } else if (data.phase === 'confirm_delete') {
                                setMovePhase('confirm_delete');
                                setMoveSessionId(data.sessionId);
                                setMoveDeleteCmd(data.deleteCommand);
                                setMoveSourcePath(data.sourcePath);
                                setMoveTargetPath(data.targetPath);
                                setMoveSourceSize(data.sourceSizeHuman);
                                setMoveMessage(data.message);
                            } else if (data.phase === 'error') {
                                setMovePhase('error');
                                setMoveError(data.message);
                            } else if (data.phase === 'preparing') {
                                setMoveMessage(data.message || '准备中...');
                            }
                        } catch { }
                    }
                }
            }
        } catch (err: any) {
            setMovePhase('error');
            setMoveError(err.message || '网络错误');
        }
    };

    const handleMoveConfirm = async () => {
        setMovePhase('deleting');
        setMoveMessage('正在删除源文件...');
        try {
            const res = await fetch('/api/media/move/confirm', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId: moveSessionId })
            });
            const data = await res.json();
            if (data.success) {
                setMovePhase('done');
                setMoveMessage('移动完成！页面将在 3 秒后刷新...');
                setTimeout(() => {
                    router.replace(`/watch?filePath=${encodeURIComponent(moveTargetPath)}`);
                }, 3000);
            } else {
                setMovePhase('error');
                setMoveError(data.error || '删除失败');
            }
        } catch (err: any) {
            setMovePhase('error');
            setMoveError(err.message || '网络错误');
        }
    };

    const handleMoveCancel = () => {
        setMovePhase('idle');
        setMoveProgress(0);
        setMoveMessage('');
        setMoveSessionId('');
        setMoveDeleteCmd('');
    };

    // 文件路径切换时，强制清零并恢复播放器为”直连原画”状态，防止降级状态污染下一个分集
    useEffect(() => {
        setPlayMode('direct');
        setIsInitializingHls(false);
        setSelectedAudioIndex(null);
        setSelectedSubtitleIndex(null);
    }, [filePath]);

    // 键盘快捷键：空格/k 播停、←→ 快退快进 10s、↑↓ 音量、f 全屏、m 静音、n 下一集
    // 通过 dpRef 读实例（不进依赖数组），输入框/文本域内不拦截，切集时重建绑定
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            const t = e.target as HTMLElement;
            if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t.isContentEditable) return;
            const dp: any = dpRef.current;
            if (!dp || !dp.video) return;
            const video = dp.video as HTMLVideoElement;
            switch (e.key) {
                case ' ': case 'k': case 'K':
                    e.preventDefault();
                    if (video.paused) video.play().catch(() => {}); else video.pause();
                    break;
                case 'ArrowRight':
                    e.preventDefault();
                    // 直接设 currentTime，不走 dp.seek()——后者内部会自弹 "FF x s" 提示，与下面的提示叠成两条
                    video.currentTime = Math.min((video.currentTime || 0) + 10, video.duration || (video.currentTime + 10));
                    dp.notice('⏩ 10s');
                    break;
                case 'ArrowLeft':
                    e.preventDefault();
                    video.currentTime = Math.max((video.currentTime || 0) - 10, 0);
                    dp.notice('⏪ 10s');
                    break;
                case 'ArrowUp':
                    e.preventDefault();
                    video.volume = Math.min((video.volume || 0) + 0.1, 1);
                    dp.notice(`音量 ${Math.round(video.volume * 100)}%`);
                    break;
                case 'ArrowDown':
                    e.preventDefault();
                    video.volume = Math.max((video.volume || 0) - 0.1, 0);
                    dp.notice(`音量 ${Math.round(video.volume * 100)}%`);
                    break;
                case 'f': case 'F':
                    e.preventDefault();
                    dp.fullScreen?.toggle('browser');
                    break;
                case 'm': case 'M':
                    e.preventDefault();
                    video.muted = !video.muted;
                    dp.notice(video.muted ? '🔇 已静音' : '🔊 取消静音');
                    break;
                case 'n': case 'N':
                    e.preventDefault();
                    goNextEpisode();
                    break;
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [filePath]);

    // 动态装配 DPlayer 弹幕视频内核并嵌入当前 HLS 解析协议
    useEffect(() => {
        if (!filePath || !containerRef.current) return;

        // 异步链取消守卫（报告 #12）：切集 / playMode 变 / reload 时，旧 effect 的
        // fetch progress → tracks → import dplayer → new DPlayer 及 HLS init/心跳若晚 resolve，
        // 必须作废——否则会往同一容器装第二个播放器、用旧 filePath 上报进度、clearInterval
        // 掉新会话心跳并给已被 kill 的旧 session 续命（→ 新会话 30s 后被服务端回收卡死 / 僵尸 ffmpeg）。
        let cancelled = false;

        // 清理上一次的 HLS 与 DPlayer 实例
        if (hlsRef.current) {
            hlsRef.current.destroy();
            hlsRef.current = null;
        }
        if (dpRef.current) {
            dpRef.current.destroy();
            dpRef.current = null;
        }

        // 进度与轨道信息互不依赖，并行请求（旧实现串联，白多一次往返）；
        // 各自兜底，任何一个失败都不阻塞播放器初始化
        Promise.all([
            fetch(`/api/media/progress?filePath=${encodeURIComponent(filePath)}`)
                .then(res => res.json())
                .then(d => (d.success && d.position) ? d.position : 0)
                .catch(() => 0),
            fetch(`/api/media/tracks?filePath=${encodeURIComponent(filePath)}`)
                .then(r => r.json())
                .then(d => d.success ? d : { audioTracks: [], subtitleTracks: [], videoCodec: '' })
                .catch(() => ({ audioTracks: [], subtitleTracks: [], videoCodec: '' }))
        ])
            .then(([initialTime, tracksData]) => {
                if (cancelled) return; // 旧链晚到：放弃装配播放器
                const audioTracks = tracksData.audioTracks || [];
                const subtitleTracks = tracksData.subtitleTracks || [];
                setAudioTracks(audioTracks);
                setSubtitleTracks(subtitleTracks);

                // 解码能力自适应：HEVC/10bit/EAC3/DTS 等浏览器不支持的源自动走转码，
                // H.264+不支持音频走智能转封装（视频零损耗复制）
                if (autoDecidedForRef.current !== filePath) {
                    autoDecidedForRef.current = filePath;
                    let decision = decidePlayStrategy(
                        tracksData.videoCodec || "",
                        tracksData.videoPixFmt || "",
                        audioTracks[0]?.codec || ""
                    );
                    // 省流量通道强制 HLS 完整转码（服务端锁 720p/30fps；直连会被 403）。
                    // reason 留空：限流是内部策略，不在播放界面向用户展示
                    if (limitedChannelRef.current) {
                        decision = { mode: "hls", remux: false, reason: "" };
                    }
                    hlsRemuxRef.current = decision.remux;
                    setDecodeReason(decision.reason);
                    if (decision.mode !== playMode) {
                        console.log(`[Player] 自动选择 ${decision.mode}${decision.remux ? " (remux)" : ""}: ${decision.reason}`);
                        setPlayMode(decision.mode);
                        return; // 模式切换后 effect 会重新初始化播放器
                    }
                }

                // 自动选中第一条音轨（浏览器直连时默认播放的就是第一条）
                if (audioTracks.length > 0 && selectedAudioRef.current === null) {
                    setSelectedAudioIndex(audioTracks[0].index);
                }

                import('dplayer').then((DPlayerModule) => {
                    if (cancelled) return; // import 期间已切集：不装配，防止往同容器装第二个播放器
                    const DPlayer = DPlayerModule.default;

                    // 字幕 URL：总是尝试加载（API 会自动提取内嵌字幕作为回退）
                    const subtitleUrl = `/api/media/subtitle?filePath=${encodeURIComponent(filePath)}`;

                    const dp = new DPlayer({
                        container: containerRef.current,
                        theme: '#F0784A',
                        // 必须关：DPlayer 自带 hotkey 与下方自定义键盘监听双重响应——
                        // 空格被切换两次（暂停→又播放=失效）、方向键两边各弹一次提示（叠加成多个）
                        hotkey: false,
                        video: {
                            url: playMode === 'direct'
                                ? `/api/media/stream?filePath=${encodeURIComponent(filePath)}${initialTime > 0 ? `#t=${initialTime}` : ''}`
                                : 'data:,', // 占位（hls.attachMedia 会接管）；用 data URI 避免对 /customHls 发起 404 请求
                            type: playMode === 'direct' ? 'auto' : 'customHls',
                            customType: {
                                customHls: function (video: HTMLVideoElement, player: any) {
                                    if (playMode === 'hls') {
                                        setIsInitializingHls(true);
                                        // 核心改进：客户端生成 sessionId，解决清理时的竞态条件
                                        const sid = Math.random().toString(16).substring(2, 10);
                                        hlsSessionRef.current = sid;

                                        // 只有图形字幕（PGS 等）需要烧录；文本字幕走原生 <track>，避免双重显示
                                        const selSubIdx = selectedSubtitleRef.current;
                                        const selSubTrack = subtitleTracksRef.current.find(t => t.index === selSubIdx);
                                        const burnIndex = (selSubIdx !== null && selSubTrack?.isImage) ? selSubIdx : null;

                                        fetch("/api/media/hls/init", {
                                            method: "POST",
                                            headers: { "Content-Type": "application/json" },
                                            body: JSON.stringify({
                                                filePath,
                                                sessionId: sid,
                                                startTime: initialTime,
                                                audioIndex: selectedAudioRef.current,
                                                subtitleIndex: burnIndex,
                                                // 烧录字幕时必须重编码视频，否则按解码探测结果决定是否转封装
                                                remux: burnIndex === null ? hlsRemuxRef.current : false
                                            })
                                        }).then(res => res.json())
                                            .then(data => {
                                                if (cancelled) return; // 旧 init 晚到：不清新心跳、不给旧 session 续命
                                                if (data.success && data.streamUrl) {
                                                    setHlsSession(sid);
                                                    // 心跳续命：服务端 30 秒收不到任何信号就会回收 FFmpeg
                                                    if (heartbeatRef.current) clearInterval(heartbeatRef.current);
                                                    heartbeatRef.current = setInterval(() => {
                                                        fetch('/api/media/hls/heartbeat', {
                                                            method: 'POST',
                                                            headers: { 'Content-Type': 'application/json' },
                                                            body: JSON.stringify({ sessionId: sid })
                                                        }).catch(() => {});
                                                    }, 5000);
                                                    return import("hls.js").then(({ default: Hls }) => {
                                                    if (cancelled) return;
                                                    if (Hls.isSupported()) {
                                                        const hls = new Hls({ maxBufferLength: 30, maxMaxBufferLength: 60 });
                                                        hlsRef.current = hls;
                                                        hls.loadSource(data.streamUrl);
                                                        hls.attachMedia(video);
                                                        hls.on(Hls.Events.MANIFEST_PARSED, () => {
                                                            setIsInitializingHls(false);
                                                            video.play().catch(err => {
                                                                if (err.name !== 'AbortError') console.warn("HLS play failed", err);
                                                            });
                                                            // 播放器重建会丢失原生字幕 track，重挂选中的文本字幕（按起播时间平移）
                                                            const selIdx = selectedSubtitleRef.current;
                                                            const selTrack = subtitleTracksRef.current.find(t => t.index === selIdx);
                                                            if (selIdx !== null && selTrack && !selTrack.isImage) {
                                                                const offsetParam = initialTime > 0 ? `&offset=${-initialTime}` : '';
                                                                fetch(`/api/media/embedded-subtitle?filePath=${encodeURIComponent(filePath!)}&streamIndex=${selIdx}${offsetParam}`)
                                                                    .then(r => r.ok ? r.text() : Promise.reject(new Error('extract fail')))
                                                                    .then(vtt => mountNasTrack(video, vtt, selTrack.title || selTrack.language, selTrack.language || 'zh'))
                                                                    .catch(() => {});
                                                            }
                                                        });
                                                        hls.on(Hls.Events.ERROR, (e, data) => {
                                                            if (data.fatal) setIsInitializingHls(false);
                                                        });
                                                    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
                                                        video.src = data.streamUrl;
                                                        video.addEventListener('loadedmetadata', () => {
                                                            setIsInitializingHls(false);
                                                            video.play().catch(() => {});
                                                        }, { once: true });
                                                    }
                                                    });
                                                } else {
                                                    throw new Error(data.error || "HLS Fail");
                                                }
                                            }).catch(err => {
                                                console.error("HLS 自动降级失败:", err);
                                                setIsInitializingHls(false);
                                                setPlayMode("direct");
                                            });
                                    }
                                }
                            }
                        },
                        subtitle: {
                            url: subtitleUrl,
                            type: 'webvtt',
                            fontSize: '25px',
                            bottom: '10%',
                            color: '#b7daff',
                        }
                    });

                    dpRef.current = dp;

                    // 截胡 DPlayer 的网页全屏按钮：capture 阶段先于其自身监听器，
                    // 阻断原生 dplayer-fulled/body-fixed 方案，走自研 isWebFull
                    {
                        const el = containerRef.current;
                        if (el) {
                            const interceptWebFull = (e: Event) => {
                                if ((e.target as HTMLElement).closest('.dplayer-full-in-icon')) {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    setIsWebFull(v => !v);
                                }
                            };
                            el.addEventListener('click', interceptWebFull, true);
                            playerCleanupsRef.current.push(() => el.removeEventListener('click', interceptWebFull, true));
                        }
                    }

                    // 应用持久化的倍速（direct 直连立即生效；HLS 模式下 video 就绪后同样应用）
                    applyPlaybackRate(playbackRateRef.current);

                    // 片尾自动连播下一集（仅当开启开关且存在下一集；电影无下一集自然不触发）
                    dp.on('ended', () => {
                        if (!autoPlayNextRef.current) return;
                        const next = computeNextEpisode();
                        if (next) router.push(`/watch?filePath=${encodeURIComponent(next.path)}`);
                    });

                    // 弹幕时间轴调度：DPlayer video 就绪后绑 timeupdate/seeking → push DanmakuTrack
                    // HLS 转码流 currentTime 从 0 起（相对转码起点），弹幕时间戳是绝对原片时间，
                    // 必须 +startTime 对齐；direct 模式 currentTime 本身即绝对时间（offset=0）。
                    dmTimeOffsetRef.current = playMode === 'hls' ? initialTime : 0;
                    const dmVideo = dp.video as HTMLVideoElement | undefined;
                    if (dmVideo) {
                        const onTime = () => {
                            // 后台标签页不吐弹幕：CSS 动画在后台被冻结，吐了也只会积压，
                            // 回到前台由 visibilitychange 对齐游标，积压的直接跳过
                            if (document.hidden) return;
                            const t = dmVideo.currentTime + dmTimeOffsetRef.current;
                            const list = filteredListRef.current;
                            while (dmIndexRef.current < list.length && list[dmIndexRef.current][0] <= t) {
                                const d = list[dmIndexRef.current];
                                danmakuRef.current?.push({
                                    text: d[4],
                                    color: "#" + (d[2] || 0xffffff).toString(16).padStart(6, "0"),
                                    type: d[1] as 0 | 1 | 2,
                                });
                                dmIndexRef.current++;
                            }
                        };
                        const onSeek = () => {
                            const t = dmVideo.currentTime + dmTimeOffsetRef.current;
                            const list = filteredListRef.current;
                            let lo = 0, hi = list.length;
                            while (lo < hi) { const m = (lo + hi) >> 1; if (list[m][0] < t) lo = m + 1; else hi = m; }
                            dmIndexRef.current = lo;
                            danmakuRef.current?.clear();
                        };
                        // 弹幕随视频暂停/恢复冻结（DanmakuTrack 内部会顺延轨道占用时钟）
                        const onPause = () => danmakuRef.current?.setPaused(true);
                        const onPlay = () => danmakuRef.current?.setPaused(false);
                        // 从后台切回：游标二分对齐当前时刻 + 清掉冻结期间的残留
                        const onVis = () => { if (document.visibilityState === "visible") onSeek(); };
                        dmVideo.addEventListener("timeupdate", onTime);
                        dmVideo.addEventListener("seeking", onSeek);
                        dmVideo.addEventListener("pause", onPause);
                        dmVideo.addEventListener("play", onPlay);
                        document.addEventListener("visibilitychange", onVis);
                        playerCleanupsRef.current.push(() => {
                            dmVideo.removeEventListener("timeupdate", onTime);
                            dmVideo.removeEventListener("seeking", onSeek);
                            dmVideo.removeEventListener("pause", onPause);
                            dmVideo.removeEventListener("play", onPlay);
                            document.removeEventListener("visibilitychange", onVis);
                            danmakuRef.current?.setPaused(false);
                        });
                        // 装配/重建后把弹幕游标对齐当前时间（切音轨→HLS 重建后 dmIndexRef 可能仍是旧值，
                        // 导致 onTime 的 while 不推进 → 弹幕不显示。这里按 currentTime 二分重置游标）
                        {
                            const t0 = dmVideo.currentTime + dmTimeOffsetRef.current;
                            const list0 = filteredListRef.current;
                            let lo = 0, hi = list0.length;
                            while (lo < hi) { const m = (lo + hi) >> 1; if (list0[m][0] < t0) lo = m + 1; else hi = m; }
                            dmIndexRef.current = lo;
                        }
                        onTime();
                    }

                    // 直连模式下，自动加载第一条内嵌文本字幕（注入为 HTML <track>）
                    // 前提：没有外挂字幕文件（否则 DPlayer 字幕层已经在显示外挂字幕，再注入会重影）
                    if (playMode === 'direct' && subtitleTracks.length > 0) {
                        const firstTextSub = subtitleTracks.find((t: any) => !t.isImage);
                        if (firstTextSub) {
                            fetch(subtitleUrl, { method: 'HEAD' })
                                .then(r => {
                                    if (r.headers.get('X-Subtitle-Found') === '1') throw new Error('external exists');
                                    const subUrl = `/api/media/embedded-subtitle?filePath=${encodeURIComponent(filePath)}&streamIndex=${firstTextSub.index}`;
                                    return fetch(subUrl);
                                })
                                .then(r => { if (!r.ok) throw new Error('extract fail'); return r.text(); })
                                .then(vttText => {
                                    mountNasTrack(dp.video as HTMLVideoElement, vttText, firstTextSub.title || firstTextSub.language || '内嵌字幕', firstTextSub.language || 'zh');
                                    setSelectedSubtitleIndex(firstTextSub.index);
                                    console.log(`[Player] Auto-loaded embedded subtitle: ${firstTextSub.title || firstTextSub.language}`);
                                })
                                .catch(() => {
                                    // 有外挂字幕或提取失败：跳过内嵌自动加载
                                });
                        }
                    }

                    // 监听 DPlayer 初始化完成，强行注入剧院模式（宽屏）按钮与字幕上传按钮
                    dp.on('canplay', () => {
                        const rightIcons = containerRef.current?.querySelector('.dplayer-icons-right');
                        const fullScreenBtn = rightIcons?.querySelector('.dplayer-full');

                        if (rightIcons && fullScreenBtn && !theaterBtnRef.current) {
                            // 关闭菜单的全局点击
                            const closeMenus = (e: MouseEvent) => {
                                if (!(e.target as HTMLElement).closest('.dplayer-track-select-icon')) {
                                    containerRef.current?.querySelectorAll('.dplayer-track-menu').forEach(m => {
                                        (m as HTMLDivElement).style.display = 'none';
                                    });
                                }
                            };
                            document.addEventListener('click', closeMenus);
                            playerCleanupsRef.current.push(() => document.removeEventListener('click', closeMenus));

                            // 1. 注入音轨选择按钮（仅当有多条音轨时显示）
                            if (audioTracks.length > 1) {
                                const audioIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`;
                                const audioMenu = document.createElement('div');
                                audioMenu.className = 'dplayer-track-menu';
                                audioMenu.style.cssText = `
                                    display: none; position: absolute; bottom: 100%; right: 0; margin-bottom: 8px;
                                    background: rgba(0,0,0,0.9); border-radius: 8px; min-width: 160px; max-height: 300px;
                                    overflow-y: auto; z-index: 100; padding: 4px 0; backdrop-filter: blur(10px);
                                    border: 1px solid rgba(255,255,255,0.1);
                                `;
                                // 每次打开时重建菜单内容，选中状态与点击事件始终新鲜
                                const renderAudioMenu = () => {
                                    audioMenu.innerHTML = '';
                                    for (const t of audioTracks) {
                                        const row = document.createElement('div');
                                        const isActive = selectedAudioRef.current === t.index;
                                        const label = t.title || `${t.language} (${t.codec})`;
                                        row.style.cssText = `padding: 8px 16px; cursor: pointer; font-size: 13px; color: ${isActive ? '#0a84ff' : '#eee'}; white-space: nowrap; transition: background 0.15s;`;
                                        row.innerHTML = isActive ? `<span style="margin-right:6px;">✓</span>${label}` : label;
                                        row.addEventListener('mouseenter', () => { row.style.background = 'rgba(255,255,255,0.1)'; });
                                        row.addEventListener('mouseleave', () => { row.style.background = 'transparent'; });
                                        row.addEventListener('click', (e) => {
                                            e.stopPropagation();
                                            audioMenu.style.display = 'none';
                                            if (selectedAudioRef.current === t.index) return;
                                            setSelectedAudioIndex(t.index);
                                            dp.notice(`音轨: ${label}，转码模式加载中...`);
                                            // 非首条音轨必须转码（浏览器只播默认轨）；已在 HLS 模式时用 reloadToken 强制重建
                                            setPlayMode('hls');
                                            setReloadToken(v => v + 1);
                                        });
                                        audioMenu.appendChild(row);
                                    }
                                };
                                const audioWrapper = document.createElement('div');
                                audioWrapper.className = 'dplayer-icon dplayer-track-select-icon dplayer-audio-track-icon';
                                audioWrapper.setAttribute('data-balloon', '音轨选择');
                                audioWrapper.setAttribute('data-balloon-pos', 'up');
                                audioWrapper.style.position = 'relative';
                                audioWrapper.innerHTML = `<span class="dplayer-icon-content">${audioIcon}</span>`;
                                audioWrapper.appendChild(audioMenu);
                                audioWrapper.addEventListener('click', (e) => {
                                    e.stopPropagation();
                                    containerRef.current?.querySelectorAll('.dplayer-track-menu').forEach(m => {
                                        if (m !== audioMenu) (m as HTMLDivElement).style.display = 'none';
                                    });
                                    if (audioMenu.style.display === 'none') {
                                        renderAudioMenu();
                                        audioMenu.style.display = 'block';
                                    } else {
                                        audioMenu.style.display = 'none';
                                    }
                                });
                                rightIcons.insertBefore(audioWrapper, fullScreenBtn);
                            }

                            // 倍速选择按钮（0.5 / 1 / 1.25 / 1.5 / 2，跨集持久化）
                            const speedIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;
                            const speedMenu = document.createElement('div');
                            speedMenu.className = 'dplayer-track-menu';
                            speedMenu.style.cssText = `
                                display: none; position: absolute; bottom: 100%; right: 0; margin-bottom: 8px;
                                background: rgba(0,0,0,0.9); border-radius: 8px; min-width: 120px;
                                z-index: 100; padding: 4px 0; backdrop-filter: blur(10px);
                                border: 1px solid rgba(255,255,255,0.1);
                            `;
                            const SPEEDS = [0.5, 1, 1.25, 1.5, 2];
                            const renderSpeedMenu = () => {
                                speedMenu.innerHTML = '';
                                for (const s of SPEEDS) {
                                    const row = document.createElement('div');
                                    const isActive = playbackRateRef.current === s;
                                    const label = s === 1 ? '正常' : `${s}x`;
                                    row.style.cssText = `padding: 8px 16px; cursor: pointer; font-size: 13px; color: ${isActive ? '#0a84ff' : '#eee'}; white-space: nowrap; transition: background 0.15s;`;
                                    row.innerHTML = isActive ? `<span style="margin-right:6px;">✓</span>${label}` : label;
                                    row.addEventListener('mouseenter', () => { row.style.background = 'rgba(255,255,255,0.1)'; });
                                    row.addEventListener('mouseleave', () => { row.style.background = 'transparent'; });
                                    row.addEventListener('click', (ev) => {
                                        ev.stopPropagation();
                                        speedMenu.style.display = 'none';
                                        setPlaybackRate(s);
                                        applyPlaybackRate(s);
                                        dp.notice(`倍速 ${s}x`);
                                    });
                                    speedMenu.appendChild(row);
                                }
                            };
                            const speedWrapper = document.createElement('div');
                            speedWrapper.className = 'dplayer-icon dplayer-track-select-icon dplayer-speed-icon';
                            speedWrapper.setAttribute('data-balloon', `倍速 ${playbackRateRef.current === 1 ? '正常' : playbackRateRef.current + 'x'}`);
                            speedWrapper.setAttribute('data-balloon-pos', 'up');
                            speedWrapper.style.position = 'relative';
                            speedWrapper.innerHTML = `<span class="dplayer-icon-content">${speedIcon}</span>`;
                            speedWrapper.appendChild(speedMenu);
                            speedWrapper.addEventListener('click', (ev) => {
                                ev.stopPropagation();
                                containerRef.current?.querySelectorAll('.dplayer-track-menu').forEach(m => {
                                    if (m !== speedMenu) (m as HTMLDivElement).style.display = 'none';
                                });
                                if (speedMenu.style.display === 'none') {
                                    renderSpeedMenu();
                                    speedMenu.style.display = 'block';
                                } else {
                                    speedMenu.style.display = 'none';
                                }
                            });
                            rightIcons.insertBefore(speedWrapper, fullScreenBtn);

                            // 注入字幕样式 CSS（::cue 控制原生 track 字幕），重复初始化时先清旧的
                            document.getElementById('nas-subtitle-style')?.remove();
                            const subStyleEl = document.createElement('style');
                            subStyleEl.id = 'nas-subtitle-style';
                            subStyleEl.textContent = `video::cue { font-size: 24px; color: #ffffff; background: rgba(0,0,0,0.6); }`;
                            document.head.appendChild(subStyleEl);
                            playerCleanupsRef.current.push(() => {
                                document.getElementById('nas-subtitle-style')?.remove();
                                document.getElementById('nas-subtitle-p-style')?.remove();
                            });

                            // 更新字幕样式：同时控制 ::cue（原生track）和 DPlayer 字幕容器（直接改内联样式）
                            const updateSubStyle = (fontSize: string, color: string, bg: string) => {
                                // 1. 更新 ::cue CSS
                                const el = document.getElementById('nas-subtitle-style');
                                if (el) el.textContent = `video::cue { font-size: ${fontSize}; color: ${color}; background: ${bg}; }`;
                                // 2. 直接改 DPlayer 字幕容器的内联样式（最高优先级）
                                const subContainer = containerRef.current?.querySelector('.dplayer-subtitle') as HTMLElement;
                                if (subContainer) {
                                    subContainer.style.fontSize = fontSize;
                                    subContainer.style.color = color;
                                }
                                // 3. 给 <p> 设背景（通过 CSS 覆盖，因为 p 是 DPlayer 动态生成的）
                                const pStyleEl = document.getElementById('nas-subtitle-p-style');
                                if (pStyleEl) pStyleEl.remove();
                                const pStyle = document.createElement('style');
                                pStyle.id = 'nas-subtitle-p-style';
                                pStyle.textContent = `.dplayer-subtitle p { background: ${bg} !important; }`;
                                document.head.appendChild(pStyle);
                            };

                            // --- 字幕设置按钮 ---
                            const settingsIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`;
                            const settingsBtn = document.createElement('div');
                            settingsBtn.className = 'dplayer-icon dplayer-sub-settings-icon';
                            settingsBtn.setAttribute('data-balloon', '字幕设置');
                            settingsBtn.setAttribute('data-balloon-pos', 'up');
                            settingsBtn.style.position = 'relative';
                            settingsBtn.innerHTML = `<span class="dplayer-icon-content">${settingsIcon}</span>`;

                            // 设置面板
                            const settingsPanel = document.createElement('div');
                            settingsPanel.className = 'dplayer-track-menu';
                            settingsPanel.style.cssText = `
                                display: none; position: absolute; bottom: 100%; right: 0; margin-bottom: 8px;
                                background: rgba(0,0,0,0.92); border-radius: 8px; min-width: 200px;
                                z-index: 100; padding: 12px 16px; backdrop-filter: blur(10px);
                                border: 1px solid rgba(255,255,255,0.1); color: #eee; font-size: 13px;
                            `;
                            settingsPanel.innerHTML = `
                                <div style="margin-bottom:10px;font-weight:600;color:#fff;">字幕样式</div>
                                <div style="margin-bottom:8px;">
                                    <div style="margin-bottom:4px;">字号</div>
                                    <div style="display:flex;gap:6px;">
                                        <button class="sub-size-btn" data-size="18px" style="flex:1;padding:4px 8px;background:rgba(255,255,255,0.1);border:none;border-radius:4px;color:#eee;cursor:pointer;">小</button>
                                        <button class="sub-size-btn" data-size="24px" style="flex:1;padding:4px 8px;background:#0a84ff;border:none;border-radius:4px;color:#fff;cursor:pointer;">中</button>
                                        <button class="sub-size-btn" data-size="32px" style="flex:1;padding:4px 8px;background:rgba(255,255,255,0.1);border:none;border-radius:4px;color:#eee;cursor:pointer;">大</button>
                                        <button class="sub-size-btn" data-size="40px" style="flex:1;padding:4px 8px;background:rgba(255,255,255,0.1);border:none;border-radius:4px;color:#eee;cursor:pointer;">特大</button>
                                    </div>
                                </div>
                                <div style="margin-bottom:8px;">
                                    <div style="margin-bottom:4px;">颜色</div>
                                    <div style="display:flex;gap:8px;align-items:center;">
                                        <button class="sub-color-btn" data-color="#ffffff" style="width:24px;height:24px;border-radius:50%;background:#ffffff;border:2px solid #0a84ff;cursor:pointer;"></button>
                                        <button class="sub-color-btn" data-color="#ffff00" style="width:24px;height:24px;border-radius:50%;background:#ffff00;border:2px solid transparent;cursor:pointer;"></button>
                                        <button class="sub-color-btn" data-color="#00ff00" style="width:24px;height:24px;border-radius:50%;background:#00ff00;border:2px solid transparent;cursor:pointer;"></button>
                                        <button class="sub-color-btn" data-color="#00ffff" style="width:24px;height:24px;border-radius:50%;background:#00ffff;border:2px solid transparent;cursor:pointer;"></button>
                                        <button class="sub-color-btn" data-color="#b7daff" style="width:24px;height:24px;border-radius:50%;background:#b7daff;border:2px solid transparent;cursor:pointer;"></button>
                                    </div>
                                </div>
                                <div>
                                    <div style="margin-bottom:4px;">背景</div>
                                    <div style="display:flex;gap:6px;">
                                        <button class="sub-bg-btn" data-bg="rgba(0,0,0,0.6)" style="flex:1;padding:4px 8px;background:rgba(255,255,255,0.1);border:none;border-radius:4px;color:#eee;cursor:pointer;">半透明</button>
                                        <button class="sub-bg-btn" data-bg="rgba(0,0,0,0.85)" style="flex:1;padding:4px 8px;background:#0a84ff;border:none;border-radius:4px;color:#fff;cursor:pointer;">深色</button>
                                        <button class="sub-bg-btn" data-bg="transparent" style="flex:1;padding:4px 8px;background:rgba(255,255,255,0.1);border:none;border-radius:4px;color:#eee;cursor:pointer;">无</button>
                                    </div>
                                </div>
                            `;

                            // 当前字幕样式状态
                            let currentSubSize = '24px';
                            let currentSubColor = '#ffffff';
                            let currentSubBg = 'rgba(0,0,0,0.6)';

                            // 字号按钮事件
                            settingsPanel.querySelectorAll('.sub-size-btn').forEach((btn: any) => {
                                btn.addEventListener('click', (e: Event) => {
                                    e.stopPropagation();
                                    currentSubSize = (btn as HTMLElement).dataset.size!;
                                    settingsPanel.querySelectorAll('.sub-size-btn').forEach((b: any) => { b.style.background = 'rgba(255,255,255,0.1)'; b.style.color = '#eee'; });
                                    btn.style.background = '#0a84ff'; btn.style.color = '#fff';
                                    updateSubStyle(currentSubSize, currentSubColor, currentSubBg);
                                });
                            });
                            // 颜色按钮事件
                            settingsPanel.querySelectorAll('.sub-color-btn').forEach((btn: any) => {
                                btn.addEventListener('click', (e: Event) => {
                                    e.stopPropagation();
                                    currentSubColor = (btn as HTMLElement).dataset.color!;
                                    settingsPanel.querySelectorAll('.sub-color-btn').forEach((b: any) => { b.style.borderColor = 'transparent'; });
                                    btn.style.borderColor = '#0a84ff';
                                    updateSubStyle(currentSubSize, currentSubColor, currentSubBg);
                                });
                            });
                            // 背景按钮事件
                            settingsPanel.querySelectorAll('.sub-bg-btn').forEach((btn: any) => {
                                btn.addEventListener('click', (e: Event) => {
                                    e.stopPropagation();
                                    currentSubBg = (btn as HTMLElement).dataset.bg!;
                                    settingsPanel.querySelectorAll('.sub-bg-btn').forEach((b: any) => { b.style.background = 'rgba(255,255,255,0.1)'; b.style.color = '#eee'; });
                                    btn.style.background = '#0a84ff'; btn.style.color = '#fff';
                                    updateSubStyle(currentSubSize, currentSubColor, currentSubBg);
                                });
                            });

                            settingsBtn.appendChild(settingsPanel);
                            settingsBtn.addEventListener('click', (e) => {
                                e.stopPropagation();
                                containerRef.current?.querySelectorAll('.dplayer-track-menu').forEach(m => {
                                    if (m !== settingsPanel) (m as HTMLDivElement).style.display = 'none';
                                });
                                settingsPanel.style.display = settingsPanel.style.display === 'none' ? 'block' : 'none';
                            });
                            rightIcons.insertBefore(settingsBtn, fullScreenBtn);

                            // 2. 注入内嵌字幕选择按钮
                            if (subtitleTracks.length > 0) {
                                const subIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M6 12h4M14 12h4M7 16h10"/></svg>`;
                                const subMenu = document.createElement('div');
                                subMenu.className = 'dplayer-track-menu';
                                subMenu.style.cssText = `
                                    display: none; position: absolute; bottom: 100%; right: 0; margin-bottom: 8px;
                                    background: rgba(0,0,0,0.9); border-radius: 8px; min-width: 160px; max-height: 300px;
                                    overflow-y: auto; z-index: 100; padding: 4px 0; backdrop-filter: blur(10px);
                                    border: 1px solid rgba(255,255,255,0.1);
                                `;
                                const renderSubMenu = () => {
                                    subMenu.innerHTML = '';
                                    // "关闭" 选项
                                    const offRow = document.createElement('div');
                                    const isOff = selectedSubtitleRef.current === null;
                                    offRow.style.cssText = `padding: 8px 16px; cursor: pointer; font-size: 13px; color: ${isOff ? '#0a84ff' : '#eee'}; white-space: nowrap; transition: background 0.15s;`;
                                    offRow.innerHTML = isOff ? `<span style="margin-right:6px;">✓</span>关闭内嵌字幕` : '关闭内嵌字幕';
                                    offRow.addEventListener('mouseenter', () => { offRow.style.background = 'rgba(255,255,255,0.1)'; });
                                    offRow.addEventListener('mouseleave', () => { offRow.style.background = 'transparent'; });
                                    offRow.addEventListener('click', (e) => {
                                        e.stopPropagation();
                                        subMenu.style.display = 'none';
                                        const wasBurnedIn = selectedSubtitleRef.current !== null && playMode === 'hls';
                                        setSelectedSubtitleIndex(null);
                                        unmountNasTrack(dp.video as HTMLVideoElement);
                                        if (wasBurnedIn) {
                                            // 烧录字幕已经在画面里，必须重新转码才能去掉
                                            dp.notice('移除烧录字幕，重新加载...');
                                            setReloadToken(v => v + 1);
                                        } else {
                                            dp.notice('内嵌字幕已关闭');
                                        }
                                    });
                                    subMenu.appendChild(offRow);

                                    for (const t of subtitleTracks) {
                                        const row = document.createElement('div');
                                        const isActive = selectedSubtitleRef.current === t.index;
                                        const displayLabel = t.isImage ? `${t.title || t.language} (图形)` : (t.title || t.language);
                                        row.style.cssText = `padding: 8px 16px; cursor: pointer; font-size: 13px; color: ${isActive ? '#0a84ff' : '#eee'}; white-space: nowrap; transition: background 0.15s;`;
                                        row.innerHTML = isActive ? `<span style="margin-right:6px;">✓</span>${displayLabel}` : displayLabel;
                                        row.addEventListener('mouseenter', () => { row.style.background = 'rgba(255,255,255,0.1)'; });
                                        row.addEventListener('mouseleave', () => { row.style.background = 'transparent'; });
                                        row.addEventListener('click', (e) => {
                                            e.stopPropagation();
                                            subMenu.style.display = 'none';
                                            setSelectedSubtitleIndex(t.index);
                                            if (t.isImage) {
                                                // 图形字幕（PGS 等）: 需要转码烧录；已在 HLS 模式时强制重建
                                                dp.notice(`图形字幕需转码烧录，自动切换到转码模式...`);
                                                setPlayMode('hls');
                                                setReloadToken(v => v + 1);
                                            } else {
                                                // 文本字幕: 提取为 VTT 挂载。
                                                // HLS -ss 起播时视频时间轴被重置为 0，需要把字幕整体前移 initialTime
                                                const offsetParam = (playMode === 'hls' && initialTime > 0) ? `&offset=${-initialTime}` : '';
                                                const subUrl = `/api/media/embedded-subtitle?filePath=${encodeURIComponent(filePath!)}&streamIndex=${t.index}${offsetParam}`;
                                                dp.notice('正在提取内嵌字幕...');
                                                fetch(subUrl)
                                                    .then(r => {
                                                        if (!r.ok) throw new Error('提取失败');
                                                        return r.text();
                                                    })
                                                    .then(vttText => {
                                                        mountNasTrack(dp.video as HTMLVideoElement, vttText, t.title || t.language, t.language || 'zh');
                                                        dp.notice(`内嵌字幕: ${t.title || t.language}`);
                                                    })
                                                    .catch(err => {
                                                        console.error('字幕提取失败:', err);
                                                        dp.notice('字幕提取失败');
                                                    });
                                            }
                                        });
                                        subMenu.appendChild(row);
                                    }
                                };

                                const subWrapper = document.createElement('div');
                                subWrapper.className = 'dplayer-icon dplayer-track-select-icon';
                                subWrapper.setAttribute('data-balloon', '内嵌字幕');
                                subWrapper.setAttribute('data-balloon-pos', 'up');
                                subWrapper.style.position = 'relative';
                                subWrapper.innerHTML = `<span class="dplayer-icon-content">${subIcon}</span>`;
                                subWrapper.appendChild(subMenu);
                                subWrapper.addEventListener('click', (e) => {
                                    e.stopPropagation();
                                    containerRef.current?.querySelectorAll('.dplayer-track-menu').forEach(m => {
                                        if (m !== subMenu) (m as HTMLDivElement).style.display = 'none';
                                    });
                                    if (subMenu.style.display === 'none') {
                                        renderSubMenu();
                                        subMenu.style.display = 'block';
                                    } else {
                                        subMenu.style.display = 'none';
                                    }
                                });
                                rightIcons.insertBefore(subWrapper, fullScreenBtn);
                            }

                            // 3. 注入字幕上传按钮
                            const subBtn = document.createElement('div');
                            subBtn.className = 'dplayer-icon dplayer-sub-upload-icon';
                            subBtn.setAttribute('data-balloon', '上传本地字幕 (.vtt/.srt)');
                            subBtn.setAttribute('data-balloon-pos', 'up');
                            subBtn.innerHTML = `<span class="dplayer-icon-content"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/></svg></span>`;

                            const fileInput = document.createElement('input');
                            fileInput.type = 'file';
                            fileInput.accept = '.vtt,.srt,.ass';
                            fileInput.style.display = 'none';

                            subBtn.addEventListener('click', () => fileInput.click());
                            fileInput.addEventListener('change', async (e: any) => {
                                const file = e.target.files?.[0];
                                if (file) {
                                    const reader = new FileReader();
                                    reader.onload = async (event: any) => {
                                        const rawContent = event.target.result;
                                        dp.notice('正在转换并保存字幕...');
                                        // 服务端统一转换为 VTT 并保存到视频同目录，返回转换结果直接挂载，
                                        // 保证「立即显示」与「下次自动加载」内容完全一致
                                        try {
                                            const r = await fetch('/api/media/subtitle', {
                                                method: 'POST',
                                                headers: { 'Content-Type': 'application/json' },
                                                body: JSON.stringify({
                                                    filePath,
                                                    content: rawContent,
                                                    originalName: file.name,
                                                })
                                            });
                                            const data = await r.json();
                                            if (data.success && data.vttContent) {
                                                mountNasTrack(dp.video as HTMLVideoElement, data.vttContent, '本地上传', 'zh');
                                                dp.notice('字幕已加载并保存，下次自动生效');
                                            } else {
                                                throw new Error(data.error || '保存失败');
                                            }
                                        } catch (err) {
                                            console.error('字幕上传失败:', err);
                                            dp.notice('字幕上传失败');
                                        }
                                    };
                                    reader.readAsText(file);
                                }
                            });

                            // 4. 注入剧院模式按钮
                            const btn = document.createElement('div');
                            btn.className = 'dplayer-icon dplayer-theater-icon';
                            btn.setAttribute('data-balloon', '宽屏模式');
                            btn.setAttribute('data-balloon-pos', 'up');

                            btn.innerHTML = `<span class="dplayer-icon-content"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2" ry="2"></rect></svg></span>`;

                            btn.addEventListener('click', () => {
                                // View Transition：让剧场模式的整页重排（播放器变宽 + 推荐栏挪位）
                                // 变成浏览器级 morph 而不是硬跳；不支持的浏览器退回普通切换
                                const doc = document as Document & { startViewTransition?: (cb: () => void) => void };
                                if (doc.startViewTransition) {
                                    doc.startViewTransition(() => { flushSync(() => setIsTheaterMode(prev => !prev)); });
                                } else {
                                    setIsTheaterMode(prev => !prev);
                                }
                            });

                            rightIcons.insertBefore(subBtn, fullScreenBtn);
                            rightIcons.insertBefore(btn, fullScreenBtn);
                            theaterBtnRef.current = btn;
                        }
                    });

                    // 针对直接播放模式，已经通过 URL Media Fragment (#t=initialTime) 实现了内核级直达。
                    // 针对 HLS 转码模式，服务端也已经传过去了 startTime，转码出的流本身就从那里开始。
                    if (initialTime > 0) {
                        dp.on('loadedmetadata', () => {
                            dp.notice(playMode === 'hls'
                                ? `无缝加载转码切片: ${Math.floor(initialTime / 60)}:${Math.floor(initialTime % 60).toString().padStart(2, '0')}`
                                : `已定位至上次观看位置: ${Math.floor(initialTime / 60)}:${Math.floor(initialTime % 60).toString().padStart(2, '0')}`
                            );
                            // 针对直接播放模式的补救：如果浏览器忽略了 #t 碎片导致 currentTime 为 0，则手动跳转（延迟 500ms 以防内核未就绪）
                            if (playMode === 'direct' && dp.video.currentTime < 1) {
                                setTimeout(() => {
                                    try {
                                        if (dp.video.currentTime < 1) dp.seek(initialTime);
                                    } catch (e) { console.warn("Fallback seek failed", e); }
                                }, 500);
                            }
                        });
                    }

                    // 定时记录进度 (每隔 5 秒)
                    let lastSaveTime = 0;
                    dp.on('timeupdate', () => {
                        const currentTime = dp.video.currentTime;
                        // 核心防御：如果已有历史进度但当前处于 0 秒刚启动或跳跃中，禁止上报 0 秒，防止覆盖掉历史记录
                        if (playMode === 'direct' && initialTime > 0 && currentTime < 0.1) return;

                        const actualPosition = playMode === 'hls' ? currentTime + initialTime : currentTime;
                        if (Math.abs(currentTime - lastSaveTime) > 5) {
                            lastSaveTime = currentTime;
                            fetch('/api/media/progress', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    filePath,
                                    position: actualPosition,
                                    duration: (dp.video.duration || 0) + (playMode === 'hls' ? initialTime : 0)
                                })
                            }).catch(console.error);
                        }
                    });
                });
            }).catch(err => console.error("进度数据加载失败", err));
        // 页面刷新/关闭时也杀掉 FFmpeg 进程
        const handleBeforeUnload = () => {
            const sid = hlsSessionRef.current;
            if (sid) {
                fetch('/api/media/hls/kill', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ sessionId: sid }),
                    keepalive: true
                }).catch(() => {});
            }
        };
        window.addEventListener('beforeunload', handleBeforeUnload);

        return () => {
            cancelled = true; // 先作废飞行中的异步回调，再销毁实例
            window.removeEventListener('beforeunload', handleBeforeUnload);
            if (heartbeatRef.current) {
                clearInterval(heartbeatRef.current);
                heartbeatRef.current = null;
            }
            // 撤销播放器初始化期间注册的全局副作用（document 监听器、注入的 style 等）
            for (const fn of playerCleanupsRef.current.splice(0)) {
                try { fn(); } catch {}
            }
            if (subtitleBlobRef.current) {
                URL.revokeObjectURL(subtitleBlobRef.current);
                subtitleBlobRef.current = null;
            }
            // 注意：这里绝不能清 danmakuListRef/filteredListRef。弹幕数据的生命周期跟 filePath
            // （由上面的加载 effect 管理），不跟播放器实例。此前在这里清空导致：
            // direct→hls 模式切换的 cleanup 把刚 fetch 到的弹幕擦掉且无人重拉 →
            // HLS 模式弹幕十次九不中（仅当弹幕接口比模式切换慢返回时才幸存）。
            if (theaterBtnRef.current) {
                theaterBtnRef.current = null;
            }
            if (dpRef.current) {
                try { dpRef.current.video?.pause(); } catch {}
                dpRef.current.destroy();
                dpRef.current = null;
            }
            // 兜底清理 DPlayer 网页全屏残留：destroy() 不会摘掉 body 上的
            // dplayer-web-fullscreen-fix（position:fixed），一旦带着它客户端路由回首页，
            // 全站上下滑不动。自研 isWebFull 已截胡按钮，此处防的是任何遗留触发路径。
            document.body.classList.remove('dplayer-web-fullscreen-fix');
            containerRef.current?.classList.remove('dplayer-fulled');
            if (hlsRef.current) {
                hlsRef.current.destroy();
                hlsRef.current = null;
            }
            // 主动通知服务端杀掉 FFmpeg 进程
            const sid = hlsSessionRef.current;
            if (sid) {
                hlsSessionRef.current = null;
                fetch('/api/media/hls/kill', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ sessionId: sid }),
                    keepalive: true
                }).catch(() => {});
            }
        };
    }, [playMode, filePath, reloadToken]);

    if (!filePath) {
        return (
            <div className="flex flex-col items-center justify-center h-[50vh] text-text-3">
                <svg className="w-16 h-16 mb-4 opacity-20" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="m15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25h-9A2.25 2.25 0 0 0 2.25 7.5v9a2.25 2.25 0 0 0 2.25 2.25Z" />
                </svg>
                <p className="text-lg font-medium text-text-2">未提供视频文件路径</p>
                <button
                    onClick={() => router.back()}
                    className="mt-6 px-6 py-2 rounded-full bg-primary text-white font-medium hover:bg-primary/90 transition-all"
                >
                    返回
                </button>
            </div>
        );
    }

    return (
        <div className="w-full text-text-1 custom-scrollbar">
            <DanmakuControl
                enabled={dmEnabled} onEnabled={setDmEnabled}
                opacity={dmOpacity} onOpacity={setDmOpacity}
                fontSize={dmFontSize} onFontSize={setDmFontSize}
                areaFrac={dmAreaFrac} onAreaFrac={setDmAreaFrac}
                speed={dmSpeed} onSpeed={setDmSpeed}
                density={dmDensity} onDensity={setDmDensity}
                types={dmTypes} onTypes={setDmTypes}
                blockwords={dmBlockwords} onBlockwords={setDmBlockwords}
            />
            <div className="w-full">

                {/* 顶部标题区 - 增加层次感 */}
                <div className={`flex items-start gap-4 mb-8 ${isTheaterMode ? 'theater-padding-compensate pt-8' : ''}`}>
                    <button
                        onClick={() => router.back()}
                        className="flex items-center justify-center w-11 h-11 mt-1 rounded-lg glass-panel hover:bg-bg-hover text-text-2 hover:text-primary transition-all duration-150 cursor-pointer shrink-0 shadow-lg border-white/5 group"
                        title="返回上一级"
                    >
                        <div className="group-hover:-translate-x-1 transition-transform duration-150">
                            <BackIcon />
                        </div>
                    </button>
                    <div className="flex-1 min-w-0">
                        <h1 className="text-[22px] leading-[34px] font-medium text-text-1 line-clamp-2 pr-6">
                            {fileName}
                        </h1>
                        <div className="text-[13px] text-text-3 mt-3.5 flex flex-wrap items-center gap-4">
                            <div className="relative group">
                                <select
                                    value={playMode}
                                    onChange={(e) => setPlayMode(e.target.value as "direct" | "hls")}
                                    className="appearance-none bg-bg-tag/50 backdrop-blur-sm px-4 py-2 pr-10 rounded-md text-text-2 outline-none cursor-pointer border border-line/50 hover:border-primary/50 focus:ring-4 focus:ring-primary/10 transition-all font-bold text-[12px] uppercase tracking-wider"
                                >
                                    <option value="direct">🔥 Direct Play</option>
                                    <option value="hls">✨ FFmpeg Transcode</option>
                                </select>
                                <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-text-3 group-hover:text-primary transition-colors">
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M19 9l-7 7-7-7" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" /></svg>
                                </div>
                            </div>
                            {decodeReason && (
                                <span className="text-[11px] text-text-3 bg-bg-tag/40 px-2.5 py-1 rounded-full border border-line/40" title="解码策略自动探测结果">
                                    {decodeReason}
                                </span>
                            )}
                            {computeNextEpisode() && (
                                <button
                                    onClick={goNextEpisode}
                                    className="flex items-center gap-1.5 bg-primary/15 hover:bg-primary/25 text-primary px-3 py-1.5 rounded-full border border-primary/30 transition-all text-[12px] font-bold tracking-wider cursor-pointer"
                                    title="播放下一集 (N)"
                                >
                                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M5 5l10 7-10 7V5z"/><path d="M18 4h3v16h-3z"/></svg>
                                    下一集
                                </button>
                            )}
                            <button
                                onClick={() => setAutoPlayNext(v => !v)}
                                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border transition-all text-[12px] font-bold tracking-wider cursor-pointer ${autoPlayNext ? 'bg-primary/15 text-primary border-primary/30' : 'bg-bg-tag/50 text-text-3 border-line/50 hover:text-text-1'}`}
                                title="片尾自动播放下一集"
                            >
                                <span className={`w-2 h-2 rounded-full transition-colors ${autoPlayNext ? 'bg-primary' : 'bg-text-4'}`}></span>
                                连播 {autoPlayNext ? '开' : '关'}
                            </button>
                            <span className="text-line/30 hidden sm:inline">|</span>
                            <span className="truncate max-w-[150px] sm:max-w-md hidden sm:inline font-mono opacity-50 hover:opacity-100 transition-opacity" title={filePath}>
                                {filePath}
                            </span>
                        </div>
                    </div>
                </div>

                <div className={`flex flex-col gap-10 ${isTheaterMode ? 'flex-col' : 'xl:flex-row'}`}>
                    {/* 左侧：播放器主区域 */}
                    <div className="flex-1 min-w-0">
                        {/* 播放器容器 - 增强沉浸感 */}
                        <div
                            ref={playerWrapperRef}
                            className={`bg-black overflow-hidden pointer-events-auto flex items-center justify-center group ${isWebFull
                                ? 'fixed inset-0 z-[200] rounded-none'
                                : `relative transition-all duration-300 ease-out w-full aspect-video ${isTheaterMode
                                    ? 'rounded-none border-y border-white/5 shadow-[0_30px_100px_rgba(0,0,0,0.8)]'
                                    : 'rounded-lg sm:rounded-xl ring-1 ring-white/10 shadow-2xl shadow-black/40'}`
                                }`}
                            style={isWebFull
                                ? undefined
                                : isTheaterMode
                                    ? { width: '80vw', marginLeft: 'calc(-40vw + 50%)', viewTransitionName: 'theater-player' }
                                    : { viewTransitionName: 'theater-player' }}
                        >
                            {isInitializingHls && (
                                <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/90 backdrop-blur-md z-20 text-white animate-fadeIn">
                                    <div className="relative w-16 h-16 mb-6">
                                        <div className="absolute inset-0 border-4 border-primary/20 rounded-full" />
                                        <div className="absolute inset-0 border-4 border-t-primary rounded-full animate-spin" />
                                    </div>
                                    <p className="text-[14px] font-bold tracking-[0.2em] text-primary animate-pulse uppercase">Allocating FFmpeg Core...</p>
                                </div>
                            )}

                            {/* DPlayer 的核心 WebGL 物理挂载容器 */}
                            <div ref={containerRef} className="custom-dplayer-theme h-full w-full" />
                            {/* 自研弹幕层（套进 dmHost：真全屏时 reparent 进 DPlayer container，随全屏显示） */}
                            <div ref={dmHostRef} className="pointer-events-none absolute inset-0 z-30">
                                <DanmakuTrack ref={danmakuRef} settings={danmakuSettings} />
                            </div>
                        </div>

                        {/* 播放器下方信息区 - 悬浮美学 */}
                        <div className={`mt-8 py-5 flex items-center justify-between border-b border-line/30 ${isTheaterMode ? 'theater-padding-compensate' : ''}`}>
                            <div className="flex items-center gap-10 text-text-2 text-[14px]">
                                {loggedIn && <span onClick={handleFavorite} className={`group hover:text-bili-pink cursor-pointer transition-all duration-300 flex items-center gap-2.5 font-bold ${isFavorite ? 'text-bili-pink scale-105' : ''}`}>
                                    <div className={`transition-transform duration-500 ${isFavorite ? 'scale-110 drop-shadow-[0_0_10px_rgba(251,114,153,0.5)]' : 'group-hover:scale-120'}`}>
                                        <svg className="w-[28px] h-[28px]" fill={isFavorite ? "currentColor" : "none"} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={isFavorite ? 0 : 1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" /></svg>
                                    </div>
                                    {isFavorite ? '已存入我的收藏' : '存入标签页'}
                                </span>}
                                <span onClick={handleShare} className="group hover:text-primary cursor-pointer transition-all duration-300 flex items-center gap-2.5 font-bold relative">
                                    <div className="group-hover:scale-120 group-active:rotate-12 transition-transform duration-500">
                                        <svg className="w-[28px] h-[28px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" /></svg>
                                    </div>
                                    分享链接
                                    {showShareTip && <span className="absolute -top-12 left-1/2 -translate-x-1/2 bg-primary text-white text-[11px] font-bold px-3 py-1.5 rounded-md shadow-xl shadow-primary/30 animate-in slide-in-from-bottom-2 duration-300">已复制到剪贴板</span>}
                                </span>
                                {loggedIn && <span className="group hover:text-bili-blue cursor-pointer transition-all duration-300 flex items-center gap-2.5 font-bold relative">
                                    <div
                                        className="flex items-center gap-2.5"
                                        onClick={async (e) => {
                                            e.stopPropagation();
                                            if (showPlaylistMenu) { setShowPlaylistMenu(false); return; }
                                            const res = await fetch('/api/playlists');
                                            const data = await res.json();
                                            if (data.success) {
                                                setAvailablePlaylists(data.data);
                                                setShowPlaylistMenu(true);
                                            }
                                        }}
                                    >
                                        <svg className="w-[28px] h-[28px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 0 1 0 3.75H5.625a1.875 1.875 0 0 1 0-3.75Z" /></svg>
                                        加入播放列表
                                    </div>
                                    {playlistTip && <span className="absolute -top-12 left-1/2 -translate-x-1/2 bg-bili-blue text-white text-[11px] font-bold px-3 py-1.5 rounded-md shadow-xl whitespace-nowrap">{playlistTip}</span>}
                                    {showPlaylistMenu && (
                                        <div className="absolute top-9 left-0 z-50 min-w-[200px] rounded-xl border border-line/50 bg-bg-card shadow-2xl py-2" onClick={e => e.stopPropagation()}>
                                            {availablePlaylists.map(pl => (
                                                <div
                                                    key={pl.id}
                                                    className="px-4 py-2 text-[13px] text-text-2 hover:bg-bg-hover hover:text-bili-blue cursor-pointer transition-colors"
                                                    onClick={() => handleAddToPlaylist(pl.id, pl.name)}
                                                >
                                                    {pl.name} <span className="text-text-3">({pl.itemCount})</span>
                                                </div>
                                            ))}
                                            <div
                                                className="px-4 py-2 text-[13px] text-bili-blue hover:bg-bg-hover cursor-pointer transition-colors border-t border-line/40 mt-1 pt-2"
                                                onClick={async () => {
                                                    const name = prompt('新列表名称：');
                                                    if (!name?.trim()) return;
                                                    const res = await fetch('/api/playlists', {
                                                        method: 'POST',
                                                        headers: { 'Content-Type': 'application/json' },
                                                        body: JSON.stringify({ action: 'create', name: name.trim() })
                                                    });
                                                    const data = await res.json();
                                                    if (data.success) handleAddToPlaylist(data.data.id, name.trim());
                                                }}
                                            >
                                                + 新建列表
                                            </div>
                                        </div>
                                    )}
                                </span>}
                            </div>
                        </div>

                        {/* 简介区 - 毛玻璃卡片 */}
                        <div className={`mt-8 ${isTheaterMode ? 'theater-padding-compensate' : ''}`}>
                            <div className="glass-panel p-6 sm:p-8 rounded-xl border-white/5 shadow-2xl">
                                {loadingTmdb ? (
                                    <div className="animate-pulse space-y-6">
                                        <div className="h-8 bg-bg-tag rounded-xl w-1/3"></div>
                                        <div className="space-y-3">
                                            <div className="h-4 bg-bg-tag rounded-lg"></div>
                                            <div className="h-4 bg-bg-tag rounded-lg w-5/6"></div>
                                            <div className="h-4 bg-bg-tag rounded-lg w-4/6"></div>
                                        </div>
                                    </div>
                                ) : tmdbData ? (
                                    <div className="animate-fadeIn">
                                        <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
                                            <h3 className="text-[22px] sm:text-[26px] font-black tracking-tight text-text-1">
                                                {tmdbData.title}
                                                {tmdbData.release_date && <span className="text-text-3 text-[16px] font-medium ml-3 opacity-40 italic">/ {tmdbData.release_date.substring(0, 4)}</span>}
                                            </h3>
                                            <div className="flex items-center gap-2">
                                                <span className="flex items-center gap-1.5 text-[14px] font-black text-[#f5c518] bg-[#f5c518]/10 px-3 py-1 rounded-md border border-[#f5c518]/20">
                                                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" /></svg>
                                                    {tmdbData.vote_average ? tmdbData.vote_average.toFixed(1) : 'N/A'}
                                                </span>
                                                <span className="text-[11px] font-black uppercase tracking-widest text-text-3 px-3 py-1 bg-bg-tag/50 rounded-md border border-line/50">{tmdbData.media_type === 'tv' ? 'Series' : 'Cinema'}</span>
                                            </div>
                                        </div>

                                        <p className="text-[14.5px] leading-8 text-text-2/90 font-medium">{tmdbData.overview || "暂无剧本梗概，这可能是一场不需要解释的冒险。"}</p>
                                    </div>
                                ) : (
                                    <div className="py-2 opacity-60">
                                        <p className="text-[14px] leading-7 font-medium italic">
                                            {fileName}
                                        </p>
                                        <p className="text-[12px] mt-4 font-bold uppercase tracking-[0.2em] text-primary/60">Metadata Pending...</p>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* 分类移动功能区 */}
                        {mediaDirs.length > 1 && (
                            <div className={`mt-4 p-4 rounded-lg border border-line bg-bg-card ${isTheaterMode ? 'theater-padding-compensate' : ''}`}>
                                <div className="flex flex-wrap items-center gap-2 text-[13px] text-text-2">
                                    <span className="mr-1">🏷️ 认为这个视频不属于当前分类？移动至：</span>
                                    {mediaDirs
                                        .filter(d => d.type !== currentDirType)
                                        .map(dir => (
                                            <button
                                                key={dir.key}
                                                onClick={() => handleMoveStart(dir.key)}
                                                disabled={movePhase !== 'idle'}
                                                className="px-3 py-1.5 rounded-md text-[12px] font-medium border transition-all
                                                    border-line bg-bg-tag text-text-1 hover:border-primary hover:text-primary hover:bg-primary/5
                                                    disabled:opacity-40 disabled:cursor-not-allowed"
                                            >
                                                {typeLabels[dir.type] || dir.name}
                                            </button>
                                        ))
                                    }
                                </div>
                            </div>
                        )}

                        {/* 移动进度/确认 对话框 */}
                        {movePhase !== 'idle' && (
                            <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm">
                                <div className="bg-bg-card border border-line rounded-2xl shadow-2xl w-[520px] max-w-[90vw] p-6">

                                    {/* 标题 */}
                                    <h3 className="text-[18px] font-bold text-text-1 mb-4 flex items-center gap-2">
                                        {movePhase === 'copying' && '📦 正在安全复制...'}
                                        {movePhase === 'confirm_delete' && '✅ 复制完成'}
                                        {movePhase === 'deleting' && '🗑️ 正在删除源文件...'}
                                        {movePhase === 'done' && '🎉 移动完成！'}
                                        {movePhase === 'error' && '❌ 出错了'}
                                    </h3>

                                    {/* 复制进度条 */}
                                    {movePhase === 'copying' && (
                                        <div>
                                            <div className="w-full h-3 bg-bg-input rounded-full overflow-hidden mb-3">
                                                <div
                                                    className="h-full bg-gradient-to-r from-[#00a1d6] to-[#00c4b6] transition-all duration-300 rounded-full"
                                                    style={{ width: `${moveProgress}%` }}
                                                />
                                            </div>
                                            <p className="text-[14px] text-text-2 font-mono">{moveProgress}%</p>
                                            <p className="text-[12px] text-text-3 mt-1">{moveMessage}</p>
                                        </div>
                                    )}

                                    {/* 删除确认 */}
                                    {movePhase === 'confirm_delete' && (
                                        <div>
                                            <p className="text-[14px] text-text-2 mb-3">文件大小校验通过 ({moveSourceSize})</p>
                                            <div className="bg-bg-input rounded-lg p-3 mb-4 font-mono text-[12px]">
                                                <p className="text-text-3 mb-1">待执行删除命令：</p>
                                                <p className="text-[#ff6b6b] break-all select-all">{moveDeleteCmd}</p>
                                            </div>
                                            <div className="bg-bg-input rounded-lg p-3 mb-4 text-[12px]">
                                                <p className="text-text-3"><span className="text-text-2">源：</span>{moveSourcePath}</p>
                                                <p className="text-text-3 mt-1"><span className="text-[#10b981]">目标：</span>{moveTargetPath}</p>
                                            </div>
                                            <div className="flex items-center gap-3 mt-5">
                                                <button
                                                    onClick={handleMoveCancel}
                                                    className="flex-1 py-2.5 rounded-lg border border-line bg-bg-tag text-text-2 text-[14px] font-medium hover:bg-bg-hover transition-colors"
                                                >
                                                    取消（保留两份）
                                                </button>
                                                <button
                                                    onClick={handleMoveConfirm}
                                                    className="flex-1 py-2.5 rounded-lg bg-[#ff4757] text-white text-[14px] font-bold hover:bg-[#ff6b81] transition-colors"
                                                >
                                                    确认删除源文件
                                                </button>
                                            </div>
                                        </div>
                                    )}

                                    {/* 删除中 */}
                                    {movePhase === 'deleting' && (
                                        <div className="flex items-center gap-3">
                                            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary" />
                                            <p className="text-[14px] text-text-2">{moveMessage}</p>
                                        </div>
                                    )}

                                    {/* 完成 */}
                                    {movePhase === 'done' && (
                                        <div>
                                            <p className="text-[14px] text-[#10b981] font-medium">{moveMessage}</p>
                                        </div>
                                    )}

                                    {/* 错误 */}
                                    {movePhase === 'error' && (
                                        <div>
                                            <p className="text-[14px] text-[#ff4757] mb-4">{moveError}</p>
                                            <button
                                                onClick={handleMoveCancel}
                                                className="w-full py-2.5 rounded-lg border border-line bg-bg-tag text-text-2 text-[14px] font-medium hover:bg-bg-hover transition-colors"
                                            >
                                                关闭
                                            </button>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* 右侧推荐位 - 无分集时为"为你推荐"随机站内视频 */}
                    {(!loadingRelated && relatedMedia.length === 0) ? (
                        recommendMedia.length === 0 ? null : (
                            <div className={`${isTheaterMode ? 'w-full theater-padding-compensate pb-20 mt-4' : 'w-full xl:w-[380px] shrink-0'}`}>
                                <div className={`rounded-xl border border-line bg-bg-nav p-5 ${isTheaterMode ? '' : 'lg:sticky lg:top-24'}`}>
                                    <div className="flex items-center justify-between mb-4 px-1 pb-2">
                                        <h3 className="text-[14px] font-medium text-text-1">为你推荐</h3>
                                        <span className="text-[12px] text-text-3">{recommendMedia.length} 个视频</span>
                                    </div>
                                    <div className="flex flex-col gap-3">
                                        {recommendMedia.map((item: any) => {
                                            const isCinemaItem = item.type === 'movie' || item.type === 'series' || item.type === 'anime';
                                            const playablePath = item.firstEpisodePath || item.path;
                                            const typeLabel = item.type === 'movie' ? '电影' : item.type === 'series' ? '剧集' : item.type === 'anime' ? '动漫' : item.type === 'travel' ? '旅行' : item.type;
                                            return (
                                                <div
                                                    key={item.id}
                                                    onClick={() => router.push(isCinemaItem
                                                        ? `/detail?id=${item.id}`
                                                        : `/watch?filePath=${encodeURIComponent(playablePath)}`)}
                                                    className="group flex gap-3 rounded-lg p-1.5 -m-1.5 hover:bg-bg-hover transition-colors cursor-pointer"
                                                >
                                                    <div className="relative w-[150px] shrink-0 aspect-video rounded-lg overflow-hidden bg-bg-input border border-line/40">
                                                        <img
                                                            src={`/api/media/thumbnail?filePath=${encodeURIComponent(playablePath)}`}
                                                            className="w-full h-full object-cover"
                                                            alt={item.title}
                                                            loading="lazy"
                                                            onError={(e) => {
                                                                const el = e.target as HTMLImageElement;
                                                                if (item.poster && !el.dataset.fbk) { el.dataset.fbk = '1'; el.src = item.poster; }
                                                                else { el.src = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjM2YzZjQ2IiBzdHJva2Utd2lkdGg9IjIiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCI+PHJlY3QgeD0iMyIgeT0iMyIgd2lkdGg9IjE4IiBoZWlnaHQ9IjE4IiByeD0iMiIgcnk9IjIiPjwvcmVjdD48Y2lyY2xlIGN4PSI4LjUiIGN5PSI4LjUiIHI9IjEuNSI+PC9jaXJjbGU+PHBvbHlsaW5lIHBvaW50cz0iMjEgMTUgMTYgMTAgNSAyMSI+PC9wb2x5bGluZT48L3N2Zz4='; }
                                                            }}
                                                        />
                                                    </div>
                                                    <div className="flex-1 min-w-0 py-0.5">
                                                        <p className="text-[13px] font-medium text-text-1 leading-snug line-clamp-2 group-hover:text-primary transition-colors">{item.title}</p>
                                                        <p className="text-[12px] text-text-3 mt-1.5">{typeLabel}{item.year ? ` · ${item.year}` : ''}</p>
                                                        {item.rating ? <p className="text-[12px] text-text-3 mt-0.5">★ {Number(item.rating).toFixed(1)}</p> : null}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            </div>
                        )
                    ) : (
                    <div className={`${isTheaterMode ? 'w-full theater-padding-compensate pb-20 mt-4' : 'w-full xl:w-[380px] shrink-0'}`}>
                        <div className={`rounded-lg border border-line bg-bg-card p-5 ${isTheaterMode ? '' : 'lg:sticky lg:top-24'}`}>
                            {/* 1:1 头部：正片 + 统计 + 功能 Icon */}
                            <div className="flex items-center justify-between mb-4 px-1 pb-2">
                                <div className="flex items-center gap-2">
                                    <h3 className="text-[14px] font-medium text-text-1">正片</h3>
                                    <span className="text-[12px] text-text-3">({relatedMedia.filter(m => m.season === activeSeason).findIndex(m => m.path === filePath) + 1}/{relatedMedia.filter(m => m.season === activeSeason).length})</span>
                                </div>
                                <div className="flex items-center gap-3 text-text-3 opacity-80">
                                    <svg onClick={() => setEpisodeViewMode('grid')} className={`w-4 h-4 cursor-pointer transition-colors ${episodeViewMode === 'grid' ? 'text-bili-pink' : 'hover:text-bili-pink'}`} fill="currentColor" viewBox="0 0 24 24"><path d="M4 11h5V5H4v6zm0 7h5v-6H4v6zm7 0h5v-6h-5v6zm0-13v6h5V5h-5z" /></svg>
                                    <svg onClick={() => setEpisodeViewMode('list')} className={`w-4 h-4 cursor-pointer transition-colors ${episodeViewMode === 'list' ? 'text-bili-pink' : 'hover:text-bili-pink'}`} fill="currentColor" viewBox="0 0 24 24"><path d="M3 18h6v-2H3v2zM3 6v2h18V6H3zm0 7h12v-2H3v2z" /></svg>
                                    <svg onClick={() => setEpisodeSortAsc(prev => !prev)} className="w-4 h-4 cursor-pointer hover:text-bili-pink transition-colors" fill="currentColor" viewBox="0 0 24 24"><path d="M3 18h6v-2H3v2zM3 6v2h18V6H3zm0 7h12v-2H3v2z" />{episodeSortAsc ? <path d="M19 7l-4 4h3v6h2v-6h3l-4-4z" /> : <path d="M19 17l4-4h-3V7h-2v6h-3l4 4z" />}</svg>
                                </div>
                            </div>

                            <div className="min-h-[150px]">
                                {loadingRelated ? (
                                    <div className="flex flex-col gap-4">
                                        {[1, 2, 3, 4, 5, 6].map(i => (
                                            <div key={i} className="h-14 rounded-md bg-bg-hover animate-pulse" />
                                        ))}
                                    </div>
                                ) : relatedMedia.length > 0 ? (
                                    <>
                                        {/* 季数切换 — 带透明占位保护 */}
                                        {Array.from(new Set(relatedMedia.map(m => m.season))).length > 1 && (
                                            <div className="mb-5">
                                                {/* 顶部占位 */}
                                                <div className="h-1 w-full" aria-hidden="true" />
                                                <div className="flex">
                                                    {/* 左侧占位 */}
                                                    <div className="w-3 shrink-0" aria-hidden="true" />
                                                    <div className="flex flex-wrap gap-3 flex-1">
                                                        {Array.from(new Set(relatedMedia.map(m => m.season))).sort((a: any, b: any) => a - b).map((s: any) => {
                                                            const chineseSeason = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'][s] || s;
                                                            return (
                                                                <button
                                                                    key={s}
                                                                    onClick={() => setActiveSeason(s)}
                                                                    className={`rounded-md px-3.5 py-1.5 text-[13px] font-medium transition-all duration-150 border ${activeSeason === s ? 'bg-primary text-white border-primary shadow-sm' : 'border-line text-text-2 hover:border-primary/50 hover:text-primary cursor-pointer'}`}
                                                                >
                                                                    第{chineseSeason}季
                                                                </button>
                                                            );
                                                        })}
                                                    </div>
                                                    {/* 右侧占位 */}
                                                    <div className="w-3 shrink-0" aria-hidden="true" />
                                                </div>
                                                {/* 底部占位 */}
                                                <div className="h-1 w-full" aria-hidden="true" />
                                            </div>
                                        )}


                                        {/* 剧集区域 — 网格 / 列表双模式 */}
                                        <div className="flex-1 overflow-y-auto pr-0 custom-scrollbar min-h-0">
                                            {/* 顶部透明占位 */}
                                            <div className="h-2 w-full shrink-0" aria-hidden="true" />
                                            <div className="flex">
                                                {/* 左侧透明占位 div */}
                                                <div className="w-3 shrink-0" aria-hidden="true" />
                                                <div className="flex-1">
                                                    {episodeViewMode === 'grid' ? (
                                                        <div className="grid grid-cols-6 gap-2">
                                                            {relatedMedia
                                                                .filter(m => m.season === activeSeason)
                                                                .sort((a, b) => episodeSortAsc ? a.episode - b.episode : b.episode - a.episode)
                                                                .map((item) => {
                                                                    const isCurrent = item.path === filePath;
                                                                    return (
                                                                        <button
                                                                            key={item.id}
                                                                            onClick={() => handlePlay(item.path)}
                                                                            className={`aspect-[4/3] flex items-center justify-center text-[13px] font-medium transition-all duration-150 rounded-md relative border ${isCurrent
                                                                                ? 'border-2 border-primary bg-primary/10 text-primary z-10'
                                                                                : 'border-line bg-bg-tag text-text-2 hover:border-primary/50 hover:text-primary cursor-pointer'
                                                                                }`}
                                                                        >
                                                                            {item.episode}
                                                                        </button>
                                                                    );
                                                                })}
                                                        </div>
                                                    ) : (
                                                        <div className="flex flex-col gap-1">
                                                            {relatedMedia
                                                                .filter(m => m.season === activeSeason)
                                                                .sort((a, b) => episodeSortAsc ? a.episode - b.episode : b.episode - a.episode)
                                                                .map((item) => {
                                                                    const isCurrent = item.path === filePath;
                                                                    return (
                                                                        <button
                                                                            key={item.id}
                                                                            onClick={() => handlePlay(item.path)}
                                                                            className={`flex items-center gap-3 px-3 py-2.5 rounded-md text-[13px] font-medium transition-all duration-150 border text-left ${isCurrent
                                                                                ? 'border-2 border-primary bg-primary/10 text-primary'
                                                                                : 'border-line bg-bg-tag text-text-2 hover:border-primary/50 hover:text-primary cursor-pointer'
                                                                                }`}
                                                                        >
                                                                            <span className="w-6 text-center shrink-0 font-bold">{item.episode}</span>
                                                                            <span className="truncate opacity-70">{item.title || `第 ${item.episode} 集`}</span>
                                                                        </button>
                                                                    );
                                                                })}
                                                        </div>
                                                    )}
                                                </div>
                                                {/* 右侧透明占位 div */}
                                                <div className="w-3 shrink-0" aria-hidden="true" />
                                            </div>
                                            {/* 底部透明占位 div */}
                                            <div className="h-4 w-full shrink-0" aria-hidden="true" />
                                        </div>
                                    </>
                                ) : (
                                    <div className="flex flex-col items-center justify-center py-16 text-text-3 opacity-30">
                                        <svg className="w-12 h-12 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" /></svg>
                                        <div className="text-[12px] font-bold uppercase tracking-widest">No Episodes</div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                    )}
                </div>
            </div>
            <SourceDrawer
                title={fileName.replace(/\.[a-zA-Z0-9]{2,5}$/, "")}
                kind="series"
                open={sourceDrawer}
                onClose={() => setSourceDrawer(false)}
            />
        </div >
    );
}

export default function WatchPage() {
    return (
        <Suspense fallback={
            <div className="flex flex-col items-center justify-center min-h-[50vh] text-text-3">
                <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary mb-4" />
                <p>播放器加载中...</p>
            </div>
        }>
            <WatchContent />
        </Suspense>
    );
}
