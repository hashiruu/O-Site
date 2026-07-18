"use client";

// ── 观看历史 Dashboard ──
// 统计卡行（在追/读过的书/本周活跃/已完成/累计观看时长）+ 影音与阅读合并的时间线
// （今天/昨天/过去7天/更早分组）。阅读足迹与首页"继续观看"同源（reading_progress），
// 此前历史页只有影音——与首页不同步的根因，本版起两页看到同一个世界。
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useMe } from "@/components/useMe";
import { LoginGate } from "@/components/LoginGate";
import { PageHeader } from "../../components/PageHeader";
import { useLang } from "@/lib/i18n";

const FALLBACK_IMG = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjM2YzZjQ2IiBzdHJva2Utd2lkdGg9IjIiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCI+PHJlY3QgeD0iMyIgeT0iMyIgd2lkdGg9IjE4IiBoZWlnaHQ9IjE4IiByeD0iMiIgcnk9IjIiPjwvcmVjdD48Y2lyY2xlIGN4PSI4LjUiIGN5PSI4LjUiIHI9IjEuNSI+PC9jaXJjbGU+PHBvbHlsaW5lIHBvaW50cz0iMjEgMTUgMTYgMTAgNSAyMSI+PC9wb2x5bGluZT48L3N2Zz4=';

interface WatchItem {
    wpId: string; title: string; path: string; poster: string | null; type: string;
    episodeLabel: string | null; progressPct: number; completed: boolean; lastWatched: string;
}
interface BookItem {
    kind: "book"; path: string; title: string; poster: string; progressPct: number; completed: boolean; lastAt: string;
}
interface Stats { totalWatch: number; totalBooks: number; weekActive: number; finished: number; watchSeconds: number }

type Entry =
    | { kind: "watch"; at: string; w: WatchItem }
    | { kind: "book"; at: string; b: BookItem };

const parseUtc = (iso: string) => new Date(iso.replace(" ", "T") + (iso.includes("Z") || iso.includes("+") ? "" : "Z"));

function timeAgo(iso: string): string {
    if (!iso) return "";
    const diff = (Date.now() - parseUtc(iso).getTime()) / 1000;
    if (diff < 60) return "刚刚";
    if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
    if (diff < 86400 * 30) return `${Math.floor(diff / 86400)} 天前`;
    return parseUtc(iso).toLocaleDateString("zh-CN");
}

function groupOf(iso: string): string {
    const t = parseUtc(iso).getTime();
    const now = new Date();
    const day0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    if (t >= day0) return "今天";
    if (t >= day0 - 86400_000) return "昨天";
    if (t >= day0 - 6 * 86400_000) return "过去 7 天";
    return "更早";
}

const fmtHours = (sec: number) => {
    const h = sec / 3600;
    return h >= 100 ? `${Math.round(h)}` : h >= 1 ? h.toFixed(1) : (sec / 60).toFixed(0);
};

const bookHref = (p: string) => {
    if (/\.pdf$/i.test(p)) return `/reader/pdf?path=${encodeURIComponent(p)}`;
    if (/\.md$/i.test(p)) return `/reader/md?path=${encodeURIComponent(p)}`;
    return `/reader/epub?path=${encodeURIComponent(p)}`;
};

export default function HistoryPage() {
    const router = useRouter();
    const me = useMe();
    const [items, setItems] = useState<WatchItem[]>([]);
    const [books, setBooks] = useState<BookItem[]>([]);
    const [stats, setStats] = useState<Stats | null>(null);
    const [loading, setLoading] = useState(true);
    const [page, setPage] = useState(1);
    const [hasMore, setHasMore] = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);
    const [tab, setTab] = useState<"all" | "watch" | "book">("all");
    const { t } = useLang();

    const load = useCallback(async (p: number, append: boolean) => {
        try {
            const r = await fetch(`/api/media/history?page=${p}`);
            const j = await r.json();
            if (j.success) {
                setItems(prev => append ? [...prev, ...j.data] : j.data);
                if (!append) { setBooks(j.books || []); setStats(j.stats || null); }
                setHasMore(j.hasMore);
                setPage(p);
            }
        } catch (e) { console.error(e); }
        finally { setLoading(false); setLoadingMore(false); }
    }, []);

    useEffect(() => { load(1, false); }, [load]);

    const markComplete = async (wpId: string) => {
        setItems(prev => prev.map(i => i.wpId === wpId ? { ...i, completed: true } : i));
        try {
            await fetch('/api/media/history', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ wpId })
            });
        } catch (e) { console.error(e); }
    };

    const remove = async (wpId: string) => {
        const prev = items;
        setItems(items.filter(i => i.wpId !== wpId));
        try {
            const r = await fetch('/api/media/history', {
                method: 'DELETE', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ wpId })
            });
            const j = await r.json();
            if (!j.success) setItems(prev);
        } catch (e) { console.error(e); setItems(prev); }
    };

    if (!me.loggedIn) return me.loading ? null : <LoginGate feature="观看历史" />;

    // 合并时间线
    const entries: Entry[] = [
        ...(tab !== "book" ? items.map((w): Entry => ({ kind: "watch", at: w.lastWatched, w })) : []),
        ...(tab !== "watch" ? books.map((b): Entry => ({ kind: "book", at: b.lastAt, b })) : []),
    ].sort((a, b) => (a.at < b.at ? 1 : -1));

    const groups: { label: string; list: Entry[] }[] = [];
    for (const e of entries) {
        const g = groupOf(e.at);
        const f = groups.find((x) => x.label === g);
        if (f) f.list.push(e); else groups.push({ label: g, list: [e] });
    }

    const statCards = stats ? [
        { n: stats.totalWatch, label: t("看过的影音"), accent: "text-primary" },
        { n: stats.totalBooks, label: t("翻过的书"), accent: "text-secondary" },
        { n: stats.weekActive, label: t("本周活跃"), accent: "text-text-1" },
        { n: stats.finished, label: t("已完成"), accent: "text-text-1" },
        { n: fmtHours(stats.watchSeconds), label: stats.watchSeconds >= 3600 ? t("累计观看(小时)") : t("累计观看(分钟)"), accent: "text-text-1" },
    ] : [];

    return (
        <div className="w-full text-text-1 pb-20">
            <PageHeader
                title={t("观看历史")}
                description={t("影音与阅读的全部足迹，与首页「继续观看」同一本账。")}
                actions={
                    <div className="flex rounded-full border border-line bg-bg-input p-0.5 text-[12.5px]">
                        {([["all", "全部"], ["watch", "影音"], ["book", "书"]] as const).map(([k, label]) => (
                            <button
                                key={k}
                                onClick={() => setTab(k)}
                                className={`cursor-pointer rounded-full px-3.5 py-1.5 transition-colors ${tab === k ? "bg-bg-card font-semibold text-text-1 shadow-sm" : "text-text-3 hover:text-text-1"}`}
                            >
                                {t(label)}
                            </button>
                        ))}
                    </div>
                }
            />

            {/* 统计卡行 */}
            {stats && (
                <div className="mb-7 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                    {statCards.map((c) => (
                        <div key={c.label} className="rounded-2xl border border-line bg-bg-card px-4 py-3.5">
                            <div className={`font-display text-[26px] leading-none tabular-nums ${c.accent}`}>{c.n}</div>
                            <div className="mt-1.5 text-[11.5px] tracking-wide text-text-3">{c.label}</div>
                        </div>
                    ))}
                </div>
            )}

            {loading ? (
                <div className="text-center py-20 text-text-3">加载中...</div>
            ) : entries.length === 0 ? (
                <div className="text-center py-20 text-text-3">
                    <svg className="w-24 h-24 mx-auto mb-4 text-text-4 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                    <p className="text-lg font-medium text-text-2">{t("这里还是空的")}</p>
                    <p className="text-sm mt-1 opacity-60">看过的、读过的都会出现在这里</p>
                    <Link href="/" className="inline-block mt-6 px-6 py-2 rounded-full bg-primary text-white text-sm hover:brightness-110 transition">{t("去首页看看")}</Link>
                </div>
            ) : (
                <div className="space-y-7">
                    {groups.map((g) => (
                        <section key={g.label}>
                            <div className="mb-3 flex items-center gap-3">
                                <h2 className="font-display text-[17px] tracking-tight text-text-1">{t(g.label)}</h2>
                                <span className="text-[12px] text-text-3">{g.list.length} {t("条")}</span>
                                <div className="h-px flex-1 bg-line/70" />
                            </div>
                            <div className="space-y-2.5">
                                {g.list.map((e) => e.kind === "watch" ? (
                                    <div key={e.w.wpId} className="group flex gap-4 rounded-xl border border-line bg-bg-card p-3 transition-colors hover:border-primary/30">
                                        <div
                                            onClick={() => router.push(`/watch?filePath=${encodeURIComponent(e.w.path)}`)}
                                            className="relative aspect-video w-[150px] shrink-0 cursor-pointer overflow-hidden rounded-lg bg-bg-input sm:w-[200px]"
                                        >
                                            {/* eslint-disable-next-line @next/next/no-img-element */}
                                            <img
                                                src={e.w.poster || `/api/media/thumbnail?filePath=${encodeURIComponent(e.w.path)}`}
                                                className="h-full w-full object-cover transition-[filter] duration-300 group-hover:brightness-105"
                                                alt={e.w.title}
                                                loading="lazy"
                                                onError={(ev) => { const img = ev.target as HTMLImageElement; if (img.dataset.fb) return; img.dataset.fb = "1"; img.src = FALLBACK_IMG; }}
                                            />
                                            <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-black/40">
                                                <div className="h-full bg-primary" style={{ width: `${e.w.completed ? 100 : e.w.progressPct}%` }} />
                                            </div>
                                            {e.w.completed && (
                                                <div className="absolute right-1.5 top-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-white">✓ 已看完</div>
                                            )}
                                        </div>
                                        <div className="flex min-w-0 flex-1 flex-col">
                                            <div className="flex items-center gap-2">
                                                <span className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">影音</span>
                                                <h3 className="line-clamp-1 text-[15px] font-semibold text-text-1" title={e.w.title}>{e.w.title}</h3>
                                            </div>
                                            <p className="mt-1 text-[12px] text-text-3">
                                                {e.w.episodeLabel ? `${e.w.episodeLabel} · ` : ''}{e.w.completed ? '已看完' : `已看 ${e.w.progressPct}%`} · {timeAgo(e.w.lastWatched)}
                                            </p>
                                            <div className="mt-auto flex flex-wrap items-center gap-2 pt-3">
                                                <button
                                                    onClick={() => router.push(`/watch?filePath=${encodeURIComponent(e.w.path)}`)}
                                                    className="cursor-pointer rounded-md bg-primary/15 px-4 py-1.5 text-[12.5px] font-medium text-primary transition-colors hover:bg-primary/25"
                                                >
                                                    {e.w.completed ? t('重新看') : t('继续看')}
                                                </button>
                                                {!e.w.completed && (
                                                    <button
                                                        onClick={() => markComplete(e.w.wpId)}
                                                        className="cursor-pointer rounded-md border border-line px-3 py-1.5 text-[12px] text-text-2 transition-colors hover:text-text-1"
                                                    >{t("标记已看")}</button>
                                                )}
                                                <button
                                                    onClick={() => remove(e.w.wpId)}
                                                    className="cursor-pointer rounded-md border border-line px-3 py-1.5 text-[12px] text-text-3 transition-colors hover:border-bili-pink/40 hover:text-bili-pink"
                                                >{t("移除")}</button>
                                            </div>
                                        </div>
                                    </div>
                                ) : (
                                    <div key={`bk-${e.b.path}`} className="group flex gap-4 rounded-xl border border-line bg-bg-card p-3 transition-colors hover:border-secondary/40">
                                        <div
                                            onClick={() => router.push(bookHref(e.b.path))}
                                            className="relative aspect-[2/3] w-[68px] shrink-0 cursor-pointer overflow-hidden rounded-md bg-bg-input shadow-[0_4px_10px_rgba(0,0,0,0.18)] sm:w-[80px]"
                                        >
                                            {/* eslint-disable-next-line @next/next/no-img-element */}
                                            <img
                                                src={e.b.poster}
                                                className="h-full w-full object-cover"
                                                alt={e.b.title}
                                                loading="lazy"
                                                onError={(ev) => { const img = ev.target as HTMLImageElement; if (img.dataset.fb) return; img.dataset.fb = "1"; img.src = FALLBACK_IMG; }}
                                            />
                                        </div>
                                        <div className="flex min-w-0 flex-1 flex-col">
                                            <div className="flex items-center gap-2">
                                                <span className="shrink-0 rounded bg-secondary/10 px-1.5 py-0.5 text-[10px] font-semibold text-secondary">书</span>
                                                <h3 className="line-clamp-1 text-[15px] font-semibold text-text-1" title={e.b.title}>{e.b.title}</h3>
                                            </div>
                                            <p className="mt-1 text-[12px] text-text-3">
                                                {e.b.completed ? '已读完' : `已读 ${e.b.progressPct}%`} · {timeAgo(e.b.lastAt)}
                                            </p>
                                            <div className="mt-2 h-[3px] w-full max-w-[240px] overflow-hidden rounded-full bg-line">
                                                <div className="h-full rounded-full bg-secondary" style={{ width: `${e.b.completed ? 100 : e.b.progressPct}%` }} />
                                            </div>
                                            <div className="mt-auto pt-3">
                                                <button
                                                    onClick={() => router.push(bookHref(e.b.path))}
                                                    className="cursor-pointer rounded-md bg-secondary/12 px-4 py-1.5 text-[12.5px] font-medium text-secondary transition-colors hover:bg-secondary/20"
                                                >
                                                    {e.b.completed ? t('重读') : t('继续读')}
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </section>
                    ))}

                    {hasMore && tab !== "book" && (
                        <div className="pt-2 text-center">
                            <button
                                onClick={() => { setLoadingMore(true); load(page + 1, true); }}
                                disabled={loadingMore}
                                className="cursor-pointer rounded-full border border-line px-6 py-2 text-sm text-text-2 transition-colors hover:border-primary/40 hover:text-primary disabled:opacity-50"
                            >
                                {loadingMore ? t('加载中…') : t('加载更多')}
                            </button>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
