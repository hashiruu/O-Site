import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { resolveUserKeyOrNull } from "@/lib/identity";
import { v4 as uuidv4 } from "uuid";

function getIdsByPath(db: any, filePath: string) {
    // 检查是否单集（电视剧/番剧）
    const episode = db.prepare("SELECT id, media_id FROM episodes WHERE path = ?").get(filePath) as any;
    if (episode) {
        return { media_id: episode.media_id, episode_id: episode.id };
    }
    // 检查是否单体电影
    const media = db.prepare("SELECT id FROM media WHERE path = ?").get(filePath) as any;
    if (media) {
        return { media_id: media.id, episode_id: null };
    }
    return null;
}

// 获取播放进度
export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    const filePath = searchParams.get('filePath');

    if (!filePath) return NextResponse.json({ success: false, error: 'Missing filePath' });

    try {
        const db = getDb();
        const user = await resolveUserKeyOrNull(request);
        if (!user) return NextResponse.json({ success: true, position: 0 }); // 未登录：无进度可查
        const ids = getIdsByPath(db, filePath);
        if (!ids) return NextResponse.json({ success: true, position: 0 });

        const query = ids.episode_id
            ? "SELECT position FROM watch_progress WHERE user_id = ? AND media_id = ? AND episode_id = ?"
            : "SELECT position FROM watch_progress WHERE user_id = ? AND media_id = ? AND episode_id IS NULL";

        const row = ids.episode_id
            ? db.prepare(query).get(user, ids.media_id, ids.episode_id) as any
            : db.prepare(query).get(user, ids.media_id) as any;

        return NextResponse.json({ success: true, position: row ? row.position : 0 });
    } catch (e: any) {
        return NextResponse.json({ success: false, error: e.message });
    }
}

// 更新播放进度
export async function POST(request: NextRequest) {
    try {
        const { filePath, position, duration } = await request.json();
        if (!filePath) return NextResponse.json({ success: false, error: 'Missing filePath' });

        const db = getDb();
        const user = await resolveUserKeyOrNull(request);
        if (!user) return NextResponse.json({ success: false, error: "LOGIN_REQUIRED" }, { status: 401 }); // 未登录不落任何进度
        const ids = getIdsByPath(db, filePath);
        if (!ids) return NextResponse.json({ success: false, error: 'Media not found in library' });

        // 如果看到了 90% 以上，认为是已看完 (completed=1)
        const completed = (duration > 0 && position / duration > 0.9) ? 1 : 0;

        const checkQuery = ids.episode_id
            ? "SELECT id FROM watch_progress WHERE user_id = ? AND media_id = ? AND episode_id = ?"
            : "SELECT id FROM watch_progress WHERE user_id = ? AND media_id = ? AND episode_id IS NULL";

        const existing = ids.episode_id
            ? db.prepare(checkQuery).get(user, ids.media_id, ids.episode_id) as any
            : db.prepare(checkQuery).get(user, ids.media_id) as any;

        if (existing) {
            db.prepare(
                "UPDATE watch_progress SET position = ?, duration = ?, completed = ?, last_watched = CURRENT_TIMESTAMP WHERE id = ?"
            ).run(position, duration, completed, existing.id);
        } else {
            db.prepare(
                "INSERT INTO watch_progress (id, media_id, episode_id, position, duration, completed, user_id) VALUES (?, ?, ?, ?, ?, ?, ?)"
            ).run(uuidv4(), ids.media_id, ids.episode_id, position, duration, completed, user);
        }

        return NextResponse.json({ success: true });
    } catch (e: any) {
        return NextResponse.json({ success: false, error: e.message });
    }
}
