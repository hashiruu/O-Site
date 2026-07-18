// 2026 世界杯小组积分榜计算。
// ESPN 不提供 group 字段 + standings 空，分组硬编码（队名 → 组），积分从已结束赛事累加。
import type { MatchEvent } from "./types";

// 48 队 / 12 组（按 ESPN displayName）
export const GROUPS: Record<string, string[]> = {
    A: ["Mexico", "South Africa", "South Korea", "Czechia"],
    B: ["Switzerland", "Canada", "Bosnia-Herzegovina", "Qatar"],
    C: ["Brazil", "Morocco", "Scotland", "Haiti"],
    D: ["United States", "Australia", "Paraguay", "Türkiye"],
    E: ["Germany", "Ivory Coast", "Ecuador", "Curaçao"],
    F: ["Netherlands", "Japan", "Sweden", "Tunisia"],
    G: ["Egypt", "Iran", "Belgium", "New Zealand"],
    H: ["Spain", "Uruguay", "Cape Verde", "Saudi Arabia"],
    I: ["France", "Norway", "Senegal", "Iraq"],
    J: ["Argentina", "Austria", "Algeria", "Jordan"],
    K: ["Colombia", "Portugal", "Congo DR", "Uzbekistan"],
    L: ["England", "Ghana", "Croatia", "Panama"],
};

const NAME_TO_GROUP: Record<string, string> = {};
for (const [g, teams] of Object.entries(GROUPS)) for (const t of teams) NAME_TO_GROUP[t] = g;

export function teamToGroup(name: string): string {
    return NAME_TO_GROUP[name] ?? "";
}

export interface TeamStat {
    name: string;
    group: string;
    logo: string;       // 国旗（ESPN countries logo）
    played: number; w: number; d: number; l: number;
    gf: number; ga: number; pts: number;
    qualify: "in" | "out" | "maybe_in" | "maybe_out";
}

// 排名：积分 → 净胜球 → 进球
function cmp(x: TeamStat, y: TeamStat): number {
    return y.pts - x.pts || (y.gf - y.ga) - (x.gf - x.ga) || y.gf - x.gf;
}

// 从已结束赛事算各组积分榜 + 晋级/淘汰标记
export function computeStandings(events: MatchEvent[]): Record<string, TeamStat[]> {
    const logoMap: Record<string, string> = {};
    for (const e of events) {
        logoMap[e.home.name] = e.home.logo;
        logoMap[e.away.name] = e.away.logo;
    }
    const stats = new Map<string, TeamStat>();
    const get = (name: string): TeamStat | null => {
        const g = teamToGroup(name);
        if (!g) return null; // 占位符（"Group X Winner"/"Round of 32..."）跳过
        if (!stats.has(name)) {
            stats.set(name, { name, group: g, logo: logoMap[name] || "", played: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0, qualify: "out" });
        }
        return stats.get(name)!;
    };

    for (const e of events) {
        if (e.status !== "final") continue;
        if (e.home.score == null || e.away.score == null) continue;
        const hs = +e.home.score, as = +e.away.score;
        if (Number.isNaN(hs) || Number.isNaN(as)) continue;
        const h = get(e.home.name), a = get(e.away.name);
        if (!h || !a) continue;
        h.played++; a.played++;
        h.gf += hs; h.ga += as;
        a.gf += as; a.ga += hs;
        if (hs > as) { h.w++; h.pts += 3; a.l++; }
        else if (hs < as) { h.l++; a.w++; a.pts += 3; }
        else { h.d++; a.d++; h.pts++; a.pts++; }
    }

    const groups: Record<string, TeamStat[]> = {};
    for (const s of stats.values()) (groups[s.group] ??= []).push(s);
    for (const g of Object.keys(groups)) groups[g].sort(cmp);

    // 当前排名：前 2 出线；各组第 3 取成绩最好 8 个出线
    const thirds: TeamStat[] = [];
    for (const g of Object.keys(groups)) if (groups[g][2]) thirds.push(groups[g][2]);
    thirds.sort(cmp);
    const thirdIn = new Set(thirds.slice(0, 8).map((t) => t.name));

    // 区分「确定」与「可能」：组内 4 队都打满 3 场 → 排名确定（前2确定出线 / 第4确定淘汰）。
    // 第 3 名的最佳第三资格：所有 12 组都完赛后即为最终结果（in/out），
    // 只要还有组没踢完才标「可能」——避免小组赛全部结束后仍挂着"可能淘汰"。
    const allComplete = Object.keys(groups).length >= 12
        && Object.values(groups).every((arr) => arr.length >= 4 && arr.every((t) => t.played >= 3));
    for (const g of Object.keys(groups)) {
        const arr = groups[g];
        const complete = arr.every((t) => t.played >= 3);
        arr.forEach((t, i) => {
            const curIn = i < 2 || (i === 2 && thirdIn.has(t.name));
            if (complete) {
                if (i < 2) t.qualify = "in";
                else if (i === 3) t.qualify = "out";
                else if (allComplete) t.qualify = curIn ? "in" : "out";
                else t.qualify = curIn ? "maybe_in" : "maybe_out";
            } else {
                t.qualify = curIn ? "maybe_in" : "maybe_out";
            }
        });
    }

    return groups;
}
