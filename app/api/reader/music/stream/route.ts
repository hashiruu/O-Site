// GET /api/reader/music/stream?id=<trackId> → 流式播放本地乐库文件（range 支持，可 seek/loop）
import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { Readable } from "stream";
import { resolveUserKeyOrNull } from "@/lib/identity";
import { fileById } from "@/lib/ambient-music";

export const dynamic = "force-dynamic";

const MIME: Record<string, string> = {
    ".flac": "audio/flac", ".mp3": "audio/mpeg", ".m4a": "audio/mp4",
    ".wav": "audio/wav", ".ogg": "audio/ogg", ".aac": "audio/aac",
};

export async function GET(req: NextRequest) {
    if (!(await resolveUserKeyOrNull(req))) {
        return NextResponse.json({ error: "LOGIN_REQUIRED" }, { status: 401 });
    }
    const id = req.nextUrl.searchParams.get("id") || "";
    const file = fileById(id);
    if (!file) return NextResponse.json({ error: "未找到曲目" }, { status: 404 });
    const mime = MIME[path.extname(file).toLowerCase()] || "application/octet-stream";
    const size = fs.statSync(file).size;

    const range = req.headers.get("range");
    const baseHeaders: Record<string, string> = {
        "Content-Type": mime,
        "Accept-Ranges": "bytes",
        "Cache-Control": "public, max-age=604800", // 一周（乐库稳定，浏览器缓存后循环零流量）
    };

    if (range) {
        const m = /bytes=(\d+)-(\d*)/.exec(range);
        const start = m ? parseInt(m[1], 10) : 0;
        const end = m && m[2] ? parseInt(m[2], 10) : size - 1;
        if (start >= size || end >= size) {
            return new NextResponse(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
        }
        const stream = fs.createReadStream(file, { start, end });
        return new NextResponse(Readable.toWeb(stream) as unknown as ReadableStream, {
            status: 206,
            headers: { ...baseHeaders, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) },
        });
    }
    const stream = fs.createReadStream(file);
    return new NextResponse(Readable.toWeb(stream) as unknown as ReadableStream, {
        status: 200, headers: { ...baseHeaders, "Content-Length": String(size) },
    });
}
