"use client";

// 淘汰赛 bracket 树状图（div 渲染，弃 mermaid）。
// 横向五列 R32→Final，每列纵向排对阵卡（队色条 + 国旗 logo + 队名 + 日期/比分/TBD）。
// div 渲染随 events prop 自动更新（60s 轮询），无 mermaid 重复渲染冻住问题。
// 「胜者晋级」对应：轮次直接用 ESPN season.slug 分类，已结束场的胜者由 ESPN 填进下游轮
// 对应位（如加拿大胜 R32 → 出现在 R16 的 "Canada vs TBD"）。同队跨轮用相同队色条视觉跟踪。
// 国旗用 ESPN team.logo（PNG），复用 MatchCard 模式。8强/4强/决赛即使无数据也列出占位列。
import type { MatchEvent, MatchTeam } from "../../lib/sports/types";
import { classifyKnockout, KNOCKOUT_ROUNDS, ROUND_LABELS, shortName } from "../../lib/sports/bracket";

// 各轮应有场数（赛制固定），用于补齐未排出的占位列（4强/决赛）
const ROUND_SLOTS: Record<string, number> = { R32: 16, R16: 8, QF: 4, SF: 2, Final: 1 };

function teamColor(c?: string): string {
    return c && /^[0-9a-fA-F]{6}$/.test(c) ? `#${c}` : "#3a3a3a";
}

/** dateUtc → 美东月/日（如 "6/29"）；无日期或解析失败返回空串（"不知道的就不标"） */
function etDateLabel(dateUtc: string): string {
    if (!dateUtc) return "";
    try {
        return new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "numeric", day: "numeric" }).format(new Date(dateUtc));
    } catch { return ""; }
}

function TeamLine({ t, win, showScore }: { t: MatchTeam; win?: boolean; showScore?: boolean }) {
    return (
        <div
            className="flex items-center gap-1.5 min-w-0 pl-1.5 py-px"
            style={{ borderLeft: `2px solid ${teamColor(t.color)}` }}
        >
            {t.logo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={t.logo} alt="" className="w-4 h-4 object-contain shrink-0" loading="lazy" />
            ) : (
                <span className="w-4 h-4 rounded-full bg-bg-tag shrink-0 inline-block" />
            )}
            <span className={`text-[12px] truncate flex-1 ${win ? "text-text-1 font-semibold" : "text-text-3"}`}>
                {shortName(t.name)}
            </span>
            {showScore && t.score != null && (
                <span className={`text-[12px] tabular-nums font-bold shrink-0 ${win ? "text-text-1" : "text-text-3"}`}>
                    {t.score}
                </span>
            )}
        </div>
    );
}

function Matchup({ e }: { e: MatchEvent }) {
    let homeWin = false, awayWin = false;
    if (e.status === "final" && e.home.score != null && e.away.score != null) {
        if (+e.home.score > +e.away.score) homeWin = true;
        else if (+e.away.score > +e.home.score) awayWin = true;
    }
    const live = e.status === "live";
    const showScore = e.status !== "scheduled";
    return (
        <div className={`rounded-lg border px-1.5 py-1 flex flex-col gap-0.5 bg-bg min-w-0
            ${live ? "border-primary/60" : "border-line"}`}>
            <TeamLine t={e.home} win={homeWin} showScore={showScore} />
            <TeamLine t={e.away} win={awayWin} showScore={showScore} />
            <div className={`text-[9px] tabular-nums pl-1.5 ${live ? "text-primary font-bold" : "text-text-4"}`}>
                {etDateLabel(e.dateUtc) && <span className="text-text-3">{etDateLabel(e.dateUtc)} · </span>}
                {e.status === "scheduled" ? e.timeEt : e.statusDetail}
            </div>
        </div>
    );
}

/** 占位对阵（该轮尚未排出）：虚线卡 + 待定 */
function PlaceholderMatchup() {
    return (
        <div className="rounded-lg border border-dashed border-line px-1.5 py-1 flex flex-col gap-0.5 bg-bg/40 min-w-0">
            {[0, 1].map((k) => (
                <div key={k} className="flex items-center gap-1.5 min-w-0 pl-1.5 py-px" style={{ borderLeft: "2px solid #3a3a3a" }}>
                    <span className="w-4 h-4 rounded-full bg-bg-tag shrink-0 inline-block" />
                    <span className="text-[12px] text-text-4 truncate flex-1">待定</span>
                </div>
            ))}
        </div>
    );
}

// 列间晋级示意箭头（同列胜者流向下一轮；ESPN 无种子数据，不画精确 1v1 配对连线）
function AdvanceArrow() {
    return (
        <div className="w-6 flex items-center justify-center self-stretch shrink-0">
            <svg viewBox="0 0 24 24" className="w-full h-4 text-line" fill="none" stroke="currentColor" strokeWidth="1.2">
                <line x1="0" y1="12" x2="18" y2="12" />
                <polyline points="14,7 20,12 14,17" />
            </svg>
        </div>
    );
}

export function Bracket({ events }: { events: MatchEvent[] }) {
    const rounds = classifyKnockout(events);
    const hasAny = KNOCKOUT_ROUNDS.some((r) => rounds[r].length > 0);

    if (!hasAny) {
        return <div className="bg-bg-nav border border-line rounded-xl p-6 text-center text-sm text-text-3">暂无淘汰赛对阵</div>;
    }

    return (
        <div className="bg-bg-nav border border-line rounded-xl p-4">
            <div className="overflow-x-auto custom-scrollbar pb-2">
                <div className="inline-flex items-stretch">
                    {KNOCKOUT_ROUNDS.map((r, i) => {
                        const evs = rounds[r];
                        const ph = Math.max(0, ROUND_SLOTS[r] - evs.length);
                        return (
                            <div key={r} className="flex items-stretch">
                                <div className="w-48 flex flex-col gap-2 px-1">
                                    <div className="text-xs font-semibold text-text-2 text-center">
                                        {ROUND_LABELS[r]}
                                        <span className="text-text-4 font-normal ml-1">{evs.length}/{ROUND_SLOTS[r]}</span>
                                    </div>
                                    <div className="flex flex-col gap-2 justify-around flex-1">
                                        {evs.map((e) => <Matchup key={e.id} e={e} />)}
                                        {Array.from({ length: ph }).map((_, k) => <PlaceholderMatchup key={`ph${k}`} />)}
                                    </div>
                                </div>
                                {i < KNOCKOUT_ROUNDS.length - 1 && <AdvanceArrow />}
                            </div>
                        );
                    })}
                </div>
            </div>
            <div className="text-[10px] text-text-3 mt-2">
                → 同色条 = 同一支队，跨轮可跟踪晋级路径；虚线卡 = 待定，随上游完赛自动补全。占位对阵（TBD）的 N 编号 ESPN 不映射实际赛事，故不画精确种子连线。
            </div>
        </div>
    );
}
