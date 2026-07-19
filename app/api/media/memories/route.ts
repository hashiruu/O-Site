// GET /api/media/memories → 找出今天月日落在某旅行相册 date 范围内且年份早于今年的相册
// date 格式 "YY.M-DD.M"，如 "26.6-31.5"（两端 年份.月份 用 - 分隔）
// 鉴权：与 travel-albums 一致（allows travel scope）
// 多个命中取年份最近一条；无命中返回 null
import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { getAccess, allows } from "@/lib/roles";
import { TRAVEL_ROOT as ROOT } from "@/lib/paths";

export const dynamic = "force-dynamic";

const IMG_RE = /\.(jpg|jpeg|png|webp)$/i;
const VID_RE = /\.(mov|mp4|avi|mts|m2ts|webm|mkv)$/i;

function parseDateParts(date: string): { year: number; monthA: number; monthB: number } | null {
  try {
    const parts = date.split("-");
    if (parts.length < 2) return null;
    const [partA, partB] = parts;
    const yearN = parseInt(partA.split(".")[0], 10);
    const monthA = parseInt(partA.split(".")[1], 10);
    const monthB = parseInt(partB.split(".")[1], 10);
    if (isNaN(yearN) || isNaN(monthA) || isNaN(monthB)) return null;
    const year = yearN >= 0 && yearN < 100 ? 2000 + yearN : yearN;
    return { year, monthA, monthB };
  } catch { return null; }
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!allows(await getAccess(req), "travel")) {
    return NextResponse.json({ success: false, error: "UNAUTHORIZED" }, { status: 401 });
  }
  try {
    const now = new Date();
    const todayM = now.getMonth() + 1;
    const currentYear = now.getFullYear();

    const entries = fs.readdirSync(ROOT, { withFileTypes: true }).filter((d) => d.isDirectory());

    const candidates: Array<{ name: string; title: string; date: string; poster: string; year: number; yearsAgo: number }> = [];

    for (const d of entries) {
      const nameParts = d.name.split("_");
      const date = nameParts[0] || "";
      const title = nameParts.slice(1).join(" ").trim() || d.name;

      const parsed = parseDateParts(date);
      if (!parsed) continue;
      const { year, monthA, monthB } = parsed;
      if (year >= currentYear) continue;

      const lo = Math.min(monthA, monthB);
      const hi = Math.max(monthA, monthB);
      // 跨年情况（hi-lo > 6 说明可能跨年，反转判断）
      const inRange = hi - lo <= 6
        ? todayM >= lo && todayM <= hi
        : todayM <= lo || todayM >= hi;
      if (!inRange) continue;

      // 生成封面
      const dir = path.join(ROOT, d.name);
      let files: string[] = [];
      try { files = fs.readdirSync(dir).filter((f) => !f.startsWith(".") && !fs.statSync(path.join(dir, f)).isDirectory()); } catch { /* noop */ }
      const photos = files.filter((f) => IMG_RE.test(f));
      const videos = files.filter((f) => VID_RE.test(f));
      const img = photos[0];
      const video = videos[0];
      const coverPath = img ? path.join(dir, img) : video ? path.join(dir, video) : "";
      const poster = img
        ? `/api/media/photo-thumb?filePath=${encodeURIComponent(coverPath)}`
        : video ? `/api/media/thumbnail?filePath=${encodeURIComponent(coverPath)}` : "";

      candidates.push({ name: d.name, title, date, poster, year, yearsAgo: currentYear - year });
    }

    if (candidates.length === 0) return NextResponse.json({ success: true, data: null });

    // 取年份最近（yearsAgo 最小）的一条
    candidates.sort((a, b) => a.yearsAgo - b.yearsAgo);
    const best = candidates[0];
    return NextResponse.json({
      success: true,
      data: { album: { name: best.name, title: best.title, date: best.date, poster: best.poster, year: best.year }, yearsAgo: best.yearsAgo }
    });
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
  }
}
