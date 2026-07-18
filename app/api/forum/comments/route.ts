// 论坛评论：POST 发评论/回复（限流）· DELETE 软删除（保树形结构，正文置空）
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { auth } from "@/auth";
import { ensureForumSchema, rateLimitHit } from "@/lib/forum";
import { getRoleByEmail, canAdminSite } from "@/lib/roles";

export const dynamic = "force-dynamic";

async function requireUser() {
    try {
        const session = await auth();
        const email = session?.user?.email?.toLowerCase();
        if (!email) return null;
        return { email, name: session?.user?.name || email.split("@")[0] };
    } catch { return null; }
}

function refreshCommentCount(postId: number) {
    getDb().prepare(
        "UPDATE forum_posts SET comment_count = (SELECT COUNT(*) FROM forum_comments WHERE post_id = ? AND deleted = 0) WHERE id = ?"
    ).run(postId, postId);
}

export async function POST(req: NextRequest) {
    const user = await requireUser();
    if (!user) return NextResponse.json({ success: false, error: "LOGIN_REQUIRED" }, { status: 401 });
    ensureForumSchema();
    try {
        const { postId, parentId, body } = await req.json();
        const b = String(body || "").trim();
        if (!b) return NextResponse.json({ success: false, error: "评论不能为空" }, { status: 400 });
        if (b.length > 5000) return NextResponse.json({ success: false, error: "评论最长 5000 字" }, { status: 400 });
        const db = getDb();
        const post = db.prepare("SELECT id FROM forum_posts WHERE id = ?").get(postId);
        if (!post) return NextResponse.json({ success: false, error: "帖子不存在" }, { status: 404 });
        if (parentId != null) {
            const parent = db.prepare("SELECT id FROM forum_comments WHERE id = ? AND post_id = ?").get(parentId, postId);
            if (!parent) return NextResponse.json({ success: false, error: "回复的评论不存在" }, { status: 404 });
        }
        if (rateLimitHit(user.email, "comment")) {
            return NextResponse.json({ success: false, error: "评论太频繁了，歇 10 分钟再来" }, { status: 429 });
        }
        const info = db.prepare(
            "INSERT INTO forum_comments (post_id, parent_id, user_id, author_name, body) VALUES (?, ?, ?, ?, ?)"
        ).run(postId, parentId ?? null, user.email, user.name, b);
        refreshCommentCount(Number(postId));
        return NextResponse.json({ success: true, id: Number(info.lastInsertRowid) });
    } catch (e) {
        return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
    }
}

export async function DELETE(req: NextRequest) {
    const user = await requireUser();
    if (!user) return NextResponse.json({ success: false, error: "LOGIN_REQUIRED" }, { status: 401 });
    ensureForumSchema();
    try {
        const { id } = await req.json();
        const db = getDb();
        const c = db.prepare("SELECT user_id, post_id FROM forum_comments WHERE id = ?").get(id) as any;
        if (!c) return NextResponse.json({ success: false, error: "评论不存在" }, { status: 404 });
        const role = getRoleByEmail(user.email);
        if (c.user_id !== user.email && !canAdminSite(role)) {
            return NextResponse.json({ success: false, error: "只能删除自己的评论" }, { status: 403 });
        }
        // 软删除：保留楼层结构，正文抹掉
        db.prepare("UPDATE forum_comments SET deleted = 1, body = '' WHERE id = ?").run(id);
        refreshCommentCount(c.post_id);
        return NextResponse.json({ success: true });
    } catch (e) {
        return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
    }
}
