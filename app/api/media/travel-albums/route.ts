// GET /api/media/travel-albums → 扫描旅行相册根目录，返回每个旅行文件夹 + 封面 + 文件数。
// 封面优先取文件夹内首张图片（jpg），否则取首个视频的截图（thumbnail API）。
// 私密化：旅行相册与私密空间同级，服务端验设备信任 cookie，未信任设备 401（防绕过 UI 直连）。
import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { getAccess, allows } from "@/lib/roles";

export const dynamic = "force-dynamic";

// 旅行相册根目录（settings media_dir 之一）
const ROOT = "/home/steven/mydrive/重要资料！/旅行相册";

export async function GET(req: NextRequest): Promise<NextResponse> {
    // 内容范围守卫：travel 类别需在用户 scope 内（boss/admin 全开）
    if (!allows(await getAccess(req), "travel")) {
        return NextResponse.json({ success: false, error: "UNAUTHORIZED" }, { status: 401 });
    }
    try {
        // 与详情页 travel-album 一致：只认浏览器可预览的照片/视频，dng/xmp/csv 等不计入
        const IMG_RE = /\.(jpg|jpeg|png|webp)$/i;
        const VID_RE = /\.(mov|mp4|avi|mts|m2ts|webm|mkv)$/i;
        const entries = fs.readdirSync(ROOT, { withFileTypes: true }).filter((d) => d.isDirectory());
        const albums = entries.map((d) => {
            const dir = path.join(ROOT, d.name);
            let files: string[] = [];
            try { files = fs.readdirSync(dir).filter((f) => !f.startsWith(".") && !fs.statSync(path.join(dir, f)).isDirectory()); } catch { /* noop */ }

            const photos = files.filter((f) => IMG_RE.test(f));
            const videos = files.filter((f) => VID_RE.test(f));
            const img = photos[0];
            const video = videos[0];
            const coverPath = img ? path.join(dir, img) : video ? path.join(dir, video) : "";
            const cover = img
                ? `/api/media/photo-thumb?filePath=${encodeURIComponent(coverPath)}`
                : video ? `/api/media/thumbnail?filePath=${encodeURIComponent(coverPath)}` : "";

            const parts = d.name.split("_");
            const date = parts[0] || "";
            const title = parts.slice(1).join(" ").trim() || d.name;

            const viewable = photos.length + videos.length;
            return {
                id: d.name,
                name: d.name,
                title,
                type: "travel",
                date,
                path: dir,
                poster: cover,
                episodeCount: viewable,
                count: viewable,
                cover,
                hasContent: viewable > 0,
            };
        })
        .filter((a) => a.hasContent) // 隐藏无可展示照片/视频的空相册
        .sort((a, b) => b.date.localeCompare(a.date)); // 按旅行日期倒序（最新在前）

        return NextResponse.json({ success: true, data: albums });
    } catch (e) {
        return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
    }
}
