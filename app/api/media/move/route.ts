import { NextRequest } from "next/server";
import path from "path";
import fs from "fs";
import { exec, spawn } from "child_process";
import crypto from "crypto";
import { getDb } from "@/lib/db";
import { isPathUnder } from "@/lib/path-guard";

// 全局存储 move session（用于后续 confirm 阶段引用）
const globalAny = global as any;
if (!globalAny.moveSessions) {
    globalAny.moveSessions = new Map();
}
const sessions: Map<string, {
    sourcePath: string;
    targetPath: string;
    targetDirKey: string;
    targetType: string;
    sourceSize: number;
    verified: boolean;
    createdAt: number;
}> = globalAny.moveSessions;

// 清理超过 30 分钟的过期 session
function cleanSessions() {
    const now = Date.now();
    for (const [id, s] of sessions) {
        if (now - s.createdAt > 30 * 60 * 1000) sessions.delete(id);
    }
}

export async function POST(req: NextRequest) {
    try {
        // 文件移动是后台功能，仅 admin/boss
        const { getAccess, canAdminSite } = await import("@/lib/roles");
        if (!canAdminSite((await getAccess(req)).role)) {
            return new Response(JSON.stringify({ error: "Forbidden" }), {
                status: 403, headers: { "Content-Type": "application/json" }
            });
        }
        const { filePath, targetDirKey } = await req.json();

        if (!filePath || !targetDirKey) {
            return new Response(JSON.stringify({ error: "Missing filePath or targetDirKey" }), {
                status: 400, headers: { "Content-Type": "application/json" }
            });
        }

        const db = getDb();

        // 1. 获取目标目录配置
        const targetSetting = db.prepare("SELECT value FROM settings WHERE key = ?").get(targetDirKey) as { value: string } | undefined;
        if (!targetSetting) {
            return new Response(JSON.stringify({ error: "目标目录配置不存在" }), {
                status: 404, headers: { "Content-Type": "application/json" }
            });
        }

        let targetConfig: { path: string; name: string; type: string };
        try {
            targetConfig = JSON.parse(targetSetting.value);
        } catch {
            return new Response(JSON.stringify({ error: "目标目录配置格式错误" }), {
                status: 500, headers: { "Content-Type": "application/json" }
            });
        }

        // 2. 安全校验：源文件必须在已注册的媒体目录内
        const resolvedSource = path.resolve(filePath);
        const mediaDirs = db.prepare("SELECT value FROM settings WHERE key LIKE 'media_dir_%'").all() as { value: string }[];
        const allowedPaths = mediaDirs.map(d => {
            try { return JSON.parse(d.value).path; } catch { return d.value; }
        });
        const isAllowed = allowedPaths.some((dir: string) => isPathUnder(resolvedSource, dir));
        if (!isAllowed) {
            return new Response(JSON.stringify({ error: "源文件不在允许的媒体目录内" }), {
                status: 403, headers: { "Content-Type": "application/json" }
            });
        }

        if (!fs.existsSync(resolvedSource)) {
            return new Response(JSON.stringify({ error: "源文件不存在" }), {
                status: 404, headers: { "Content-Type": "application/json" }
            });
        }

        const sourceStats = fs.statSync(resolvedSource);
        if (!sourceStats.isFile()) {
            return new Response(JSON.stringify({ error: "源路径不是文件" }), {
                status: 400, headers: { "Content-Type": "application/json" }
            });
        }

        const sourceSize = sourceStats.size;
        const fileName = path.basename(resolvedSource);
        const targetDir = path.resolve(targetConfig.path);
        const targetFilePath = path.join(targetDir, fileName);

        // 检查目标目录是否存在
        if (!fs.existsSync(targetDir)) {
            return new Response(JSON.stringify({ error: `目标目录不存在: ${targetDir}` }), {
                status: 404, headers: { "Content-Type": "application/json" }
            });
        }

        // 检查目标文件是否已存在
        if (fs.existsSync(targetFilePath)) {
            return new Response(JSON.stringify({ error: `目标文件已存在: ${targetFilePath}` }), {
                status: 409, headers: { "Content-Type": "application/json" }
            });
        }

        // 3. 生成 session ID
        cleanSessions();
        const sessionId = crypto.randomBytes(16).toString("hex");

        // 4. SSE 流式推送
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
            start(controller) {
                function send(data: any) {
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
                }

                // Phase 1: preparing
                send({
                    phase: "preparing",
                    message: "正在校验文件和目标目录...",
                    source: resolvedSource,
                    target: targetFilePath,
                    sourceSize,
                    sourceSizeHuman: formatSize(sourceSize),
                });

                // Phase 2: copying with progress
                send({
                    phase: "copying",
                    progress: 0,
                    message: `正在复制 ${fileName}...`
                });

                // 使用 cp 命令复制
                const cpProcess = spawn("cp", ["--", resolvedSource, targetFilePath]);

                // 定期检查目标文件大小以推算进度
                const progressInterval = setInterval(() => {
                    try {
                        if (fs.existsSync(targetFilePath)) {
                            const targetStats = fs.statSync(targetFilePath);
                            const progress = Math.min(99, Math.round((targetStats.size / sourceSize) * 100));
                            send({
                                phase: "copying",
                                progress,
                                copiedBytes: targetStats.size,
                                copiedHuman: formatSize(targetStats.size),
                                message: `正在复制... ${formatSize(targetStats.size)} / ${formatSize(sourceSize)}`
                            });
                        }
                    } catch { /* ignore stat errors during copy */ }
                }, 500);

                cpProcess.on("close", (code) => {
                    clearInterval(progressInterval);

                    if (code !== 0) {
                        send({ phase: "error", message: `复制失败 (exit code: ${code})` });
                        // 清理可能的不完整文件
                        try { if (fs.existsSync(targetFilePath)) fs.unlinkSync(targetFilePath); } catch { }
                        controller.close();
                        return;
                    }

                    // Phase 3: verifying
                    send({ phase: "verifying", message: "正在校验文件完整性..." });

                    try {
                        const targetStats = fs.statSync(targetFilePath);
                        if (targetStats.size !== sourceSize) {
                            send({
                                phase: "error",
                                message: `文件大小不匹配！源: ${sourceSize} bytes, 目标: ${targetStats.size} bytes`
                            });
                            controller.close();
                            return;
                        }
                    } catch (err) {
                        send({ phase: "error", message: `校验失败: ${err}` });
                        controller.close();
                        return;
                    }

                    send({
                        phase: "copying",
                        progress: 100,
                        message: "复制完成！"
                    });

                    // Phase 4: confirm_delete — 存储 session 并等待用户确认
                    const deleteCommand = `rm "${resolvedSource}"`;
                    sessions.set(sessionId, {
                        sourcePath: resolvedSource,
                        targetPath: targetFilePath,
                        targetDirKey,
                        targetType: targetConfig.type,
                        sourceSize,
                        verified: true,
                        createdAt: Date.now(),
                    });

                    send({
                        phase: "confirm_delete",
                        sessionId,
                        deleteCommand,
                        message: "复制完成且文件大小校验通过。请确认是否删除源文件。",
                        sourceSize,
                        sourceSizeHuman: formatSize(sourceSize),
                        sourcePath: resolvedSource,
                        targetPath: targetFilePath,
                    });

                    controller.close();
                });

                cpProcess.on("error", (err) => {
                    clearInterval(progressInterval);
                    send({ phase: "error", message: `复制进程错误: ${err.message}` });
                    controller.close();
                });
            }
        });

        return new Response(stream, {
            headers: {
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
            }
        });

    } catch (error) {
        console.error("Move API Error:", error);
        return new Response(JSON.stringify({ error: "Internal Server Error" }), {
            status: 500, headers: { "Content-Type": "application/json" }
        });
    }
}

function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
