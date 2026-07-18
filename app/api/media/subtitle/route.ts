import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs";
import { getDb } from "@/lib/db";
import { isPathUnder } from "@/lib/path-guard";
import { execFile } from "child_process";
import os from "os";
import crypto from "crypto";
import { FFMPEG_PATH } from "@/lib/ffmpeg";
import { srtToVtt, isVtt } from "@/lib/subtitle";

// 外挂字幕查找与格式转换 API
// 注意：内嵌字幕由 /api/media/embedded-subtitle 提供，本接口只处理视频同目录的外部字幕文件，
// 避免 DPlayer 字幕层与原生 <track> 同时渲染同一条内嵌字幕（重影）。
export async function GET(req: NextRequest) {
    try {
        const filePath = req.nextUrl.searchParams.get("filePath");
        if (!filePath) {
            return new NextResponse("Missing filePath", { status: 400 });
        }

        // 权限守卫：字幕随视频本体走，同 stream 规则（默认拒绝）
        const { getCategoryByPath } = await import("@/lib/mediaDirs");
        const { getAccess, allows } = await import("@/lib/roles");
        if (!allows(await getAccess(req), getCategoryByPath(filePath))) {
            return new NextResponse("Forbidden", { status: 403 });
        }

        const videoPath = path.resolve(filePath);
        const videoDir = path.dirname(videoPath);
        const videoBase = path.basename(videoPath, path.extname(videoPath));

        // 查找外部字幕文件: .vtt > .srt > .ass
        const possibleExts = [".vtt", ".srt", ".ass", ".zh.vtt", ".zh.srt", ".en.vtt", ".en.srt"];
        let foundSubPath = "";

        for (const ext of possibleExts) {
            const subPath = path.join(videoDir, videoBase + ext);
            if (fs.existsSync(subPath)) {
                foundSubPath = subPath;
                break;
            }
        }

        if (!foundSubPath) {
            // 返回空 VTT（200）而非 404：DPlayer 总是挂载本接口，404 会在控制台刷错误
            return new NextResponse("WEBVTT\n\n", {
                headers: {
                    "Content-Type": "text/vtt; charset=utf-8",
                    "X-Subtitle-Found": "0",
                },
            });
        }

        const subContent = fs.readFileSync(foundSubPath, "utf-8");
        const ext = path.extname(foundSubPath).toLowerCase();

        let vttContent: string;
        if (ext === ".vtt") {
            vttContent = subContent;
        } else if (ext === ".srt") {
            vttContent = srtToVtt(subContent);
        } else {
            // .ass 等复杂格式交给 ffmpeg 转换
            vttContent = await convertToVttViaFfmpeg(foundSubPath);
        }

        return new NextResponse(vttContent, {
            headers: {
                "Content-Type": "text/vtt; charset=utf-8",
                "X-Subtitle-Found": "1",
            },
        });
    } catch (error) {
        console.error("Subtitle API Error:", error);
        return new NextResponse("Internal Server Error", { status: 500 });
    }
}

// 用 ffmpeg 把任意字幕文件转成 VTT
async function convertToVttViaFfmpeg(subPath: string): Promise<string> {
    const tmpVtt = path.join(os.tmpdir(), `nas-sub-${crypto.randomBytes(4).toString("hex")}.vtt`);
    try {
        await new Promise<void>((resolve, reject) => {
            execFile(FFMPEG_PATH, ["-i", subPath, "-f", "webvtt", "-y", tmpVtt], { timeout: 15000 }, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
        if (fs.existsSync(tmpVtt) && fs.statSync(tmpVtt).size > 0) {
            return fs.readFileSync(tmpVtt, "utf-8");
        }
        return "WEBVTT\n\n";
    } catch {
        return "WEBVTT\n\n";
    } finally {
        try { fs.unlinkSync(tmpVtt); } catch {}
    }
}

// 上传字幕并保存到视频同目录，命名为 视频名.vtt，下次自动加载
export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { filePath, content, originalName } = body;
        if (!filePath || !content) {
            return NextResponse.json({ error: "Missing filePath or content" }, { status: 400 });
        }

        const videoPath = path.resolve(filePath);

        // 安全校验：确保视频路径在媒体目录内
        const db = getDb();
        const mediaDirs = db.prepare("SELECT value FROM settings WHERE key LIKE 'media_dir_%'").all() as { value: string }[];
        const allowedPaths = mediaDirs.map(d => {
            try { return JSON.parse(d.value).path; } catch { return d.value; }
        });
        const isAllowed = allowedPaths.some((dir: string) => isPathUnder(videoPath, dir));
        if (!isAllowed) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }

        const videoDir = path.dirname(videoPath);
        const videoBase = path.basename(videoPath, path.extname(videoPath));

        // 统一转为 VTT
        let vttContent: string;
        if (isVtt(content)) {
            vttContent = content;
        } else if (originalName?.toLowerCase().endsWith(".ass") || /^\[Script Info\]/im.test(content)) {
            // ASS：写入临时文件交给 ffmpeg 转换
            const tmpAss = path.join(os.tmpdir(), `nas-upload-${crypto.randomBytes(4).toString("hex")}.ass`);
            fs.writeFileSync(tmpAss, content, "utf-8");
            try {
                vttContent = await convertToVttViaFfmpeg(tmpAss);
            } finally {
                try { fs.unlinkSync(tmpAss); } catch {}
            }
        } else {
            // 默认按 SRT 处理（仅转换时间戳逗号，不破坏正文）
            vttContent = srtToVtt(content);
        }

        // 先清除旧的已保存字幕（避免 .srt 和 .vtt 同时存在冲突）
        for (const oldExt of [".vtt", ".srt"]) {
            const oldPath = path.join(videoDir, videoBase + oldExt);
            if (fs.existsSync(oldPath)) {
                fs.unlinkSync(oldPath);
            }
        }

        const savePath = path.join(videoDir, videoBase + ".vtt");
        fs.writeFileSync(savePath, vttContent, "utf-8");

        console.log(`[Subtitle] Saved: ${savePath}`);
        // 返回转换后的内容，客户端直接用它挂载，保证「立即加载」与「下次自动加载」内容一致
        return NextResponse.json({ success: true, path: savePath, vttContent });
    } catch (error) {
        console.error("Subtitle save error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
