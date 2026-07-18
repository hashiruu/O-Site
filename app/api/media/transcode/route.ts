import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs";
import { execFile } from "child_process";
import crypto from "crypto";
import { getDb } from "@/lib/db";
import { isPathUnder } from "@/lib/path-guard";

import { FFMPEG_PATH, FFPROBE_PATH } from "@/lib/ffmpeg";

// 流索引必须是非负整数；非法值回退为 null（使用默认轨道）。
// 既避免把脏值喂给 ffmpeg，也从根源杜绝 -map 0:${idx} 类的命令注入。
function sanitizeStreamIdx(v: unknown): number | null {
    return typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null;
}

// 校验路径在已配置的媒体目录内（报告 #4：probe/start 原先只 existsSync，可探测/转码任意文件）
function isMediaPath(resolvedPath: string): boolean {
    const dirs = getDb().prepare("SELECT value FROM settings WHERE key LIKE 'media_dir_%'").all() as { value: string }[];
    return dirs.some((d) => {
        let p: string;
        try { p = JSON.parse(d.value).path; } catch { p = d.value; }
        return isPathUnder(resolvedPath, p);
    });
}

// 全局转码进程管理
const globalAny = global as any;
if (!globalAny.transcodeProcesses) globalAny.transcodeProcesses = new Map();
if (!globalAny.transcodeProgress) globalAny.transcodeProgress = new Map();
const tcProcesses = globalAny.transcodeProcesses as Map<string, any>;
const tcProgress = globalAny.transcodeProgress as Map<string, { progress: number; speed: string; eta: string }>;

// GET: 获取转码任务列表
export async function GET(req: NextRequest) {
    try {
        // 转码任务管理是后台功能（含 delete_source 删源文件），仅 admin/boss
        const { getAccess, canAdminSite } = await import("@/lib/roles");
        if (!canAdminSite((await getAccess(req)).role)) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }
        const db = getDb();
        const jobs = db.prepare(
            "SELECT * FROM transcode_jobs ORDER BY created_at DESC LIMIT 100"
        ).all();

        // 附加实时进度
        const enriched = (jobs as any[]).map(j => ({
            ...j,
            liveProgress: tcProgress.get(j.id) || null
        }));

        return NextResponse.json({ success: true, jobs: enriched });
    } catch (error) {
        console.error("Transcode GET error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}

// POST: 任务操作
export async function POST(req: NextRequest) {
    try {
        // 转码任务管理是后台功能（含 delete_source 删源文件），仅 admin/boss
        const { getAccess, canAdminSite } = await import("@/lib/roles");
        if (!canAdminSite((await getAccess(req)).role)) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }
        const body = await req.json();
        const { action } = body;

        if (action === "probe") {
            return handleProbe(body);
        } else if (action === "start") {
            return handleStart(body);
        } else if (action === "cancel") {
            return handleCancel(body);
        } else if (action === "delete_source") {
            return handleDeleteSource(body);
        } else if (action === "clear_done") {
            return handleClearDone();
        } else if (action === "list_files") {
            return handleListFiles();
        }

        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    } catch (error) {
        console.error("Transcode POST error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
// 获取供转码面板使用的展平后文件列表
function handleListFiles() {
    const db = getDb();
    
    // 电影/私密直接是单文件 (用户要求只保留电影)
    const nonEpisodic = db.prepare(`
        SELECT id as mediaId, title, path, type 
        FROM media 
        WHERE type IN ('movie')
        ORDER BY title ASC
    `).all();

    // 剧集/动漫展平为具体分集，包含层次结构所需的元数据
    const episodic = db.prepare(`
        SELECT m.id as mediaId, m.title as seriesTitle, e.season, e.episode, e.title as episodeTitle, (m.title || ' - ' || e.title) as title, e.path, m.type
        FROM episodes e
        JOIN media m ON e.media_id = m.id
        WHERE m.type IN ('series', 'anime')
        ORDER BY m.title ASC, e.season ASC, e.episode ASC
    `).all();

    const items = [...nonEpisodic, ...episodic];
    // 过滤掉已经在转码列表中的正在运行/排队文件（可选，暂时全部返回）
    
    return NextResponse.json({ success: true, files: items });
}

// 探测文件轨道信息
async function handleProbe(body: any) {
    const { filePath } = body;
    if (!filePath) return NextResponse.json({ error: "Missing filePath" }, { status: 400 });

    const resolvedPath = path.resolve(filePath);
    if (!isMediaPath(resolvedPath)) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (!fs.existsSync(resolvedPath)) {
        return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    const probeResult = await new Promise<string>((resolve, reject) => {
        execFile(FFPROBE_PATH, [
            "-v", "quiet", "-print_format", "json",
            "-show_streams", "-show_format",
            resolvedPath
        ], { maxBuffer: 10 * 1024 * 1024 }, (err, stdout) => {
            if (err) reject(err);
            else resolve(stdout);
        });
    });

    const data = JSON.parse(probeResult);
    const streams = data.streams || [];
    const format = data.format || {};

    let videoCodec = "";
    const audioTracks: any[] = [];
    const subtitleTracks: any[] = [];

    const imageCodecs = ["pgssub", "hdmv_pgs_subtitle", "dvd_subtitle", "vobsub", "dvb_subtitle", "dvdsub"];

    for (const s of streams) {
        const lang = s.tags?.language || "und";
        const title = s.tags?.title || "";
        if (s.codec_type === "video" && !videoCodec) {
            videoCodec = (s.codec_name || "").toLowerCase();
        } else if (s.codec_type === "audio") {
            audioTracks.push({
                index: s.index, title: title || lang,
                language: lang, codec: s.codec_name || "unknown",
                channels: s.channels || 0
            });
        } else if (s.codec_type === "subtitle") {
            subtitleTracks.push({
                index: s.index, title: title || lang,
                language: lang, codec: s.codec_name || "unknown",
                isImage: imageCodecs.includes((s.codec_name || "").toLowerCase())
            });
        }
    }

    // 判断是否需要转码
    const browserAudio = ["aac", "mp3", "opus", "vorbis"];
    const browserVideo = ["h264"];
    const needsVideoTranscode = !browserVideo.includes(videoCodec);
    const needsAudioTranscode = audioTracks.length > 0 &&
        !browserAudio.some(c => (audioTracks[0].codec || "").toLowerCase().includes(c));

    return NextResponse.json({
        success: true,
        videoCodec,
        audioTracks,
        subtitleTracks,
        duration: parseFloat(format.duration || "0"),
        needsVideoTranscode,
        needsAudioTranscode,
        needsTranscode: needsVideoTranscode || needsAudioTranscode
    });
}

// 启动转码任务
async function handleStart(body: any) {
    const { files } = body;
    if (!files || !Array.isArray(files) || files.length === 0) {
        return NextResponse.json({ error: "No files provided" }, { status: 400 });
    }

    // 单次提交上限：防止误操作把整库塞进队列
    if (files.length > 100) {
        return NextResponse.json({ error: "Too many files (max 100 per batch)" }, { status: 400 });
    }

    const db = getDb();
    const createdJobs: string[] = [];

    for (const file of files) {
        const sourcePath = path.resolve(file.path);
        if (!isMediaPath(sourcePath) || !fs.existsSync(sourcePath)) continue;

        const jobId = crypto.randomBytes(8).toString("hex");
        const dir = path.dirname(sourcePath);
        const ext = path.extname(sourcePath);
        const baseName = path.basename(sourcePath, ext);
        const outputPath = path.join(dir, `tr_${baseName}.mp4`);

        // 探测视频编码
        let videoCodec = "";
        let audioCodec = "";
        try {
            const probeOut = await new Promise<string>((resolve, reject) => {
                execFile(FFPROBE_PATH, [
                    "-v", "quiet", "-print_format", "json",
                    "-show_streams", "-show_format", sourcePath
                ], { maxBuffer: 10 * 1024 * 1024 }, (err, stdout) => {
                    if (err) reject(err); else resolve(stdout);
                });
            });
            const probeData = JSON.parse(probeOut);
            for (const s of (probeData.streams || [])) {
                if (s.codec_type === "video" && !videoCodec) videoCodec = (s.codec_name || "").toLowerCase();
                if (s.codec_type === "audio" && !audioCodec) audioCodec = (s.codec_name || "").toLowerCase();
            }
        } catch {}

        db.prepare(`
            INSERT INTO transcode_jobs (id, source_path, output_path, status, video_codec, audio_codec, selected_audio, selected_subtitle)
            VALUES (?, ?, ?, 'pending', ?, ?, ?, ?)
        `).run(
            jobId, sourcePath, outputPath,
            videoCodec, audioCodec,
            sanitizeStreamIdx(file.audioIndex),
            sanitizeStreamIdx(file.subtitleIndex)
        );

        createdJobs.push(jobId);
    }

    // 启动队列处理（不阻塞响应）
    processQueue();

    return NextResponse.json({ success: true, jobIds: createdJobs });
}

// 转码队列处理
const MAX_TRANSCODE_CONCURRENT = 2;
// 单任务硬超时：损坏/异常源可能让 ffmpeg 永远跑不完，没有超时就是僵尸进程
const TRANSCODE_TIMEOUT_MS = 2 * 60 * 60 * 1000;

async function processQueue() {
    const db = getDb();

    // 服务重启后 DB 里残留 status='running' 但进程已不存在：重置为 pending 恢复执行
    const runningRows = db.prepare("SELECT id FROM transcode_jobs WHERE status = 'running'").all() as { id: string }[];
    for (const r of runningRows) {
        if (!tcProcesses.has(r.id)) {
            db.prepare("UPDATE transcode_jobs SET status = 'pending' WHERE id = ?").run(r.id);
        }
    }

    while (tcProcesses.size < MAX_TRANSCODE_CONCURRENT) {
        const next = db.prepare("SELECT * FROM transcode_jobs WHERE status = 'pending' ORDER BY created_at ASC LIMIT 1").get() as any;
        if (!next) return;

        db.prepare("UPDATE transcode_jobs SET status = 'running' WHERE id = ?").run(next.id);
        // 先占位再异步启动：runJob 在 spawn 前有多个 await，
        // 占位既算进并发额度，也防止此间隙被上面的孤儿检测误重置
        tcProcesses.set(next.id, null);
        void runJob(next);
    }
}

async function runJob(next: any) {
    const db = getDb();
    try {
        await execJob(db, next);
    } catch (e) {
        console.error(`[Transcode] Job ${next.id} failed to start:`, e);
        tcProcesses.delete(next.id);
        tcProgress.delete(next.id);
        db.prepare("UPDATE transcode_jobs SET status = 'error', error = ? WHERE id = ?")
            .run(e instanceof Error ? e.message : String(e), next.id);
        processQueue();
    }
}

async function execJob(db: ReturnType<typeof getDb>, next: any) {
    const sourcePath = next.source_path;
    const outputPath = next.output_path;

    // 判断视频编码：H.264 直接 copy，其他重编码
    const browserVideoCodecs = ["h264"];
    const copyVideo = browserVideoCodecs.includes(next.video_codec || "");

    // 构建 FFmpeg 参数数组（全部走 execFile argv，不经 shell）。
    // 从根源消除命令注入：路径里的 " $ ; ` 等元字符不再被 shell 解析。
    // 流索引再校验一次（防御纵深；handleStart 写入时已清过，这里兜底）。
    const audioIdx = sanitizeStreamIdx(next.selected_audio);
    const subIdx = sanitizeStreamIdx(next.selected_subtitle);
    const ffmpegArgs: string[] = ["-i", sourcePath, "-map", "0:v:0"];
    if (audioIdx !== null) {
        ffmpegArgs.push("-map", `0:${audioIdx}`);
    } else {
        ffmpegArgs.push("-map", "0:a:0?");
    }
    if (copyVideo) {
        ffmpegArgs.push("-c:v", "copy");
    } else {
        // -pix_fmt yuv420p 是铁律：10bit 源（Hi10P 等）不降到 8bit 浏览器无法解码
        ffmpegArgs.push("-c:v", "libx264", "-preset", "medium", "-crf", "23", "-pix_fmt", "yuv420p");
    }

    // 字幕烧录（仅在重编码视频时可用）
    if (subIdx !== null && !copyVideo) {
        // 提取字幕到临时文件用于烧录
        const tmpAss = `/tmp/nas-tc-sub-${next.id}.ass`;
        try {
            await new Promise<void>((resolve, reject) => {
                execFile(FFMPEG_PATH, [
                    "-i", sourcePath, "-map", `0:${subIdx}`,
                    "-f", "ass", "-y", tmpAss
                ], { timeout: 30000 }, (err) => { if (err) reject(err); else resolve(); });
            });
            if (fs.existsSync(tmpAss) && fs.statSync(tmpAss).size > 0) {
                // ffmpeg subtitles filter 对路径中的 : ' [ ] \ 需转义；execFile 无 shell，不再需要外层单引号
                const escaped = tmpAss.replace(/([:\\'])/g, '\\$1').replace(/([\[\]])/g, '\\$1');
                ffmpegArgs.push("-vf", `subtitles=${escaped}`);
            }
        } catch (e) {
            console.error(`[Transcode] Subtitle extraction failed for job ${next.id}:`, e);
        }
    }

    // 用 -progress 获取实时进度
    ffmpegArgs.push("-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-y", "-progress", "pipe:1", outputPath);

    console.log(`[Transcode] Starting job ${next.id}: ${path.basename(sourcePath)}`);
    console.log(`[Transcode] ${copyVideo ? 'VIDEO COPY' : 'VIDEO TRANSCODE'} | CMD: ${FFMPEG_PATH} ${ffmpegArgs.join(' ')}`);

    // 获取总时长用于进度计算
    let totalDuration = 0;
    try {
        const durationOut = await new Promise<string>((resolve, reject) => {
            execFile(FFPROBE_PATH, [
                "-v", "quiet", "-print_format", "json", "-show_format", sourcePath
            ], { timeout: 10000 }, (err, stdout) => { if (err) reject(err); else resolve(stdout); });
        });
        totalDuration = parseFloat(JSON.parse(durationOut).format?.duration || "0");
    } catch {}

    const proc = execFile(FFMPEG_PATH, ffmpegArgs);
    tcProcesses.set(next.id, proc);

    // 硬超时保护
    let timedOut = false;
    const killTimer = setTimeout(() => {
        timedOut = true;
        console.error(`[Transcode] Job ${next.id} timed out after ${TRANSCODE_TIMEOUT_MS / 60000} min, killing`);
        try { proc.kill("SIGKILL"); } catch {}
    }, TRANSCODE_TIMEOUT_MS);

    // 解析 FFmpeg -progress 输出
    let currentTime = 0;
    let currentSpeed = "";
    proc.stdout?.on("data", (data: string) => {
        const lines = data.toString().split("\n");
        for (const line of lines) {
            if (line.startsWith("out_time_us=")) {
                const us = parseInt(line.split("=")[1] || "0", 10);
                currentTime = us / 1_000_000;
            }
            if (line.startsWith("speed=")) {
                currentSpeed = line.split("=")[1]?.trim() || "";
            }
            if (line.startsWith("progress=")) {
                const progressPct = totalDuration > 0 ? Math.min(100, (currentTime / totalDuration) * 100) : 0;

                // 计算 ETA
                let eta = "";
                if (currentSpeed && currentSpeed !== "N/A") {
                    const speedNum = parseFloat(currentSpeed);
                    if (speedNum > 0 && totalDuration > 0) {
                        const remaining = (totalDuration - currentTime) / speedNum;
                        const mins = Math.floor(remaining / 60);
                        const secs = Math.floor(remaining % 60);
                        eta = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
                    }
                }

                tcProgress.set(next.id, { progress: progressPct, speed: currentSpeed, eta });
                db.prepare("UPDATE transcode_jobs SET progress = ? WHERE id = ?").run(progressPct, next.id);
            }
        }
    });

    proc.stderr?.on("data", (data: string) => {
        // FFmpeg 日志输出到 stderr，可用于调试
        const msg = data.toString().trim();
        if (msg && !msg.startsWith("frame=")) {
            console.log(`[Transcode ${next.id}] ${msg.substring(0, 200)}`);
        }
    });

    proc.on("close", (code) => {
        clearTimeout(killTimer);
        tcProcesses.delete(next.id);
        tcProgress.delete(next.id);

        if (code === 0 && fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
            db.prepare("UPDATE transcode_jobs SET status = 'done', progress = 100, completed_at = CURRENT_TIMESTAMP WHERE id = ?").run(next.id);
            console.log(`[Transcode] Job ${next.id} completed: ${path.basename(outputPath)}`);
        } else {
            const errMsg = timedOut
                ? `Timed out after ${TRANSCODE_TIMEOUT_MS / 60000} min`
                : code === null ? "Process killed" : `FFmpeg exited with code ${code}`;
            db.prepare("UPDATE transcode_jobs SET status = 'error', error = ? WHERE id = ?").run(errMsg, next.id);
            console.error(`[Transcode] Job ${next.id} failed: ${errMsg}`);
            // 清理失败的输出文件
            try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch {}
        }

        // 清理临时字幕
        try { fs.unlinkSync(`/tmp/nas-tc-sub-${next.id}.ass`); } catch {}

        // 继续处理队列
        processQueue();
    });

    return;
}

// 取消任务
function handleCancel(body: any) {
    const { jobId } = body;
    if (!jobId) return NextResponse.json({ error: "Missing jobId" }, { status: 400 });

    const db = getDb();
    const job = db.prepare("SELECT * FROM transcode_jobs WHERE id = ?").get(jobId) as any;
    if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

    if (job.status === "running") {
        const proc = tcProcesses.get(jobId);
        // proc 可能是 null 占位（spawn 前的窗口期），此时只需释放并发额度
        if (proc) {
            try { proc.kill("SIGKILL"); } catch {}
        }
        tcProcesses.delete(jobId);
        tcProgress.delete(jobId);
    }

    db.prepare("UPDATE transcode_jobs SET status = 'error', error = 'Cancelled by user' WHERE id = ?").run(jobId);

    // 清理输出文件
    if (job.output_path) {
        try { if (fs.existsSync(job.output_path)) fs.unlinkSync(job.output_path); } catch {}
    }

    return NextResponse.json({ success: true });
}

// 删除原文件（管理员确认后）
function handleDeleteSource(body: any) {
    const { jobId } = body;
    if (!jobId) return NextResponse.json({ error: "Missing jobId" }, { status: 400 });

    const db = getDb();
    const job = db.prepare("SELECT * FROM transcode_jobs WHERE id = ? AND status = 'done'").get(jobId) as any;
    if (!job) return NextResponse.json({ error: "Job not found or not completed" }, { status: 404 });

    // 确保转码文件存在
    if (!fs.existsSync(job.output_path)) {
        return NextResponse.json({ error: "Transcoded file missing, cannot delete source" }, { status: 400 });
    }

    // 删除原文件
    try {
        fs.unlinkSync(job.source_path);
        console.log(`[Transcode] Deleted source: ${job.source_path}`);

        // 重命名转码文件为原文件名（去掉 tr_ 前缀，改扩展名为 .mp4）
        const dir = path.dirname(job.source_path);
        const origExt = path.extname(job.source_path);
        const origBase = path.basename(job.source_path, origExt);
        const finalPath = path.join(dir, `${origBase}.mp4`);

        fs.renameSync(job.output_path, finalPath);
        console.log(`[Transcode] Renamed: ${job.output_path} -> ${finalPath}`);

        // 更新数据库中的路径引用
        db.prepare("UPDATE media SET path = ? WHERE path = ?").run(finalPath, job.source_path);
        db.prepare("UPDATE episodes SET path = ? WHERE path = ?").run(finalPath, job.source_path);
        db.prepare("UPDATE transcode_jobs SET output_path = ?, source_path = ? WHERE id = ?").run(finalPath, finalPath, job.id);

        return NextResponse.json({ success: true, finalPath });
    } catch (error: any) {
        console.error(`[Transcode] Delete source failed:`, error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

// 清理已完成的历史记录
function handleClearDone() {
    const db = getDb();
    db.prepare("DELETE FROM transcode_jobs WHERE status IN ('done', 'error')").run();
    return NextResponse.json({ success: true });
}
