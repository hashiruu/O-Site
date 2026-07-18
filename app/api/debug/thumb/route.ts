import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import { FFMPEG_PATH, FFPROBE_PATH } from "@/lib/ffmpeg";
import { getDb } from "@/lib/db";
import { isPathUnder } from "@/lib/path-guard";
import path from "path";
import fs from "fs";

// 校验路径在已配置的媒体目录内（报告 #4：原只 existsSync，可探测任意文件）
function isMediaPath(resolvedPath: string): boolean {
    const dirs = getDb().prepare("SELECT value FROM settings WHERE key LIKE 'media_dir_%'").all() as { value: string }[];
    return dirs.some((d) => {
        let p: string;
        try { p = JSON.parse(d.value).path; } catch { p = d.value; }
        return isPathUnder(resolvedPath, p);
    });
}

// 调试用：测试 ffprobe 和 ffmpeg 对指定视频的工作情况
export async function GET(req: NextRequest) {
    // 后台功能守卫：仅 admin/boss
    {
        const { getAccess, canAdminSite } = await import("@/lib/roles");
        if (!canAdminSite((await getAccess(req)).role)) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }
    }
    const filePath = req.nextUrl.searchParams.get("filePath");
    if (!filePath) {
        return NextResponse.json({ error: "Missing filePath" });
    }

    const resolvedPath = path.resolve(filePath);
    if (!isMediaPath(resolvedPath)) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (!fs.existsSync(resolvedPath)) {
        return NextResponse.json({ error: "File not found", resolvedPath });
    }

    const results: any = { resolvedPath, steps: [] };

    // Step 1: ffprobe 获取时长
    const probeDuration = await new Promise<string>((resolve) => {
        execFile(FFPROBE_PATH, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", resolvedPath], (err, stdout, stderr) => {
            results.steps.push({
                step: "ffprobe duration",
                stdout: stdout.trim(),
                stderr: stderr.trim(),
                error: err ? err.message : null
            });
            resolve(stdout.trim());
        });
    });

    const duration = parseFloat(probeDuration);
    const seekSeconds = !isNaN(duration) && duration > 0 ? Math.floor(duration / 2) : 10;
    results.duration = duration;
    results.seekSeconds = seekSeconds;

    // Step 2: ffprobe 获取编码信息
    await new Promise<void>((resolve) => {
        execFile(FFPROBE_PATH, ["-v", "error", "-show_entries", "stream=codec_name,codec_type,width,height", "-of", "json", resolvedPath], (err, stdout, stderr) => {
            try {
                results.streams = JSON.parse(stdout);
            } catch {
                results.streams = { raw: stdout.trim(), error: err?.message };
            }
            resolve();
        });
    });

    // Step 3: 尝试在 seekSeconds 位置抽帧
    const testThumbPath = `/tmp/debug_thumb_${Date.now()}.jpg`;
    await new Promise<void>((resolve) => {
        execFile(FFMPEG_PATH, ["-loglevel", "verbose", "-y", "-ss", String(seekSeconds), "-i", resolvedPath, "-vframes", "1", "-q:v", "5", "-s", "640x360", testThumbPath], (err, stdout, stderr) => {
            results.steps.push({
                step: `ffmpeg extract at ${seekSeconds}s`,
                thumbExists: fs.existsSync(testThumbPath),
                thumbSize: fs.existsSync(testThumbPath) ? fs.statSync(testThumbPath).size : 0,
                stderr: stderr.trim().slice(-500),
                error: err ? err.message : null
            });
            // 清理
            try { if (fs.existsSync(testThumbPath)) fs.unlinkSync(testThumbPath); } catch { }
            resolve();
        });
    });

    return NextResponse.json(results, { status: 200 });
}
