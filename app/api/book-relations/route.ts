// 关系图（连线机制）：POST { bookPath, names[] } → { mermaid, explain }
// 最少 token：只把选中词条已缓存的出场片段（book_characters.contexts）喂给 LLM，
// 不重扫全书；结果按「书 + 排序后的词条组合」缓存进 book_relations，重复选同一组直接回。
import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
import { getDb } from "@/lib/db";
import { resolveUserKeyOrNull } from "@/lib/identity";
import { isPathUnder } from "@/lib/path-guard";
import { recordUsage } from "@/lib/ai-usage";
import { extractBookText } from "@/lib/book-text";

/** 找"同时出现 ≥2 个选中词"的段落片段——关系信息全在这里，避免 AI 凭空编 */
function coOccurrence(text: string, names: string[], max = 8): string[] {
    if (!text) return [];
    // 按中文句末/换行粗切成句块
    const chunks = text.split(/[\n。！？；]/).map((s) => s.trim()).filter((s) => s.length > 4);
    const hits: { s: string; n: number; pos: number }[] = [];
    for (let i = 0; i < chunks.length; i++) {
        const c = chunks[i];
        const present = names.filter((n) => c.includes(n));
        if (present.length >= 2) {
            // 带前后各一句做上下文
            const ctx = [chunks[i - 1], c, chunks[i + 1]].filter(Boolean).join("。");
            hits.push({ s: ctx.slice(0, 240), n: present.length, pos: i });
        }
    }
    // 共现人数多的优先，去相邻重复
    hits.sort((a, b) => b.n - a.n || a.pos - b.pos);
    const out: string[] = [];
    const seen = new Set<number>();
    for (const h of hits) {
        if (out.length >= max) break;
        if ([...seen].some((p) => Math.abs(p - h.pos) < 3)) continue;
        seen.add(h.pos);
        out.push(h.s);
    }
    return out;
}

export const dynamic = "force-dynamic";
const DS_BASE = process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/anthropic";
const DS_MODEL = process.env.DEEPSEEK_REL_MODEL || "deepseek-chat";
import { BOOK_ALLOWED_ROOTS as ALLOWED_ROOTS } from "@/lib/paths";

function token(): string | null {
    try { return fs.readFileSync(path.join(os.homedir(), ".config", "deepseek-token"), "utf-8").trim() || null; }
    catch { return null; }
}

let ensured = false;
function ensureTable() {
    if (ensured) return;
    getDb().exec(`
        CREATE TABLE IF NOT EXISTS book_relations (
            book_path TEXT NOT NULL,
            combo_key TEXT NOT NULL,
            mermaid TEXT NOT NULL,
            explain TEXT NOT NULL,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (book_path, combo_key)
        )
    `);
    ensured = true;
}

interface Char { name: string; kind?: string; contexts?: string[]; desc?: string; count?: number }

export async function POST(req: NextRequest) {
    if (!(await resolveUserKeyOrNull(req))) {
        return NextResponse.json({ success: false, error: "LOGIN_REQUIRED" }, { status: 401 });
    }
    try {
        const body = await req.json();
        const resolved = path.resolve(String(body.bookPath || ""));
        if (!ALLOWED_ROOTS.some((r) => isPathUnder(resolved, r))) {
            return NextResponse.json({ success: false, error: "无权访问" }, { status: 403 });
        }
        const names: string[] = Array.isArray(body.names) ? body.names.map(String).filter(Boolean) : [];
        if (names.length < 2) {
            return NextResponse.json({ success: false, error: "至少选 2 个对象" }, { status: 400 });
        }
        if (names.length > 16) {
            return NextResponse.json({ success: false, error: "一次最多 16 个对象" }, { status: 400 });
        }
        ensureTable();
        const db = getDb();
        const comboKey = crypto.createHash("sha1").update([...names].sort().join("")).digest("hex");

        // 缓存命中：同一组合直接回，零 token
        const cached = db.prepare("SELECT mermaid, explain FROM book_relations WHERE book_path = ? AND combo_key = ?")
            .get(resolved, comboKey) as { mermaid: string; explain: string } | undefined;
        if (cached) return NextResponse.json({ success: true, mermaid: cached.mermaid, explain: cached.explain, cached: true });

        // 取选中词条的缓存片段（book_characters.contexts）
        const row = db.prepare("SELECT data FROM book_characters WHERE book_path = ?").get(resolved) as { data: string } | undefined;
        const all: Char[] = row ? JSON.parse(row.data) : [];
        const picked = names.map((n) => all.find((c) => c.name === n)).filter(Boolean) as Char[];
        if (picked.length < 2) {
            return NextResponse.json({ success: false, error: "所选对象缺少记录，请先在正文点开它们看看" }, { status: 400 });
        }
        const tk = token();
        if (!tk) return NextResponse.json({ success: false, error: "AI 未配置" }, { status: 500 });

        const bookTitle = path.basename(resolved, path.extname(resolved));
        // 关键：现扫全书找【选中词的共现段落】——关系信息在这里，才不会跑题。
        const text = await extractBookText(resolved);
        const coocc = coOccurrence(text, names);
        // 每个词条的身份线索（名字/类型/简介 + 各自 1 条片段作背景）
        const roster = picked.map((c) => {
            const ctx = (c.contexts || [])[0] || "";
            return `- ${c.name}（${c.kind || "?"}）${c.desc ? "：" + c.desc : ""}${ctx ? "｜出场：" + ctx.slice(0, 80) : ""}`;
        }).join("\n");
        const cooccBlock = coocc.length
            ? coocc.map((s, i) => `${i + 1}. …${s}…`).join("\n")
            : "（正文中没找到它们同时出现的段落——请仅依据下方名单和你对本书的可靠知识判断，找不到关系就如实说没有明显关联）";

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
                max_tokens: 1200,
                system: `你是读书助手，只为【用户指定的这几个对象】梳理彼此关系。铁律：
1. 只画名单里的对象，一个不多一个不少；节点数 = 名单对象数。
2. 关系依据：优先用"共现片段"里的实际互动，其次用你对这本书的可靠知识；禁止编造，禁止引入名单外的人物或无关主题。
3. 若两对象间没有明显关系，就不连边，并在说明里点出。
输出严格 JSON（无多余文字、无 markdown 围栏）：
{"mermaid":"graph LR\\n  N1[\\"名字\\"] -->|关系| N2[\\"名字\\"]","explain":"逐条说明，200字内"}
mermaid 规则：首行 graph LR；节点 id 用 N1 N2…；节点文字放方括号双引号里 N1[\\"中文名\\"]；边写 N1 -->|关系词| N2。`,
                messages: [{ role: "user", content: `书名：《${bookTitle}》\n\n【要分析的对象名单】（只画这些）：\n${roster}\n\n【它们在正文中的共现片段】：\n${cooccBlock}` }],
            }),
            signal: AbortSignal.timeout(60_000),
        });
        if (!res.ok) return NextResponse.json({ success: false, error: `AI HTTP ${res.status}` }, { status: 502 });
        const data = await res.json() as { content?: Array<{ text?: string }>; usage?: Record<string, number> };
        recordUsage("relations", DS_MODEL, data.usage);
        const respText = (data.content || []).map((b) => b.text || "").join("");
        const jsonStr = respText.replace(/^[\s\S]*?({[\s\S]*})[\s\S]*$/, "$1");
        let parsed: { mermaid?: string; explain?: string };
        try { parsed = JSON.parse(jsonStr); } catch { return NextResponse.json({ success: false, error: "AI 返回解析失败" }, { status: 502 }); }
        const mermaid = String(parsed.mermaid || "").trim();
        const explain = String(parsed.explain || "").trim();
        if (!mermaid) return NextResponse.json({ success: false, error: "AI 未生成关系图" }, { status: 502 });

        db.prepare(`INSERT INTO book_relations (book_path, combo_key, mermaid, explain, updated_at)
            VALUES (?, ?, ?, ?, datetime('now'))
            ON CONFLICT(book_path, combo_key) DO UPDATE SET mermaid=excluded.mermaid, explain=excluded.explain, updated_at=excluded.updated_at`)
            .run(resolved, comboKey, mermaid, explain);

        return NextResponse.json({ success: true, mermaid, explain });
    } catch (e) {
        return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
    }
}
