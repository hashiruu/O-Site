import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs";
import { execFile } from "child_process";
import { getDb } from "@/lib/db";
import { isPathUnder } from "@/lib/path-guard";
import os from "os";
import crypto from "crypto";
import { FFMPEG_PATH } from "@/lib/ffmpeg";
import { srtToVtt, shiftVtt } from "@/lib/subtitle";

export async function GET(req: NextRequest) {
    try {
        const filePath = req.nextUrl.searchParams.get("filePath");
        const streamIndex = req.nextUrl.searchParams.get("streamIndex");
        // 时间平移（秒）：HLS -ss 起播时视频时间轴从 0 开始，字幕需要相应前移
        const offset = parseFloat(req.nextUrl.searchParams.get("offset") || "0") || 0;

        if (!filePath || streamIndex === null) {
            return NextResponse.json({ error: "Missing filePath or streamIndex" }, { status: 400 });
        }

        // 权限守卫：字幕随视频本体走，同 stream 规则（默认拒绝）
        const { getCategoryByPath } = await import("@/lib/mediaDirs");
        const { getAccess, allows } = await import("@/lib/roles");
        if (!allows(await getAccess(req), getCategoryByPath(filePath))) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }

        const resolvedPath = path.resolve(filePath);

        // 安全检查
        const db = getDb();
        const mediaDirs = db.prepare("SELECT value FROM settings WHERE key LIKE 'media_dir_%'").all() as { value: string }[];
        const allowedPaths = mediaDirs.map(d => {
            try { return JSON.parse(d.value).path; } catch { return d.value; }
        });
        const isAllowed = allowedPaths.some((dir: string) => isPathUnder(resolvedPath, dir));
        if (!isAllowed) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }

        if (!fs.existsSync(resolvedPath)) {
            return NextResponse.json({ error: "File not found" }, { status: 404 });
        }

        const idx = parseInt(streamIndex, 10);

        const tmpSrt = path.join(os.tmpdir(), `nas-sub-${crypto.randomBytes(4).toString("hex")}.srt`);

        try {
            // 用 ffmpeg 提取为 SRT 格式（通用中间格式）
            await new Promise<void>((resolve, reject) => {
                execFile(FFMPEG_PATH, [
                    "-i", resolvedPath,
                    "-map", `0:${idx}`,
                    "-f", "srt",
                    "-y",
                    tmpSrt
                ], { timeout: 30000 }, (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });

            if (!fs.existsSync(tmpSrt) || fs.statSync(tmpSrt).size === 0) {
                return new NextResponse("Subtitle extraction failed", { status: 500 });
            }

            const srtContent = fs.readFileSync(tmpSrt, "utf-8");
            let vttContent = srtToVtt(srtContent);
            if (offset) vttContent = shiftVtt(vttContent, offset);

            return new NextResponse(vttContent, {
                headers: { "Content-Type": "text/vtt; charset=utf-8" },
            });
        } finally {
            try { fs.unlinkSync(tmpSrt); } catch {}
        }
    } catch (error) {
        console.error("Embedded subtitle extraction error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
