// GET /api/danmaku/ass?filePath=<视频绝对路径>
// 找该集的 ASS 弹幕 → 解析成 DPlayer 弹幕数组 → 磁盘缓存。
// 匹配顺序：① danmaku/<视频basename>.ass 精确同名（兼容重命名过）
//          ② 按视频集号匹配 danmaku/ 下任意命名的 ass（B站长名直接可用）
// 返回 DPlayer addition api 格式 { code:0, data:[[time,type,color,author,text]] }。
import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { getDb } from "@/lib/db";
import { isPathUnder } from "@/lib/path-guard";
import { parseAssToDanmaku } from "@/lib/ass-danmaku";
import { parseEpisode } from "@/lib/scanner";

export const dynamic = "force-dynamic";

const CACHE_DIR = path.join(process.cwd(), "cache", "ass-danmaku");

// danmaku/ 目录「集号→ass路径」映射缓存：按目录 mtime 失效，避免每次扫整个目录
let dirMapCache: { dir: string; mtime: number; map: Map<number, string> } | null = null;

function getDanmakuDirMap(dir: string): Map<number, string> {
    let mtime = 0;
    try { mtime = fs.statSync(dir).mtimeMs; } catch { return new Map(); }
    if (dirMapCache && dirMapCache.dir === dir && dirMapCache.mtime === mtime) return dirMapCache.map;
    const map = new Map<number, string>();
    try {
        for (const f of fs.readdirSync(dir)) {
            if (!f.toLowerCase().endsWith(".ass")) continue;
            const ep = parseEpisode(f).episode;
            if (ep > 0 && !map.has(ep)) map.set(ep, path.join(dir, f));
        }
    } catch { /* 目录不存在或不可读 */ }
    dirMapCache = { dir, mtime, map };
    return map;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
    const filePath = req.nextUrl.searchParams.get("filePath");
    if (!filePath) return NextResponse.json({ code: 0, data: [] });

    const resolved = path.resolve(filePath);

    // 安全：必须在某个 media_dir 下（与 photo-thumb route 一致）
    const db = getDb();
    const dirs = db.prepare("SELECT value FROM settings WHERE key LIKE 'media_dir_%'").all() as { value: string }[];
    const allowed = dirs.some((d) => {
        try { return isPathUnder(resolved, JSON.parse(d.value).path); }
        catch { return isPathUnder(resolved, d.value); }
    });
    if (!allowed) return NextResponse.json({ code: 0, data: [] });

    const videoDir = path.dirname(resolved);
    const videoBase = path.basename(resolved, path.extname(resolved));
    const dmDir = path.join(videoDir, "danmaku");

    // ① 精确同名 → ② 按视频集号匹配
    let assPath = path.join(dmDir, videoBase + ".ass");
    if (!fs.existsSync(assPath)) {
        const ep = parseEpisode(path.basename(resolved), resolved).episode;
        if (ep > 0) assPath = getDanmakuDirMap(dmDir).get(ep) || "";
    }
    if (!assPath || !fs.existsSync(assPath)) return NextResponse.json({ code: 0, data: [] });

    let stat: fs.Stats;
    try { stat = fs.statSync(assPath); } catch { return NextResponse.json({ code: 0, data: [] }); }

    if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
    const key = crypto.createHash("md5").update(`${assPath}@${stat.mtimeMs}`).digest("hex");
    const cachePath = path.join(CACHE_DIR, `${key}.json`);

    if (fs.existsSync(cachePath)) {
        try {
            const cached = JSON.parse(fs.readFileSync(cachePath, "utf-8"));
            return NextResponse.json({ code: 0, data: cached });
        } catch { /* 缓存损坏，重新解析 */ }
    }

    let data;
    try {
        const ass = fs.readFileSync(assPath, "utf-8").replace(/^﻿/, ""); // strip BOM
        data = parseAssToDanmaku(ass);
    } catch {
        return NextResponse.json({ code: 0, data: [] });
    }

    try { fs.writeFileSync(cachePath, JSON.stringify(data)); } catch { /* 缓存写失败不影响返回 */ }
    return NextResponse.json({ code: 0, data });
}
