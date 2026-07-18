"use client";

// ── 站内嵌入观看（B站） ──
// 不离站看B站：搜索 → 结果网格 → 点视频进 80vh **B站主站整页 iframe**（www.bilibili.com/video/…）。
// 用主站而非 player.bilibili.com 的原因：主站页面可登录、可解锁高画质/大会员清晰度，
// （实测 B站主站与登录页均无 X-Frame-Options / frame-ancestors，整页可嵌）。
// 进度：iframe 跨域读不到播放器时间轴——"心跳估算 + ?t= 续播"：
//   播放中每 30s 把已观看时长 upsert 到 /api/bili/progress（页面隐藏暂停心跳）。
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { PageHeader } from "../../components/PageHeader";
import { useMe } from "../../components/useMe";
import { LoginGate } from "../../components/LoginGate";
import { useLang } from "../../lib/i18n";

interface BiliHit { bvid: string; title: string; cover: string | null; author: string; duration: string; play: number | null; desc: string }
interface BiliProg { bvid: string; title: string; cover: string | null; author: string; seconds: number; updated_at: string }

const fmtSec = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const fmtPlay = (n: number | null) => (n == null ? "" : n >= 10000 ? `${(n / 10000).toFixed(1)}万` : String(n));

function EmbedContent() {
    const sp = useSearchParams();
    const me = useMe();
    const [q, setQ] = useState(sp.get("q") || "");
    const [hits, setHits] = useState<BiliHit[]>([]);
    const [searching, setSearching] = useState(false);
    const [cur, setCur] = useState<{ bvid: string; title: string; cover: string | null; author: string; startAt: number } | null>(null);
    const [continueList, setContinueList] = useState<BiliProg[]>([]);
    const watchedRef = useRef(0);   // 本次会话累计观看秒数（心跳估算）
    const baseRef = useRef(0);      // 打开时的历史进度
    const debRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const { t } = useLang();

    const loadContinue = useCallback(() => {
        fetch("/api/bili/progress").then((r) => r.json())
            .then((d) => { if (d.success) setContinueList(d.data || []); })
            .catch(() => { /* noop */ });
    }, []);
    useEffect(() => { loadContinue(); }, [loadContinue]);

    // 搜索（防抖）
    useEffect(() => {
        if (debRef.current) clearTimeout(debRef.current);
        const query = q.trim();
        if (!query) { setHits([]); return; }
        debRef.current = setTimeout(async () => {
            setSearching(true);
            try {
                const r = await fetch(`/api/bili/search?q=${encodeURIComponent(query)}`);
                const d = await r.json();
                setHits(d.success ? d.data || [] : []);
            } catch { setHits([]); }
            finally { setSearching(false); }
        }, 400);
    }, [q]);

    // URL 带 ?q= 时自动搜（fetch-out 菜单跳进来的场景）
    useEffect(() => {
        const initQ = sp.get("q");
        if (initQ) setQ(initQ);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const saveProgress = useCallback((extra = 0) => {
        if (!cur) return;
        const seconds = baseRef.current + watchedRef.current + extra;
        void fetch("/api/bili/progress", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ bvid: cur.bvid, title: cur.title, cover: cur.cover, author: cur.author, seconds }),
        }).then(loadContinue);
    }, [cur, loadContinue]);

    // 心跳：播放器打开期间每 30s 估算累计观看并保存（页面隐藏时暂停计数）
    useEffect(() => {
        if (!cur) return;
        watchedRef.current = 0;
        baseRef.current = cur.startAt;
        saveProgress(0); // 打开即挂号（记录"看过这个"）
        const t = setInterval(() => {
            if (!document.hidden) {
                watchedRef.current += 30;
                saveProgress(0);
            }
        }, 30_000);
        return () => { clearInterval(t); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [cur?.bvid]);

    const openVideo = (v: { bvid: string; title: string; cover: string | null; author: string }, startAt = 0) => {
        setCur({ ...v, startAt });
        setTimeout(() => document.getElementById("bili-player")?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
    };

    if (!me.loading && !me.loggedIn) return <LoginGate feature="站内嵌入观看" />;

    return (
        <div className="w-full pb-16 text-text-1">
            <PageHeader
                title={t("嵌入观看")}
                eyebrow="Bilibili"
                description="不离站看B站：搜索 → 站内整页播放（可登录、可切高画质）→ 自动记录看到哪。进度为估算值。"
            />

            {/* 播放器：80vh 官方 embed，?t= 续播 */}
            {cur && (
                <section id="bili-player" className="mb-8">
                    <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
                        <div className="min-w-0">
                            <h2 className="line-clamp-1 text-[17px] font-semibold text-text-1">{cur.title}</h2>
                            <p className="text-[12px] text-text-3">
                                {cur.author}{cur.startAt > 0 ? ` · 从 ${fmtSec(cur.startAt)} 继续` : ""}
                            </p>
                        </div>
                        <div className="flex items-center gap-2">
                            <a
                                href={`https://www.bilibili.com/video/${cur.bvid}`}
                                target="_blank" rel="noopener noreferrer"
                                className="rounded-full border border-line px-3.5 py-1.5 text-[12.5px] text-text-2 transition-colors hover:border-primary/50 hover:text-primary"
                            >
                                去B站打开 ↗
                            </a>
                            <button
                                onClick={() => { saveProgress(0); setCur(null); }}
                                className="cursor-pointer rounded-full border border-line px-3.5 py-1.5 text-[12.5px] text-text-3 transition-colors hover:bg-bg-hover hover:text-text-1"
                            >
                                收起播放器
                            </button>
                        </div>
                    </div>
                    <div className="relative h-[80vh] w-full overflow-hidden rounded-2xl border border-line bg-black">
                        <iframe
                            key={`${cur.bvid}-${cur.startAt}`}
                            // 主站整页：iframe 里可正常登录 B 站账号、切高画质（player.bilibili.com 嵌入版
                            // 无登录入口、锁 720p——曾是"无法登录/无法解锁高画质"的根因）
                            src={`https://www.bilibili.com/video/${cur.bvid}/${cur.startAt > 0 ? `?t=${cur.startAt}` : ""}`}
                            className="absolute inset-0 h-full w-full"
                            allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
                            allowFullScreen
                            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-presentation"
                        />
                    </div>
                </section>
            )}

            {/* 继续看 */}
            {continueList.length > 0 && (
                <section className="mb-8">
                    <div className="mb-3 flex items-baseline gap-3">
                        <h2 className="font-display text-[20px] tracking-tight text-text-1">{t("继续看")}</h2>
                        <span className="text-[12px] text-text-3">{continueList.length} 条 · 进度为观看时长估算</span>
                    </div>
                    <div className="ios-scroll scrollbar-hide -mx-1 flex gap-3.5 overflow-x-auto px-1 pb-2">
                        {continueList.map((p) => (
                            <div key={p.bvid} className="group/cw relative w-[240px] shrink-0">
                                <button
                                    onClick={() => openVideo({ bvid: p.bvid, title: p.title, cover: p.cover, author: p.author }, p.seconds)}
                                    className="block w-full cursor-pointer text-left"
                                >
                                    <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-bg-input">
                                        {p.cover ? (
                                            /* eslint-disable-next-line @next/next/no-img-element */
                                            <img src={p.cover} alt="" loading="lazy" className="h-full w-full object-cover transition-transform duration-200 group-hover/cw:scale-[1.03]" />
                                        ) : (
                                            <div className="flex h-full w-full items-center justify-center p-3 text-center text-[12px] text-text-3">{p.title}</div>
                                        )}
                                        <span className="absolute bottom-1.5 right-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[11px] leading-none text-white">
                                            看到 {fmtSec(p.seconds)}
                                        </span>
                                    </div>
                                    <div className="mt-1.5 line-clamp-1 text-[13px] font-medium text-text-1 transition-colors group-hover/cw:text-primary">{p.title}</div>
                                    <div className="text-[11px] text-text-3">{p.author}</div>
                                </button>
                                <button
                                    onClick={() => {
                                        setContinueList((l) => l.filter((x) => x.bvid !== p.bvid));
                                        void fetch("/api/bili/progress", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bvid: p.bvid }) });
                                    }}
                                    aria-label="移除"
                                    className="absolute left-1.5 top-1.5 z-10 hidden h-6 w-6 cursor-pointer items-center justify-center rounded-full bg-black/60 text-[13px] text-white/85 hover:bg-black/80 group-hover/cw:flex"
                                >×</button>
                            </div>
                        ))}
                    </div>
                </section>
            )}

            {/* 搜索 */}
            <section>
                <div className="relative max-w-xl">
                    <svg className="pointer-events-none absolute left-4 top-1/2 h-4.5 w-4.5 -translate-y-1/2 text-text-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                        <circle cx="11" cy="11" r="7" /><path strokeLinecap="round" d="M21 21l-4.3-4.3" />
                    </svg>
                    <input
                        value={q}
                        onChange={(e) => setQ(e.target.value)}
                        placeholder={t("搜B站视频：片名 / UP主 / 关键词…")}
                        className="h-12 w-full rounded-full border border-line bg-bg-input pl-11 pr-5 text-[15px] text-text-1 outline-none transition-colors placeholder:text-text-3 focus:border-primary"
                    />
                </div>

                {searching && <p className="py-10 text-center text-[13px] text-text-3">搜索中…</p>}
                {!searching && q.trim() && hits.length === 0 && (
                    <p className="py-10 text-center text-[13px] text-text-3">没搜到「{q.trim()}」，换个关键词试试</p>
                )}
                {hits.length > 0 && (
                    <div className="mt-5 grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                        {hits.map((v) => (
                            <button
                                key={v.bvid}
                                onClick={() => openVideo(v)}
                                className="group cursor-pointer text-left"
                            >
                                <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-bg-input transition-all duration-200 group-hover:-translate-y-1 group-hover:shadow-[0_12px_28px_rgba(0,0,0,0.14)]">
                                    {v.cover ? (
                                        /* eslint-disable-next-line @next/next/no-img-element */
                                        <img src={v.cover} alt="" loading="lazy" className="h-full w-full object-cover" />
                                    ) : (
                                        <div className="flex h-full w-full items-center justify-center p-3 text-center text-[12px] text-text-3">{v.title}</div>
                                    )}
                                    {v.duration && (
                                        <span className="absolute bottom-1.5 right-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[11px] leading-none text-white">{v.duration}</span>
                                    )}
                                    <span className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                                        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white/90 text-black shadow-lg">
                                            <svg className="ml-0.5 h-4 w-4" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
                                        </span>
                                    </span>
                                </div>
                                <div className="mt-2 line-clamp-2 text-[13.5px] font-medium leading-snug text-text-1 transition-colors group-hover:text-primary">{v.title}</div>
                                <div className="mt-0.5 text-[11.5px] text-text-3">
                                    {v.author}{v.play != null ? ` · ${fmtPlay(v.play)}播放` : ""}
                                </div>
                            </button>
                        ))}
                    </div>
                )}
            </section>
        </div>
    );
}

export default function EmbedPage() {
    return (
        <Suspense fallback={<div className="py-20 text-center text-text-3">加载中…</div>}>
            <EmbedContent />
        </Suspense>
    );
}
