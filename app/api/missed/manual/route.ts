import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { resolveUserKeyOrNull } from "@/lib/identity";

export const dynamic = "force-dynamic";

// POST /api/missed/manual { kind, title, cover?, year? } —— 手动补一条错过的热点
const VALID_KINDS = new Set(["movie", "tv", "book", "game"]);

export async function POST(request: NextRequest) {
    try {
        // 补课清单是个人功能：未登录不提供、不落库
        if (!(await resolveUserKeyOrNull(request))) {
            return NextResponse.json({ success: false, error: "LOGIN_REQUIRED" }, { status: 401 });
        }
        const body = await request.json();
        const kind = String(body?.kind || "");
        const title = String(body?.title || "").trim();
        const cover = body?.cover ? String(body.cover).trim() : null;
        const yearNum = Number(body?.year);
        const year = Number.isInteger(yearNum) && yearNum > 1800 && yearNum < 2200 ? yearNum : null;

        if (!VALID_KINDS.has(kind)) {
            return NextResponse.json({ success: false, error: "kind 必须是 movie/tv/book/game" }, { status: 400 });
        }
        if (!title) {
            return NextResponse.json({ success: false, error: "title 不能为空" }, { status: 400 });
        }

        const db = getDb();
        const sourceId = `m${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const info = db
            .prepare(
                `INSERT INTO missed_items (kind, title, cover, year, source, source_id, extra)
                 VALUES (?, ?, ?, ?, 'manual', ?, '{}')`
            )
            .run(kind, title, cover, year, sourceId);

        return NextResponse.json({
            success: true,
            item: { id: Number(info.lastInsertRowid), kind, title, cover, year, source: "manual", source_id: sourceId, extra: {}, status: "unseen", progress: 0 },
        });
    } catch (error) {
        console.error("[missed/manual] POST 失败:", error);
        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : String(error) },
            { status: 500 }
        );
    }
}
