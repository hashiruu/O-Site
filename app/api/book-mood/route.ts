// 故事温度：POST { bookPath, cfi, text } → { temp: 0-100, word: "关键词" }
// temp = 情节的紧张/情感强度：0 平静舒缓，50 中性，100 极度紧张/激烈。
// word = ≤6 字的气氛关键词（山雨欲来/暗流涌动/温情脉脉…），写在聚焦光标左侧给读者看。
// 最省 token：只喂"最近三页"文本（前端截好，再压到 ~1500 字），要 AI 回「数字|关键词」；
// 结果按 (书 + 页 cfi) 缓存，同一页翻回来零 token；deepseek-flash 单次几十 token。
import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
import { getDb } from "@/lib/db";
import { resolveUserKeyOrNull } from "@/lib/identity";
import { recordUsage } from "@/lib/ai-usage";

export const dynamic = "force-dynamic";
const DS_BASE = process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/anthropic";
const DS_MODEL = process.env.DEEPSEEK_MOOD_MODEL || "deepseek-chat";

function token(): string | null {
    try { return fs.readFileSync(path.join(os.homedir(), ".config", "deepseek-token"), "utf-8").trim() || null; }
    catch { return null; }
}

let ensured = false;
function ensureTable() {
    if (ensured) return;
    getDb().exec(`
        CREATE TABLE IF NOT EXISTS book_mood (
            book_path TEXT NOT NULL,
            key TEXT NOT NULL,       -- sha1(最近三页文本) —— 内容一致即命中，跨用户复用
            temp INTEGER NOT NULL,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (book_path, key)
        )
    `);
    try { getDb().exec(`ALTER TABLE book_mood ADD COLUMN word TEXT NOT NULL DEFAULT ''`); } catch { /* 已存在 */ }
    try { getDb().exec(`ALTER TABLE book_mood ADD COLUMN tag TEXT NOT NULL DEFAULT ''`); } catch { /* 已存在 */ }
    ensured = true;
}

export async function POST(req: NextRequest) {
    if (!(await resolveUserKeyOrNull(req))) {
        return NextResponse.json({ success: false, error: "LOGIN_REQUIRED" }, { status: 401 });
    }
    try {
        const body = await req.json();
        const bookPath = String(body.bookPath || "");
        // 最近三页文本压到 1500 字（省 token；紧张度判断不需要全文）
        const text = String(body.text || "").replace(/\s+/g, " ").trim().slice(0, 1500);
        if (!bookPath || text.length < 20) {
            return NextResponse.json({ success: true, temp: 50 }); // 信息太少 → 中性
        }
        ensureTable();
        const db = getDb();
        const key = crypto.createHash("sha1").update(text).digest("hex");
        const cached = db.prepare("SELECT temp, word, tag FROM book_mood WHERE book_path = ? AND key = ?").get(bookPath, key) as { temp: number; word: string; tag: string } | undefined;
        if (cached) return NextResponse.json({ success: true, temp: cached.temp, word: cached.word || "", tag: cached.tag || "", cached: true });

        const tk = token();
        if (!tk) return NextResponse.json({ success: true, temp: 50, word: "" }); // 无 key 时不报错，静默中性

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
                max_tokens: 24,
                system: "你是情节氛围计。读这段小说，输出三样，严格用竖线分隔，格式：数字|关键词|情绪标签\n"
                    + "① 数字：此刻的紧张/激烈程度 0-100（0-30 平静舒缓，40-60 略有起伏，70-100 紧张激烈/悬疑/危险/高潮）。\n"
                    + "② 关键词：概括此刻气氛或即将到来的情节感，4 字最佳、最多 6 字（如：山雨欲来、暗流涌动、杀机隐现、温情脉脉、平静日常、真相浮现）。给读者看，贴合原文、有画面感，别剧透。\n"
                    + "③ 情绪标签：此刻最贴切的一个，只能从这十个里选：calm(平静日常) warm(温情) sad(伤感) mystery(神秘悬疑) tension(紧张) dark(黑暗杀机) epic(史诗高潮) wonder(壮丽惊叹) lonely(孤独) romance(浪漫)。用于匹配背景音乐。\n"
                    + "只输出「数字|关键词|情绪标签」，别的都不要。",
                messages: [{ role: "user", content: text }],
            }),
            signal: AbortSignal.timeout(30_000),
        });
        if (!res.ok) return NextResponse.json({ success: true, temp: 50, word: "" });
        const data = await res.json() as { content?: Array<{ text?: string }>; usage?: Record<string, number> };
        recordUsage("mood", DS_MODEL, data.usage);
        const raw = (data.content || []).map((b) => b.text || "").join("").trim();
        const m = raw.match(/\d{1,3}/);
        const temp = m ? Math.max(0, Math.min(100, parseInt(m[0], 10))) : 50;
        // 竖线分三段：数字 | 关键词 | 情绪标签
        const parts = raw.split(/[|｜]/).map((s) => s.trim());
        const word = ((parts[1] || parts[parts.length - 1] || "").match(/[一-龥]{2,8}/) || [""])[0];
        const BUCKETS = ["calm", "warm", "sad", "mystery", "tension", "dark", "epic", "wonder", "lonely", "romance"];
        const tag = (parts.slice(2).join(" ").match(/calm|warm|sad|mystery|tension|dark|epic|wonder|lonely|romance/i)?.[0].toLowerCase())
            || (BUCKETS.find((b) => raw.toLowerCase().includes(b)) || "");

        db.prepare(`INSERT INTO book_mood (book_path, key, temp, word, tag, updated_at) VALUES (?, ?, ?, ?, ?, datetime('now'))
            ON CONFLICT(book_path, key) DO UPDATE SET temp=excluded.temp, word=excluded.word, tag=excluded.tag, updated_at=excluded.updated_at`)
            .run(bookPath, key, temp, word, tag);
        return NextResponse.json({ success: true, temp, word, tag });
    } catch (e) {
        return NextResponse.json({ success: false, error: String(e), temp: 50 }, { status: 500 });
    }
}
