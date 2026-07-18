// 淘汰赛 bracket 工具：直接用 ESPN event.season.slug（官方轮次标记）分类，不做任何推断。
// ESPN 为每场赛事标 slug：group-stage / round-of-32 / round-of-16 / quarterfinals /
// semifinal / final。已结束场的胜者由 ESPN 填进下游轮对应位（如加拿大胜 R32 → 出现在 R16）。
import type { MatchEvent, MatchTeam } from "./types";

export type KnockoutRound = "R32" | "R16" | "QF" | "SF" | "Third" | "Final";
export const KNOCKOUT_ROUNDS: KnockoutRound[] = ["R32", "R16", "QF", "SF", "Third", "Final"];
export const ROUND_LABELS: Record<KnockoutRound, string> = {
    R32: "32强", R16: "16强", QF: "8强", SF: "4强", Final: "决赛",
    Third: "季军赛",
};

// ESPN season.slug → 淘汰赛轮次（group-stage / 空 → 小组赛，不在此表）
const SLUG_ROUND: Record<string, KnockoutRound> = {
    "round-of-32": "R32",
    "round-of-16": "R16",
    "quarterfinals": "QF",
    "quarterfinal": "QF",
    "semifinals": "SF",
    "semifinal": "SF",
    "final": "Final",
    "third-place-playoff": "Third",
    "third-place": "Third",
    "third-place-final": "Third",
    "3rd-place-final": "Third",
};

/** 是否占位符队名（淘汰赛未定对阵）—— handleWatch 用，占位不可点播 */
export function isKnockoutPlaceholder(name: string): boolean {
    return /^(Group |Round of |Quarterfinal|Semifinal|Third Place)/.test(name) || /\b(Winner|Place)\b/.test(name);
}

/** 赛事是否属淘汰赛：ESPN slug 标为淘汰轮次（兜底：无 slug 时看占位符队名） */
export function isKnockoutEvent(e: MatchEvent): boolean {
    if (SLUG_ROUND[e.roundSlug]) return true;
    return isKnockoutPlaceholder(e.home.name) || isKnockoutPlaceholder(e.away.name);
}

/** 淘汰赛按轮分类（直接用 ESPN slug）。**保留 ESPN 原始顺序**（= bracket slot 编号），不排序——
 *  R16/QF 占位的 "Round of 32 N Winner" 的 N 对应此顺序，排序会破坏配对映射。 */
export function classifyKnockout(events: MatchEvent[]): Record<KnockoutRound, MatchEvent[]> {
    const out: Record<KnockoutRound, MatchEvent[]> = { R32: [], R16: [], QF: [], SF: [], Third: [], Final: [] };
    for (const e of events) {
        // 季军赛 slug 各赛事命名不一，兜底按关键词归类
        const r = SLUG_ROUND[e.roundSlug]
            || (/third|3rd/i.test(e.roundSlug || "") ? "Third" as const : undefined);
        if (r) out[r].push(e);
    }
    return out;
}

/** 已结束场的胜方：优先 ESPN 官方 winner 字段（点球 0-0 也有值），兜底常规比分 */
export function winnerSide(e: MatchEvent): "h" | "a" | null {
    if (e.status !== "final") return null;
    if (e.home.winner === true) return "h";
    if (e.away.winner === true) return "a";
    if (e.home.score == null || e.away.score == null) return null;
    if (+e.home.score > +e.away.score) return "h";
    if (+e.away.score > +e.home.score) return "a";
    return null; // 平局且无 winner 字段（旧缓存点球场）→ 无法判定
}

export function winnerTeam(e: MatchEvent | undefined): MatchTeam | null {
    if (!e) return null;
    const w = winnerSide(e);
    return w === "h" ? e.home : w === "a" ? e.away : null;
}

/** SF 标准配对：SF0 = QF0+QF1 胜者，SF1 = QF2+QF3 胜者（FIFA M101=W97vW98, M102=W99vW100） */
export const SF_PAIRS: [number, number][] = [[0, 1], [2, 3]];

export interface SemiSeat { team: MatchTeam | null; win: boolean }
export interface SemiInfo { event: MatchEvent | null; seats: [SemiSeat, SemiSeat] }

/**
 * SF 两场的座位推导。ESPN 在 QF 结束后才建 SF 赛事（世界杯 104 场，QF 阶段 scoreboard 只有 100 场），
 * 因此 QF 胜者不能只靠"ESPN 填进下游轮"显示——无 SF 赛事（或其座位仍是占位符）时由 QF 结果本地合成。
 * 有真实 SF 赛事时按队名/占位符映射到所属半区（不信 scoreboard 数组顺序，与 R16/QF 的 slot 逻辑一致）。
 * seats[0] 恒为 SF_PAIRS[s][0]（即 QF 2s）一侧，保证圆形图连线两侧不交叉。
 */
export function deriveSemis(qf: MatchEvent[], sf: MatchEvent[]): [SemiInfo, SemiInfo] {
    // 队名 → QF 索引；"Quarterfinal N Winner" 占位 → N-1
    const tQF = new Map<string, number>();
    qf.forEach((e, i) => {
        if (!isKnockoutPlaceholder(e.home.name)) tQF.set(e.home.name, i);
        if (!isKnockoutPlaceholder(e.away.name)) tQF.set(e.away.name, i);
    });
    const slotQF = (n: string): number | null => {
        const m = n.match(/^Quarterfinal (\d+) Winner$/);
        if (m) return +m[1] - 1;
        return tQF.has(n) ? tQF.get(n)! : null;
    };

    // 真实 SF 赛事归属半区：任一队解析出的 QF 索引命中该半区配对即归入；解析不出按数组顺序兜底
    const sfEvent: (MatchEvent | null)[] = [null, null];
    sf.forEach((e, i) => {
        const qs = [slotQF(e.home.name), slotQF(e.away.name)].filter((x): x is number => x != null);
        let s = SF_PAIRS.findIndex((p) => qs.some((x) => p.includes(x)));
        if (s < 0) s = Math.min(i, 1);
        if (!sfEvent[s]) sfEvent[s] = e;
    });

    return [0, 1].map((s) => {
        const e = sfEvent[s];
        const seats: [SemiSeat, SemiSeat] = [{ team: null, win: false }, { team: null, win: false }];
        if (e) {
            const w = winnerSide(e);
            for (const side of ["home", "away"] as const) {
                const t = side === "home" ? e.home : e.away;
                if (isKnockoutPlaceholder(t.name)) continue;
                // 属 QF(2s+1) 一侧 → 座位1，否则座位0（含解析失败的兜底）
                const k = slotQF(t.name) === SF_PAIRS[s][1] ? 1 : 0;
                seats[k] = { team: t, win: w === (side === "home" ? "h" : "a") };
            }
        }
        // 空座位由对应 QF 胜者合成（win 恒 false：QF 的 winner 字段是上一轮的胜利，不能带进 SF）
        for (const k of [0, 1] as const) {
            if (!seats[k].team) seats[k] = { team: winnerTeam(qf[SF_PAIRS[s][k]]), win: false };
        }
        return { event: e, seats };
    }) as [SemiInfo, SemiInfo];
}

/** 占位符队名缩短显示（避免长串占位符撑爆列宽） */
const CIRCLED = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩", "⑪", "⑫", "⑬", "⑭", "⑮", "⑯"];
function circled(n: number): string {
    return n >= 1 && n <= 16 ? CIRCLED[n - 1] : `第${n}场`;
}
export function shortName(name: string): string {
    let m;
    if ((m = name.match(/^Group ([A-L]) Winner$/))) return `${m[1]}组第1`;
    if ((m = name.match(/^Group ([A-L]) 2nd Place$/))) return `${m[1]}组第2`;
    if ((m = name.match(/^Third Place Group (.+)$/))) return `最佳第三(${m[1]})`;
    if ((m = name.match(/^Round of 32 (\d+) Winner$/))) return `32强${circled(+m[1])}胜者`;
    if ((m = name.match(/^Round of 16 (\d+) Winner$/))) return `16强${circled(+m[1])}胜者`;
    if ((m = name.match(/^Quarterfinal (\d+) Winner$/))) return `八强${circled(+m[1])}胜者`;
    if ((m = name.match(/^Semifinal (\d+) Winner$/))) return `四强${circled(+m[1])}胜者`;
    return name;
}
