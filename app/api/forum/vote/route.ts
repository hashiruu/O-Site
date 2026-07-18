// 论坛投票：POST { type: 'post'|'comment', id, value: 1|-1|0 }（0 = 取消），限流后重算得分
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { auth } from "@/auth";
import { ensureForumSchema, rateLimitHit, recomputeScore } from "@/lib/forum";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
    let email: string | undefined;
    try { email = (await auth())?.user?.email?.toLowerCase(); } catch { /* noop */ }
    if (!email) return NextResponse.json({ success: false, error: "LOGIN_REQUIRED" }, { status: 401 });
    ensureForumSchema();
    try {
        const { type, id, value } = await req.json();
        if (type !== "post" && type !== "comment") {
            return NextResponse.json({ success: false, error: "type 无效" }, { status: 400 });
        }
        const targetId = Number(id);
        if (!Number.isInteger(targetId) || targetId <= 0 || ![1, -1, 0].includes(value)) {
            return NextResponse.json({ success: false, error: "参数无效" }, { status: 400 });
        }
        const db = getDb();
        const table = type === "post" ? "forum_posts" : "forum_comments";
        if (!db.prepare(`SELECT id FROM ${table} WHERE id = ?`).get(targetId)) {
            return NextResponse.json({ success: false, error: "对象不存在" }, { status: 404 });
        }
        if (rateLimitHit(email, "vote")) {
            return NextResponse.json({ success: false, error: "操作太频繁了，稍后再试" }, { status: 429 });
        }
        if (value === 0) {
            db.prepare("DELETE FROM forum_votes WHERE user_id = ? AND target_type = ? AND target_id = ?").run(email, type, targetId);
        } else {
            db.prepare(`
                INSERT INTO forum_votes (user_id, target_type, target_id, value) VALUES (?, ?, ?, ?)
                ON CONFLICT(user_id, target_type, target_id) DO UPDATE SET value = excluded.value
            `).run(email, type, targetId, value);
        }
        const score = recomputeScore(type, targetId);
        return NextResponse.json({ success: true, score, myVote: value });
    } catch (e) {
        return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
    }
}
