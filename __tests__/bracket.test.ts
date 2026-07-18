// lib/sports/bracket 淘汰赛逻辑测试：胜负判定（含点球）+ SF 座位推导
// 背景 bug（2026-07-10）：ESPN 在 QF 结束后才建 SF 赛事，QF 胜者不显示在 SF 环；
// 点球 0-0 场（瑞士 4-3 哥伦比亚）按比分判胜返回 null，晋级线不高亮。
import { winnerSide, winnerTeam, deriveSemis, SF_PAIRS } from "../lib/sports/bracket";
import type { MatchEvent, MatchTeam } from "../lib/sports/types";

function team(name: string, score: string | null = null, winner?: boolean): MatchTeam {
    return { name, logo: "", color: "666666", score, record: "", pts: 0, winner };
}
function ev(home: MatchTeam, away: MatchTeam, status: MatchEvent["status"] = "final"): MatchEvent {
    return {
        id: "x", dateUtc: "2026-07-09T20:00Z", timeEt: "16:00", home, away, status,
        statusDetail: "FT", stage: "Knockout", roundSlug: "quarterfinals", venue: "", eliminated: null,
    };
}

describe("winnerSide", () => {
    it("常规比分判胜", () => {
        expect(winnerSide(ev(team("France", "2"), team("Morocco", "0")))).toBe("h");
        expect(winnerSide(ev(team("A", "0"), team("B", "1")))).toBe("a");
    });
    it("点球 0-0：用 ESPN winner 字段判胜", () => {
        expect(winnerSide(ev(team("Switzerland", "0", true), team("Colombia", "0", false)))).toBe("h");
    });
    it("未结束 / 平局无 winner 字段 → null", () => {
        expect(winnerSide(ev(team("A", "1"), team("B", "0"), "live"))).toBeNull();
        expect(winnerSide(ev(team("A", "0"), team("B", "0")))).toBeNull();
    });
});

// QF 固定牌桌：QF0 France 胜 Morocco（已结束）、QF1/2/3 未开赛
const QF: MatchEvent[] = [
    ev(team("France", "2", true), team("Morocco", "0", false)),
    ev(team("Spain"), team("Belgium"), "scheduled"),
    ev(team("Norway"), team("England"), "scheduled"),
    ev(team("Argentina"), team("Switzerland"), "scheduled"),
];

describe("deriveSemis", () => {
    it("ESPN 无 SF 赛事：由 QF 胜者本地合成座位（部分完赛只填已知侧）", () => {
        const [sf0, sf1] = deriveSemis(QF, []);
        expect(sf0.event).toBeNull();
        expect(sf0.seats[0].team?.name).toBe("France"); // QF0 胜者 → SF0 座位0
        expect(sf0.seats[0].win).toBe(false);           // QF 的 winner 不能带进 SF
        expect(sf0.seats[1].team).toBeNull();           // QF1 未打完
        expect(sf1.seats[0].team).toBeNull();
        expect(sf1.seats[1].team).toBeNull();
    });

    it("真实 SF 赛事按队名映射半区，不信 scoreboard 数组顺序", () => {
        // 故意把下半区（Norway ∈ QF2）放在数组第一位
        const sfEvents = [
            ev(team("Norway"), team("Argentina"), "scheduled"),
            ev(team("France"), team("Spain"), "scheduled"),
        ];
        const [sf0, sf1] = deriveSemis(QF, sfEvents);
        expect(sf0.seats[0].team?.name).toBe("France");
        expect(sf1.seats[0].team?.name).toBe("Norway");   // QF2 侧 → 座位0
        expect(sf1.seats[1].team?.name).toBe("Argentina"); // QF3 侧 → 座位1
    });

    it("SF 赛事座位是占位符：占位侧回退 QF 胜者合成", () => {
        const sfEvents = [ev(team("France"), team("Quarterfinal 2 Winner"), "scheduled")];
        const [sf0] = deriveSemis(QF, sfEvents);
        expect(sf0.event).not.toBeNull();
        expect(sf0.seats[0].team?.name).toBe("France");
        expect(sf0.seats[1].team).toBeNull(); // QF1 未打完，占位不显示
    });

    it("'Quarterfinal N Winner' 占位赛事归属正确半区", () => {
        const sfEvents = [ev(team("Quarterfinal 3 Winner"), team("Quarterfinal 4 Winner"), "scheduled")];
        const [sf0, sf1] = deriveSemis(QF, sfEvents);
        expect(sf1.event).not.toBeNull(); // QF2/QF3 → 下半区
        expect(sf0.event).toBeNull();
    });

    it("SF 已结束：胜者金环只标在真实 SF 场的胜方", () => {
        const sfEvents = [ev(team("France", "1", true), team("Spain", "0", false))];
        const [sf0] = deriveSemis(QF, sfEvents);
        expect(sf0.seats[0].team?.name).toBe("France");
        expect(sf0.seats[0].win).toBe(true);
        expect(sf0.seats[1].team?.name).toBe("Spain");
        expect(sf0.seats[1].win).toBe(false);
    });
});

describe("winnerTeam", () => {
    it("点球场返回 winner=true 一方", () => {
        const e = ev(team("Switzerland", "0", true), team("Colombia", "0", false));
        expect(winnerTeam(e)?.name).toBe("Switzerland");
        expect(winnerTeam(undefined)).toBeNull();
    });
});

describe("SF_PAIRS", () => {
    it("标准半区配对", () => {
        expect(SF_PAIRS).toEqual([[0, 1], [2, 3]]);
    });
});
