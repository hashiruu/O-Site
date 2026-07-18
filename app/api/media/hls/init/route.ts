import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs";
import { execFile } from "child_process";
import crypto from "crypto";
import os from "os";
import { getDb } from "@/lib/db";
import { isPathUnder } from "@/lib/path-guard";
import { FFMPEG_PATH, FFPROBE_PATH } from "@/lib/ffmpeg";
import { startSession, ensureReaper, HLS_TEMP_DIR } from "@/lib/hls-manager";

const IMAGE_SUB_CODECS = ["pgssub", "hdmv_pgs_subtitle", "dvd_subtitle", "vobsub", "dvb_subtitle", "dvdsub"];

function probeStreams(filePath: string, selector: string): Promise<any[]> {
    return new Promise((resolve) => {
        execFile(FFPROBE_PATH, [
            "-v", "quiet", "-print_format", "json", "-show_streams",
            "-select_streams", selector, filePath,
        ], { timeout: 10000 }, (err, stdout) => {
            if (err) { resolve([]); return; }
            try { resolve(JSON.parse(stdout || "{}").streams || []); } catch { resolve([]); }
        });
    });
}

export async function POST(req: NextRequest) {
    try {
        ensureReaper();
        const body = await req.json();
        const filePath = body.filePath;
        const startTime = body.startTime || 0;
        const audioIndex = body.audioIndex !== undefined ? body.audioIndex : null;
        const subtitleIndex = body.subtitleIndex !== undefined ? body.subtitleIndex : null;
        let remux = body.remux === true; // 智能转封装模式：视频直接复制，仅转码音频

        if (!filePath) {
            return NextResponse.json({ error: "Missing filePath" }, { status: 400 });
        }

        // 权限守卫：与 /api/media/stream 同规则（HLS 是另一条播放通道，之前漏守卫=播放旁路）
        const { getCategoryByPath } = await import("@/lib/mediaDirs");
        const { getAccess, allows } = await import("@/lib/roles");
        const access = await getAccess(req);
        if (!allows(access, getCategoryByPath(filePath))) {
            return NextResponse.json({ error: "Forbidden — 需管理员授权" }, { status: 403 });
        }

        // 省流量通道：公网入口的受限用户强制完整转码（禁 remux 视频复制），输出锁 720p/30fps
        const { isBandwidthLimited } = await import("@/lib/access");
        const limited = isBandwidthLimited(req, access);
        if (limited) remux = false;

        const db = getDb();
        const mediaDirs = db.prepare("SELECT value FROM settings WHERE key LIKE 'media_dir_%'").all() as { value: string }[];
        const allowedPaths = mediaDirs.map(d => {
            try { return JSON.parse(d.value).path; } catch { return d.value; }
        });

        const resolvedPath = path.resolve(filePath);
        const isAllowed = allowedPaths.some((dir: string) => isPathUnder(resolvedPath, dir));
        if (!isAllowed) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }
        if (!fs.existsSync(resolvedPath)) {
            return NextResponse.json({ error: "File not found" }, { status: 404 });
        }

        // 优先使用客户端提供的 sessionId 以保证清理时的 ID 一致性
        const sessionId = (typeof body.sessionId === "string" && /^[a-f0-9]{6,32}$/.test(body.sessionId))
            ? body.sessionId
            : crypto.randomBytes(8).toString("hex");

        const sessionDir = path.join(HLS_TEMP_DIR, sessionId);
        const m3u8Path = path.join(sessionDir, "index.m3u8");
        const startNum = startTime ? Math.floor(startTime / 4) : 0;
        const tmpFiles: string[] = [];

        // ---- 字幕烧录准备 ----
        let burnFilter: { type: "vf" | "complex"; value: string } | null = null;
        if (subtitleIndex !== null && !remux) {
            const subStreams = await probeStreams(resolvedPath, String(subtitleIndex));
            const codec = (subStreams[0]?.codec_name || "").toLowerCase();

            if (IMAGE_SUB_CODECS.includes(codec)) {
                // 图形字幕：overlay 滤镜叠加
                burnFilter = { type: "complex", value: `[0:v][0:${subtitleIndex}]overlay` };
            } else {
                // 文本字幕：先提取为 ASS，再用 subtitles 滤镜烧录
                const tmpSubFile = path.join(os.tmpdir(), `nas-burn-${crypto.randomBytes(4).toString("hex")}.ass`);
                await new Promise<void>((resolve) => {
                    execFile(FFMPEG_PATH, ["-i", resolvedPath, "-map", `0:${subtitleIndex}`, "-f", "ass", "-y", tmpSubFile], { timeout: 15000 }, (err) => {
                        if (err) console.error("字幕提取失败:", err.message);
                        resolve();
                    });
                });
                if (fs.existsSync(tmpSubFile) && fs.statSync(tmpSubFile).size > 0) {
                    tmpFiles.push(tmpSubFile);
                    // ffmpeg subtitles 滤镜的文件名转义（我们生成的临时路径只含安全字符）
                    const escaped = tmpSubFile.replace(/([:\\'])/g, "\\$1");
                    burnFilter = { type: "vf", value: `subtitles=${escaped}` };
                }
            }
        }

        // ---- 分辨率探测：内网超 1080p 降规格；省流量通道超 720p 一律压到 720p ----
        const videoStreams = await probeStreams(resolvedPath, "v:0");
        const height = videoStreams[0]?.height || 0;
        const maxHeight = limited ? 720 : 1080;
        const needsScale = height > maxHeight && !remux;
        const scaleVf = limited ? "scale=-2:720" : "scale=1920:-2";

        // ---- 组装 ffmpeg 参数（数组形式，无 shell，文件名特殊字符安全）----
        const args: string[] = ["-loglevel", "error"];
        if (startTime > 0) args.push("-ss", String(startTime));
        args.push("-i", resolvedPath, "-map", "0:v:0");
        args.push(...(audioIndex !== null ? ["-map", `0:${audioIndex}`] : ["-map", "0:a?"]));

        if (remux) {
            args.push("-c:v", "copy");
        } else {
            // 滤镜链：字幕 + 缩放合并
            if (burnFilter?.type === "complex") {
                args.push("-filter_complex", needsScale ? `${burnFilter.value},${scaleVf}` : burnFilter.value);
            } else if (burnFilter?.type === "vf") {
                args.push("-vf", needsScale ? `${burnFilter.value},${scaleVf}` : burnFilter.value);
            } else if (needsScale) {
                args.push("-vf", scaleVf);
            }
            args.push(
                "-c:v", "libx264", "-preset", "ultrafast", "-crf", "28",
                // 浏览器只支持 8bit H.264（High10 会导致 MSE 解析直接失败），10bit/HDR 源必须降到 yuv420p
                "-pix_fmt", "yuv420p",
                // GOP 对齐切片时长，加快起播与 seek
                "-g", "96", "-keyint_min", "96", "-sc_threshold", "0",
            );
            // 省流量通道：帧率锁 30fps
            if (limited) args.push("-r", "30");
        }

        args.push(
            // 多声道源（EAC3/DTS 5.1）下混立体声，避免 AAC 5.1 在部分设备静音
            "-c:a", "aac", "-b:a", "160k", "-ac", "2",
            "-f", "hls", "-hls_time", "4", "-hls_list_size", "0",
            "-start_number", String(startNum),
            "-hls_segment_filename", path.join(sessionDir, "segment_%03d.ts"),
            m3u8Path,
        );

        if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir, { recursive: true });

        console.log(`[HLS Init] ${remux ? "REMUX" : "TRANSCODE"}${limited ? " (外网限流 720p30)" : ""}: ${sessionId} for ${path.basename(resolvedPath)}`);
        const session = startSession({
            sessionId,
            filePath: resolvedPath,
            ffmpegPath: FFMPEG_PATH,
            args,
            tmpFiles,
        });

        // 轮询等待 FFmpeg 生成切片索引文件
        let retries = 0;
        while (!fs.existsSync(m3u8Path) && retries < 20) {
            await new Promise(r => setTimeout(r, 500));
            // 进程提前退出说明转码失败，无需等满 10 秒
            if (session.proc && session.proc.exitCode !== null && !fs.existsSync(m3u8Path)) break;
            retries++;
        }

        if (!fs.existsSync(m3u8Path)) {
            const { killSession } = await import("@/lib/hls-manager");
            killSession(sessionId, "manifest never appeared");
            return NextResponse.json({ error: "Transcoding failed to start" }, { status: 500 });
        }

        return NextResponse.json({
            success: true,
            sessionId,
            streamUrl: `/api/media/hls/${sessionId}/index.m3u8`,
        });
    } catch (error) {
        console.error("HLS init error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
