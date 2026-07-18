import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs";
import { execFile } from "child_process";
import { getDb } from "@/lib/db";
import { isPathUnder } from "@/lib/path-guard";
import { FFPROBE_PATH } from "@/lib/ffmpeg";

export async function GET(req: NextRequest) {
    try {
        const filePath = req.nextUrl.searchParams.get("filePath");
        if (!filePath) {
            return NextResponse.json({ error: "Missing filePath" }, { status: 400 });
        }

        // 权限守卫：轨道信息随视频本体走，同 stream 规则（默认拒绝）
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

        // 使用 ffprobe 探测流信息
        const probeResult = await new Promise<string>((resolve, reject) => {
            execFile(FFPROBE_PATH, [
                "-v", "quiet",
                "-print_format", "json",
                "-show_streams",
                "-show_entries", "stream=index,codec_type,codec_name,pix_fmt,language,title:stream_tags=language,title",
                resolvedPath
            ], { maxBuffer: 10 * 1024 * 1024 }, (err, stdout) => {
                if (err) reject(err);
                else resolve(stdout);
            });
        });

        const probeData = JSON.parse(probeResult);
        const streams = probeData.streams || [];

        const audioTracks: { index: number; title: string; language: string; codec: string }[] = [];
        const subtitleTracks: { index: number; title: string; language: string; codec: string; isImage: boolean }[] = [];
        let videoCodec = "";
        let videoPixFmt = "";

        for (const stream of streams) {
            const lang = stream.tags?.language || stream.language || "und";
            const title = stream.tags?.title || stream.title || "";

            if (stream.codec_type === "video" && !videoCodec) {
                videoCodec = (stream.codec_name || "").toLowerCase();
                videoPixFmt = (stream.pix_fmt || "").toLowerCase();
            } else if (stream.codec_type === "audio") {
                audioTracks.push({
                    index: stream.index,
                    title: title || (lang !== "und" ? lang : `Audio ${stream.index}`),
                    language: lang,
                    codec: stream.codec_name || "unknown",
                });
            } else if (stream.codec_type === "subtitle") {
                const imageCodecs = ["pgssub", "hdmv_pgs_subtitle", "dvd_subtitle", "vobsub", "dvb_subtitle", "dvdsub"];
                subtitleTracks.push({
                    index: stream.index,
                    title: title || (lang !== "und" ? lang : `Subtitle ${stream.index}`),
                    language: lang,
                    codec: stream.codec_name || "unknown",
                    isImage: imageCodecs.includes((stream.codec_name || "").toLowerCase()),
                });
            }
        }

        return NextResponse.json({
            success: true,
            videoCodec,
            videoPixFmt,
            audioTracks,
            subtitleTracks,
        });
    } catch (error) {
        console.error("Tracks probe error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
