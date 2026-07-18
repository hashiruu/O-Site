import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { Readable } from "stream";
import { touchSession, ensureReaper, HLS_TEMP_DIR } from "@/lib/hls-manager";

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ sessionId: string; file: string }> }
) {
    try {
        ensureReaper();
        const resolvedParams = await params;
        const { sessionId, file } = resolvedParams;

        if (file.includes("/") || file.includes("..") || sessionId.includes("/") || sessionId.includes("..")) {
            return new NextResponse("Forbidden", { status: 403 });
        }

        // 切片请求即存活信号
        touchSession(sessionId);

        const targetPath = path.join(HLS_TEMP_DIR, sessionId, file);

        if (!fs.existsSync(targetPath)) {
            for (let i = 0; i < 15; i++) {
                await new Promise(r => setTimeout(r, 500));
                touchSession(sessionId); // 等待期间持续续命，防止边等边被清理
                if (fs.existsSync(targetPath)) break;
            }
            if (!fs.existsSync(targetPath)) {
                return new NextResponse("Not Found or Timeout", { status: 404 });
            }
        }

        const ext = path.extname(file).toLowerCase();
        const headers = new Headers();
        if (ext === ".m3u8") {
            headers.set("Content-Type", "application/vnd.apple.mpegurl");
            headers.set("Cache-Control", "no-cache");
            headers.set("Access-Control-Allow-Origin", "*");
        } else if (ext === ".ts") {
            headers.set("Content-Type", "video/MP2T");
            headers.set("Cache-Control", "public, max-age=3600");
            headers.set("Access-Control-Allow-Origin", "*");
        } else {
            headers.set("Content-Type", "application/octet-stream");
        }

        const nodeStream = fs.createReadStream(targetPath);
        const webStream = Readable.toWeb(nodeStream) as unknown as ReadableStream;

        return new NextResponse(webStream, { headers });
    } catch (error) {
        console.error("Error serving HLS segment:", error);
        return new NextResponse("Internal Error", { status: 500 });
    }
}
