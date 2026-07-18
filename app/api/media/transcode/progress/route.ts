import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

const globalAny = global as any;

// SSE: 实时推送转码进度
export async function GET(req: NextRequest) {
    // 后台功能守卫：仅 admin/boss
    {
        const { getAccess, canAdminSite } = await import("@/lib/roles");
        if (!canAdminSite((await getAccess(req)).role)) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }
    }
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
        start(controller) {
            const send = (data: any) => {
                try {
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
                } catch {}
            };

            const interval = setInterval(() => {
                try {
                    const db = getDb();
                    const jobs = db.prepare(
                        "SELECT * FROM transcode_jobs WHERE status IN ('pending', 'running') ORDER BY created_at ASC"
                    ).all() as any[];

                    const tcProgress = globalAny.transcodeProgress as Map<string, any> | undefined;

                    for (const job of jobs) {
                        const live = tcProgress?.get(job.id);
                        send({
                            jobId: job.id,
                            sourcePath: job.source_path,
                            outputPath: job.output_path,
                            status: job.status,
                            progress: live?.progress ?? job.progress ?? 0,
                            speed: live?.speed || "",
                            eta: live?.eta || "",
                            videoCodec: job.video_codec,
                            audioCodec: job.audio_codec,
                        });
                    }

                    // 发送完成/失败的任务（最近 10 条）
                    const doneJobs = db.prepare(
                        "SELECT * FROM transcode_jobs WHERE status IN ('done', 'error') ORDER BY completed_at DESC LIMIT 10"
                    ).all() as any[];

                    for (const job of doneJobs) {
                        send({
                            jobId: job.id,
                            sourcePath: job.source_path,
                            outputPath: job.output_path,
                            status: job.status,
                            progress: job.progress,
                            error: job.error,
                            videoCodec: job.video_codec,
                            audioCodec: job.audio_codec,
                        });
                    }

                    // 没有活跃任务时发心跳
                    if (jobs.length === 0 && doneJobs.length === 0) {
                        send({ heartbeat: true });
                    }
                } catch (err) {
                    console.error("[Transcode SSE] Error:", err);
                }
            }, 1000);

            // 客户端断开时清理
            req.signal.addEventListener("abort", () => {
                clearInterval(interval);
                try { controller.close(); } catch {}
            });
        }
    });

    return new Response(stream, {
        headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        },
    });
}
