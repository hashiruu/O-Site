// ASS 弹幕解析器：把 SubStation Alpha 字幕（B站/弹幕Play 导出的弹幕 .ass）
// 解析成 DPlayer 弹幕数组 [time(秒), type(0滚/1顶/2底), color(十进制int), author, text]。
// 纯字符串/正则，无依赖；丢弃精确坐标/字体/动画，简化为滚动/顶部/底部三态。
//
// DPlayer 弹幕格式见 app/api/danmaku/v3/route.ts:21-27。
export type DPlayerDanmaku = [number, number, number, string, string];

const FALLBACK_COLOR = 0xffffff; // 白

/** 解析 ASS 颜色 &H[AA]BBGGRR& → DPlayer 用的 RRGGBB 十进制 int */
function parseAssColor(raw: string, fallback = FALLBACK_COLOR): number {
    const m = raw.replace(/&/g, "").match(/^H?([0-9A-Fa-f]+)$/);
    if (!m) return fallback;
    let hex = m[1];
    if (hex.length === 8) hex = hex.slice(2);       // 去前导 Alpha
    else if (hex.length < 6) hex = hex.padStart(6, "0");
    else if (hex.length > 6) hex = hex.slice(-6);
    const bb = hex.slice(0, 2), gg = hex.slice(2, 4), rr = hex.slice(4, 6);
    return parseInt(rr + gg + bb, 16);
}

/** ASS 时间 H:MM:SS.cc（centiseconds）→ 秒 */
function parseAssTime(t: string): number {
    const m = t.trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{2})(?:[.,](\d{1,3}))?$/);
    if (!m) return 0;
    const h = +(m[1] || 0), min = +m[2], sec = +m[3];
    let frac = 0;
    if (m[4]) {
        // ASS 时间小数是 centiseconds（1/100 秒）。原实现 1 位走 /1000 → 0:00:05.5 被算成 5.005 秒（报告第四章）。
        // 修正：1/2 位按 centiseconds（1 位补前导 0 → 百分位语义），3 位按毫秒。
        if (m[4].length >= 3) frac = +m[4] / 1000;
        else frac = +m[4].padStart(2, "0") / 100;
    }
    return h * 3600 + min * 60 + sec + frac;
}

/** 按 ASS Format 列数切行：前 N-1 列按逗号切，最后一列（Text，可能含逗号）整体保留 */
function splitAssFields(body: string, numCols: number): string[] {
    const parts = body.split(",");
    if (parts.length <= numCols) return parts;
    const head = parts.slice(0, numCols - 1);
    head.push(parts.slice(numCols - 1).join(","));
    return head;
}

interface DialogueMeta { text: string; type: number; color: number; }

/** 处理一行 Dialogue 的 Text（含覆盖标签）→ 纯文本 + type + 行内色 */
function processDialogue(rawText: string, styleColor: number): DialogueMeta | null {
    // drawing 命令（\p1 模式）跳过
    if (/\\p1\b/.test(rawText)) return null;

    const tagStr = (rawText.match(/\{[^}]*\}/g) || []).join(" ");
    const hasMove = /\\move\b/.test(tagStr);
    const hasPos = /\\pos\b/.test(tagStr);
    const anMatch = tagStr.match(/\\an(\d)/);
    const an = anMatch ? +anMatch[1] : 0;
    const colorMatch = tagStr.match(/\\(?:1c|c)&H([0-9A-Fa-f]+)&?/i);
    const color = colorMatch ? parseAssColor(colorMatch[1]) : styleColor;

    // 剥离所有 {...} 标签，转义换行/硬空格
    const text = rawText.replace(/\{[^}]*\}/g, "").replace(/\\N|\\n|\\h/gi, " ").trim();
    if (!text) return null;

    let type: number;
    if (hasMove) type = 0;                       // \move → 滚动
    else if (an >= 7 && an <= 9) type = 1;       // 顶部固定
    else if (an >= 1 && an <= 3) type = 2;       // 底部固定
    else if (hasPos) type = 1;                   // \pos 无 an → 当顶部
    else type = 0;                               // 默认滚动

    return { text, type, color };
}

/** ASS 全文 → DPlayer 弹幕数组（按时间升序） */
export function parseAssToDanmaku(ass: string): DPlayerDanmaku[] {
    const lines = ass.split(/\r?\n/);
    let section = "";
    let defaultColor = FALLBACK_COLOR;
    let formatCols: string[] = [];
    const out: DPlayerDanmaku[] = [];

    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) continue;

        const sec = line.match(/^\[(.+)\]$/);
        if (sec) {
            section = sec[1].toLowerCase();
            continue;
        }

        // 默认色：取 Default style 的 PrimaryColour
        if (section === "v4+ styles" || section === "v4 styles") {
            if (line.startsWith("Format:")) {
                formatCols = line.slice(7).split(",").map((s) => s.trim().toLowerCase());
            } else if (line.startsWith("Style:")) {
                const fields = splitAssFields(line.slice(6), Math.max(formatCols.length, 3));
                const nameIdx = formatCols.indexOf("name");
                const colorIdx = formatCols.indexOf("primarycolour");
                const name = (nameIdx >= 0 ? fields[nameIdx] : fields[0]) || "";
                if (/default/i.test(name.trim()) && colorIdx >= 0) {
                    defaultColor = parseAssColor(fields[colorIdx]);
                }
            }
            continue;
        }

        if (section === "events") {
            if (line.startsWith("Format:")) {
                formatCols = line.slice(7).split(",").map((s) => s.trim().toLowerCase());
                continue;
            }
            if (!line.startsWith("Dialogue:")) continue;

            const body = line.slice("Dialogue:".length);
            const cols = Math.max(formatCols.length, 10);
            const fields = splitAssFields(body, cols);
            const idx = (k: string) => formatCols.indexOf(k);
            const startIdx = idx("start");
            const textIdx = idx("text");
            const nameIdx = idx("name");
            if (startIdx < 0 || textIdx < 0) continue;

            const time = parseAssTime(fields[startIdx]);
            const meta = processDialogue(fields[textIdx] ?? "", defaultColor);
            if (!meta) continue;
            const author = (nameIdx >= 0 ? (fields[nameIdx] || "").trim() : "") || "ASS";
            out.push([time, meta.type, meta.color, author, meta.text]);
        }
    }

    out.sort((a, b) => a[0] - b[0]);
    return out;
}
