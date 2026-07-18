// 段落朗读：POST { text, voice? } → Edge TTS（微软神经语音，中文自然度远超浏览器内置）→ mp3。
// 逐段调用（阅读器按聚焦段落一段一段要音频），单段文本上限 1200 字符。
// edge-tts 是 CLI（pip install --user edge-tts），绝对路径调用，输出临时文件后即删。
import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
import { execFile } from "child_process";
import { promisify } from "util";
import { resolveUserKeyOrNull } from "@/lib/identity";

export const dynamic = "force-dynamic";
const execFileAsync = promisify(execFile);

import { EDGE_TTS_BIN as EDGE_TTS } from "@/lib/paths";
const VOICES = new Set(["zh-CN-XiaoxiaoNeural", "zh-CN-YunxiNeural", "zh-CN-XiaoyiNeural", "zh-CN-YunyangNeural", "zh-CN-YunjianNeural"]);

export async function POST(req: NextRequest) {
    if (!(await resolveUserKeyOrNull(req))) {
        return NextResponse.json({ success: false, error: "LOGIN_REQUIRED" }, { status: 401 });
    }
    try {
        const body = await req.json();
        const text = String(body.text || "").replace(/\s+/g, " ").trim().slice(0, 1200);
        if (!text) return NextResponse.json({ success: false, error: "空文本" }, { status: 400 });
        const voice = VOICES.has(body.voice) ? body.voice : "zh-CN-XiaoxiaoNeural";
        const rate = Math.max(-50, Math.min(200, Math.round(Number(body.rate) || 0)));

        const tmp = path.join(os.tmpdir(), `tts-${crypto.randomBytes(8).toString("hex")}.mp3`);
        try {
            const args = ["--voice", voice, "--text", text, "--write-media", tmp];
            if (rate !== 0) args.push("--rate", `${rate > 0 ? "+" : ""}${rate}%`);
            await execFileAsync(EDGE_TTS, args, {
                timeout: 30_000,
            });
            const buf = fs.readFileSync(tmp);
            return new NextResponse(new Uint8Array(buf), {
                headers: { "Content-Type": "audio/mpeg", "Content-Length": String(buf.length), "Cache-Control": "no-store" },
            });
        } finally {
            try { fs.unlinkSync(tmp); } catch { /* noop */ }
        }
    } catch (e) {
        return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
    }
}
