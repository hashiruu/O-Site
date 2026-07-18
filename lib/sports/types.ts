// /sports 赛程 dashboard 共享类型
// ESPN scoreboard 原始字段 → 统一前端友好格式（见 api/sports/schedule 转换）

export interface MatchTeam {
    name: string;
    logo: string;        // ESPN 队徽 URL
    color: string;       // 队色 hex（无 #），用于卡片点缀
    score: string | null; // 比分；未开始为 null
    record: string;      // "0-1-2" 胜-平-负
    pts: number;         // 积分（W*3 + D*1，由 record 换算）
    winner?: boolean;    // ESPN 官方胜负判定（含点球，如 0-0 FT-Pens 也有值）；旧缓存/未结束为 undefined
}

export type MatchStatus = "scheduled" | "live" | "final";

export interface MatchEvent {
    id: string;
    dateUtc: string;          // ISO UTC，如 "2026-06-25T20:00Z"
    timeEt: string;           // 美东 24h "HH:mm"
    home: MatchTeam;
    away: MatchTeam;
    status: MatchStatus;
    statusDetail: string;     // "FT" / "23'" / "HT" / "20:00"
    stage: string;            // "Group Stage" / "Round of 32" ...
    roundSlug: string;        // ESPN event.season.slug：group-stage / round-of-32 / round-of-16 / quarterfinals / semifinal / final
    venue: string;
    eliminated: "home" | "away" | null; // 淘汰判定 → 盖斩杀条
}

export interface ScheduleData {
    leagueName: string;       // "FIFA World Cup"
    season: number;           // 2026
    stage: string;            // 当前阶段
    events: MatchEvent[];
    fetchedAt: number;        // 服务端抓取时间戳（ms）
}
