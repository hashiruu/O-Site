"use client";

// 顶部常驻全景条：赛制阶段时间轴 + 进度 + LIVE 计数 + 用法图例（三合一「一目了然」）。
import type { ScheduleData } from "../../lib/sports/types";

const STAGES = ["Group Stage", "Round of 32", "Round of 16", "Quarterfinals", "Semifinals", "Final"];
const STAGE_LABELS: Record<string, string> = {
    "Group Stage": "小组赛", "Round of 32": "32强", "Round of 16": "16强",
    "Quarterfinals": "8强", "Semifinals": "4强", "Final": "决赛",
};

export function StageTimeline({ data, onReplayTour }: { data: ScheduleData; onReplayTour?: () => void }) {
    const currentIdx = Math.max(0, STAGES.indexOf(data.stage));
    const finished = data.events.filter((e) => e.status === "final").length;
    const liveCount = data.events.filter((e) => e.status === "live").length;
    const pct = data.events.length ? Math.round((finished / data.events.length) * 100) : 0;

    return (
        <div className="bg-bg-nav border border-line rounded-xl p-4 sm:p-5">
            <div className="flex items-center justify-between mb-3">
                <h2 className="font-display text-base sm:text-lg text-text-1">🏆 {data.leagueName} {data.season}</h2>
                <span className="text-[11px] text-text-3 shrink-0">美东 24h · 数据 ESPN</span>
            </div>

            {/* 赛制阶段时间轴 */}
            <div className="flex items-center gap-1.5 sm:gap-2 text-[10px] sm:text-[11px] mb-3 overflow-x-auto pb-1">
                {STAGES.map((s, i) => {
                    const cur = i === currentIdx;
                    const done = i < currentIdx;
                    return (
                        <span key={s} className="flex items-center gap-1.5 sm:gap-2 whitespace-nowrap">
                            <span className={`px-2 py-0.5 rounded font-semibold transition-colors
                                ${cur ? "bg-primary text-white animate-pulse" : done ? "text-primary/70" : "text-text-3"}`}>
                                {cur ? "● " : ""}{STAGE_LABELS[s] ?? s}
                            </span>
                            {i < STAGES.length - 1 && <span className="text-line">━</span>}
                        </span>
                    );
                })}
            </div>

            {/* 进度 */}
            <div className="flex items-center gap-3 mb-3">
                <div className="flex-1 h-1.5 bg-bg-tag rounded-full overflow-hidden">
                    <div className="h-full bg-primary transition-all duration-500" style={{ width: `${pct}%` }} />
                </div>
                <span className="text-[11px] text-text-3 tabular-nums whitespace-nowrap">
                    {STAGE_LABELS[data.stage] ?? data.stage} · {finished}/{data.events.length}场
                </span>
                {liveCount > 0 && (
                    <span className="text-[11px] text-primary font-bold animate-pulse whitespace-nowrap">🔴 LIVE ×{liveCount}</span>
                )}
            </div>

            {/* 用法图例 */}
            <div className="flex items-center gap-3 sm:gap-4 text-[10px] text-text-3 flex-wrap">
                <span>📌 点击卡片 → 自动匹配直播源</span>
                <span>🕐 时间统一美东 24h</span>
                <button type="button" onClick={onReplayTour} className="text-text-2 hover:text-primary transition-colors">
                    ❓ 重看引导
                </button>
            </div>
        </div>
    );
}
