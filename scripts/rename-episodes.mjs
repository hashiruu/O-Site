#!/usr/bin/env node
// 手动重命名剧集 mkv 为「第N集 中文名」+ 同步 DB episodes.path/title。
// 中文名从 danmaku/*.ass 文件名提取（"B...- 第N话 中文名.ass"）。
// 可重复跑（已重命名的跳过）。新导入的集会被重命名 + DB 同步。
// 用法：node scripts/rename-episodes.mjs [目录]   （目录默认柯南）
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dir = process.argv[2]; if (!dir) { console.error("usage: node rename-episodes.mjs <dir>"); process.exit(1); }
const db = new Database(path.resolve(__dirname, "..", "data", "nas-media.db"));
const assDir = path.join(dir, "danmaku");

function parseEpisode(fn) {
    let s = 1;
    const c = fn.toLowerCase().replace(/(2160|1080|720|480)p/g, "").replace(/[hx]26[45]/g, "");
    let m;
    if ((m = c.match(/s(\d{1,2})e(\d{1,4})/))) return { season: +m[1], episode: +m[2] };
    if ((m = c.match(/(?:^|[^a-z0-9])(\d{1,2})x(\d{1,4})(?:[^a-z0-9]|$)/))) return { season: +m[1], episode: +m[2] };
    if ((m = c.match(/(?:^|[^a-z])[e][p]?(\d{1,4})/))) return { season: s, episode: +m[1] };
    if ((m = fn.match(/第(\d{1,4})[集话]/))) return { season: s, episode: +m[1] };
    if ((m = c.match(/[_\s]p(\d{1,4})/))) return { season: s, episode: +m[1] };
    if ((m = c.match(/(?:^|\D)(\d{1,4})(?:\D|$)/))) return { season: s, episode: +m[1] };
    return { season: s, episode: 0 };
}

// ass 名提取 {集号: 中文名}
const assMap = new Map();
if (fs.existsSync(assDir)) {
    for (const f of fs.readdirSync(assDir)) {
        if (!f.endsWith(".ass")) continue;
        const m = f.match(/第(\d+)话\s*(.+?)\.ass$/);
        if (m) assMap.set(+m[1], m[2].trim());
    }
}

function findMkv(d, out = []) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        if (e.name.startsWith(".") || e.name === "danmaku") continue;
        const p = path.join(d, e.name);
        if (e.isDirectory()) findMkv(p, out);
        else if (/\.mkv$/i.test(e.name)) out.push(p);
    }
    return out;
}

let renamed = 0, noCn = 0;
for (const mkv of findMkv(dir)) {
    const pe = parseEpisode(path.basename(mkv));
    if (!pe.episode) continue;
    const cn = assMap.get(pe.episode);
    const newBase = cn ? `第${pe.episode}集 ${cn}.mkv` : `第${pe.episode}集.mkv`;
    const newPath = path.join(path.dirname(mkv), newBase);
    if (path.resolve(mkv) === path.resolve(newPath)) continue;  // 已重命名，跳过
    if (!cn) noCn++;
    fs.renameSync(mkv, newPath);
    db.prepare("UPDATE episodes SET path = ?, title = ? WHERE path = ?").run(newPath, cn || `第${pe.episode}集`, mkv);
    renamed++;
}

console.log(`ass 中文名库: ${assMap.size} 集`);
console.log(`重命名 ${renamed} 集${noCn ? `（其中 ${noCn} 集无中文名，用"第N集"占位）` : ""}`);
