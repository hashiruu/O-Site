import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import fs from "fs";
import path from "path";
import { getAccess, canAdminSite } from "@/lib/roles";

export const dynamic = 'force-dynamic';

// GET: 获取设置。站点配置（媒体目录/TMDB key/硬件加速/直播源）仅 admin；
// 播放偏好（livePrefs/watchPrefs）+ 直播源地址（live 页播放要用）全员可读。
export async function GET(req: NextRequest) {
    try {
        const db = getDb();
        const isAdmin = canAdminSite((await getAccess(req)).role);

        const dirRows = db
            .prepare("SELECT key, value FROM settings WHERE key LIKE 'media_dir_%'")
            .all() as { key: string; value: string }[];

        const mediaDirs = dirRows.map((row) => {
            try {
                return { key: row.key, ...JSON.parse(row.value) };
            } catch {
                return { key: row.key, path: row.value, name: path.basename(row.value), type: "movie" };
            }
        });

        const tmdbRow = db.prepare("SELECT value FROM settings WHERE key = 'tmdb_api_key'").get() as { value: string } | undefined;
        const hwRow = db.prepare("SELECT value FROM settings WHERE key = 'hw_accel_prefer'").get() as { value: string } | undefined;
        const liveAudioRow = db.prepare("SELECT value FROM settings WHERE key = 'live_tv_audio_url'").get() as { value: string } | undefined;
        const liveDanmakuRow = db.prepare("SELECT value FROM settings WHERE key = 'live_tv_danmaku_url'").get() as { value: string } | undefined;
        const livePrefsRow = db.prepare("SELECT value FROM settings WHERE key = 'live_tv_prefs'").get() as { value: string } | undefined;
        const watchPrefsRow = db.prepare("SELECT value FROM settings WHERE key = 'watch_prefs'").get() as { value: string } | undefined;

        return NextResponse.json({
            success: true,
            data: {
                mediaDirs: isAdmin ? mediaDirs : [],
                tmdbApiKey: isAdmin ? (tmdbRow ? tmdbRow.value : "") : "",
                hwAccelPrefer: hwRow ? hwRow.value === 'true' : false,
                liveTvAudioUrl: liveAudioRow ? liveAudioRow.value : "",
                liveTvDanmakuUrl: liveDanmakuRow ? liveDanmakuRow.value : "",
                livePrefs: livePrefsRow ? livePrefsRow.value : "",
                watchPrefs: watchPrefsRow ? watchPrefsRow.value : ""
            },
        });
    } catch (error) {
        console.error("获取设置失败:", error);
        return NextResponse.json(
            { success: false, error: "获取设置失败", details: error instanceof Error ? error.message : String(error) },
            { status: 500 }
        );
    }
}

// POST: 各种设置操作
export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { action, dirPath, name, type, tmdbApiKey, hwAccelPrefer, liveTvAudioUrl, liveTvDanmakuUrl, livePrefs, watchPrefs, key } = body;
        const db = getDb();
        const isAdmin = canAdminSite((await getAccess(request)).role);

        // 保存配置：播放偏好全员可写；系统级字段（TMDB key/硬件加速/直播源/目录）仅 admin
        if (action === "save_config") {
            const wantsSystemField = tmdbApiKey !== undefined || hwAccelPrefer !== undefined
                || liveTvAudioUrl !== undefined || liveTvDanmakuUrl !== undefined;
            if (wantsSystemField && !isAdmin) {
                return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
            }
            const stmt = db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)");
            db.transaction(() => {
                if (tmdbApiKey !== undefined) stmt.run('tmdb_api_key', tmdbApiKey);
                if (hwAccelPrefer !== undefined) stmt.run('hw_accel_prefer', hwAccelPrefer ? 'true' : 'false');
                if (liveTvAudioUrl !== undefined) stmt.run('live_tv_audio_url', liveTvAudioUrl);
                if (liveTvDanmakuUrl !== undefined) stmt.run('live_tv_danmaku_url', liveTvDanmakuUrl);
                if (livePrefs !== undefined) stmt.run('live_tv_prefs', livePrefs);
                if (watchPrefs !== undefined) stmt.run('watch_prefs', watchPrefs);
            })();
            return NextResponse.json({ success: true });
        }

        // 目录管理操作仅 admin（改 media_dir = 改写全站权限边界，必须锁死）
        if (!isAdmin) {
            return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
        }

        // 添加媒体目录
        if (action === "add_dir") {
            if (!dirPath || !type) {
                return NextResponse.json({ success: false, error: "目录路径和类型不能为空" }, { status: 400 });
            }

            const resolvedPath = path.resolve(dirPath);
            if (!fs.existsSync(resolvedPath)) {
                return NextResponse.json({ success: false, error: `目录不存在: ${resolvedPath}` }, { status: 400 });
            }
            if (!fs.statSync(resolvedPath).isDirectory()) {
                return NextResponse.json({ success: false, error: "路径不是目录" }, { status: 400 });
            }
            if (!type || typeof type !== 'string' || !type.trim()) {
                return NextResponse.json({ success: false, error: "媒体类型不能为空" }, { status: 400 });
            }

            const dirKey = `media_dir_${Date.now()}`;
            const dirConfig = JSON.stringify({
                path: resolvedPath,
                name: name || path.basename(resolvedPath),
                type,
            });

            db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run(dirKey, dirConfig);

            return NextResponse.json({
                success: true,
                data: { key: dirKey, path: resolvedPath, name: name || path.basename(resolvedPath), type },
            });
        }

        // 清除指定目录的映射数据（保留目录配置，只删 media 记录）
        if (action === "clear_dir_data") {
            if (!key) {
                return NextResponse.json({ success: false, error: "需要指定目录 key" }, { status: 400 });
            }

            const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
            if (!row) {
                return NextResponse.json({ success: false, error: "目录不存在" }, { status: 400 });
            }

            try {
                const config = JSON.parse(row.value);
                if (config.path) {
                    const result = db.prepare("DELETE FROM media WHERE instr(path, ?) = 1").run(config.path);
                    return NextResponse.json({ success: true, deleted: result.changes });
                }
            } catch (e) {
                console.error("清理数据失败", e);
            }

            return NextResponse.json({ success: true, deleted: 0 });
        }

        return NextResponse.json({ success: false, error: "无效操作" }, { status: 400 });
    } catch (error) {
        console.error("设置操作失败:", error);
        return NextResponse.json({ success: false, error: "操作失败" }, { status: 500 });
    }
}

// DELETE: 删除媒体目录（同时清理关联数据）——仅 admin
export async function DELETE(request: NextRequest) {
    try {
        if (!canAdminSite((await getAccess(request)).role)) {
            return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
        }
        const { searchParams } = new URL(request.url);
        const key = searchParams.get("key");

        if (!key) {
            return NextResponse.json({ success: false, error: "需要指定目录 key" }, { status: 400 });
        }

        const db = getDb();

        const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
        if (row) {
            try {
                const config = JSON.parse(row.value);
                if (config.path) {
                    db.prepare("DELETE FROM media WHERE instr(path, ?) = 1").run(config.path);
                }
            } catch (e) {
                console.error("解析配置失败，跳过媒体数据清理", e);
            }
        }

        db.prepare("DELETE FROM settings WHERE key = ?").run(key);

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("删除目录失败:", error);
        return NextResponse.json({ success: false, error: "删除失败" }, { status: 500 });
    }
}
