"use client";

// 淘汰赛 bracket 圆形可视化（借鉴 @paul__ux FWC26 Circle Draw）。
// 5 层同心圆：R32(外)→R16→QF→SF→Final(圆心🏆)。
// 配对按 ESPN bracket slot：从 R16/QF 占位的 "Round of 32/16 N Winner" 解析 N，
//   节点位置 = 配对两 slot 的角度中点（V 形对称，顶点与该场弦重合）。
// 胜者金环 + 路径高亮 = 显示晋级（判定优先 ESPN winner 字段，点球 0-0 也能判）；每场外侧标日期时间。
// SF 环：ESPN 在 QF 结束后才建 SF 赛事，未建时由 QF 胜者本地合成座位（见 lib/sports/bracket deriveSemis）。
import type { MatchEvent, MatchTeam } from "../../lib/sports/types";
import { classifyKnockout, winnerSide, deriveSemis, SF_PAIRS } from "../../lib/sports/bracket";

const SIZE = 860;
const C = SIZE / 2;
const R = [350, 245, 158, 82, 0];                              // R32/R16/QF/SF/Final 半径
const D = [Math.PI / 32, Math.PI / 16, Math.PI / 8, Math.PI / 5]; // 各层场内两队角度偏移
const FLAG = [30, 26, 24, 22];
const PH = /^(Group |Round of |Quarterfinal|Semifinal|Third Place)|\b(Winner|Place)\b/;
// 2026 WC：ESPN "Round of 32 N Winner" 的 N（= FIFA Match 编号 − 72）→ ESPN scoreboard R32 index 映射。
// ESPN 的 N ≠ scoreboard 顺序（N 是 bracket 编号），从 Wikipedia knockout 页 Match 编号+小组出线表反推：
// Match73(2Av2B)=idx0, Match74(1Ev3D)=idx2, Match75(1Fv2C)=idx3, Match76(1Cv2F=Brazil)=idx1, ... Match88(2Dv2G)=idx13。
// 本届赛程固定，硬编码；下届须重算。让占位(N映射)与填队(队名匹配)结果一致 → 配对准确且不跳变。
const N_TO_INDEX: number[] = [0, 2, 3, 1, 5, 4, 6, 7, 9, 8, 11, 10, 12, 14, 15, 13];

const pt = (r: number, a: number): [number, number] => [C + r * Math.cos(a), C + r * Math.sin(a)];
const midPt = (p: [number, number], q: [number, number]): [number, number] => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
const teamPos = (L: number, a: number, s: "h" | "a") => pt(R[L], a + (s === "h" ? -D[L] : D[L]));
const chordMid = (L: number, a: number) => midPt(teamPos(L, a, "h"), teamPos(L, a, "a"));

function dateLabel(d: string): string {
    if (!d) return "";
    try { return new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "numeric", day: "numeric" }).format(new Date(d)); }
    catch { return ""; }
}
function timeLabel(d: string): string {
    if (!d) return "";
    try { return new Intl.DateTimeFormat("zh-CN", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(d)); }
    catch { return ""; }
}
// ring：名次色环（金=冠军 / 银=亚军 / 铜=季军），给了 ring 就盖过普通晋级环
function FlagNode({ team, pos, size, win, ring }: { team: MatchTeam; pos: [number, number]; size: number; win: boolean; ring?: string }) {
    const [x, y] = pos; const h = size / 2;
    return (
        <g>
            {ring
                ? <circle cx={x} cy={y} r={h + 4} fill="none" stroke={ring} strokeWidth={3.5} />
                : win && <circle cx={x} cy={y} r={h + 4} fill="none" stroke="currentColor" strokeWidth={3} className="text-primary" />}
            {team.logo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <image href={team.logo} x={x - h} y={y - h} width={size} height={size} />
            ) : (
                <circle cx={x} cy={y} r={h} className="fill-bg-tag" />
            )}
            <title>{team.name}</title>
        </g>
    );
}

const GOLD = "#FCC419", SILVER = "#B9C2CC", BRONZE = "#C77B30"; // 冠/亚/季军色环

export function BracketCircle({ events }: { events: MatchEvent[] }) {
    const rounds = classifyKnockout(events);
    const r32 = rounds.R32, r16 = rounds.R16, qf = rounds.QF;
    if (r32.length === 0) {
        return <div className="bg-bg-nav border border-line rounded-xl p-6 text-center text-sm text-text-3">暂无淘汰赛对阵</div>;
    }

    // slot 映射：队名 → R32 slot；占位 "Round of 32 N Winner" → N-1
    const t32 = new Map<string, number>();
    r32.forEach((e, i) => { t32.set(e.home.name, i); t32.set(e.away.name, i); });
    const slot32 = (n: string): number | null => {
        const m = n.match(/Round of 32 (\d+) Winner/);
        if (m) { const idx = N_TO_INDEX[+m[1] - 1]; return idx !== undefined ? idx : null; }
        return t32.has(n) ? t32.get(n)! : null; // 实际队：队名匹配（结果与 N_TO_INDEX 一致）
    };
    const r16src = r16.map((e) => [slot32(e.home.name), slot32(e.away.name)] as [number | null, number | null]);
    const t16 = new Map<string, number>();
    r16.forEach((e, i) => { if (!PH.test(e.home.name)) t16.set(e.home.name, i); if (!PH.test(e.away.name)) t16.set(e.away.name, i); });
    const slot16 = (n: string): number | null => {
        const m = n.match(/Round of 16 (\d+) Winner/); if (m) return +m[1] - 1;
        return t16.has(n) ? t16.get(n)! : null;
    };
    const qfsrc = qf.map((e) => [slot16(e.home.name), slot16(e.away.name)] as [number | null, number | null]);

    // R32 圆周顺序 = bracket 树中序遍历：让每轮配对的两队在圆周相邻，
    // 路径从圆周向心局部收敛、不跨心（避免"对角线"乱象）。同一侧的小组在同一半圆会师决赛。
    const inR16 = (k: number): number[] => (r16src[k] ?? []).filter((x): x is number => x != null);
    const inQF = (j: number): number[] => {
        const [c, d] = qfsrc[j] ?? [null, null];
        return [...(c != null ? inR16(c) : []), ...(d != null ? inR16(d) : [])];
    };
    const inSF = (s: number): number[] => [...inQF(SF_PAIRS[s][0]), ...inQF(SF_PAIRS[s][1])];
    // SF 座位：ESPN 建了 SF 赛事就按队名/占位映射半区；否则由 QF 胜者本地合成（ESPN 在 QF 结束后才建 SF）
    const semis = deriveSemis(qf, rounds.SF);
    const r32Order = [...inSF(0), ...inSF(1)];
    const slotPos = new Map<number, number>();
    r32Order.forEach((slot, pos) => slotPos.set(slot, pos));
    r32.forEach((_, i) => { if (!slotPos.has(i)) slotPos.set(i, i); }); // 数据不全时兜底

    // 各层节点角度：R32 按中序圆周位置；R16/QF = 配对两 slot 角度中点（V 形对称、局部不跨心）
    const a32 = (slot: number) => -Math.PI / 2 + ((slotPos.get(slot) ?? slot) + 0.5) * 2 * Math.PI / 16;
    const a16 = (k: number) => {
        const [a, b] = r16src[k] ?? [null, null];
        if (a == null || b == null) return -Math.PI / 2 + (k + 0.5) * 2 * Math.PI / 8;
        return (a32(a) + a32(b)) / 2;
    };
    const aQF = (j: number) => {
        const [c, d] = qfsrc[j] ?? [null, null];
        if (c == null || d == null) return -Math.PI / 2 + (j + 0.5) * 2 * Math.PI / 4;
        return (a16(c) + a16(d)) / 2;
    };
    const aSF = (s: number) => (aQF(2 * s) + aQF(2 * s + 1)) / 2;

    const Link = ({ p, q, w, k }: { p: [number, number]; q: [number, number]; w: "h" | "a" | null; k: string }) => (
        <line x1={p[0]} y1={p[1]} x2={q[0]} y2={q[1]} stroke="currentColor" strokeWidth={w ? 2.5 : 1} className={w ? "text-primary" : ""} />
    );

    return (
        <div className="bg-bg-nav border border-line rounded-xl p-4">
            <div className="overflow-x-auto custom-scrollbar">
                <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="w-full max-w-[860px] mx-auto block text-line">
                    {/* 同心圆轨道 */}
                    {[0, 1, 2, 3].map((i) => (
                        <circle key={i} cx={C} cy={C} r={R[i]} fill="none" stroke="currentColor" strokeWidth={1} className="opacity-20" />
                    ))}

                    {/* R32 → R16（slot 配对）：两 R32 弦中点 → R16 弦中点 */}
                    {r16.map((e, k) => {
                        const [sa, sb] = r16src[k]; const top = chordMid(1, a16(k));
                        const wA = sa != null && sa < r32.length ? winnerSide(r32[sa]) : null;
                        const wB = sb != null && sb < r32.length ? winnerSide(r32[sb]) : null;
                        return (
                            <g key={`v1-${k}`}>
                                {sa != null && <Link p={chordMid(0, a32(sa))} q={top} w={wA} k={`a${k}`} />}
                                {sb != null && <Link p={chordMid(0, a32(sb))} q={top} w={wB} k={`b${k}`} />}
                            </g>
                        );
                    })}
                    {/* R16 → QF */}
                    {qf.map((e, j) => {
                        const [c, d] = qfsrc[j]; const top = chordMid(2, aQF(j));
                        const wC = c != null && c < r16.length ? winnerSide(r16[c]) : null;
                        const wD = d != null && d < r16.length ? winnerSide(r16[d]) : null;
                        return (
                            <g key={`v2-${j}`}>
                                {c != null && <Link p={chordMid(1, a16(c))} q={top} w={wC} k={`c${j}`} />}
                                {d != null && <Link p={chordMid(1, a16(d))} q={top} w={wD} k={`d${j}`} />}
                            </g>
                        );
                    })}
                    {/* QF → SF（标准 QF0+1→SF0, QF2+3→SF1）：汇聚到 SF 座位弦中点，和其它环一致 */}
                    {[0, 1].map((s) => {
                        const top = chordMid(3, aSF(s));
                        const wA = qf[2 * s] ? winnerSide(qf[2 * s]) : null;
                        const wB = qf[2 * s + 1] ? winnerSide(qf[2 * s + 1]) : null;
                        return (
                            <g key={`v3-${s}`}>
                                <Link p={chordMid(2, aQF(2 * s))} q={top} w={wA} k={`e${s}`} />
                                <Link p={chordMid(2, aQF(2 * s + 1))} q={top} w={wB} k={`f${s}`} />
                            </g>
                        );
                    })}
                    {/* SF → Final：延伸到各自半区的决赛座位（半径 46 处），不再直捣圆心 */}
                    {[0, 1].map((s) => (
                        <Link key={`v4-${s}`} p={chordMid(3, aSF(s))} q={pt(46, aSF(s))}
                            w={semis[s].event ? winnerSide(semis[s].event!) : null} k={`g${s}`} />
                    ))}

                    {/* 每层 弦 + 两国旗（R32/R16/QF） */}
                    {([
                        { evs: r32, L: 0, af: a32 },
                        { evs: r16, L: 1, af: a16 },
                        { evs: qf, L: 2, af: aQF },
                    ] as const).map(({ evs, L, af }, li) =>
                        evs.map((e, i) => {
                            const a = af(i); const w = winnerSide(e);
                            return (
                                <g key={`m${li}-${i}`}>
                                    <line x1={teamPos(L, a, "h")[0]} y1={teamPos(L, a, "h")[1]}
                                        x2={teamPos(L, a, "a")[0]} y2={teamPos(L, a, "a")[1]}
                                        stroke="currentColor" strokeWidth={w ? 2 : 1.2}
                                        className={w ? "text-primary" : "text-line"} opacity={0.7} />
                                    <FlagNode team={e.home} pos={teamPos(L, a, "h")} size={FLAG[L]} win={w === "h"} />
                                    <FlagNode team={e.away} pos={teamPos(L, a, "a")} size={FLAG[L]} win={w === "a"} />
                                </g>
                            );
                        })
                    )}

                    {/* SF（最内环）：每场两座位，座位0 = 对应 QF(2s) 一侧（与连线同侧不交叉）。
                        QF 胜者出来一个填一个（ESPN 未建 SF 赛事时本地合成），未定座位保持空点 */}
                    {(() => {
                        // 季军：季军赛打完后，SF 环上的这支队画铜圈
                        const te = rounds.Third[0];
                        const tw = te ? winnerSide(te) : null;
                        const thirdName = tw ? (tw === "h" ? te.home.name : te.away.name) : null;
                        return [0, 1].map((s) => {
                            const a = aSF(s);
                            const w = semis[s].event ? winnerSide(semis[s].event!) : null;
                            const pos: [number, number][] = [teamPos(3, a, "h"), teamPos(3, a, "a")];
                            return (
                                <g key={`sf${s}`}>
                                    <line x1={pos[0][0]} y1={pos[0][1]} x2={pos[1][0]} y2={pos[1][1]} stroke="currentColor"
                                        strokeWidth={w ? 2 : 1.2} className={w ? "text-primary" : "text-line"} opacity={0.7} />
                                    {semis[s].seats.map((seat, k) =>
                                        seat.team ? (
                                            <FlagNode key={k} team={seat.team} pos={pos[k]} size={FLAG[3]} win={seat.win}
                                                ring={thirdName && seat.team.name === thirdName ? BRONZE : undefined} />
                                        ) : (
                                            <circle key={k} cx={pos[k][0]} cy={pos[k][1]} r={FLAG[3] / 2} className="fill-bg-tag" />
                                        )
                                    )}
                                </g>
                            );
                        });
                    })()}

                    {/* R32 日期时间（外圈外侧） */}
                    {r32.map((e, i) => {
                        const d = dateLabel(e.dateUtc); if (!d) return null;
                        const [x, y] = pt(R[0] + 42, a32(i));
                        return (
                            <text key={`d${i}`} x={x} y={y} fontSize={12} fill="currentColor"
                                className="text-text-3" textAnchor="middle" dominantBaseline="middle">
                                {d} {timeLabel(e.dateUtc)}
                            </text>
                        );
                    })}

                    {/* R16 / QF 日期时间：标在各场弦的径向外侧（已结束的不标，避免内圈拥挤） */}
                    {([
                        { evs: r16, af: a16, r: R[1] + 24, fs: 11 },
                        { evs: qf, af: aQF, r: R[2] + 22, fs: 11 },
                    ] as const).map(({ evs, af, r, fs }, li) =>
                        evs.map((e, i) => {
                            if (e.status === "final") return null;
                            const d = dateLabel(e.dateUtc); if (!d) return null;
                            const [x, y] = pt(r, af(i));
                            return (
                                <text key={`t${li}-${i}`} x={x} y={y} fontSize={fs} fill="currentColor"
                                    className="text-text-3" textAnchor="middle" dominantBaseline="middle">
                                    {d} {timeLabel(e.dateUtc)}
                                </text>
                            );
                        })
                    )}

                    {/* SF 日期时间（节点内侧，靠圆心一格）：只有 ESPN 真实 SF 赛事才有日期，合成座位不标 */}
                    {semis.map(({ event: e }, s) => {
                        if (!e || e.status === "final") return null;
                        const d = dateLabel(e.dateUtc); if (!d) return null;
                        const [x, y] = pt(R[3] + 22, aSF(s));
                        return (
                            <text key={`sf-t${s}`} x={x} y={y} fontSize={10} fill="currentColor"
                                className="text-text-3" textAnchor="middle" dominantBaseline="middle">
                                {d} {timeLabel(e.dateUtc)}
                            </text>
                        );
                    })}

                    {/* 决赛座位：四强向心延伸线的末端各一个（同半区同角度），中间不留连线——
                        冠军由圆心的圈（🏆 + 胜者金环）表达。ESPN 建了 Final 且非占位 → 直接用（含胜者高亮）；
                        未建时由 SF 胜者本地合成；SF 未打完的一侧保持空点，位置永远预留 */}
                    {(() => {
                        const fe = rounds.Final[0];
                        const real = fe && !PH.test(fe.home.name) && !PH.test(fe.away.name);
                        const fw = real ? winnerSide(fe) : null;
                        // 半区归位：真实 Final 的两队按所在半区对号入座（跟连线同侧，不交叉）
                        const sfWinner = (s2: number): MatchTeam | null => {
                            const e = semis[s2].event;
                            if (e && e.status === "final") {
                                const w2 = winnerSide(e);
                                if (w2) return w2 === "h" ? e.home : e.away;
                            }
                            return null;
                        };
                        const seats: { team: MatchTeam | null; win: boolean }[] = [0, 1].map((s2) => {
                            if (real) {
                                const local = sfWinner(s2);
                                const homeHere = local ? local.name === fe.home.name : s2 === 0;
                                const t = homeHere ? fe.home : fe.away;
                                return { team: t, win: fw === (homeHere ? "h" : "a") };
                            }
                            return { team: sfWinner(s2), win: false };
                        });
                        return (
                            <g>
                                {seats.map((seat, k) => {
                                    const pos = pt(46, aSF(k));
                                    // 决赛出结果：冠军金圈、亚军银圈；未分胜负时普通节点
                                    const ring = fw ? (seat.win ? GOLD : SILVER) : undefined;
                                    return seat.team ? (
                                        <FlagNode key={k} team={seat.team} pos={pos} size={FLAG[3]} win={seat.win} ring={ring} />
                                    ) : (
                                        <circle key={k} cx={pos[0]} cy={pos[1]} r={FLAG[3] / 2} className="fill-bg-tag" />
                                    );
                                })}
                            </g>
                        );
                    })()}
                    <text x={C} y={C + 10} fontSize={30} textAnchor="middle">🏆</text>
                    <text x={C} y={C + 32} fontSize={11} textAnchor="middle" fill="currentColor" className="text-text-3">决赛</text>
                    {/* 决赛日期时间（圆心下方） */}
                    {rounds.Final[0] && dateLabel(rounds.Final[0].dateUtc) && (
                        <text x={C} y={C + 48} fontSize={10} textAnchor="middle" fill="currentColor" className="text-text-3">
                            {dateLabel(rounds.Final[0].dateUtc)} {timeLabel(rounds.Final[0].dateUtc)}
                        </text>
                    )}
                </svg>
            </div>
            <div className="text-[10px] text-text-3 mt-2">
                → 外→内：32强→16强→8强→4强→决赛。<span className="text-primary">高亮环 + 高亮连线 = 已晋级</span>；名次色环：<span style={{ color: "#FCC419" }}>金 = 冠军</span> · <span style={{ color: "#8f9aa6" }}>银 = 亚军</span> · <span style={{ color: "#C77B30" }}>铜 = 季军</span>（季军赛出结果后画在 4 强环上）。胜者随 ESPN 更新（60s）自动填入下层；ESPN 尚未排出 4 强赛事时，4 强座位由 8 强胜者本地推得（无日期）。
            </div>
        </div>
    );
}
