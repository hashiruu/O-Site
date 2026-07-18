import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { isPathUnder } from "@/lib/path-guard";

// 支持的媒体格式
const VIDEO_EXTS = new Set([".mp4", ".mkv", ".avi", ".mov", ".wmv", ".flv", ".webm", ".m4v", ".ts", ".rmvb"]);
const AUDIO_EXTS = new Set([".mp3", ".flac", ".wav", ".aac", ".ogg", ".m4a", ".wma"]);
const SUBTITLE_EXTS = new Set([".srt", ".ass", ".ssa", ".vtt", ".sub"]);
const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp"]);

export interface FileItem {
    name: string;
    path: string;
    isDirectory: boolean;
    size: number;
    modifiedAt: string;
    type: "video" | "audio" | "subtitle" | "image" | "other" | "directory";
    extension?: string;
}

function getFileType(ext: string): FileItem["type"] {
    if (VIDEO_EXTS.has(ext)) return "video";
    if (AUDIO_EXTS.has(ext)) return "audio";
    if (SUBTITLE_EXTS.has(ext)) return "subtitle";
    if (IMAGE_EXTS.has(ext)) return "image";
    return "other";
}

function formatSize(bytes: number): string {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

// GET /api/files?path=xxx
export async function GET(request: NextRequest) {
    try {
        // 文件巡航是后台功能（暴露完整文件树），仅 admin/boss；
        // boss 专属类别目录（private/travel/theater相册/日常）由 allows 进一步限 boss
        const { getAccess, canAdminSite, allows } = await import("@/lib/roles");
        const access = await getAccess(request);
        if (!canAdminSite(access.role)) {
            return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
        }

        const { searchParams } = new URL(request.url);
        const requestedPath = searchParams.get("path") || "/";

        // 获取允许的媒体目录
        const { getDb } = await import("@/lib/db");
        const db = getDb();
        const mediaDirs = db
            .prepare("SELECT value FROM settings WHERE key LIKE 'media_dir_%'")
            .all() as { value: string }[];

        const allowedPaths = mediaDirs.map((d) => {
            try {
                return JSON.parse(d.value);
            } catch {
                return { path: d.value };
            }
        }).filter((dir: any) => allows(access, dir.type)); // boss 专属目录仅 boss 可见

        // 如果请求根目录，返回已配置的媒体目录列表
        if (requestedPath === "/" || requestedPath === "") {
            const roots: FileItem[] = allowedPaths.map((dir: { path: string; name?: string; type?: string }) => ({
                name: dir.name || path.basename(dir.path),
                path: dir.path,
                isDirectory: true,
                size: 0,
                modifiedAt: new Date().toISOString(),
                type: "directory" as const,
            }));
            return NextResponse.json({
                success: true,
                data: { path: "/", items: roots, parent: null },
            });
        }

        // 安全检查：确保请求路径在允许的根目录下
        const resolvedPath = path.resolve(requestedPath);
        const isAllowed = allowedPaths.some((dir: { path: string }) =>
            isPathUnder(resolvedPath, dir.path)
        );

        if (!isAllowed) {
            return NextResponse.json(
                { success: false, error: "无权访问此路径" },
                { status: 403 }
            );
        }

        // boss 专属类别目录（含旅行相册根目录）按类别复核（防直接拼路径绕过根列表过滤）
        const { getDirTypeByPath } = await import("@/lib/mediaDirs");
        if (!allows(access, getDirTypeByPath(resolvedPath))) {
            return NextResponse.json({ success: false, error: "无权访问此路径" }, { status: 403 });
        }

        // 检查路径是否存在
        if (!fs.existsSync(resolvedPath)) {
            return NextResponse.json(
                { success: false, error: "路径不存在" },
                { status: 404 }
            );
        }

        const stat = fs.statSync(resolvedPath);

        if (!stat.isDirectory()) {
            return NextResponse.json(
                { success: false, error: "不是目录" },
                { status: 400 }
            );
        }

        // 读取目录内容
        const entries = fs.readdirSync(resolvedPath, { withFileTypes: true });
        const items: FileItem[] = [];

        for (const entry of entries) {
            // 跳过隐藏文件
            if (entry.name.startsWith(".")) continue;

            const fullPath = path.join(resolvedPath, entry.name);
            try {
                const entryStat = fs.statSync(fullPath);
                const ext = path.extname(entry.name).toLowerCase();

                items.push({
                    name: entry.name,
                    path: fullPath,
                    isDirectory: entry.isDirectory(),
                    size: entry.isDirectory() ? 0 : entryStat.size,
                    modifiedAt: entryStat.mtime.toISOString(),
                    type: entry.isDirectory() ? "directory" : getFileType(ext),
                    extension: entry.isDirectory() ? undefined : ext,
                });
            } catch {
                // 跳过无法读取的文件
                continue;
            }
        }

        // 排序：目录在前，然后按名称
        items.sort((a, b) => {
            if (a.isDirectory && !b.isDirectory) return -1;
            if (!a.isDirectory && b.isDirectory) return 1;
            return a.name.localeCompare(b.name, "zh-CN");
        });

        // 计算父目录
        const parentPath = path.dirname(resolvedPath);
        const isRoot = allowedPaths.some(
            (dir: { path: string }) => path.resolve(dir.path) === resolvedPath
        );

        return NextResponse.json({
            success: true,
            data: {
                path: resolvedPath,
                items,
                parent: isRoot ? "/" : parentPath,
                itemCount: items.length,
                videoCount: items.filter((i) => i.type === "video").length,
            },
        });
    } catch (error) {
        console.error("文件浏览失败:", error);
        return NextResponse.json(
            { success: false, error: "读取目录失败" },
            { status: 500 }
        );
    }
}
