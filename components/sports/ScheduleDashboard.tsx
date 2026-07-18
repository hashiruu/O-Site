"use client";

// 赛程 dashboard：小组赛按美东日期分组（卡片网格）+ 淘汰赛按轮次分组（bracket 结构）。
// 小组赛全部踢完后默认折叠（可手动展开）；进页面自动滚到「今天」或淘汰赛对阵图。
import { useCallback, useEffect, useRef, useState } from "react";
import type { ScheduleData, MatchEvent } from "../../lib/sports/types";
import { StageTimeline } from "./StageTimeline";
import { MatchCard } from "./MatchCard";
import { isKnockoutEvent } from "../../lib/sports/bracket";
import { BracketCircle } from "./BracketCircle";

const TZ = "America/New_York";

function etDateKey(dateUtc: string): string {
    return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(dateUtc));
}
function etTodayKey(): string {
    return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
function dateLabel(key: string): string {
    const [y, m, d] = key.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    const wd = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][dt.getDay()];
    const base = `${m}月${d}日 ${wd}`;
    if (key === etTodayKey()) return `今天 · ${base}`;
    return base;
}

function isGroupDone(data: ScheduleData): boolean {
    const gs = data.events.filter((e) => !isKnockoutEvent(e));
    return gs.length > 0 && gs.every((e) => e.status === "final");
}

export function ScheduleDashboard({ onWatch, onReplayTour }: { onWatch: (e: MatchEvent) => void; onReplayTour?: () => void }) {
    const [data, setData] = useState<ScheduleData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    // null = 未手动操作，跟随默认（小组赛踢完 → 收起）
    const [groupsOpen, setGroupsOpen] = useState<boolean | null>(null);
    // 仅首次拿到数据时滚到「今天」；避免每 60s 轮询（setData 传入新对象引用）都把用户从别的日期/bracket 拽回。
    const didInitialScrollRef = useRef(false);

    const load = useCallback(() => {
        fetch("/api/sports/schedule")
            .then((r) => r.json())
            .then((d) => { if (d.success) { setData(d.data); setError(null); } else setError(d.error || "加载失败"); })
            .catch(() => setError("网络错误"))
            .finally(() => setLoading(false));
    }, []);

    useEffect(() => {
        load();
        const t = setInterval(load, 60_000);
        return () => clearInterval(t);
    }, [load]);

    // 进页面自动定位。仅首次：
    // - 小组赛已全部结束（此时默认折叠）→ 直接滚到淘汰赛对阵图锚点，精准落位；
    // - 小组赛进行中 → 滚到「今天」（若无今天，滚到最近未来比赛日）。
    useEffect(() => {
        if (!data || didInitialScrollRef.current) return;
        let el: HTMLElement | null = null;
        if (isGroupDone(data)) {
            el = document.getElementById("knockout-bracket");
        } else {
            const ks = Array.from(new Set(data.events.filter((e) => !isKnockoutEvent(e)).map((e) => etDateKey(e.dateUtc)))).sort();
            const target = ks.find((k) => k >= etTodayKey()) ?? ks[ks.length - 1];
            if (target) el = document.getElementById(`group-${target}`);
        }
        if (el) {
            didInitialScrollRef.current = true;
            const node = el;
            const t = setTimeout(() => node.scrollIntoView({ behavior: "smooth", block: "start" }), 120);
            return () => clearTimeout(t);
        }
    }, [data]);

    if (loading) {
        return (
            <div className="bg-bg-nav border border-line rounded-xl p-6 flex items-center justify-center gap-3">
                <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                <span className="text-sm text-text-3">加载赛程...</span>
            </div>
        );
    }
    // 仅在「没有任何数据」时把错误当致命态：轮询中偶发 502 但有旧数据时仍渲染旧数据，
    // 下次轮询成功会清掉 error，不再一次抖动就永久卡死在错误页。
    if (error && !data) {
        return <div className="bg-bg-nav border border-line rounded-xl p-6 text-center"><span className="text-sm text-bili-pink">赛程加载失败：{error}</span></div>;
    }
    if (!data || data.events.length === 0) {
        return <div className="bg-bg-nav border border-line rounded-xl p-6 text-center"><span className="text-sm text-text-3">暂无赛程数据</span></div>;
    }

    const groupEvents = data.events.filter((e) => !isKnockoutEvent(e));
    const groupDone = isGroupDone(data);
    // 手动开关优先；否则小组赛踢完默认收起
    const showGroups = groupsOpen ?? !groupDone;

    // 小组赛按日期分组
    const grouped: Record<string, MatchEvent[]> = {};
    for (const e of groupEvents) {
        const k = etDateKey(e.dateUtc);
        (grouped[k] ??= []).push(e);
    }
    const keys = Object.keys(grouped).sort();

    return (
        <div className="flex flex-col gap-4">
            <StageTimeline data={data} onReplayTour={onReplayTour} />

            {/* 小组赛折叠头（踢完后默认收起） */}
            {keys.length > 0 && (
                <button
                    type="button"
                    onClick={() => setGroupsOpen(!showGroups)}
                    className="flex items-center justify-between bg-bg-nav border border-line rounded-xl px-4 py-2.5 hover:bg-bg-hover transition-colors text-left"
                >
                    <span className="text-sm font-semibold text-text-1">
                        ⚽ 小组赛{groupDone ? <span className="text-text-3 font-normal">（已全部结束 · {groupEvents.length} 场）</span> : ""}
                    </span>
                    <span className="text-xs text-text-3">{showGroups ? "收起 ▲" : "展开 ▼"}</span>
                </button>
            )}

            {showGroups && keys.map((k) => (
                <div key={k} id={`group-${k}`} className="scroll-mt-24">
                    <h3 className="text-xs text-text-3 font-semibold mb-2 px-1">{dateLabel(k)}</h3>
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                        {grouped[k].map((e) => <MatchCard key={e.id} event={e} onClick={onWatch} />)}
                    </div>
                </div>
            ))}

            {/* 淘汰赛 bracket 树状图 */}
            {data.events.some((e) => isKnockoutEvent(e)) && (
                <div id="knockout-bracket" className="mt-2 pt-3 border-t border-line scroll-mt-24">
                    <h3 className="text-xs text-text-3 font-semibold mb-2 px-1">🏆 淘汰赛对阵（32 强 → 决赛）</h3>
                    <BracketCircle events={data.events} />
                </div>
            )}
        </div>
    );
}
