import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { getDb } from "@/lib/db";

// 引用全局 move sessions
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

export async function POST(req: NextRequest) {
    try {
        // 移动确认会删除源文件，仅 admin/boss
        const { getAccess, canAdminSite } = await import("@/lib/roles");
        if (!canAdminSite((await getAccess(req)).role)) {
            return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
        }
        const { sessionId } = await req.json();

        if (!sessionId) {
            return NextResponse.json({ success: false, error: "Missing sessionId" }, { status: 400 });
        }

        const session = sessions.get(sessionId);
        if (!session) {
            return NextResponse.json({ success: false, error: "Session 不存在或已过期（30分钟有效期）" }, { status: 404 });
        }

        if (!session.verified) {
            return NextResponse.json({ success: false, error: "文件完整性未通过校验，拒绝执行删除" }, { status: 400 });
        }

        // 再次确认目标文件存在且大小一致
        if (!fs.existsSync(session.targetPath)) {
            return NextResponse.json({ success: false, error: `目标文件不存在: ${session.targetPath}` }, { status: 404 });
        }

        const targetStats = fs.statSync(session.targetPath);
        if (targetStats.size !== session.sourceSize) {
            return NextResponse.json({
                success: false,
                error: `目标文件大小不匹配！期望: ${session.sourceSize}, 实际: ${targetStats.size}`
            }, { status: 400 });
        }

        // 确认源文件仍然存在
        if (!fs.existsSync(session.sourcePath)) {
            return NextResponse.json({ success: false, error: `源文件已不存在: ${session.sourcePath}` }, { status: 404 });
        }

        // 执行删除源文件
        try {
            fs.unlinkSync(session.sourcePath);
        } catch (err) {
            return NextResponse.json({ success: false, error: `删除源文件失败: ${err}` }, { status: 500 });
        }

        // 更新数据库：修改 media 表中的 path 和 type
        const db = getDb();
        const fileName = path.basename(session.sourcePath);

        // 尝试更新 media 表
        const mediaResult = db.prepare(
            "UPDATE media SET path = ?, type = ? WHERE path = ?"
        ).run(session.targetPath, session.targetType, session.sourcePath);

        // 尝试更新 episodes 表
        const episodeResult = db.prepare(
            "UPDATE episodes SET path = ? WHERE path = ?"
        ).run(session.targetPath, session.sourcePath);

        // 清除旧缩略图缓存
        const CACHE_DIR = path.join(process.cwd(), "cache", "thumbnails");
        const oldHash = crypto.createHash("md5").update(path.resolve(session.sourcePath)).digest("hex");
        const oldThumbPath = path.join(CACHE_DIR, `${oldHash}.jpg`);
        const oldErrorPath = path.join(CACHE_DIR, `${oldHash}.error`);
        try { if (fs.existsSync(oldThumbPath)) fs.unlinkSync(oldThumbPath); } catch { }
        try { if (fs.existsSync(oldErrorPath)) fs.unlinkSync(oldErrorPath); } catch { }

        // 清理 session
        sessions.delete(sessionId);

        return NextResponse.json({
            success: true,
            message: "源文件已安全删除，数据库已更新",
            details: {
                deletedSource: session.sourcePath,
                newPath: session.targetPath,
                newType: session.targetType,
                mediaRowsUpdated: mediaResult.changes,
                episodeRowsUpdated: episodeResult.changes,
            }
        });

    } catch (error) {
        console.error("Move Confirm API Error:", error);
        return NextResponse.json({ success: false, error: "Internal Server Error" }, { status: 500 });
    }
}
