import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs";
import { execFile } from "child_process";
import { FFMPEG_PATH, FFPROBE_PATH } from "@/lib/ffmpeg";
import crypto from "crypto";
import { getDb } from "@/lib/db";
import { isPathUnder } from "@/lib/path-guard";
import { Readable } from "stream";
import { ensureCacheCleaner } from "@/lib/cache-cleaner";

ensureCacheCleaner();

const CACHE_DIR = path.join(process.cwd(), "cache", "thumbnails");
const TIMEOUT_MS = 30000; // 30秒超时（ffprobe + ffmpeg 两步对 HEVC 需要更多时间）

// 基本的“加载失败” SVG 占位图
const ERROR_PLACEHOLDER_SVG = `data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjM2YzZjQ2IiBzdHJva2Utd2lkdGg9IjIiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCI+PHJlY3QgeD0iMyIgeT0iMyIgd2lkdGg9IjE4IiBoZWlnaHQ9IjE4IiByeD0iMiIgcnk9IjIiPjwvcmVjdD48Y2lyY2xlIGN4PSI4LjUiIGN5PSI4LjUiIHI9IjEuNSI+PC9jaXJjbGU+PHBvbHlsaW5lIHBvaW50cz0iMjEgMTUgMTYgMTAgNSAyMSI+PC9wb2x5bGluZT48L3N2Zz4=`;

let concurrentTasks = 0;
const MAX_CONCURRENT = 4;
const queue: (() => void)[] = [];

async function acquireLock() {
    if (concurrentTasks < MAX_CONCURRENT) {
        concurrentTasks++;
        return;
    }
    return new Promise<void>((resolve) => queue.push(resolve));
}

function releaseLock() {
    concurrentTasks--;
    if (queue.length > 0) {
        const next = queue.shift();
        if (next) {
            concurrentTasks++;
            next();
        }
    }
}

export async function GET(req: NextRequest) {
    try {
        // 支持通过 GET ?action=clear 清除缩略图缓存（方便浏览器地址栏直接触发）
        const action = req.nextUrl.searchParams.get("action");
        if (action === "clear") {
            if (fs.existsSync(CACHE_DIR)) {
                const files = fs.readdirSync(CACHE_DIR);
                let count = 0;
                for (const file of files) {
                    try { fs.unlinkSync(path.join(CACHE_DIR, file)); count++; } catch { }
                }
                return NextResponse.json({ success: true, message: `已清除 ${count} 个缩略图缓存` });
            }
            return NextResponse.json({ success: true, message: "缓存目录为空" });
        }

        const filePath = req.nextUrl.searchParams.get("filePath");
        if (!filePath) {
            return new NextResponse("Missing filePath", { status: 400 });
        }

        // 权限守卫：按内容类别对 scope，默认拒绝（boss 分配可见栏目）
        const { getCategoryByPath } = await import("@/lib/mediaDirs");
        const { getAccess, allows } = await import("@/lib/roles");
        if (!allows(await getAccess(req), getCategoryByPath(filePath))) {
            return new NextResponse("Forbidden", { status: 403 });
        }

        const resolvedPath = path.resolve(filePath);

        // --- 安全检查：确保路径在允许的媒体目录内 ---
        const db = getDb();
        const mediaDirs = db
            .prepare("SELECT value FROM settings WHERE key LIKE 'media_dir_%'")
            .all() as { value: string }[];

        const allowedPaths = mediaDirs.map((d) => {
            try { return JSON.parse(d.value).path; } catch { return d.value; }
        });

        const isAllowed = allowedPaths.some((dir: string) =>
            isPathUnder(resolvedPath, dir)
        );

        if (!isAllowed) {
            return new NextResponse("Forbidden Access", { status: 403 });
        }

        // --- 缓存机制 ---
        if (!fs.existsSync(CACHE_DIR)) {
            fs.mkdirSync(CACHE_DIR, { recursive: true });
        }

        const hash = crypto.createHash("md5").update(resolvedPath).digest("hex");
        const thumbPath = path.join(CACHE_DIR, `${hash}.jpg`);
        const errorFlagPath = path.join(CACHE_DIR, `${hash}.error`);

        // 第一层检查：已有正片缓存
        if (fs.existsSync(thumbPath)) {
            const nodeStream = fs.createReadStream(thumbPath);
            const webStream = Readable.toWeb(nodeStream) as any;
            return new NextResponse(webStream, {
                headers: {
                    "Content-Type": "image/jpeg",
                    "Cache-Control": "public, max-age=31536000, immutable",
                },
            });
        }

        // 第一层检查：已有错误标识缓存，避免重复尝试
        if (fs.existsSync(errorFlagPath)) {
            return new NextResponse(ERROR_PLACEHOLDER_SVG, {
                headers: { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=3600" }
            });
        }

        if (!fs.existsSync(resolvedPath)) {
            return new NextResponse("File Not Found", { status: 404 });
        }

        // --- 排队等待获取执行资源 ---
        await acquireLock();

        try {
            // 第二层检查 (Double-Check)
            if (fs.existsSync(thumbPath)) {
                const nodeStream = fs.createReadStream(thumbPath);
                const webStream = Readable.toWeb(nodeStream) as any;
                return new NextResponse(webStream, {
                    headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=31536000, immutable" },
                });
            }

            // --- 使用 FFmpeg 实时生成缩略图 (带超时) ---
            // 先用 ffprobe 获取视频时长，然后取中间位置 (duration/2) 抽帧
            return await new Promise<NextResponse>((resolve) => {
                const probeProcess = execFile(FFPROBE_PATH, [
                    "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", resolvedPath
                ], (probeErr, stdout) => {
                    let seekSeconds = 10; // 默认回退值
                    let retrySeekSeconds = 60; // 重试偏移
                    if (!probeErr && stdout.trim()) {
                        const totalDuration = parseFloat(stdout.trim());
                        if (!isNaN(totalDuration) && totalDuration > 0) {
                            seekSeconds = Math.floor(totalDuration / 3); // 取 1/3 处
                            retrySeekSeconds = Math.floor(totalDuration * 2 / 3); // 重试取 2/3 处
                        }
                    }

                    const generateThumb = (ss: number, onFail: () => void) => {
                        const ffmpegProcess = execFile(FFMPEG_PATH, [
                            "-loglevel", "error", "-y", "-ss", String(ss), "-i", resolvedPath,
                            "-vframes", "1", "-q:v", "5", "-vf", "scale=640:-2", thumbPath
                        ], (error) => {
                            if (error || !fs.existsSync(thumbPath)) {
                                onFail();
                                return;
                            }
                            // 黑帧检测：如果图片小于 3KB，很可能是纯黑帧，自动重试
                            const size = fs.statSync(thumbPath).size;
                            if (size < 3000 && ss !== retrySeekSeconds) {
                                fs.unlinkSync(thumbPath);
                                generateThumb(retrySeekSeconds, onFail);
                                return;
                            }
                            const nodeStream = fs.createReadStream(thumbPath);
                            const webStream = Readable.toWeb(nodeStream) as any;
                            resolve(new NextResponse(webStream, {
                                headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=31536000, immutable" },
                            }));
                        });
                        setTimeout(() => { try { ffmpegProcess.kill('SIGKILL'); } catch { } }, TIMEOUT_MS);
                    };

                    generateThumb(seekSeconds, () => {
                        // 最终回退到 0 秒
                        const fallbackProcess = execFile(FFMPEG_PATH, [
                            "-loglevel", "error", "-y", "-ss", "0", "-i", resolvedPath,
                            "-vframes", "1", "-q:v", "5", "-vf", "scale=640:-2", thumbPath
                        ], (err2) => {
                            if (err2 || !fs.existsSync(thumbPath)) {
                                console.error("Thumbnail generation error (all attempts failed)");
                                fs.writeFileSync(errorFlagPath, "FFmpeg failed");
                                resolve(new NextResponse(ERROR_PLACEHOLDER_SVG, {
                                    headers: { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=3600" }
                                }));
                                return;
                            }
                            const nodeStream = fs.createReadStream(thumbPath);
                            const webStream = Readable.toWeb(nodeStream) as any;
                            resolve(new NextResponse(webStream, {
                                headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=31536000, immutable" },
                            }));
                        });
                        setTimeout(() => { try { fallbackProcess.kill('SIGKILL'); } catch { } }, TIMEOUT_MS);
                    });
                });

                // ffprobe 本身的超时
                setTimeout(() => {
                    try { probeProcess.kill('SIGKILL'); } catch { }
                }, 5000);
            });
        } finally {
            releaseLock();
        }

    } catch (error) {
        console.error("Thumbnail API Error:", error);
        return new NextResponse("Internal Server Error", { status: 500 });
    }
}

// DELETE /api/media/thumbnail — 清除缩略图缓存
export async function DELETE() {
    try {
        if (fs.existsSync(CACHE_DIR)) {
            const files = fs.readdirSync(CACHE_DIR);
            let count = 0;
            for (const file of files) {
                try {
                    fs.unlinkSync(path.join(CACHE_DIR, file));
                    count++;
                } catch { }
            }
            return NextResponse.json({ success: true, message: `Cleared ${count} cached thumbnails` });
        }
        return NextResponse.json({ success: true, message: "Cache directory is empty" });
    } catch (error) {
        console.error("Thumbnail cache clear error:", error);
        return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
    }
}
