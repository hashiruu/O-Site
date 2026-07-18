// GET /api/media/travel-album?name=XX → 单个旅行相册的文件清单（照片 + 视频）。
// 照片走 /api/media/image 直读，视频走 /api/media/thumbnail 截图。
// 文件名 IMG_YYYYMMDD_HHMMSS 天然按名排序即时间序。
// dng/xmp/csv 等浏览器不可预览的文件忽略（不计入展示）。
import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { getAccess, allows } from "@/lib/roles";

export const dynamic = "force-dynamic";

import { TRAVEL_ROOT as ROOT } from "@/lib/paths";
const IMG_RE = /\.(jpg|jpeg|png|webp)$/i;
const VID_RE = /\.(mov|mp4|avi|mts|m2ts|webm|mkv)$/i;

export async function GET(req: NextRequest): Promise<NextResponse> {
    // 内容范围守卫：travel 类别需在用户 scope 内（boss/admin 全开）
    if (!allows(await getAccess(req), "travel")) {
        return NextResponse.json({ success: false, error: "UNAUTHORIZED" }, { status: 401 });
    }
    const name = req.nextUrl.searchParams.get("name");
    if (!name) return NextResponse.json({ success: false, error: "missing name" }, { status: 400 });

    // 防 path traversal：只取 basename，必须落在 ROOT 下
    const safe = path.basename(name);
    const dir = path.resolve(ROOT, safe);
    if (!dir.startsWith(ROOT) || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
        return NextResponse.json({ success: false, error: "not found" }, { status: 404 });
    }

    let files: string[] = [];
    try {
        files = fs.readdirSync(dir).filter((f) => !f.startsWith(".") && !fs.statSync(path.join(dir, f)).isDirectory());
    } catch { /* noop */ }
    files.sort();

    const photos = files
        .filter((f) => IMG_RE.test(f))
        .map((f) => {
            const p = path.join(dir, f);
            return {
                name: f,
                path: p,
                url: `/api/media/image?filePath=${encodeURIComponent(p)}`,          // 原图（lightbox）
                thumb: `/api/media/photo-thumb?filePath=${encodeURIComponent(p)}`,  // 缩略图（网格）
            };
        });
    const videos = files
        .filter((f) => VID_RE.test(f))
        .map((f) => {
            const p = path.join(dir, f);
            return { name: f, path: p, thumb: `/api/media/thumbnail?filePath=${encodeURIComponent(p)}` };
        });

    const cover = photos[0]?.thumb || (videos[0]?.thumb ?? "");

    const parts = safe.split("_");
    const date = parts[0] || "";
    const title = parts.slice(1).join(" ").trim() || safe;

    return NextResponse.json({
        success: true,
        data: { id: safe, title, date, cover, photos, videos, photoCount: photos.length, videoCount: videos.length },
    });
}
