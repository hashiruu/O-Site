"use client";

// /missed —— What You Missed：热点补课清单
// 自动收录近半年热点 + 未来半年新作（TMDB 电影/剧集、Apple Books 书、Steam 游戏），
// Missed / Future 两栏目。状态是卡片右上角标：点一下循环 想看 → 在看 → 看完 → 想看。
// 不做进度条/长按/滑条（用户明确砍掉），progress 只按状态映射 0/50/100 存给 API。
// 所有状态变更乐观更新 + 失败回滚 toast。

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMe } from "@/components/useMe";
import { LoginGate } from "@/components/LoginGate";
import { PageHeader } from "../../components/PageHeader";

type Kind = "movie" | "tv" | "book" | "game";
type Status = "none" | "unseen" | "partial" | "done";

interface MissedItem {
    id: number;
    kind: Kind;
    title: string;
    cover: string | null;
    year: number | null;
    released: string | null; // 内容发布日期 YYYY-MM-DD；> 今天 = Future 栏目
    source: string;
    source_id: string;
    extra: { rating?: number | null; author?: string | null; [k: string]: unknown };
    status: Status;
    progress: number;
    autoLinked?: boolean; // 状态来自站内观看记录自动关联
}

const TODAY = new Date().toISOString().slice(0, 10);

// 卡片日期标注：同年只显示月日，跨年带年份
function fmtDate(released: string | null): string {
    if (!released) return "";
    const [y, m, d] = released.split("-");
    return y === TODAY.slice(0, 4) ? `${+m}月${+d}日` : `${y}年${+m}月${+d}日`;
}

interface SourceResult {
    source: string;
    ok: boolean;
    fetched: number;
    inserted: number;
    error?: string;
}

const KIND_TABS: { key: Kind | "all"; label: string }[] = [
    { key: "all", label: "全部" },
    { key: "movie", label: "电影" },
    { key: "tv", label: "剧集" },
    { key: "book", label: "书" },
    { key: "game", label: "游戏" },
];

const STATUS_TABS: { key: Status | "all"; label: string }[] = [
    { key: "unseen", label: "想看" },
    { key: "partial", label: "在看" },
    { key: "done", label: "看完" },
    { key: "all", label: "全部" },
];

const KIND_LABEL: Record<Kind, string> = { movie: "电影", tv: "剧集", book: "书", game: "游戏" };
const EASE = "cubic-bezier(0.22, 1, 0.36, 1)";

// 状态角标元数据：label / 配色 / 点一下切到哪个。
// 默认是"无状态"（不替用户预设想看）——点一下才开始：无 → 想看 → 在看 → 看完 → 无
const STATUS_META: Record<Status, { label: string; cls: string; next: Status }> = {
    none: { label: "", cls: "", next: "unseen" },
    unseen: { label: "想看", cls: "bg-black/55 text-white", next: "partial" },
    partial: { label: "在看", cls: "bg-secondary text-white", next: "done" },
    done: { label: "看完", cls: "bg-primary text-white", next: "none" },
};
const NEXT_LABEL: Record<Status, string> = { none: "想看", unseen: "在看", partial: "看完", done: "清除标记" };
// progress 字段保留给 API 兼容：按状态映射固定值
const STATUS_PROGRESS: Record<Status, number> = { none: 0, unseen: 0, partial: 50, done: 100 };

// ── 单张封面卡 ──
function MissedCard({
    item,
    onSetStatus,
}: {
    item: MissedItem;
    onSetStatus: (item: MissedItem, status: Status, progress: number) => void;
}) {
    const done = item.status === "done";
    const rating = typeof item.extra?.rating === "number" ? item.extra.rating : null;
    const meta = STATUS_META[item.status];

    // 唯一交互：点卡片任意位置，循环切状态（角标只负责显示当前状态）
    const cycle = () => onSetStatus(item, meta.next, STATUS_PROGRESS[meta.next]);

    return (
        <div className="group flex flex-col gap-1.5">
            <div
                className="card-lift relative cursor-pointer select-none overflow-hidden rounded-xl bg-bg-hover"
                style={{ aspectRatio: "2 / 3" }}
                onClick={cycle}
                title={`点击${meta.next === "none" ? "清除标记" : `标记为「${NEXT_LABEL[item.status]}」`}`}
            >
                {/* 封面：游戏 16:9 头图在同高 2:3 卡内 object-cover 自适应裁切 */}
                {item.cover ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                        src={item.cover}
                        alt={item.title}
                        loading="lazy"
                        className="h-full w-full object-cover"
                        style={{
                            filter: done ? "grayscale(0.6)" : "none",
                            transition: `filter 0.3s ${EASE}`,
                        }}
                    />
                ) : (
                    <div
                        className="flex h-full w-full items-center justify-center px-3 text-center text-sm font-medium text-text-3"
                        style={{ filter: done ? "grayscale(0.6)" : "none" }}
                    >
                        {item.title}
                    </div>
                )}

                {/* 类型角标（常显，左上） */}
                <span className="absolute left-1.5 top-1.5 rounded-md bg-black/55 px-1.5 py-0.5 text-[11px] leading-4 text-white backdrop-blur-sm">
                    {KIND_LABEL[item.kind]}
                </span>

                {/* 状态角标（常显，右上）：只显示当前状态，切换靠点卡片 */}
                {item.status !== "none" && <span className={`absolute right-1.5 top-1.5 rounded-md px-2 py-0.5 text-[11px] font-medium leading-4 backdrop-blur-sm transition-colors duration-200 ${meta.cls}`}>
                    {meta.label}
                </span>}

                {/* hover 角标：年份 / 评分（右下，让位给状态角标） */}
                <div className="absolute bottom-1.5 right-1.5 flex flex-col items-end gap-1 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                    {item.year && (
                        <span className="rounded-md bg-black/55 px-1.5 py-0.5 text-[11px] leading-4 text-white backdrop-blur-sm">{item.year}</span>
                    )}
                    {rating != null && rating > 0 && (
                        <span className="rounded-md bg-bili-pink/90 px-1.5 py-0.5 text-[11px] leading-4 font-semibold text-white">
                            {rating.toFixed(1)}
                        </span>
                    )}
                </div>

                {/* done：半透明暗层 + 大号 ✓ 圆形徽章从中心弹出 */}
                {done && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/45 pointer-events-none" style={{ transition: `background 0.25s ${EASE}` }}>
                        <div className="missed-check-pop flex h-16 w-16 items-center justify-center rounded-full bg-primary shadow-lg">
                            <svg viewBox="0 0 24 24" className="h-9 w-9 text-white" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M4.5 12.5l5 5L19.5 7" />
                            </svg>
                        </div>
                    </div>
                )}
            </div>

            {/* 标题行 */}
            <div className="min-w-0">
                <p
                    className={`line-clamp-2 text-[13px] leading-[18px] ${done ? "text-text-3 line-through" : "text-text-1"}`}
                    style={{ transition: `color 0.25s ${EASE}` }}
                >
                    {item.title}
                </p>
                {/* 日期标注：未来条目高亮（还没出） */}
                {item.released && (
                    <p className={`mt-0.5 text-[11px] leading-4 tabular-nums ${item.released > TODAY ? "font-medium text-primary" : "text-text-3"}`}>
                        {fmtDate(item.released)}
                    </p>
                )}
            </div>
        </div>
    );
}

// ── 手动添加弹窗 ──
function ManualAddModal({ onClose, onAdded }: { onClose: () => void; onAdded: (item: MissedItem) => void }) {
    const [kind, setKind] = useState<Kind>("movie");
    const [title, setTitle] = useState("");
    const [cover, setCover] = useState("");
    const [year, setYear] = useState("");
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");

    const submit = async () => {
        if (!title.trim() || saving) return;
        setSaving(true);
        setError("");
        try {
            const res = await fetch("/api/missed/manual", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ kind, title: title.trim(), cover: cover.trim() || undefined, year: year ? Number(year) : undefined }),
            });
            const data = await res.json();
            if (!data.success) throw new Error(data.error || "添加失败");
            onAdded(data.item);
            onClose();
        } catch (e) {
            setError(e instanceof Error ? e.message : "添加失败");
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
            <div
                className="w-full max-w-sm rounded-xl border border-line bg-bg-card p-5 shadow-xl"
                style={{ animation: `pageEnter 0.25s ${EASE} both` }}
                onClick={(e) => e.stopPropagation()}
            >
                <h3 className="mb-4 text-base font-semibold text-text-1">手动添加</h3>
                <div className="flex flex-col gap-3">
                    <div className="flex gap-1.5">
                        {(Object.keys(KIND_LABEL) as Kind[]).map((k) => (
                            <button
                                key={k}
                                className={`rounded-full px-3 py-1 text-xs transition-colors duration-200 ${
                                    kind === k ? "bg-primary text-white" : "bg-bg-tag text-text-2 hover:text-text-1"
                                }`}
                                onClick={() => setKind(k)}
                            >
                                {KIND_LABEL[k]}
                            </button>
                        ))}
                    </div>
                    <input
                        className="rounded-lg border border-line bg-bg-input px-3 py-2 text-sm text-text-1 outline-none focus:border-primary"
                        placeholder="标题（必填）"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && submit()}
                        autoFocus
                    />
                    <input
                        className="rounded-lg border border-line bg-bg-input px-3 py-2 text-sm text-text-1 outline-none focus:border-primary"
                        placeholder="封面图 URL（可选）"
                        value={cover}
                        onChange={(e) => setCover(e.target.value)}
                    />
                    <input
                        className="rounded-lg border border-line bg-bg-input px-3 py-2 text-sm text-text-1 outline-none focus:border-primary"
                        placeholder="年份（可选）"
                        inputMode="numeric"
                        value={year}
                        onChange={(e) => setYear(e.target.value.replace(/\D/g, "").slice(0, 4))}
                    />
                    {error && <p className="text-xs text-bili-pink">{error}</p>}
                    <div className="mt-1 flex justify-end gap-2">
                        <button className="rounded-lg px-4 py-1.5 text-sm text-text-2 hover:text-text-1" onClick={onClose}>取消</button>
                        <button
                            className="rounded-lg bg-primary px-4 py-1.5 text-sm text-white transition-opacity disabled:opacity-50"
                            disabled={!title.trim() || saving}
                            onClick={submit}
                        >
                            {saving ? "添加中…" : "添加"}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

// ── 骨架屏 ──
function SkeletonGrid() {
    return (
        <div>
            <p className="mb-4 text-sm text-text-3">正在收集本周热点…</p>
            <div className="grid grid-cols-3 gap-4 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8">
                {Array.from({ length: 16 }).map((_, i) => (
                    <div key={i} className="flex flex-col gap-1.5">
                        <div className="animate-pulse rounded-xl bg-bg-hover" style={{ aspectRatio: "2 / 3" }} />
                        <div className="h-3.5 w-4/5 animate-pulse rounded bg-bg-hover" />
                    </div>
                ))}
            </div>
        </div>
    );
}

export default function MissedPage() {
    const me = useMe();
    const [items, setItems] = useState<MissedItem[]>([]);
    const [sources, setSources] = useState<SourceResult[] | null>(null);
    const [loading, setLoading] = useState(true);
    // 两个栏目：Missed = 已发布该补课的；Future = 未来半年即将上映/发售的
    const [section, setSection] = useState<"missed" | "future">("missed");
    const [kindTab, setKindTab] = useState<Kind | "all">("all");
    const [statusTab, setStatusTab] = useState<Status | "all">("all");
    const [showAdd, setShowAdd] = useState(false);
    const [toast, setToast] = useState("");
    const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const showToast = useCallback((msg: string) => {
        setToast(msg);
        if (toastTimer.current) clearTimeout(toastTimer.current);
        toastTimer.current = setTimeout(() => setToast(""), 2800);
    }, []);

    const load = useCallback(async (refresh = false) => {
        setLoading(true);
        try {
            const res = await fetch(`/api/missed${refresh ? "?refresh=1" : ""}`);
            const data = await res.json();
            if (!data.success) throw new Error(data.error || "加载失败");
            setItems(data.items || []);
            setSources(data.sources || null);
            const failed = (data.sources || []).filter((s: SourceResult) => !s.ok);
            if (data.synced && failed.length) {
                showToast(`部分来源采集失败：${failed.map((s: SourceResult) => s.source).join("、")}`);
            }
        } catch (e) {
            showToast(e instanceof Error ? e.message : "加载失败");
        } finally {
            setLoading(false);
        }
    }, [showToast]);

    useEffect(() => { load(); }, [load]);

    // 乐观更新：立即改 UI，POST 失败回滚 + toast
    const setStatus = useCallback(async (item: MissedItem, status: Status, progress: number) => {
        const prev = { status: item.status, progress: item.progress };
        setItems((list) => list.map((it) => (it.id === item.id ? { ...it, status, progress } : it)));
        try {
            const res = await fetch("/api/missed", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ itemId: item.id, status, progress }),
            });
            const data = await res.json();
            if (!data.success) throw new Error(data.error || "保存失败");
        } catch (e) {
            setItems((list) => list.map((it) => (it.id === item.id ? { ...it, ...prev } : it)));
            showToast(`保存失败已回滚：${e instanceof Error ? e.message : "网络错误"}`);
        }
    }, [showToast]);

    // 栏目切分：released > 今天 → Future；其余（含无日期）→ Missed
    const missedItems = useMemo(() => items.filter((it) => !it.released || it.released <= TODAY), [items]);
    const futureItems = useMemo(() => items.filter((it) => !!it.released && it.released > TODAY), [items]);

    const filtered = useMemo(() => {
        // Missed 沿用 API 的从新到旧；Future 反过来——最近要上的排最前（倒计时视角）
        const pool = section === "future"
            ? [...futureItems].sort((a, b) => (a.released || "").localeCompare(b.released || ""))
            : missedItems;
        return pool.filter((it) => (kindTab === "all" || it.kind === kindTab) && (statusTab === "all" || it.status === statusTab));
    }, [section, missedItems, futureItems, kindTab, statusTab]);

    // 统计只算 Missed（还没发布的内容谈不上"欠"）
    const stats = useMemo(() => {
        const total = missedItems.length;
        const done = missedItems.filter((i) => i.status === "done").length;
        const partial = missedItems.filter((i) => i.status === "partial").length;
        const unseen = total - done - partial;
        return { total, done, partial, unseen, pct: total ? Math.round((done / total) * 100) : 0 };
    }, [missedItems]);

    const failedSources = (sources || []).filter((s) => !s.ok);

    // 铁律：补课清单是个人功能（标记你看没看过），未登录不提供（后端同样 401）
    if (!me.loggedIn) return me.loading ? null : <LoginGate feature="What You Missed" />;

    return (
        <div className="w-full pb-16">
            {/* ── 页头 ── */}
            <PageHeader
                title="What You Missed"
                description="热点补课清单 · 标记你看过了没"
                actions={
                    <>
                        <button
                            className="rounded-full border border-line bg-bg-card px-3 py-1.5 text-xs text-text-2 transition-colors duration-200 hover:text-primary"
                            onClick={() => load(true)}
                            title="强制重新采集本周热点"
                        >
                            ↻ 重新采集
                        </button>
                        <button
                            className="rounded-full bg-primary px-3.5 py-1.5 text-xs font-medium text-white transition-transform duration-200 hover:scale-105"
                            onClick={() => setShowAdd(true)}
                        >
                            ＋ 手动添加
                        </button>
                    </>
                }
            />

            {/* ── 统计条（纯数字，无进度条） ── */}
            <div className="mb-5 rounded-xl border border-line bg-bg-card p-4">
                <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
                    <span className="text-text-2">总数 <b className="text-text-1">{stats.total}</b></span>
                    <span className="text-text-2">已补 <b className="text-primary">{stats.done}</b></span>
                    <span className="text-text-2">在看 <b className="text-text-1">{stats.partial}</b></span>
                    <span className="text-text-2">还欠 <b className="text-text-1">{stats.unseen}</b></span>
                    <span className="ml-auto text-xs text-text-3">{stats.pct}%</span>
                </div>
                {failedSources.length > 0 && (
                    <p className="mt-2 text-xs text-text-3">
                        上次采集有失败源：{failedSources.map((s) => `${s.source}（${s.error || "未知错误"}）`).join("；")}
                    </p>
                )}
            </div>

            {/* ── 栏目：Missed（该补课的）/ Future（即将来临）── */}
            <div className="mb-4 flex gap-1 rounded-xl border border-line bg-bg-card p-1 w-fit">
                {([
                    { key: "missed", label: `Missed · ${missedItems.length}` },
                    { key: "future", label: `Future · ${futureItems.length}` },
                ] as const).map((t) => (
                    <button
                        key={t.key}
                        className={`rounded-lg px-5 py-2 text-sm font-semibold transition-colors duration-200 ${
                            section === t.key ? "bg-primary text-white" : "text-text-2 hover:text-text-1"
                        }`}
                        onClick={() => { setSection(t.key); setStatusTab(t.key === "future" ? "all" : statusTab); }}
                    >
                        {t.label}
                    </button>
                ))}
            </div>

            {/* ── 筛选 tab ── */}
            <div className="mb-5 flex flex-wrap items-center gap-x-5 gap-y-2">
                <div className="flex gap-1.5">
                    {KIND_TABS.map((t) => (
                        <button
                            key={t.key}
                            className={`rounded-full px-3.5 py-1.5 text-sm transition-colors duration-200 ${
                                kindTab === t.key ? "bg-primary text-white" : "bg-bg-card text-text-2 hover:text-text-1"
                            }`}
                            onClick={() => setKindTab(t.key)}
                        >
                            {t.label}
                        </button>
                    ))}
                </div>
                {section === "missed" && (
                    <>
                        <div className="h-4 w-px bg-line" />
                        <div className="flex gap-1.5">
                            {STATUS_TABS.map((t) => (
                                <button
                                    key={t.key}
                                    className={`rounded-full px-3.5 py-1.5 text-sm transition-colors duration-200 ${
                                        statusTab === t.key ? "bg-primary text-white" : "bg-bg-card text-text-2 hover:text-text-1"
                                    }`}
                                    onClick={() => setStatusTab(t.key)}
                                >
                                    {t.label}
                                </button>
                            ))}
                        </div>
                    </>
                )}
            </div>

            {/* ── 封面网格 / 骨架 / 空态 ── */}
            {loading ? (
                <SkeletonGrid />
            ) : filtered.length === 0 ? (
                <div className="flex flex-col items-center gap-3 py-20 text-center">
                    <svg viewBox="0 0 24 24" className="h-12 w-12 text-primary" fill="currentColor" aria-hidden="true">
                        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
                    </svg>
                    <p className="text-sm text-text-2">
                        {items.length === 0 ? "暂无条目，点右上角「重新采集」收集本周热点" : "这个筛选下没有条目"}
                    </p>
                </div>
            ) : (
                <div className="grid-stagger grid grid-cols-3 gap-x-4 gap-y-5 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8">
                    {filtered.map((item) => (
                        <MissedCard key={item.id} item={item} onSetStatus={setStatus} />
                    ))}
                </div>
            )}

            {/* ── 手动添加弹窗 ── */}
            {showAdd && (
                <ManualAddModal
                    onClose={() => setShowAdd(false)}
                    onAdded={(item) => { setItems((list) => [item, ...list]); showToast("已添加"); }}
                />
            )}

            {/* ── toast ── */}
            {toast && (
                <div
                    className="fixed bottom-8 left-1/2 z-50 -translate-x-1/2 rounded-full bg-black/80 px-4 py-2 text-sm text-white shadow-lg"
                    style={{ animation: `pageEnter 0.25s ${EASE} both` }}
                >
                    {toast}
                </div>
            )}
        </div>
    );
}
