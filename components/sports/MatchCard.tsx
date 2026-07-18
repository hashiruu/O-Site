"use client";

// 单场赛程卡片：四态（LIVE/未开始/已结束/已淘汰）。
// 已结束 → 每队标中文结果（胜/负/平）+ 积分 + 比分，赢家高亮。
// 淘汰斩杀条只盖被淘汰那一队所在的行。点击 → 父级匹配直播源。
import type { MatchEvent, MatchTeam } from "../../lib/sports/types";
import { KillStamp } from "./KillStamp";

type Side = "win" | "loss" | "draw";

export function MatchCard({ event, onClick }: { event: MatchEvent; onClick?: (e: MatchEvent) => void }) {
    const { home, away, status, statusDetail, timeEt, eliminated } = event;
    const live = status === "live";
    const showScore = status !== "scheduled";

    // 终场结果
    let homeRes: Side | undefined;
    let awayRes: Side | undefined;
    if (status === "final" && home.score != null && away.score != null) {
        const h = +home.score, a = +away.score;
        if (h > a) { homeRes = "win"; awayRes = "loss"; }
        else if (h < a) { homeRes = "loss"; awayRes = "win"; }
        else { homeRes = "draw"; awayRes = "draw"; }
    }

    return (
        <button
            type="button"
            onClick={() => onClick?.(event)}
            className={`relative overflow-hidden text-left bg-bg border rounded-xl p-3 transition-all hover:bg-bg-hover active:scale-[0.98] cursor-pointer w-full
                ${live ? "border-primary/60" : "border-line"}`}
        >
            <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] text-text-3 tabular-nums font-semibold">
                    {status === "scheduled" ? timeEt : statusDetail}
                </span>
                {live && (
                    <span className="text-[9px] font-bold text-primary bg-primary/10 rounded-full px-1.5 py-px leading-tight animate-pulse">
                        LIVE
                    </span>
                )}
            </div>

            <TeamRow team={home} result={homeRes} showScore={showScore} dim={eliminated === "home"} kill={eliminated === "home"} />
            <TeamRow team={away} result={awayRes} showScore={showScore} dim={eliminated === "away"} kill={eliminated === "away"} mt />

            {event.venue && (
                <div className="text-[10px] text-text-3 mt-1.5 truncate">{event.venue}</div>
            )}
        </button>
    );
}

function TeamRow({ team, result, showScore, dim, kill, mt }: {
    team: MatchTeam; result?: Side; showScore: boolean; dim?: boolean; kill?: boolean; mt?: boolean;
}) {
    const label = result === "win" ? "胜" : result === "loss" ? "负" : result === "draw" ? "平" : null;
    const nameClass = dim ? "text-text-3 line-through" : result === "win" ? "text-text-1" : "text-text-2";
    return (
        <div className={`relative overflow-hidden flex items-center gap-1.5 ${mt ? "mt-1" : ""} ${kill ? "-mx-3 px-3" : ""}`}>
            {kill && <KillStamp />}
            {team.logo ? (
                <img src={team.logo} alt="" className="relative w-5 h-5 object-contain shrink-0" loading="lazy" />
            ) : (
                <div className="relative w-5 h-5 rounded-full bg-bg-tag shrink-0" />
            )}
            <span className={`relative text-[13px] font-semibold truncate flex-1 ${nameClass}`}>
                {team.name}
            </span>
            {label && (
                <span className={`relative text-[10px] font-bold rounded px-1 leading-tight
                    ${result === "win" ? "bg-primary/15 text-primary" : result === "draw" ? "bg-bg-tag text-text-2" : "bg-bg-tag text-text-3"}`}>
                    {label}
                </span>
            )}
            {team.pts > 0 && (
                <span className="relative text-[10px] text-text-3 tabular-nums">{team.pts}分</span>
            )}
            {showScore && team.score != null && (
                <span className={`relative text-[15px] font-bold tabular-nums w-4 text-right ${dim ? "text-text-3" : result === "win" ? "text-text-1" : "text-text-2"}`}>
                    {team.score}
                </span>
            )}
        </div>
    );
}
