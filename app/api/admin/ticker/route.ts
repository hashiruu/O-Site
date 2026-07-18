// GET /api/admin/ticker — 后台走马灯的每日情报（替代硬编码推荐文案）。
// 内容：库藏统计 / 近7天入库 / 最新入库 / 媒体盘余量 / TMDB 今日全球热门（zh-CN）。
// 按天缓存在进程内：同一天内多次访问不重复算磁盘和打 TMDB。
import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import { getDb } from "@/lib/db";
import { getAccess, canAdminSite } from "@/lib/roles";

export const dynamic = "force-dynamic";

type TickerCache = { day: string; items: string[] };
const g = globalThis as typeof globalThis & { __nasTicker?: TickerCache };

async function buildItems(): Promise<string[]> {
    const db = getDb();
    const items: string[] = [];

    // 库藏总览
    try {
        const rows = db.prepare("SELECT type, COUNT(*) as c FROM media GROUP BY type").all() as { type: string; c: number }[];
        const by: Record<string, number> = {};
        let total = 0;
        for (const r of rows) { by[r.type] = r.c; total += r.c; }
        items.push(`📚 馆藏 ${total} 部 · 电影 ${by.movie || 0} / 剧集 ${by.series || 0} / 动漫 ${by.anime || 0} / 相册 ${by.travel || 0}`);
    } catch { /* 单项失败不影响其余 */ }

    // 近 7 天入库 + 最新三部
    try {
        const added = (db.prepare("SELECT COUNT(*) as c FROM media WHERE created_at >= datetime('now','-7 day')").get() as { c: number }).c;
        const latest = db.prepare("SELECT title FROM media WHERE type != 'private' ORDER BY created_at DESC LIMIT 3").all() as { title: string }[];
        const names = latest.map(l => l.title).join(" / ");
        items.push(`🆕 近 7 天入库 ${added} 部${names ? ` · 最新：${names}` : ""}`);
    } catch { }

    // 媒体盘余量（取第一个媒体目录所在盘）
    try {
        const dirRow = db.prepare("SELECT value FROM settings WHERE key LIKE 'media_dir_%' LIMIT 1").get() as { value: string } | undefined;
        let base = process.cwd();
        if (dirRow) { try { base = JSON.parse(dirRow.value).path || base; } catch { base = dirRow.value; } }
        const st = fs.statfsSync(base);
        const freeGB = (st.bavail * st.bsize) / 1024 ** 3;
        const totalGB = (st.blocks * st.bsize) / 1024 ** 3;
        items.push(`💾 媒体盘剩余 ${freeGB.toFixed(0)}G / 共 ${totalGB.toFixed(0)}G（已用 ${(100 - freeGB / totalGB * 100).toFixed(0)}%）`);
    } catch { }

    // TMDB 今日全球热门（有 key 才附带；外网失败不阻塞）
    try {
        const keyRow = db.prepare("SELECT value FROM settings WHERE key = 'tmdb_api_key'").get() as { value: string } | undefined;
        if (keyRow?.value) {
            const res = await fetch(
                `https://api.themoviedb.org/3/trending/all/day?api_key=${keyRow.value}&language=zh-CN`,
                { signal: AbortSignal.timeout(8000) }
            );
            const data = await res.json();
            const names = (data.results || [])
                .slice(0, 8)
                .map((r: any) => r.title || r.name)
                .filter(Boolean)
                .join(" / ");
            if (names) items.push(`🔥 TMDB 今日热门：${names}`);
        }
    } catch { }

    if (items.length === 0) items.push("后台情报暂不可用");
    return items;
}

export async function GET(req: NextRequest) {
    try {
        if (!canAdminSite((await getAccess(req)).role)) {
            return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
        }

        const day = new Date().toISOString().slice(0, 10);
        if (g.__nasTicker?.day !== day) {
            g.__nasTicker = { day, items: await buildItems() };
        }
        return NextResponse.json({ success: true, items: g.__nasTicker.items, day });
    } catch (err) {
        console.error("Ticker API error:", err);
        return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
    }
}
