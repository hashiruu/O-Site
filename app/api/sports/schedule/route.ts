// GET /api/sports/schedule → 代理 ESPN 隐藏 API，转成统一前端格式 + 60s 缓存 + 美东 24h
import { NextResponse } from "next/server";
import type { ScheduleData, MatchEvent, MatchTeam, MatchStatus } from "../../../../lib/sports/types";

export const dynamic = "force-dynamic";

const TZ = "America/New_York";
// 全程赛程（100 场：已结束+未开始，均有实际队名）
const ESPN_URL = "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?dates=20260611-20260719";
const CACHE_MS = 60_000;

let cache: { at: number; data: ScheduleData } | null = null;

function etTime(dateUtc: string): string {
    const d = new Date(dateUtc);
    return new Intl.DateTimeFormat("zh-CN", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
}

function mapStatus(name: string): MatchStatus {
    const n = name.toUpperCase();
    if (n.includes("SCHEDULED") || n.includes("POSTPONED") || n.includes("TBD")) return "scheduled";
    if (n.includes("FINAL") || n.includes("FULL_TIME") || n.includes("COMPLETED") || n.includes("ENDED")) return "final";
    return "live"; // in_progress / 等
}

function parseRecord(rec?: string): { w: number; d: number; l: number } | null {
    if (!rec) return null;
    const m = rec.match(/^(\d+)-(\d+)-(\d+)$/);
    return m ? { w: +m[1], d: +m[2], l: +m[3] } : null;
}

export async function GET(): Promise<NextResponse> {
    // 内容范围守卫：sports 栏目需 boss 授权（admin/boss 全开）
    {
        const { getAccess, allows } = await import("@/lib/roles");
        if (!allows(await getAccess(), "sports")) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }
    }
    if (cache && Date.now() - cache.at < CACHE_MS) {
        return NextResponse.json({ success: true, data: cache.data });
    }
    try {
        const res = await fetch(ESPN_URL, { headers: { "User-Agent": "nas-app/1.0" } });
        if (!res.ok) throw new Error(`ESPN ${res.status}`);
        const raw = await res.json();
        const league = raw.leagues?.[0] ?? {};
        const stage: string = league.season?.type?.name ?? "Group Stage";
        const events: any[] = raw.events ?? [];
        const isGroup = /group/i.test(stage);

        const mapped: MatchEvent[] = events.map((e) => {
            const comp = e.competitions?.[0] ?? {};
            const comps: any[] = comp.competitors ?? [];
            const homeRaw = comps.find((c) => c.homeAway === "home") ?? comps[0];
            const awayRaw = comps.find((c) => c.homeAway === "away") ?? comps[1];
            const mkTeam = (c: any): MatchTeam => {
                const rec = c?.records?.[0]?.summary ?? "";
                const r = parseRecord(rec);
                return {
                    name: c?.team?.displayName ?? "TBD",
                    logo: c?.team?.logo ?? "",
                    color: c?.team?.color ?? "666666",
                    score: c?.score ?? null,
                    record: rec,
                    pts: r ? r.w * 3 + r.d : 0,
                    // ESPN 官方胜负（含点球：0-0 FT-Pens 也标 winner），bracket 晋级判定的唯一可靠来源
                    ...(typeof c?.winner === "boolean" ? { winner: c.winner } : {}),
                };
            };
            const home = mkTeam(homeRaw);
            const away = mkTeam(awayRaw);
            const status = mapStatus(e.status?.type?.name ?? "STATUS_SCHEDULED");
            const statusDetail = e.status?.type?.shortDetail ?? (status === "scheduled" ? etTime(e.date) : "");

            // 淘汰判定 → 盖斩杀条
            let eliminated: "home" | "away" | null = null;
            if (!isGroup && status === "final") {
                // 优先 ESPN winner 字段（点球 0-0 常规比分判不出胜负），兜底比分
                if (home.winner === true) eliminated = "away";
                else if (away.winner === true) eliminated = "home";
                else if (home.score != null && away.score != null && home.score !== away.score) {
                    eliminated = +home.score < +away.score ? "home" : "away";
                }
            } else if (isGroup && status === "final") {
                const hr = parseRecord(home.record);
                const ar = parseRecord(away.record);
                if (hr && hr.w === 0 && hr.w + hr.d + hr.l >= 3) eliminated = "home";
                else if (ar && ar.w === 0 && ar.w + ar.d + ar.l >= 3) eliminated = "away";
            }

            return {
                id: String(e.id ?? ""),
                dateUtc: e.date ?? "",
                timeEt: etTime(e.date ?? ""),
                home, away, status, statusDetail, stage,
                roundSlug: String(e?.season?.slug ?? ""),
                venue: comp.venue?.fullName ?? "",
                eliminated,
            } as MatchEvent;
        });

        const data: ScheduleData = {
            leagueName: league.name ?? "FIFA World Cup",
            season: league.season?.year ?? 2026,
            stage, events: mapped, fetchedAt: Date.now(),
        };
        cache = { at: Date.now(), data };
        return NextResponse.json({ success: true, data });
    } catch (e) {
        return NextResponse.json({ success: false, error: (e as Error).message }, { status: 502 });
    }
}
