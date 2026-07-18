// 阅读疑问助手（agentic 版）：POST { bookPath, bookTitle, question, readText, history }
//
// 从「把已读全文塞进 prompt」升级为「给模型一个 ripgrep 式检索工具，让它按需翻书」：
//   · 内联只给【最近一小段】原文（当前阅读附近，最相关也最便宜）
//   · search / read_around 两个工具，范围严格限定在读者【已读部分】——绝不触及未读，天然防剧透
//   · 模型自己决定搜什么、读多少，只有命中的片段进入上下文 → 省 token 又更准（长书也能翻回开头）
//
// 事实边界铁律不变：模型对本书的全部知识 = 已读部分；search 也只在已读文本上跑。
import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import os from "os";
import path from "path";
import { resolveUserKeyOrNull } from "@/lib/identity";
import { recordUsage } from "@/lib/ai-usage";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";
const DS_BASE = process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/anthropic";
const DS_MODEL = process.env.DEEPSEEK_ASK_MODEL || "deepseek-v4-flash"; // 显式 Flash，避开 deepseek-chat 于 2026-07-24 的弃用
const MAX_READ = 2_000_000;   // 已读全文上限（防超大书爆内存）
const INLINE_TAIL = 2500;     // 内联给模型的「最近原文」字符数
const MAX_ROUNDS = 5;         // agentic 工具调用轮数上限

function token(): string | null {
    try { return fs.readFileSync(path.join(os.homedir(), ".config", "deepseek-token"), "utf-8").trim() || null; }
    catch { return null; }
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** ripgrep 式检索：在已读全文里找关键词命中处，返回带上下文的片段 + 位置 pos。 */
function searchText(full: string, query: string, max = 6): string {
    const terms = String(query || "").trim().split(/\s+/).filter(Boolean).map(esc);
    if (!terms.length) return "（空查询）";
    let re: RegExp;
    try { re = new RegExp(terms.join("|"), "gi"); } catch { return "（查询无法解析）"; }
    const hits: { pos: number; snip: string }[] = [];
    const seen: number[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(full)) && hits.length < max) {
        const pos = m.index;
        if (seen.some((p) => Math.abs(p - pos) < 120)) continue; // 相邻命中去重
        seen.push(pos);
        const snip = full.slice(Math.max(0, pos - 90), pos + 90).replace(/\s+/g, " ").trim();
        hits.push({ pos, snip });
        if (m.index === re.lastIndex) re.lastIndex++; // 防零宽死循环
    }
    if (!hits.length) return `已读部分没有找到「${query}」。可能还没读到，或换个说法再搜。`;
    return `在已读部分命中 ${hits.length} 处（按需用 read_around 展开）：\n` +
        hits.map((h) => `[pos=${h.pos}] …${h.snip}…`).join("\n");
}

/** 读取某位置前后更大段原文（展开 search 命中处）。 */
function readAround(full: string, pos: number, radius = 600): string {
    const p = Math.max(0, Math.min(full.length, Math.round(pos || 0)));
    const r = Math.max(100, Math.min(2000, Math.round(radius || 600)));
    const seg = full.slice(Math.max(0, p - r), p + r).replace(/\s+/g, " ").trim();
    return `[pos=${p} 前后约 ${r} 字]\n…${seg}…`;
}

/** 执行一次工具调用（结构化或泄漏解析出来的都走这里）。 */
function runTool(full: string, name: string, input: Record<string, unknown> | undefined): string {
    try {
        if (name === "search") return searchText(full, String(input?.query || ""));
        if (name === "read_around") return readAround(full, Number(input?.pos), Number(input?.radius));
    } catch { /* noop */ }
    return "（未知工具或执行出错）";
}

// DeepSeek 的 anthropic 兼容层有时不吐结构化 tool_use，而把工具调用以原生 DSML 文本
// （<｜｜DSML｜｜invoke name="search"><｜｜DSML｜｜parameter name="query"…>…）塞进 text。
// 这两个函数负责：从 text 解析出泄漏的工具调用 + 把残留的 DSML 标记从最终答案里剥干净。
function parseLeakedToolCall(text: string): { name: string; input: Record<string, unknown> } | null {
    if (!text || !text.includes("DSML")) return null;
    const nameM = text.match(/invoke\s+name="([^"]+)"/);
    if (!nameM) return null;
    const input: Record<string, unknown> = {};
    const re = /parameter\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/[^>]*?parameter>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) input[m[1]] = m[2].trim();
    return { name: nameM[1], input };
}
function stripDsml(text: string): string {
    let s = String(text || "");
    const i = s.indexOf("DSML");
    if (i >= 0) { const lt = s.lastIndexOf("<", i); s = lt >= 0 ? s.slice(0, lt) : s.slice(0, i); }
    return s.trim();
}

interface Anno { name?: string; kind?: string; desc?: string }
/** 读取该书【全部注解】（人物/地点/组织/术语等关键词），读者边读边标注的。 */
function loadAnnotations(bookPath: string): Anno[] {
    try {
        const resolved = path.resolve(String(bookPath || ""));
        const row = getDb().prepare("SELECT data FROM book_characters WHERE book_path = ?").get(resolved) as { data: string } | undefined;
        if (!row) return [];
        const all = JSON.parse(row.data) as Anno[];
        return Array.isArray(all) ? all.filter((c) => c?.name) : [];
    } catch { return []; }
}
const KIND_CN: Record<string, string> = { person: "人物", place: "地点", org: "组织", term: "术语", other: "其他" };
function rosterString(all: Anno[]): string {
    return all.slice(0, 60).map((c) => {
        const k = KIND_CN[c.kind || ""] || c.kind || "";
        const d = (c.desc || "").replace(/\s+/g, " ").trim().slice(0, 50);
        return `- ${c.name}${k ? `（${k}）` : ""}${d ? "：" + d : ""}`;
    }).join("\n");
}

/** 从问题里挑检索词：命中注解的人名/术语 + 「」""里引用的词。DeepSeek 常懒得调工具，服务端先替它搜。 */
function pickTerms(question: string, names: string[]): string[] {
    const terms = new Set<string>();
    for (const n of names) { if (n && n.length >= 2 && question.includes(n)) terms.add(n); }
    for (const m of question.matchAll(/[「『"“”]([^「『"”“』」]{2,20})[」』"”]/g)) terms.add(m[1].trim());
    return [...terms].slice(0, 4);
}

/** 只说"让我查一下原文"之类、却没真正调工具的停顿叙述——绝不能当答案。 */
function looksLikeStall(t: string): boolean {
    if (t.length > 220) return false; // 够长基本是真答案了
    return /(让我|我来|我先|我这就|稍等|我需要|需要先|得先|我去|我查|查一下|找一下|搜一下|搜索|检索|翻一下|看一下|马上|先查|先搜|先看|接下来我|下面我|请稍|正在查|这就去)/.test(t)
        && !/[。！？]{1}.{30,}/.test(t.replace(/^[^。！？]*[。！？]/, "")); // 除去开头一句后仍有实质内容 → 不算停顿
}

const TOOLS = [
    {
        name: "search",
        description: "在读者【已读部分】原文里全文检索关键词/人名/短语（像 ripgrep），返回每处命中的上下文片段与位置 pos。范围严格限定已读内容，搜不到未读的东西。凭记忆不确定时先搜再答。",
        input_schema: {
            type: "object",
            properties: { query: { type: "string", description: "关键词或短语；多个词用空格分隔表示任一命中" } },
            required: ["query"],
        },
    },
    {
        name: "read_around",
        description: "读取某个位置 pos 前后更大段的原文，用来展开 search 命中处、看清上下文。",
        input_schema: {
            type: "object",
            properties: {
                pos: { type: "number", description: "search 结果里给出的 pos" },
                radius: { type: "number", description: "前后各取多少字符，默认 600，最多 2000" },
            },
            required: ["pos"],
        },
    },
];

const SYSTEM = `你是读书搭子，陪读者边读边聊。读者会问细节，也会提出猜想、假设、推理（比如"某某会不会是凶手"），你要积极参与讨论。

你有工具可以翻阅读者【已读部分】的原文：
- search：像 ripgrep 一样全文检索关键词/人名/短语，返回命中片段与位置 pos
- read_around：读取某个 pos 前后更大段的原文
消息里只附了【最近读到的一小段】原文。凡是这段之外的细节（前面章节的人名、伏笔、情节），都要先用 search 查证，再回答——不要凭记忆编，也不要一次把全书塞进来。搜到位置后可用 read_around 展开看清。

读者常用语音输入，人名/地名可能被识别成【同音或近音的错字】（比如把"汤川"说成"唐川"、"雪穗"说成"雪穂"）。不要纠结字面：先按读音推断读者到底指谁，别因为一个字不同就说"没有这个人"。search 没命中时，主动换同音/近音字重试，或只搜姓、只搜名里的一个字、搜相关描述来定位那个人，找到后就当作读者指的就是他自然作答（可顺带用原文里的正确写法，但别刻意纠正、别揪着错字打转）。

事实边界（唯一铁律）：你对这本书的全部知识 = 读者已读部分（search 也只搜得到已读内容）。即使训练数据里读过这本书、知道真相，也必须装作只读到这里——严禁透露、暗示、影射任何未读部分的剧情/真相/结局，严禁说"你后面会知道的"。

在边界内你可以也应该：陪读者推理、分析猜想的依据（从原文找支持与反驳）、讨论人物动机与伏笔、大胆假设并标注哪些是原文事实哪些是推测。读者猜想接近真相时正常按已读线索讨论合理性，不确认也不否认。确实查不到相关线索时，就说"目前读到的部分还没有相关线索"。回答用中文，语气自然，像朋友聊书。

排版：回答用 Markdown——重点词 **加粗**，引用原文用 > 引用块，多条线索/要点用列表，需要对比时用表格。别整段堆在一起，让人一眼能抓住重点。`;

// 论文模式：读全文、无剧透限制、学术严谨。用于 PDF 论文（mode:"paper"）。
const SYSTEM_PAPER = `你是论文精读助手，帮读者读懂这篇学术论文（可能是机器学习/医学影像等方向）。

你有工具可以检索论文全文：
- search：像 ripgrep 一样全文检索关键词/术语/记号/方法名，返回命中片段与位置 pos
- read_around：读取某个 pos 前后更大段的原文，看清公式/定义/上下文
论文可以整篇讨论，没有"剧透"一说。消息里附了【最近看的一段】和可能的预检索片段；要谈到具体的方法、公式、符号、数据集、指标、引用时，先用 search 查证原文，别凭记忆编。

你应该：解释方法与动机、拆解公式与符号含义、说明实验设置与结论、对比相关工作、指出创新点与局限、回答"为什么这样设计"。术语用准确的中英文（首次出现给英文原词）。读者用语音输入，术语可能是近音错字（如把 "attention" 说成 "atention"、"卷积"说成"卷机"），按读音推断本意，别纠字面；search 没命中就换写法/只搜词根再试。

事实以原文为准：查得到就依据原文；确实没有的信息，明确说"论文里没有提到"，可补充你的可靠领域知识但要标注这是背景补充而非原文。

排版：回答用 Markdown——重点 **加粗**，引用原文/公式用 > 引用块，要点用列表，对比用表格。行内公式/符号用 \`代码\` 包起来。简洁、准确、直击重点。`;

interface Block { type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown>; }
interface DSResp { content?: Block[]; stop_reason?: string; usage?: Record<string, number>; }

async function callDSOnce(tk: string, sys: string, messages: unknown[], withTools: boolean, timeoutMs: number): Promise<DSResp | { error: string; status: number }> {
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
            max_tokens: 900,
            // 关键：v4-flash 默认开思考模式，每轮先烧几百 thinking token、延迟翻倍，
            // 多轮循环极易顶穿反代 60s 超时（"气泡消失没下文"的元凶）。显式关掉。
            thinking: { type: "disabled" },
            system: sys,
            ...(withTools ? { tools: TOOLS } : {}),
            messages,
        }),
        signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return { error: `AI HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`, status: 502 };
    return await res.json() as DSResp;
}

/** 带一次重试：DeepSeek anthropic 端偶发延迟尖峰/抖动，单次超时或网络错就再试一发（不同 timeout）。 */
async function callDS(tk: string, sys: string, messages: unknown[], withTools: boolean, timeoutMs = 24_000): Promise<DSResp | { error: string; status: number }> {
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const r = await callDSOnce(tk, sys, messages, withTools, timeoutMs);
            // HTTP 5xx/429 也值得重试一次；4xx（如鉴权）直接返回
            if ("error" in r && attempt === 0 && /HTTP (5\d\d|429)/.test(r.error)) continue;
            return r;
        } catch (e) {
            if (attempt === 0) continue; // 超时/网络异常 → 再试一发
            return { error: `AI 响应超时或网络异常：${String(e).slice(0, 120)}`, status: 504 };
        }
    }
    return { error: "AI 无响应", status: 504 };
}

export async function POST(req: NextRequest) {
    if (!(await resolveUserKeyOrNull(req))) {
        return NextResponse.json({ success: false, error: "LOGIN_REQUIRED" }, { status: 401 });
    }
    try {
        const body = await req.json();
        const question = String(body.question || "").trim();
        const bookTitle = String(body.bookTitle || "本书");
        // 论文模式（PDF）：读全文、无剧透限制、学术严谨。novel 模式沿用防剧透陪读。
        const isPaper = body.mode === "paper" || String(body.bookPath || "").toLowerCase().endsWith(".pdf");
        const sys = isPaper ? SYSTEM_PAPER : SYSTEM;
        if (!question) return NextResponse.json({ success: false, error: "请输入问题" }, { status: 400 });
        const tk = token();
        if (!tk) return NextResponse.json({ success: false, error: "AI 未配置（~/.config/deepseek-token）" }, { status: 500 });

        // 已读全文（search 的搜索范围，防剧透的边界）——只在服务端持有，不整块喂模型
        const full = String(body.readText || "").slice(-MAX_READ);
        const inlineTail = full.slice(-INLINE_TAIL); // 内联给模型的「最近原文」

        // 多轮历史（纯文本，去空、合并同角色、修剪残缺）
        const msgs: Array<{ role: "user" | "assistant"; content: unknown }> = [];
        const rawHistory: Array<{ role: string; text?: string; content?: string }> = Array.isArray(body.history) ? body.history : [];
        for (const h of rawHistory) {
            const text = String(h.text ?? h.content ?? "").trim();
            if (!text) continue;
            const role = h.role === "assistant" ? "assistant" : "user";
            // 历史里自己以前的停顿话术（"好，我来找一下…"）不回灌——模型会学样接着敷衍
            if (role === "assistant" && looksLikeStall(text)) continue;
            const last = msgs[msgs.length - 1];
            if (last && last.role === role && typeof last.content === "string") last.content += "\n" + text;
            else msgs.push({ role, content: text });
        }
        while (msgs[0]?.role === "assistant") msgs.shift();
        if (msgs[msgs.length - 1]?.role === "user") msgs.pop();

        const annos = loadAnnotations(String(body.bookPath || ""));
        const roster = rosterString(annos);
        // 服务端预检索：用问题里命中注解的人名 / 引用词，替模型先把相关原文搜出来（它常懒得自己调工具）
        const preTerms = pickTerms(question, annos.map((a) => a.name || ""));
        const preHits = preTerms.map((t) => `▍关于「${t}」：\n${searchText(full, t, 4)}`).join("\n\n");
        msgs.push({
            role: "user",
            content: `书名：《${bookTitle}》\n\n`
                + (roster ? `【本书已标注的关键词/人物】（读者边读边标的，是人名与术语的锚点；读者提到谁，先在这里对上号）：\n${roster}\n\n` : "")
                + (preHits ? `【已为你从已读原文预检索到的相关片段】（直接用，不够再自己 search）：\n${preHits}\n\n` : "")
                + `【最近读到的一小段原文】：\n${inlineTail || "（还没读到什么内容）"}\n\n---\n读者问题：${question}`,
        });

        // ── agentic 循环（SSE 流式）：每次工具调用实时推给前端，用户全程看得见模型在干什么 ──
        // 事件：{ev:"status",text} 步骤播报 → {ev:"done",answer} 最终答案 / {ev:"error",error}
        // 顺带好处：持续有数据流过，反代（nginx 60s idle）不会再砍长请求。
        const encoder = new TextEncoder();
        let closed = false; // 客户端断开/流已关：一切 enqueue 都要静默跳过，绝不再抛
        const stream = new ReadableStream({
            async start(controller) {
                const safeEnqueue = (chunk: Uint8Array) => { if (closed) return; try { controller.enqueue(chunk); } catch { closed = true; } };
                const send = (obj: unknown) => safeEnqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
                const status = (text: string) => send({ ev: "status", text });
                // 单次模型调用可能拖十几秒，其间发心跳注释，反代（nginx 60s idle）不会砍连接
                const callHB = async (withTools: boolean, timeout?: number) => {
                    const hb = setInterval(() => safeEnqueue(encoder.encode(`: hb\n\n`)), 12_000);
                    try { return await callDS(tk, sys, msgs, withTools, timeout); }
                    finally { clearInterval(hb); }
                };
                const t0 = Date.now();
                const BUDGET_MS = 38_000;
                let answer = "";
                let toolCalls = 0;
                let rounds = 0;
                let nudges = 0;
                let synth = 0;
                const textOf = (blocks: Block[]) => blocks.filter((b) => b.type === "text").map((b) => b.text || "").join("").trim();
                const feedBlocks = (blocks: Block[]) => blocks.filter((b) => b.type === "tool_use" || b.type === "text"); // 剥 thinking
                // 工具执行 + 播报（结构化和 DSML 泄漏共用）
                const toolLabel = (name: string, input: Record<string, unknown> | undefined) =>
                    name === "search" ? `搜索原文：「${String(input?.query || "").slice(0, 30)}」`
                        : name === "read_around" ? "展开命中处的原文细读" : `调用 ${name}`;
                const feedTool = (name: string, input: Record<string, unknown> | undefined) => {
                    toolCalls++;
                    status(toolLabel(name, input));
                    const id = `t${++synth}`;
                    msgs.push({ role: "assistant", content: [{ type: "tool_use", id, name, input: input || {} }] });
                    msgs.push({ role: "user", content: [{ type: "tool_result", tool_use_id: id, content: runTool(full, name, input) }] });
                };
                try {
                    if (preTerms.length) status(`预检索：${preTerms.map((t) => `「${t}」`).join(" ")}`);
                    status("阅读上下文，思考中…");

                    let loopErr = "";
                    for (let round = 0; round < MAX_ROUNDS && Date.now() - t0 < BUDGET_MS; round++) {
                        rounds++;
                        const resp = await callHB(true);
                        if ("error" in resp) { loopErr = resp.error; break; } // 出错不判死，跳去强制收口兜底
                        recordUsage("ask", DS_MODEL, resp.usage);
                        const blocks = resp.content || [];
                        const toolUses = blocks.filter((b) => b.type === "tool_use");
                        const text = textOf(blocks);

                        if (toolUses.length) { // 结构化 tool_use：播报 + 回灌
                            msgs.push({ role: "assistant", content: feedBlocks(blocks) });
                            msgs.push({
                                role: "user",
                                content: toolUses.map((tu) => {
                                    toolCalls++;
                                    status(toolLabel(tu.name || "", tu.input));
                                    return { type: "tool_result", tool_use_id: tu.id, content: runTool(full, tu.name || "", tu.input) };
                                }),
                            });
                            continue;
                        }
                        const leaked = parseLeakedToolCall(text); // 泄漏的 DSML 调用
                        if (leaked) { feedTool(leaked.name, leaked.input); continue; }

                        const clean = stripDsml(text);
                        // 只说"让我查一下"却没真调工具 → 催；催不动转强制收口，绝不把停顿当答案
                        if (clean && looksLikeStall(clean)) {
                            if (nudges < 2 && Date.now() - t0 < BUDGET_MS) {
                                nudges++;
                                status("模型想先看看原文，催它继续…");
                                msgs.push({ role: "assistant", content: clean });
                                msgs.push({ role: "user", content: "上面已经给了你预检索到的相关原文，别再只说要去查了。请直接据此、以及必要时用 search 补充，一次性给出完整回答。" });
                                continue;
                            }
                            break;
                        }
                        if (clean) { answer = clean; break; }
                        break;
                    }

                    // 强制收口：还没答案就再来一发【不给工具 + 明确禁令】
                    if (!answer) {
                        status("整理线索，组织回答…");
                        const CLOSE = "请现在直接用中文回答读者的问题，基于以上信息作答。不要再说要去查找，不要调用任何工具，也不要输出任何函数调用/检索指令。";
                        const last = msgs[msgs.length - 1];
                        if (last && last.role === "user" && Array.isArray(last.content)) {
                            (last.content as unknown[]).push({ type: "text", text: CLOSE });
                        } else if (last && last.role === "user" && typeof last.content === "string") {
                            last.content += "\n\n" + CLOSE;
                        } else {
                            msgs.push({ role: "user", content: CLOSE });
                        }
                        const resp = await callHB(false, 24_000);
                        if (!("error" in resp)) {
                            recordUsage("ask", DS_MODEL, resp.usage);
                            const final = stripDsml(textOf(resp.content || []));
                            if (final && !looksLikeStall(final)) answer = final;
                        } else { loopErr = loopErr || resp.error; }
                    }
                    // 收口也没拿到答案：有过错误就报人话错误，否则报"没找到线索"
                    if (!answer) {
                        answer = loopErr
                            ? "AI 响应超时了，请再问一次（多半是模型那头临时抽风，重试通常就好）。"
                            : "这个问题我暂时没能从你已读的部分找到确定的答案，换个说法、或补充点线索再问我试试？";
                    }

                    console.log(`[book-ask] rounds=${rounds} tools=${toolCalls} nudges=${nudges} ms=${Date.now() - t0} err=${loopErr ? "Y" : "N"} ans=${answer.length}`);
                    send({ ev: "done", answer, toolCalls });
                } catch (e) {
                    send({ ev: "error", error: String(e) });
                } finally {
                    if (!closed) { try { controller.close(); } catch { /* 已关 */ } closed = true; }
                }
            },
            cancel() { closed = true; }, // 客户端断开：标记关闭，停止后续 enqueue
        });
        return new Response(stream, {
            headers: {
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache, no-transform",
                "X-Accel-Buffering": "no", // nginx 别缓冲，事件要实时到前端
            },
        });
    } catch (e) {
        return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
    }
}
