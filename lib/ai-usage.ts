// AI 用量与账单：记录每次 DeepSeek 调用消耗的 token，按组件汇总、按 DeepSeek 定价算钱。
// 全站口径（所有用户合并）。写入是 fire-and-forget，绝不因记账失败影响正常接口返回。
//
// 计费依据（deepseek-chat 现路由到 V4 Flash 非思考模式；模型名 2026-07-24 弃用，届时改 deepseek-v4-flash）：
//   输入·缓存命中  $0.028 / 1M   （官方 $0.0028/1M，这里以 1M 计的美分）
//   输入·缓存未命中 $0.14  / 1M
//   输出          $0.28  / 1M
// 采用 Anthropic 兼容端语义：usage.input_tokens 为「未命中缓存」的输入，cache_read_input_tokens 为命中部分。
import { getDb } from "@/lib/db";

// 每 1M token 的美元单价（改价只动这里，历史用量按新价重算）
export const DS_PRICE = {
    inputMiss: 0.14,   // 输入·缓存未命中
    cacheHit: 0.0028,  // 输入·缓存命中
    output: 0.28,      // 输出
};

// 组件键 → 中文名（管理后台展示用）
export const AI_COMPONENTS: Record<string, string> = {
    characters: "人物识别 / AI 解读",
    ask: "疑问助手 / 直接问",
    relations: "关系图（连线机制）",
    mood: "温度感知（故事温度）",
};

let ensured = false;
function ensureTable() {
    if (ensured) return;
    getDb().exec(`
        CREATE TABLE IF NOT EXISTS ai_usage (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            component TEXT NOT NULL,          -- characters | ask | relations | mood
            model TEXT NOT NULL DEFAULT '',
            input_tokens INTEGER NOT NULL DEFAULT 0,   -- 缓存未命中的输入
            cache_tokens INTEGER NOT NULL DEFAULT 0,   -- 缓存命中的输入
            output_tokens INTEGER NOT NULL DEFAULT 0,
            user_id TEXT NOT NULL DEFAULT '',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_ai_usage_comp ON ai_usage(component, created_at);
    `);
    ensured = true;
}

interface RawUsage {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
}

/** 记一次调用的用量。usage 直接传 DeepSeek 响应里的 data.usage。永不抛错。 */
export function recordUsage(component: string, model: string, usage: RawUsage | undefined | null, userId = "") {
    try {
        if (!usage) return;
        const input = Math.max(0, Math.round(usage.input_tokens || 0));
        const cache = Math.max(0, Math.round(usage.cache_read_input_tokens || 0));
        const output = Math.max(0, Math.round(usage.output_tokens || 0));
        if (input + cache + output === 0) return; // 缓存命中零消耗的本地缓存路径不用记
        ensureTable();
        getDb().prepare(
            "INSERT INTO ai_usage (component, model, input_tokens, cache_tokens, output_tokens, user_id) VALUES (?, ?, ?, ?, ?, ?)"
        ).run(component, model || "", input, cache, output, userId || "");
    } catch { /* 记账失败绝不影响主流程 */ }
}

/** 一段 token 明细 → 美元花费 */
export function costOf(inputTokens: number, cacheTokens: number, outputTokens: number): number {
    return (
        (inputTokens / 1_000_000) * DS_PRICE.inputMiss +
        (cacheTokens / 1_000_000) * DS_PRICE.cacheHit +
        (outputTokens / 1_000_000) * DS_PRICE.output
    );
}

export interface UsageRow {
    component: string;
    label: string;
    calls: number;
    inputTokens: number;
    cacheTokens: number;
    outputTokens: number;
    totalTokens: number;
    costUsd: number;
}

export interface UsageSummary {
    components: UsageRow[];
    total: UsageRow;
    since: string | null;   // 最早一条的时间
    price: typeof DS_PRICE;
}

/** 全站用量汇总（按组件分组 + 合计）。 */
export function getUsageSummary(): UsageSummary {
    ensureTable();
    const db = getDb();
    const rows = db.prepare(`
        SELECT component,
               COUNT(*) AS calls,
               COALESCE(SUM(input_tokens),0)  AS inputTokens,
               COALESCE(SUM(cache_tokens),0)  AS cacheTokens,
               COALESCE(SUM(output_tokens),0) AS outputTokens
        FROM ai_usage GROUP BY component
    `).all() as { component: string; calls: number; inputTokens: number; cacheTokens: number; outputTokens: number }[];

    const since = (db.prepare("SELECT MIN(created_at) AS t FROM ai_usage").get() as { t: string | null }).t;

    const components: UsageRow[] = [];
    const total: UsageRow = { component: "__total__", label: "合计", calls: 0, inputTokens: 0, cacheTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0 };

    // 保证四个组件都出现（即使还没用过，显示 0）
    const byComp = new Map(rows.map((r) => [r.component, r]));
    for (const key of Object.keys(AI_COMPONENTS)) {
        const r = byComp.get(key) || { component: key, calls: 0, inputTokens: 0, cacheTokens: 0, outputTokens: 0 };
        const totalTokens = r.inputTokens + r.cacheTokens + r.outputTokens;
        const costUsd = costOf(r.inputTokens, r.cacheTokens, r.outputTokens);
        components.push({ component: key, label: AI_COMPONENTS[key], calls: r.calls, inputTokens: r.inputTokens, cacheTokens: r.cacheTokens, outputTokens: r.outputTokens, totalTokens, costUsd });
        total.calls += r.calls; total.inputTokens += r.inputTokens; total.cacheTokens += r.cacheTokens; total.outputTokens += r.outputTokens;
    }
    // 未知组件（未来新增没登记的）也并进合计
    for (const r of rows) {
        if (AI_COMPONENTS[r.component]) continue;
        total.calls += r.calls; total.inputTokens += r.inputTokens; total.cacheTokens += r.cacheTokens; total.outputTokens += r.outputTokens;
    }
    total.totalTokens = total.inputTokens + total.cacheTokens + total.outputTokens;
    total.costUsd = costOf(total.inputTokens, total.cacheTokens, total.outputTokens);
    components.sort((a, b) => b.costUsd - a.costUsd);
    return { components, total, since, price: DS_PRICE };
}
