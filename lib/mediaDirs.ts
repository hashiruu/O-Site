// 媒体目录工具：统一 getMediaDirs（5 个 API 重复实现，抽公共）+ isSensitivePath（私密/旅行相册判定）。
// media_dir_* settings value 形如 {path, name, type}，type='private' 即私密保险箱。
import path from "path";
import { getDb } from "./db";
import { isPathUnder } from "./path-guard";

export interface MediaDir {
    path: string;
    name?: string;
    type?: string; // 'movie' | 'series' | 'anime' | 'private' | 'travel' | 'theater' | ...
}

const TRAVEL_ROOT = "/home/steven/mydrive/重要资料！/旅行相册";

/** 标准公开影音类型（推荐/首页 feed 只出这些，theater相册/日常 等个人相册类不算） */
export const PUBLIC_TYPES = ["movie", "series", "anime"];

export function getMediaDirs(): MediaDir[] {
    const rows = getDb().prepare("SELECT value FROM settings WHERE key LIKE 'media_dir_%'").all() as { value: string }[];
    return rows.map((r) => {
        try {
            const v = JSON.parse(r.value);
            return { path: v.path, name: v.name, type: v.type };
        } catch {
            return { path: r.value };
        }
    }).filter((d) => d.path);
}

/** 路径是否属于敏感内容——白名单判定：所在目录 type 不是标准公开影音类（private/travel/theater相册/日常…）即敏感 */
export function isSensitivePath(filePath: string): boolean {
    const resolved = path.resolve(filePath);
    for (const d of getMediaDirs()) {
        if (isPathUnder(resolved, d.path)) return !PUBLIC_TYPES.includes(d.type || "");
    }
    if (isPathUnder(resolved, TRAVEL_ROOT)) return true;
    return false;
}

/** 路径所在 media_dir 的 type（DB 反查失败时的兜底类别来源） */
export function getDirTypeByPath(filePath: string): string | null {
    const resolved = path.resolve(filePath);
    for (const d of getMediaDirs()) {
        if (d.type && isPathUnder(resolved, d.path)) return d.type;
    }
    if (isPathUnder(resolved, TRAVEL_ROOT)) return "travel";
    return null;
}

/** 路径的内容类别：优先 media/episodes 表反查，其次所在目录 type。null = 未知（守卫默认拒绝） */
export function getCategoryByPath(filePath: string): string | null {
    return getMediaTypeByPath(filePath) ?? getDirTypeByPath(filePath);
}

/** 路径是否落在任意媒体目录内（路径白名单，原有安全检查） */
export function isPathInMediaDirs(filePath: string): boolean {
    const resolved = path.resolve(filePath);
    return getMediaDirs().some((d) => isPathUnder(resolved, d.path)) || isPathUnder(resolved, TRAVEL_ROOT);
}

/** 按 filePath 反查 media.type（剧集走 episodes 表 join media，单体走 media.path）。播放授权用 */
export function getMediaTypeByPath(filePath: string): string | null {
    const db = getDb();
    const ep = db.prepare(
        "SELECT m.type FROM episodes e JOIN media m ON e.media_id = m.id WHERE e.path = ?"
    ).get(filePath) as { type: string } | undefined;
    if (ep) return ep.type;
    const m = db.prepare("SELECT type FROM media WHERE path = ?").get(filePath) as { type: string } | undefined;
    return m?.type || null;
}
