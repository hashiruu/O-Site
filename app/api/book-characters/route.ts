// 书籍人物索引：GET ?path= → 该书人名列表（每本书首次访问时启发式提取，缓存进 SQLite）。
// POST { bookPath, name, desc } → 写入人物描述（预留给 LLM 人物解读 / 手动备注）。
//
// 提取策略（无模型启发式，够用为先，LLM 精修走 POST 接口）：
//   1. 对话动词前的主语（"XX说/道/问/喊"）——小说里人名最高频的出现形态
//   2. 音译名（带间隔号：夏洛克·福尔摩斯）
//   3. 常见中文姓氏 + 1-2 字
//   4. 英文书：大写开头词频（剔常用词）
//   候选按真实出现次数排序，去子串重复，取前 20。
import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import os from "os";
import path from "path";
import { getDb } from "@/lib/db";
import { resolveUserKeyOrNull } from "@/lib/identity";
import { isPathUnder } from "@/lib/path-guard";
import { recordUsage } from "@/lib/ai-usage";
import { extractBookText, isReadableBook } from "@/lib/book-text";

export const dynamic = "force-dynamic";

const ALLOWED_ROOTS = ["/home/steven/mydrive/book", "/home/steven/mydrive/PAPERS"];

let ensured = false;
function ensureTable() {
    if (ensured) return;
    getDb().exec(`
        CREATE TABLE IF NOT EXISTS book_characters (
            book_path TEXT PRIMARY KEY,
            data TEXT NOT NULL,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
    ensured = true;
}

// contexts：每人 ≤3 条出场片段（首次/中段/末次，各 ±60 字）。
// LLM 解读只喂「书名 + 人名 + 这几条片段」（约几百 token）而非全书，
// 结果写回 desc 后永久缓存——每个人物一生只花一次 token。
// kind：词条类型（信息解释系统，不限人名）。老数据无 kind → 按 person 处理
export type CharKind = "person" | "place" | "org" | "term" | "other";
// gender：人物性别 m/f/u（朗读分配男女音色用），AI 解读时顺带标注
export interface BookChar { name: string; count: number; color: string; desc: string; contexts: string[]; kind?: CharKind; gender?: string; }

// 颜色严格对应（核心规则）：
//   1. 类型定色系（人物=暖段 320°-70° / 地点=绿段 / 组织=蓝段 / 术语=紫段 / 其他=灰阶）
//   2. 同类型内按黄金角旋转取色相——任意两个词条【绝不同色】且间隔最大化，数量不设上限
//   3. HSL 半透明水洗底：白底/护眼绿/夜间黑下都可读（不改文字本色）
const KIND_HUE: Record<Exclude<CharKind, "other">, [number, number]> = {
    person: [320, 430], // 跨 0°：品红-红-橙-金黄（mod 360）
    place: [90, 170],
    org: [185, 255],
    term: [260, 310],
};
function kindColor(kind: CharKind, index: number): string {
    if (kind === "other") {
        return `hsla(220, 8%, ${45 + ((index * 13) % 30)}%, 0.34)`; // 灰阶变亮度
    }
    const [a, b] = KIND_HUE[kind];
    const frac = (index * 0.6180339887) % 1; // 黄金角：相邻序号色相间隔最大化
    const hue = Math.round((a + frac * (b - a)) % 360);
    return `hsla(${hue}, 72%, 55%, 0.34)`;
}

const KIND_LABEL: Record<CharKind, string> = { person: "人物", place: "地点", org: "组织", term: "术语", other: "其他" };

/** 取一个该类型下从未用过的颜色（全表查重，撞上就顺移序号） */
function pickColor(kind: CharKind, characters: BookChar[]): string {
    const used = new Set(characters.map((c) => c.color));
    const start = characters.filter((c) => (c.kind || "person") === kind).length;
    for (let i = start; i < start + 500; i++) {
        const c = kindColor(kind, i);
        if (!used.has(c)) return c;
    }
    return kindColor(kind, start);
}

const CN_STOP = new Set([
    "什么", "一个", "我们", "你们", "他们", "她们", "这个", "那个", "知道", "没有", "自己",
    "现在", "这样", "那样", "怎么", "可以", "不是", "就是", "但是", "所以", "因为", "如果",
    "已经", "还是", "觉得", "时候", "地方", "东西", "事情", "有点", "一下", "先生", "小姐",
    "夫人", "警官", "医生", "老师", "教授", "队长", "可能", "应该", "真的", "似乎", "突然",
    "于是", "然后", "接着", "此时", "这里", "那里", "出来", "起来", "过来", "回来", "下来",
    "上来", "说道", "看着", "不过", "而且", "只是", "甚至", "当然", "毕竟", "终于", "果然",
    "显然", "依然", "仍然", "忽然", "大家", "有人", "别人", "众人", "对方", "彼此", "如此",
]);
const EN_STOP = new Set([
    "The", "This", "That", "There", "Then", "They", "When", "What", "Where", "Which", "While",
    "And", "But", "Not", "Now", "How", "Why", "His", "Her", "She", "Him", "You", "Your", "Yes",
    "Chapter", "One", "Two", "Three", "Mr", "Mrs", "Miss", "Sir", "Madam", "Lady", "Lord",
    "All", "Only", "Just", "Even", "Well", "Still", "After", "Before", "Perhaps", "Maybe",
]);
const SURNAMES = "赵钱孙李周吴郑王冯陈蒋沈韩杨朱秦许何吕施张孔曹严华金魏陶姜谢邹苏潘葛范彭鲁韦马苗方俞任袁柳唐罗薛雷贺倪汤滕殷郝安常乐于时傅齐康伍余元卜顾孟平黄和穆萧尹姚邵汪毛狄米贝明臧计成戴宋庞熊纪舒屈项祝董梁杜阮蓝闵季贾路娄江童颜郭梅盛林刁钟徐邱骆高夏蔡田樊胡凌霍万支柯管卢莫柏房干解应宗丁宣邓郁单杭洪包诸左石崔吉龚程嵇邢裴陆荣翁荀羊惠甄曲封储仲伊宫宁仇栾甘厉戎祖武符刘景詹束龙叶幸司韶黎溥印宿白怀蒲邰从鄂索咸籍赖卓蔺屠蒙池乔阴胥能苍双闻莘党翟谭贡劳姬申扶堵冉宰郦雍璩桑桂濮牛寿通边扈燕冀浦尚农温别庄晏柴瞿阎充慕连茹习宦艾鱼容向古易慎戈廖庾终暨居衡步都耿满弘匡国文寇广禄阙东欧沃利蔚越夔隆师巩厍聂晁勾敖融冷訾辛阚那简饶空曾毋沙乜养鞠须丰巢关蒯相查后荆红游竺权逯盖益桓公";

// 人名里几乎不会出现的功能字/代词——含任一即废（"他也""但也"这类对话正则误捕的克星）
const BAD_CHARS = /[的了是也就都还又很不得着说道问要及或被把并向从对而且但呢吗啊吧呀么些每逐仍越挺颇既继随]/;
const BAD_PREFIX = /^[他她它你我谁这那各某有又也就还都太更曾已没不别请让]/;

function extractNames(text: string): { name: string; count: number }[] {
    const score = new Map<string, number>();
    const bump = (n: string, w: number) => {
        if (n.length < 2 || CN_STOP.has(n) || EN_STOP.has(n)) return;
        if (BAD_CHARS.test(n) || BAD_PREFIX.test(n)) return;
        score.set(n, (score.get(n) || 0) + w);
    };

    // 1) 对话动词前主语（权重最高）
    for (const m of text.matchAll(/([一-龥·]{2,5})(?:说道|说|喊道|叫道|答道|问道|回答|笑道|低声道|沉声道|道|问)[：:，,。"“]/g)) {
        bump(m[1], 3);
    }
    // 2) 音译名（间隔号）
    for (const m of text.matchAll(/[一-龥]{1,5}·[一-龥]{1,5}(?:·[一-龥]{1,5})?/g)) {
        bump(m[0], 3);
    }
    // 3) 中文姓氏 + 1-2 字
    const surnameRe = new RegExp(`[${SURNAMES}][\\u4e00-\\u9fa5]{1,2}`, "g");
    for (const m of text.matchAll(surnameRe)) bump(m[0], 1);
    // 4) 英文大写词
    for (const m of text.matchAll(/\b[A-Z][a-z]{2,14}\b/g)) bump(m[0], 1);

    // 候选按打分取前 60，再数真实出现次数
    const cands = [...score.entries()].sort((a, b) => b[1] - a[1]).slice(0, 60).map(([n]) => n);
    const counted = cands
        .map((name) => ({ name, count: text.split(name).length - 1 }))
        .filter((c) => c.count >= 6);
    // 去子串：短名是某长名的子串且出现次数接近（≤1.3 倍）→ 视为同一人删短名
    counted.sort((a, b) => b.name.length - a.name.length);
    const kept: { name: string; count: number }[] = [];
    for (const c of counted) {
        const dupOf = kept.find((k) => k.name.includes(c.name) && c.count <= k.count * 1.3);
        if (!dupOf) kept.push(c);
    }
    return kept.sort((a, b) => b.count - a.count).slice(0, 20);
}

function guard(raw: string | null): string | NextResponse {
    if (!raw) return NextResponse.json({ success: false, error: "缺少 path" }, { status: 400 });
    const resolved = path.resolve(raw);
    if (!ALLOWED_ROOTS.some((root) => isPathUnder(resolved, root))) {
        return NextResponse.json({ success: false, error: "无权访问此路径" }, { status: 403 });
    }
    return resolved;
}

export async function GET(req: NextRequest) {
    if (!(await resolveUserKeyOrNull(req))) {
        return NextResponse.json({ success: false, error: "LOGIN_REQUIRED" }, { status: 401 });
    }
    const resolved = guard(req.nextUrl.searchParams.get("path"));
    if (resolved instanceof NextResponse) return resolved;
    if (!isReadableBook(resolved)) {
        return NextResponse.json({ success: true, characters: [] }); // 只处理 epub / pdf
    }
    ensureTable();
    const db = getDb();
    const cached = db.prepare("SELECT data FROM book_characters WHERE book_path = ?").get(resolved) as { data: string } | undefined;
    if (cached) {
        try { return NextResponse.json({ success: true, characters: JSON.parse(cached.data) }); } catch { /* 重新提取 */ }
    }
    try {
        const text = await extractBookText(resolved);
        const names = extractNames(text);
        // 上下文采样：首次出场 / 中段 / 末次各一条（±60 字），供未来 LLM 低成本解读
        const sample = (name: string): string[] => {
            const idxs: number[] = [];
            const first = text.indexOf(name);
            if (first >= 0) idxs.push(first);
            const mid = text.indexOf(name, Math.floor(text.length / 2));
            if (mid > first) idxs.push(mid);
            const last = text.lastIndexOf(name);
            if (last > mid) idxs.push(last);
            return idxs.slice(0, 3).map((i) =>
                text.slice(Math.max(0, i - 60), i + name.length + 60).replace(/\s+/g, " ").trim()
            );
        };
        const characters: BookChar[] = names.map((n, i) => ({
            name: n.name, count: n.count, color: kindColor("person", i), desc: "", contexts: sample(n.name), kind: "person" as const,
        }));
        db.prepare(`
            INSERT INTO book_characters (book_path, data, updated_at) VALUES (?, ?, datetime('now'))
            ON CONFLICT(book_path) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
        `).run(resolved, JSON.stringify(characters));
        return NextResponse.json({ success: true, characters });
    } catch (e) {
        return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
    }
}

// 人物索引的增删改（基础识别的修正机制 + LLM 解读写回口）：
//   { bookPath, action: "add",    name }            → 手动录入人名（阅读时选中/长按）
//   { bookPath, action: "remove", name }            → 删除误识别
//   { bookPath, action: "rename", name, newName }   → 改名
//   { bookPath, action: "desc",   name, desc }      → 写人物描述（LLM/手动）
//   { bookPath, action: "ai",     name }            → DeepSeek 生成人物小传（省 token：只喂出场片段；
//                                                      name 为具体人名解读一人，name="*" 批量补全全部无描述人物）
export async function POST(req: NextRequest) {
    if (!(await resolveUserKeyOrNull(req))) {
        return NextResponse.json({ success: false, error: "LOGIN_REQUIRED" }, { status: 401 });
    }
    try {
        const body = await req.json();
        const action = String(body.action || "desc");
        const name = String(body.name || "").trim();
        const resolved = guard(String(body.bookPath || ""));
        if (resolved instanceof NextResponse) return resolved;
        if (!name) return NextResponse.json({ success: false, error: "缺少 name" }, { status: 400 });
        ensureTable();
        const db = getDb();
        const row = db.prepare("SELECT data FROM book_characters WHERE book_path = ?").get(resolved) as { data: string } | undefined;
        const characters: BookChar[] = row ? JSON.parse(row.data) : [];

        if (action === "add") {
            if (name.length < 2 || name.length > 12) {
                return NextResponse.json({ success: false, error: "人名长度 2-12 字" }, { status: 400 });
            }
            if (characters.some((c) => c.name === name)) {
                return NextResponse.json({ success: false, error: "已在人物表里" }, { status: 409 });
            }
            const kind: CharKind = (["person", "place", "org", "term", "other"] as const).includes(body.kind) ? body.kind : "person";
            const added: BookChar = { name, count: 0, color: pickColor(kind, characters), desc: "", contexts: [], kind };
            characters.push(added);
            persist(db, resolved, characters);
            return NextResponse.json({ success: true, character: added });
        }

        // AI 解读：带 name 单人（点击驱动）；name="*" 批量补全无描述词条（一次最多 8 个保质量）。
        // 取证在此刻现场做：重扫全书按信息量挑片段——手动录入的词条（存的 contexts 为空）
        // 也能拿到高质量证据，不再瞎猜
        if (action === "ai") {
            const bookTitle = path.basename(resolved, path.extname(resolved));
            const targets = name && name !== "*"
                ? characters.filter((c) => c.name === name)
                : characters.filter((c) => !c.desc).slice(0, 8);
            console.log(`[char-ai] name=${JSON.stringify(name)} 候选人物=[${characters.map(c=>c.name).join(",")}] targets=${targets.length}`);
            if (!targets.length) return NextResponse.json({ success: false, error: `没有需要解读的词条（name=${name} 未在人物表中匹配）` }, { status: 400 });
            const text = await extractBookText(resolved);
            console.log(`[char-ai] epubText 长度=${text.length}`);
            const allNames = characters.map((c) => c.name);
            const enriched = targets.map((c) => {
                const fresh = sampleContexts(text, c.name, allNames);
                console.log(`[char-ai] ${c.name} 采样片段=${fresh.length}${fresh[0] ? " 首片=" + fresh[0].slice(0,50) : ""}`);
                return { ...c, contexts: fresh.length ? fresh : c.contexts, count: c.count || fresh.length };
            });
            const descs = await llmDescribe(bookTitle, enriched);
            console.log(`[char-ai] LLM 返回 keys=[${Object.keys(descs).join(",")}] applied 候选=[${enriched.map(c=>c.name).join(",")}]`);
            let applied = 0;
            // ① 点击目标优先：精确 key 没有时做全名↔简称宽松匹配——模型爱自作主张用全名当 key
            //   （实案：点"夕子"，模型回 {"杉江夕子":…}，desc 全写给全名词条，点击的词条依旧空白）
            const keys = Object.keys(descs);
            const resolveDesc = (n: string) =>
                descs[n] || (() => { const k = keys.find((x) => x.includes(n) || n.includes(x)); return k ? descs[k] : null; })();
            for (const t of targets) {
                const c = characters.find((x) => x.name === t.name);
                const d = resolveDesc(t.name);
                if (c && d) { c.desc = d.d; if (d.g !== "u") c.gender = d.g; applied++; }
            }
            // ② 其余词条按精确 key 顺带补全（不覆盖已有描述）
            for (const c of characters) {
                if (!c.desc && descs[c.name]) { c.desc = descs[c.name].d; if (descs[c.name].g !== "u") c.gender = descs[c.name].g; applied++; }
            }
            console.log(`[char-ai] applied=${applied}`);
            persist(db, resolved, characters);
            return NextResponse.json({ success: true, applied, characters });
        }

        const target = characters.find((c) => c.name === name);
        if (!target) return NextResponse.json({ success: false, error: "人物不存在" }, { status: 404 });

        if (action === "remove") {
            persist(db, resolved, characters.filter((c) => c.name !== name));
            return NextResponse.json({ success: true });
        }
        if (action === "rename") {
            const newName = String(body.newName || "").trim();
            if (newName.length < 2 || newName.length > 12) {
                return NextResponse.json({ success: false, error: "人名长度 2-12 字" }, { status: 400 });
            }
            target.name = newName;
            persist(db, resolved, characters);
            return NextResponse.json({ success: true, character: target });
        }
        // 默认：desc 写回（LLM 解读 / 手动备注）
        target.desc = String(body.desc || "").slice(0, 2000);
        persist(db, resolved, characters);
        return NextResponse.json({ success: true });
    } catch (e) {
        return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
    }
}

// ── DeepSeek 人物解读（Anthropic 兼容端点，与 claudeds 同一套凭证）──
// token 运行时读 ~/.config/deepseek-token，仓库零凭证（.env.local 本就 gitignore）。
// 省 token 设计：输入只有书名 + 每人 ≤3 条出场片段，单人 ~500 token，整本 20 人一次 ~7k；
// 结果写回 desc 永久缓存，每个人物只花一次。
const DS_BASE = process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/anthropic";
const DS_MODEL = process.env.DEEPSEEK_CHAR_MODEL || "deepseek-chat"; // 最便宜档，站长钦定不用 Pro

function deepseekToken(): string | null {
    try { return fs.readFileSync(path.join(os.homedir(), ".config", "deepseek-token"), "utf-8").trim() || null; }
    catch { return null; }
}

// 身份线索词：包含这些的片段大概率写着"TA 是谁/这是什么"
const IDENTITY_HINT = /是|叫|名叫|担任|身为|作为|职业|自称|外号|绰号|饭店|酒店|旅馆|公司|大学|学校|医院|警|侦探|教练|选手|运动员|记者|医生|老师|社长|部长|课长|经理|老板|馆|局|队|社|署|厅|研究所|实验室/;

/** 解读取证：全书扫该词条的出现处，按信息量打分挑前 5 个窗口（±100 字）。
 *  评分：首次出场 +3（介绍通常在这）· 含身份线索词 +2 · 与其他已知词条共现 +1。
 *  这是"最大化准确度同时最省 token"的关键——喂的不是随机片段，是证据。 */
function sampleContexts(text: string, name: string, allNames: string[], max = 5): string[] {
    const wins: { s: string; score: number; pos: number }[] = [];
    let idx = text.indexOf(name);
    let n = 0;
    while (idx >= 0 && n < 60) {
        const span = n === 0 ? 160 : 100; // 首次出场窗口放大
        const s = text.slice(Math.max(0, idx - span), idx + name.length + span).replace(/\s+/g, " ").trim();
        let score = 0;
        if (n === 0) score += 3;
        if (IDENTITY_HINT.test(s)) score += 2;
        if (allNames.some((o) => o !== name && s.includes(o))) score += 1;
        wins.push({ s, score, pos: idx });
        idx = text.indexOf(name, idx + name.length + 200); // 跳段防重叠窗口
        n++;
    }
    wins.sort((a, b) => b.score - a.score || a.pos - b.pos);
    const picked: typeof wins = [];
    for (const w of wins) {
        if (picked.length >= max) break;
        if (picked.some((p) => Math.abs(p.pos - w.pos) < 150)) continue;
        picked.push(w);
    }
    return picked.sort((a, b) => a.pos - b.pos).map((w) => w.s);
}

async function llmDescribe(bookTitle: string, chars: BookChar[]): Promise<Record<string, { d: string; g: string }>> {
    const token = deepseekToken();
    if (!token) throw new Error("DeepSeek token 未配置（~/.config/deepseek-token）");
    const body = {
        model: DS_MODEL,
        max_tokens: 1500,
        system: '你是读书助手。根据出场片段解释每个词条：人物说明"是谁"（身份/与他人关系/特征），地点/组织/术语说明"是什么"及在书中的作用，各 60 字以内。规则：只陈述片段里能确认的事实 + 你对这本书的可靠知识；不确定的方面直接省略，禁止编造和空泛推测；片段完全没有信息时，d 写"书中信息不足，多读几章后再试"。只输出一个 JSON 对象：键必须与输入里【】中的词条名完全一致、一字不差（禁止擅自换成全名/简称/别名）；值是对象 {"d":"解释","g":"性别"}，g 只能是 m(男)/f(女)/u(未知或非人物)。不要输出其他任何内容。',
        messages: [{
            role: "user",
            content: `书名：《${bookTitle}》\n\n${chars.map((c) => `【${c.name}】类型：${KIND_LABEL[c.kind || "person"]}，出现 ${c.count} 次\n${c.contexts.join("\n") || "（手动录入，无采样片段）"}`).join("\n\n")}`,
        }],
    };
    const res = await fetch(`${DS_BASE}/v1/messages`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`,
            "x-api-key": token,
            "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`DeepSeek HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json() as { content?: Array<{ type: string; text?: string }>; usage?: Record<string, number> };
    recordUsage("characters", DS_MODEL, data.usage);
    const text = (data.content || []).map((b) => b.text || "").join("");
    const jsonStr = text.replace(/^[\s\S]*?({[\s\S]*})[\s\S]*$/, "$1"); // 剥掉可能的 ```json 围栏/闲话
    const parsed = JSON.parse(jsonStr) as Record<string, unknown>;
    // 新格式 {"名":{"d":"…","g":"m|f|u"}}；兼容旧格式 {"名":"…"}（gender 置 u）
    const out: Record<string, { d: string; g: string }> = {};
    for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === "string" && v.trim()) out[k.trim()] = { d: v.trim().slice(0, 300), g: "u" };
        else if (v && typeof v === "object") {
            const o = v as { d?: string; g?: string };
            if (o.d && o.d.trim()) out[k.trim()] = { d: o.d.trim().slice(0, 300), g: /^[mf]$/.test(o.g || "") ? o.g! : "u" };
        }
    }
    return out;
}

function persist(db: ReturnType<typeof getDb>, bookPath: string, characters: BookChar[]) {
    db.prepare(`
        INSERT INTO book_characters (book_path, data, updated_at) VALUES (?, ?, datetime('now'))
        ON CONFLICT(book_path) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
    `).run(bookPath, JSON.stringify(characters));
}
