import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import os from "os";
import path from "path";
import { getDb } from "@/lib/db";
import { resolveUserKeyOrNull } from "@/lib/identity";
import { recordUsage } from "@/lib/ai-usage";

export const dynamic = "force-dynamic";

// ── 个性化问候（首页左卡的"夜深了"升级版） ──
// GET /api/greeting → { head: "夜深了", line: "外面下着小雨，《悖论13》才翻开几页，今晚接着读一点吧。" }
// 输入给 DeepSeek Flash：当下时间/星期 + 当地天气（open-meteo 免 key）+ 这位用户的书影足迹
// （在读的书与进度 / 刚读完的书 / 最近在看的片），要求温情中文、像家人留的便条。
// 缓存：每用户每 3 小时一条（时间段变了问候才该变）；guest / 无 key / 失败 → data:null，前端用默认问候。

const DS_BASE = process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/anthropic";
const DS_MODEL = process.env.DEEPSEEK_GREETING_MODEL || process.env.DEEPSEEK_MOOD_MODEL || "deepseek-chat";
const TZ = "America/New_York"; // 家庭所在时区（与站内其他时间展示一致）

function token(): string | null {
    try { return fs.readFileSync(path.join(os.homedir(), ".config", "deepseek-token"), "utf-8").trim() || null; }
    catch { return null; }
}

// WMO weather code → 中文天气现象
function wmoText(code: number): string {
    if (code === 0) return "晴朗";
    if (code <= 2) return "多云间晴";
    if (code === 3) return "阴天";
    if (code <= 48) return "有雾";
    if (code <= 57) return "毛毛雨";
    if (code <= 67) return "下着雨";
    if (code <= 77) return "下着雪";
    if (code <= 82) return "阵雨";
    if (code <= 86) return "阵雪";
    return "雷雨";
}

const cache = new Map<string, { head: string; line: string }>();

export async function GET(req: NextRequest) {
    const userKey = await resolveUserKeyOrNull(req);
    if (!userKey) return NextResponse.json({ success: true, data: null });

    // 3 小时一个时段：同时段内问候稳定，跨时段自动更新
    const now = new Date();
    const slot = `${now.toISOString().slice(0, 10)}-${Math.floor(now.getUTCHours() / 3)}`;
    const ck = `${userKey}|${slot}`;
    if (cache.has(ck)) return NextResponse.json({ success: true, data: cache.get(ck) });

    const tk = token();
    if (!tk) return NextResponse.json({ success: true, data: null });

    try {
        const db = getDb();
        // 书影足迹：近 10 条阅读（含在读/读完）+ 近 10 条观看——给模型足够的料闲聊
        const reading = db.prepare(
            "SELECT title, percent, updated_at FROM reading_progress WHERE user_id = ? ORDER BY updated_at DESC LIMIT 10"
        ).all(userKey) as { title: string; percent: number; updated_at: string }[];
        let watched: { title: string; completed: number; last: string }[] = [];
        try {
            watched = db.prepare(
                `SELECT m.title AS title, w.completed AS completed, w.last_watched AS last
                 FROM watch_progress w JOIN media m ON m.id = w.media_id
                 WHERE w.user_id = ? ORDER BY w.last_watched DESC LIMIT 10`
            ).all(userKey) as { title: string; completed: number; last: string }[];
        } catch { /* 表结构差异不拖累 */ }

        // 当地天气（open-meteo 免 key；坐标可用 settings.weather_lat/lon 覆盖）
        let weather = "";
        try {
            const latRow = db.prepare("SELECT value FROM settings WHERE key = 'weather_lat'").get() as { value: string } | undefined;
            const lonRow = db.prepare("SELECT value FROM settings WHERE key = 'weather_lon'").get() as { value: string } | undefined;
            const lat = latRow?.value || "40.71", lon = lonRow?.value || "-74.01";
            const wres = await fetch(
                `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&timezone=${encodeURIComponent(TZ)}`,
                { signal: AbortSignal.timeout(8000) }
            );
            if (wres.ok) {
                const w = await wres.json();
                const t = Math.round(w?.current?.temperature_2m ?? NaN);
                const code = w?.current?.weather_code;
                if (!Number.isNaN(t) && typeof code === "number") weather = `${wmoText(code)}，气温 ${t}°C`;
            }
        } catch { /* 没天气就不提天气 */ }

        const timeStr = new Intl.DateTimeFormat("zh-CN", {
            timeZone: TZ, weekday: "long", hour: "2-digit", minute: "2-digit", hour12: false,
        }).format(now);
        const facts: string[] = [`现在：${timeStr}`];
        if (weather) facts.push(`天气：${weather}`);
        if (reading.length) {
            facts.push("最近的阅读记录（从新到旧）：" + reading.map((r) =>
                `《${r.title}》${r.percent >= 98 ? "已读完" : `读到 ${Math.round(r.percent)}%`}（${r.updated_at.slice(5, 10)}）`
            ).join("；"));
        }
        if (watched.length) {
            facts.push("最近的观看记录（从新到旧）：" + watched.map((w) =>
                `《${w.title}》${w.completed ? "看完了" : "还没看完"}（${(w.last || "").slice(5, 10)}）`
            ).join("；"));
        }

        const res = await fetch(`${DS_BASE}/v1/messages`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${tk}`,
                "x-api-key": tk,
                "anthropic-version": "2023-06-01",
            },
            body: JSON.stringify({
                model: DS_MODEL,
                max_tokens: 500,
                thinking: { type: "disabled" },
                system:
                    "你以村上春树的笔触为一家小小的家庭媒体站写门厅问候。根据用户信息写中文，只输出严格 JSON：{\"head\":\"…\",\"line\":\"…\"}\n"
                    + "head：恰好 3 个字、干净利落的时段招呼，只许从这些里选：夜深了、晚上好、下午好、中午好、早上好。"
                    + "禁止「还没睡呀」这类搭话式口语，禁止星期+时段硬拼（「周五凌晨好」），不要具体钟点。\n"
                    + "line：一段 50-80 字（硬上限 90 字，必须在此内完整收尾），村上春树式的语调——平静、疏离里带一点暖，"
                    + "善用具体而略微出人意料的比喻（把抽象的事比作唱片、井、猫、冰啤酒、熨好的衬衫这类日常之物），"
                    + "短句与长句交替，像深夜电台的独白。从 ta 最近的阅读、观看记录里挑一两件事，"
                    + "与天气一起自然织入：读到一半的书像什么，追到一半的剧停在哪里，都可以淡淡提起。"
                    + "克制：不堆砌比喻（至多一个），不模仿腔调到滑稽，不引用村上原文，不出现「村上」字样。"
                    + "不催促不命令，不用感叹号，不用 emoji，不用引号，问号至多一个，句末以句号收。\n"
                    + "只输出 JSON，别的都不要。",
                messages: [{ role: "user", content: facts.join("\n") }],
            }),
            signal: AbortSignal.timeout(25_000),
        });
        if (!res.ok) return NextResponse.json({ success: true, data: null });
        const data = await res.json() as { content?: Array<{ text?: string }>; usage?: Record<string, number> };
        recordUsage("greeting", DS_MODEL, data.usage);
        const raw = (data.content || []).map((b) => b.text || "").join("");
        const m = raw.match(/\{[\s\S]*\}/);
        if (!m) return NextResponse.json({ success: true, data: null });
        const parsed = JSON.parse(m[0]) as { head?: string; line?: string };
        const head = String(parsed.head || "").trim().slice(0, 8);
        // 超长兜底：不硬切句中（曾产出"服帖地裹着一。"这种断句）——
        // 超过 140 字时退到 140 字内最后一个句末标点处截断；找不到句末就整段弃用
        let line = String(parsed.line || "").trim();
        if (line.length > 140) {
            const cut = line.slice(0, 140);
            const m = cut.match(/^[\s\S]*[。！？；…]/);
            line = m ? m[0] : "";
        }
        if (!head || !line) return NextResponse.json({ success: true, data: null });

        if (cache.size > 300) cache.clear();
        cache.set(ck, { head, line });
        return NextResponse.json({ success: true, data: { head, line } });
    } catch {
        return NextResponse.json({ success: true, data: null }); // 失败静默，前端用默认问候
    }
}
