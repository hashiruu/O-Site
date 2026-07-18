import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { Readable } from "stream";
import { getDb } from "@/lib/db";
import { isPathUnder } from "@/lib/path-guard";
import { getCategoryByPath } from "@/lib/mediaDirs";
import { getAccess, allows } from "@/lib/roles";

// /api/media/stream?filePath="..."
export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const filePath = searchParams.get("filePath");

        if (!filePath) {
            return new NextResponse("Missing filePath", { status: 400 });
        }

        // --- 权限守卫：默认拒绝。boss/admin 全过；其余按内容类别对 scope（boss 分配）；类别未知也拒 ---
        const access = await getAccess(request);
        if (!allows(access, getCategoryByPath(filePath))) {
            return new NextResponse("Forbidden — 需管理员授权", { status: 403 });
        }

        // --- 省流量通道：公网入口的受限用户禁止直连视频原文件，必须走 HLS 转码（720p30）---
        const VIDEO_EXT_RE = /\.(mp4|m4v|webm|mkv|avi|mov|wmv|flv|rmvb|ts|mts|m2ts)$/i;
        const { isBandwidthLimited } = await import("@/lib/access");
        if (isBandwidthLimited(request, access) && VIDEO_EXT_RE.test(filePath)) {
            return new NextResponse("EXTERNAL_HLS_ONLY — 外网通道请使用转码播放", { status: 403 });
        }

        // --- 安全检查：确保路径在允许的媒体目录内 ---
        const db = getDb();
        const mediaDirs = db
            .prepare("SELECT value FROM settings WHERE key LIKE 'media_dir_%'")
            .all() as { value: string }[];

        const allowedPaths = mediaDirs.map((d) => {
            try { return JSON.parse(d.value).path; } catch { return d.value; }
        });

        const resolvedPath = path.resolve(filePath);
        const isAllowed = allowedPaths.some((dir: string) =>
            isPathUnder(resolvedPath, dir)
        );

        if (!isAllowed) {
            return new NextResponse("Forbidden Access", { status: 403 });
        }

        if (!fs.existsSync(resolvedPath)) {
            return new NextResponse("File Not Found", { status: 404 });
        }

        const stat = fs.statSync(resolvedPath);
        if (!stat.isFile()) {
            return new NextResponse("Not a file", { status: 400 });
        }

        const fileSize = stat.size;

        // --- 处理 Range 请求 ---
        const range = request.headers.get("range");
        if (range) {
            // 规范解析 bytes=start-end / bytes=start- / bytes=-suffix（Safari 等用后缀 Range）。
            // 旧实现 split("-")+parseInt 对 bytes=-500 会得 start=NaN，416 守卫 (NaN>=fileSize)=false 放行
            // → Content-Length:"NaN" + createReadStream({start:NaN}) 崩（报告 #16）。
            const m = range.match(/^bytes=(\d*)-(\d*)$/);
            let start: number, end: number;
            const rangeNotSatisfiable = () => new NextResponse(null, {
                status: 416,
                headers: { "Content-Range": `bytes */${fileSize}` },
            });
            if (!m) return rangeNotSatisfiable();
            if (m[1] === "") {
                // 后缀范围 bytes=-N：返回最后 N 字节
                const suffix = parseInt(m[2], 10);
                if (isNaN(suffix) || suffix <= 0) return rangeNotSatisfiable();
                start = Math.max(0, fileSize - suffix);
                end = fileSize - 1;
            } else {
                start = parseInt(m[1], 10);
                if (isNaN(start)) return rangeNotSatisfiable();
                end = m[2] === "" ? fileSize - 1 : parseInt(m[2], 10);
                if (isNaN(end)) end = fileSize - 1;
            }

            if (start >= fileSize || start > end || start < 0) {
                return rangeNotSatisfiable();
            }

            const chunkSize = end - start + 1;
            const nodeStream = fs.createReadStream(resolvedPath, { start, end });
            const webStream = Readable.toWeb(nodeStream) as any;

            const ext = path.extname(resolvedPath).toLowerCase();
            const getContentType = () => {
                if (ext === ".mp4" || ext === ".m4v") return "video/mp4";
                if (ext === ".webm") return "video/webm";
                if (ext === ".mkv") return "video/x-matroska";
                if (ext === ".avi") return "video/x-msvideo";
                if (ext === ".mov") return "video/quicktime";
                if (ext === ".ts") return "video/mp2t";
                if (ext === ".mp3") return "audio/mpeg";
                if (ext === ".flac") return "audio/flac";
                return "application/octet-stream";
            };

            return new NextResponse(webStream, {
                status: 206,
                headers: {
                    "Content-Range": `bytes ${start}-${end}/${fileSize}`,
                    "Accept-Ranges": "bytes",
                    "Content-Length": chunkSize.toString(),
                    "Content-Type": getContentType(),
                },
            });
        }

        // --- 如果不支持 Range 或者请求整个文件 ---
        const nodeStream = fs.createReadStream(resolvedPath);
        const webStream = Readable.toWeb(nodeStream) as any;
        return new NextResponse(webStream, {
            status: 200,
            headers: {
                "Content-Length": fileSize.toString(),
                "Content-Type": "application/octet-stream",
            },
        });
    } catch (error) {
        console.error("流媒体服务错误:", error);
        return new NextResponse("Internal Server Error", { status: 500 });
    }
}
