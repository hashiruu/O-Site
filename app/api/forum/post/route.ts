// 论坛帖子详情：GET ?id= → 帖子 + 全部评论（含当前用户投票状态），前端自行组树
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { auth } from "@/auth";
import { ensureForumSchema } from "@/lib/forum";
import { getRoleByEmail, canAdminSite } from "@/lib/roles";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
    let email: string | undefined;
    let name: string | undefined;
    try {
        const session = await auth();
        email = session?.user?.email?.toLowerCase();
        name = session?.user?.name || undefined;
    } catch { /* noop */ }
    if (!email) return NextResponse.json({ success: false, error: "LOGIN_REQUIRED" }, { status: 401 });
    void name;
    ensureForumSchema();

    const id = Number(req.nextUrl.searchParams.get("id"));
    if (!Number.isInteger(id) || id <= 0) {
        return NextResponse.json({ success: false, error: "无效 id" }, { status: 400 });
    }
    const db = getDb();
    const post = db.prepare("SELECT * FROM forum_posts WHERE id = ?").get(id) as any;
    if (!post) return NextResponse.json({ success: false, error: "帖子不存在" }, { status: 404 });

    const comments = db.prepare(
        "SELECT * FROM forum_comments WHERE post_id = ? ORDER BY created_at ASC"
    ).all(id) as any[];

    // 当前用户对帖子 + 评论的投票
    const myPostVote = (db.prepare(
        "SELECT value FROM forum_votes WHERE user_id = ? AND target_type = 'post' AND target_id = ?"
    ).get(email, id) as any)?.value || 0;
    const voteMap = new Map<number, number>();
    if (comments.length) {
        const ph = comments.map(() => "?").join(",");
        for (const v of db.prepare(
            `SELECT target_id, value FROM forum_votes WHERE user_id = ? AND target_type = 'comment' AND target_id IN (${ph})`
        ).all(email, ...comments.map((c) => c.id)) as any[]) {
            voteMap.set(v.target_id, v.value);
        }
    }

    const role = getRoleByEmail(email);
    const admin = canAdminSite(role);
    return NextResponse.json({
        success: true,
        post: {
            id: post.id, title: post.title, body: post.body, author: post.author_name,
            score: post.score, commentCount: post.comment_count, createdAt: post.created_at,
            myVote: myPostVote, mine: post.user_id === email, canDelete: post.user_id === email || admin,
        },
        comments: comments.map((c) => ({
            id: c.id, parentId: c.parent_id, author: c.author_name,
            body: c.deleted ? "" : c.body, deleted: !!c.deleted,
            score: c.score, createdAt: c.created_at,
            myVote: voteMap.get(c.id) || 0,
            canDelete: !c.deleted && (c.user_id === email || admin),
        })),
    });
}
