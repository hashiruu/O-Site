#!/usr/bin/env node
// 批量把任意命名的 .ass 弹幕文件按集号对齐到 danmaku/ 子目录：<视频目录>/danmaku/<视频basename>.ass
// 集号提取逻辑复刻 lib/scanner.ts 的 parseEpisode（SxxExx / 1x02 / EPxx / 第N集话 / _Pxx / 松散数字）。
// 用法：node scripts/align-danmaku.mjs <目录>           （dry-run，只打印将改什么）
//       node scripts/align-danmaku.mjs <目录> --apply   （真重命名）
import path from "node:path";
import fs from "node:fs";

const VIDEO_RE = /\.(mkv|mp4|avi|mov|flv|webm|m4v|ts|wmv|mpg|mpeg)$/i;
const ASS_RE = /\.ass$/i;

const CN_NUM_MAP = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
function parseCnNumber(s) { if (CN_NUM_MAP[s] !== undefined) return CN_NUM_MAP[s]; const n = parseInt(s); return isNaN(n) ? null : n; }

function parseEpisode(filename, fullPath = "") {
    let season = 1;
    if (fullPath) {
        for (const part of path.normalize(fullPath).split(path.sep).reverse()) {
            const sm = part.match(/[Ss](?:eason\s*)?(\d{1,2})/i);
            if (sm) { season = parseInt(sm[1]); break; }
            const cm = part.match(/第([一二三四五六七八九十\d]{1,2})季/);
            if (cm) { const p = parseCnNumber(cm[1]); if (p) { season = p; break; } }
        }
    }
    const cleanName = filename.toLowerCase().replace(/(2160|1080|720|480)p/g, "").replace(/[hx]26[45]/g, "");
    let m;
    if ((m = cleanName.match(/s(\d{1,2})e(\d{1,4})/))) return { season: parseInt(m[1]), episode: parseInt(m[2]) };
    if ((m = cleanName.match(/(?:^|[^a-z0-9])(\d{1,2})x(\d{1,4})(?:[^a-z0-9]|$)/))) return { season: parseInt(m[1]), episode: parseInt(m[2]) };
    if ((m = cleanName.match(/(?:^|[^a-z])[e][p]?(\d{1,4})/))) return { season, episode: parseInt(m[1]) };
    if ((m = filename.match(/第(\d{1,4})[集话]/))) return { season, episode: parseInt(m[1]) };
    if ((m = cleanName.match(/[_\s]p(\d{1,4})/))) return { season, episode: parseInt(m[1]) };
    if ((m = cleanName.match(/(?:^|\D)(\d{1,4})(?:\D|$)/))) return { season, episode: parseInt(m[1]) };
    return { season, episode: 0 };
}

function walk(dir, out = []) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p, out);
        else out.push(p);
    }
    return out;
}

const root = process.argv[2];
const apply = process.argv.includes("--apply");
if (!root) { console.error("用法: node scripts/align-danmaku.mjs <目录> [--apply]"); process.exit(1); }
const rootAbs = path.resolve(root);
if (!fs.existsSync(rootAbs)) { console.error("目录不存在:", rootAbs); process.exit(1); }

const files = walk(rootAbs);
const videos = [];
const asses = [];
for (const p of files) {
    if (VIDEO_RE.test(p)) {
        const { season, episode } = parseEpisode(path.basename(p), p);
        if (episode > 0) videos.push({ path: p, season, episode, key: `${season}:${episode}` });
    } else if (ASS_RE.test(p)) asses.push({ path: p });
}

// 视频按集号建索引；同集号冲突则丢弃（ass 不自动配对，交人工）
const videoMap = new Map();
const conflict = new Set();
for (const v of videos) {
    if (videoMap.has(v.key)) { conflict.add(v.key); videoMap.delete(v.key); }
    else videoMap.set(v.key, v);
}

console.log(`扫描: ${videos.length} 个视频（含集号）、${asses.length} 个 .ass 文件。${apply ? "【执行重命名】" : "【dry-run，加 --apply 真改】"}\n`);

let renamed = 0, skipped = 0, unmatched = 0;
for (const a of asses) {
    let base = path.basename(a.path, ".ass").replace(/\.danmaku$/i, "");
    const { season, episode } = parseEpisode(base, a.path);
    const v = videoMap.get(`${season}:${episode}`);
    if (!v) {
        console.log(`  ✗ 未配对 [${path.basename(a.path)}]（提取集号 ${episode || "?"}，无对应视频）`);
        unmatched++;
        continue;
    }
    const videoBase = path.basename(v.path, path.extname(v.path));
    const target = path.join(path.dirname(v.path), "danmaku", videoBase + ".ass");
    if (path.resolve(a.path) === path.resolve(target)) { skipped++; continue; }
    console.log(`  ${apply ? "→" : "·"} [${path.basename(a.path)}]  ⟶  danmaku/${videoBase}.ass`);
    if (apply) {
        try { fs.mkdirSync(path.dirname(target), { recursive: true }); fs.renameSync(a.path, target); renamed++; }
        catch (e) { console.error("    重命名失败:", e.message); }
    } else renamed++;
}

if (conflict.size) console.log(`\n⚠ 同集号视频冲突（${[...conflict].join(", ")}），对应 ass 跳过自动配对，请手动处理。`);
console.log(`\n完成: ${apply ? `已重命名 ${renamed}` : `将重命名 ${renamed}（dry-run）`}，跳过 ${skipped}（已是目标名），未配对 ${unmatched}。`);
if (!apply && renamed > 0) console.log(`确认无误后执行: node scripts/align-danmaku.mjs "${root}" --apply`);
