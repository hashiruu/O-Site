"use client";

// /live 频道实时面板：拉取 timstreams(vixnuvew) 当前所有可看直播（即 timstreams.st/watch/<slug> 下全部子页面），
// 分类 tab + 客户端搜索 + 卡片网格。点卡片 → onPick(slug) → 父组件 captureStream 抓流自播。
// 当前正在播的卡片高亮（border-primary + 「正在播」）。className 抄 app/category/[type]/page.tsx。
import { useEffect, useMemo, useState } from "react";

interface ChannelEvent {
    slug: string;
    name: string;
    logo: string;
    time: string;
    featured: boolean;
    streamNames: string[];
    has4K: boolean;
    vip: boolean;
}
interface ChannelCategory {
    name: string;
    events: ChannelEvent[];
}

interface ChannelPanelProps {
    currentSlug: string;
    onPick: (slug: string) => void;
}

const FALLBACK_IMG =
    "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjM2YzZjQ2IiBzdHJva2Utd2lkdGg9IjIiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCI+PHJlY3QgeD0iMyIgeT0iMyIgd2lkdGg9IjE4IiBoZWlnaHQ9IjE4IiByeD0iMiIgcnk9IjIiPjwvcmVjdD48Y2lyY2xlIGN4PSI4LjUiIGN5PSI4LjUiIHI9IjEuNSI+PC9jaXJjbGU+PHBvbHlsaW5lIHBvaW50cz0iMjEgMTUgMTYgMTAgNSAyMSI+PC9wb2x5bGluZT48L3N2Zz4=";

function fmtTime(t: string): string {
    if (!t) return "";
    const m = t.match(/T(\d{2}:\d{2})/);
    return m ? m[1] : t;
}

export function ChannelPanel({ currentSlug, onPick }: ChannelPanelProps) {
    const [cats, setCats] = useState<ChannelCategory[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);
    const [tab, setTab] = useState("featured");
    const [query, setQuery] = useState("");

    const load = () => {
        setLoading(true);
        setError(false);
        fetch("/api/stream-list")
            .then((r) => r.json())
            .then((d) => {
                if (d.success) setCats(d.data?.categories || []);
                else setError(true);
            })
            .catch(() => setError(true))
            .finally(() => setLoading(false));
    };

    useEffect(() => {
        load();
    }, []);

    const allEvents = useMemo(() => cats.flatMap((c) => c.events), [cats]);

    const tabs = useMemo(() => {
        const out: { key: string; label: string }[] = [{ key: "featured", label: "推荐" }];
        for (const c of cats) out.push({ key: c.name, label: c.name });
        out.push({ key: "all", label: "全部" });
        return out;
    }, [cats]);

    const events = useMemo(() => {
        let list: ChannelEvent[] = [];
        if (tab === "featured") list = allEvents.filter((e) => e.featured);
        else if (tab === "all") list = allEvents;
        else list = cats.find((c) => c.name === tab)?.events ?? [];
        const q = query.trim().toLowerCase();
        if (q) list = list.filter((e) => e.name.toLowerCase().includes(q));
        return list;
    }, [tab, query, allEvents, cats]);

    return (
        <div className="bg-bg-nav border border-line rounded-lg p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                    <div className="text-sm font-medium text-text-2">当前直播</div>
                    <div className="text-[11px] text-text-3 mt-0.5">
                        来自 timstreams · {allEvents.length} 场可看 · 点卡片即播
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <input
                        type="text"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="搜索频道..."
                        className="h-8 px-3 bg-bg-input border border-line rounded-full text-xs focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all w-40 sm:w-56"
                    />
                    <button
                        onClick={load}
                        disabled={loading}
                        className="px-3 py-1 rounded-full text-xs font-medium bg-bg-tag text-text-2 hover:bg-bg-hover transition-all active:scale-[0.97] disabled:opacity-50 shrink-0"
                    >
                        {loading ? "刷新中" : "刷新"}
                    </button>
                </div>
            </div>

            {/* 分类 tab */}
            <div className="flex gap-1 overflow-x-auto custom-scrollbar pb-1">
                {tabs.map((t) => (
                    <button
                        key={t.key}
                        onClick={() => setTab(t.key)}
                        className={`px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-all active:scale-[0.97] ${
                            tab === t.key ? "bg-primary text-white" : "bg-bg-tag text-text-2 hover:bg-bg-hover"
                        }`}
                    >
                        {t.label}
                    </button>
                ))}
            </div>

            {/* 列表 */}
            {loading ? (
                <div className="flex items-center justify-center gap-2 py-10 text-text-3 text-sm">
                    <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                    正在拉取频道数据...
                </div>
            ) : error ? (
                <div className="text-center py-10">
                    <p className="text-text-3 text-sm mb-2">拉取失败，上游暂时不可达</p>
                    <button onClick={load} className="text-primary hover:underline text-sm">重试</button>
                </div>
            ) : events.length === 0 ? (
                <div className="text-center py-10 text-text-3 text-sm">无匹配频道</div>
            ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-x-4 gap-y-4">
                    {events.map((ev) => {
                        const active = !!(currentSlug && ev.slug === currentSlug);
                        return (
                            <div
                                key={ev.slug}
                                onClick={() => onPick(ev.slug)}
                                className="group cursor-pointer flex flex-col"
                            >
                                <div
                                    className={`relative w-full rounded-xl overflow-hidden bg-bg-input border transition-colors aspect-video shadow-sm ${
                                        active ? "border-primary" : "border-transparent group-hover:border-primary/50"
                                    }`}
                                >
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img
                                        src={ev.logo || FALLBACK_IMG}
                                        alt={ev.name}
                                        loading="lazy"
                                        className="w-full h-full object-cover relative z-10 transition-transform duration-300 group-hover:brightness-105"
                                        onError={(e) => {
                                            (e.target as HTMLImageElement).src = FALLBACK_IMG;
                                        }}
                                    />
                                    <div className="absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-black/60 to-transparent z-20 pointer-events-none" />
                                    <div className="absolute top-1.5 right-1.5 flex gap-1 z-20">
                                        {ev.has4K && (
                                            <span className="bg-bili-pink text-white text-[10px] px-1.5 py-0.5 rounded font-bold">
                                                4K
                                            </span>
                                        )}
                                        {ev.streamNames.length > 1 && (
                                            <span className="bg-black/70 text-white text-[10px] px-1.5 py-0.5 rounded font-medium">
                                                {ev.streamNames.length}路
                                            </span>
                                        )}
                                    </div>
                                    {active && (
                                        <span className="absolute bottom-1.5 left-2 z-20 text-white text-[11px] font-medium flex items-center gap-1">
                                            <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" /> 正在播
                                        </span>
                                    )}
                                </div>
                                <div className="mt-2 px-0.5">
                                    <h3
                                        className={`text-[13px] font-medium line-clamp-2 leading-snug transition-colors ${
                                            active ? "text-primary" : "text-text-1 group-hover:text-primary"
                                        }`}
                                    >
                                        {ev.name}
                                    </h3>
                                    <div className="text-[11px] text-text-3 mt-1 truncate">
                                        {fmtTime(ev.time)}
                                        {ev.vip ? " · VIP" : ""}
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
