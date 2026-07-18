// 论坛帖子：GET 列表（hot/new/top + 分页）· POST 发帖（限流）· DELETE 删帖（作者本人或 admin/boss）
// 权限：登录即可用，不需要内容 scope 授权；未登录一律 401（全站铁律）。
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { auth } from "@/auth";
import { ensureForumSchema, rateLimitHit, hotRank } from "@/lib/forum";
import { getRoleByEmail, canAdminSite } from "@/lib/roles";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 30;

async function requireUser() {
    try {
        const session = await auth();
        const email = session?.user?.email?.toLowerCase();
        if (!email) return null;
        return { email, name: session?.user?.name || email.split("@")[0] };
    } catch { return null; }
}

export async function GET(req: NextRequest) {
    const user = await requireUser();
    if (!user) return NextResponse.json({ success: false, error: "LOGIN_REQUIRED" }, { status: 401 });
    ensureForumSchema();
    const db = getDb();
    const sort = req.nextUrl.searchParams.get("sort") || "hot";
    const page = Math.max(1, parseInt(req.nextUrl.searchParams.get("page") || "1"));

    let rows: any[];
    let hasMore = false;
    if (sort === "hot") {
        // 热度在 JS 里算：取最近 300 帖排序后分页（家庭站规模足够）
        const all = db.prepare(
            "SELECT * FROM forum_posts ORDER BY created_at DESC LIMIT 300"
        ).all() as any[];
        all.sort((a, b) => hotRank(b.score, b.created_at) - hotRank(a.score, a.created_at));
        rows = all.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
        hasMore = all.length > page * PAGE_SIZE;
    } else {
        const order = sort === "top" ? "score DESC, created_at DESC" : "created_at DESC";
        rows = db.prepare(
            `SELECT * FROM forum_posts ORDER BY ${order} LIMIT ? OFFSET ?`
        ).all(PAGE_SIZE + 1, (page - 1) * PAGE_SIZE) as any[];
        hasMore = rows.length > PAGE_SIZE;
        rows = rows.slice(0, PAGE_SIZE);
    }

    // 当前用户对这页帖子的投票状态
    const myVotes = new Map<number, number>();
    if (rows.length) {
        const ids = rows.map((r) => r.id);
        const ph = ids.map(() => "?").join(",");
        for (const v of db.prepare(
            `SELECT target_id, value FROM forum_votes WHERE user_id = ? AND target_type = 'post' AND target_id IN (${ph})`
        ).all(user.email, ...ids) as any[]) {
            myVotes.set(v.target_id, v.value);
        }
    }

    const role = getRoleByEmail(user.email);
    const data = rows.map((r) => ({
        id: r.id,
        title: r.title,
        body: r.body,
        author: r.author_name,
        score: r.score,
        commentCount: r.comment_count,
        createdAt: r.created_at,
        myVote: myVotes.get(r.id) || 0,
        mine: r.user_id === user.email,
        canDelete: r.user_id === user.email || canAdminSite(role),
    }));
    return NextResponse.json({ success: true, data, page, hasMore });
}

export async function POST(req: NextRequest) {
    const user = await requireUser();
    if (!user) return NextResponse.json({ success: false, error: "LOGIN_REQUIRED" }, { status: 401 });
    ensureForumSchema();
    try {
        const { title, body } = await req.json();
        const t = String(title || "").trim();
        const b = String(body || "").trim();
        if (!t) return NextResponse.json({ success: false, error: "标题不能为空" }, { status: 400 });
        if (t.length > 150) return NextResponse.json({ success: false, error: "标题最长 150 字" }, { status: 400 });
        if (b.length > 10000) return NextResponse.json({ success: false, error: "正文最长 10000 字" }, { status: 400 });
        if (rateLimitHit(user.email, "post")) {
            return NextResponse.json({ success: false, error: "发帖太频繁了，歇 10 分钟再来" }, { status: 429 });
        }
        const info = getDb().prepare(
            "INSERT INTO forum_posts (user_id, author_name, title, body) VALUES (?, ?, ?, ?)"
        ).run(user.email, user.name, t, b);
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
        const post = db.prepare("SELECT user_id FROM forum_posts WHERE id = ?").get(id) as any;
        if (!post) return NextResponse.json({ success: false, error: "帖子不存在" }, { status: 404 });
        const role = getRoleByEmail(user.email);
        if (post.user_id !== user.email && !canAdminSite(role)) {
            return NextResponse.json({ success: false, error: "只能删除自己的帖子" }, { status: 403 });
        }
        db.prepare("DELETE FROM forum_comments WHERE post_id = ?").run(id);
        db.prepare("DELETE FROM forum_votes WHERE target_type = 'post' AND target_id = ?").run(id);
        db.prepare("DELETE FROM forum_posts WHERE id = ?").run(id);
        return NextResponse.json({ success: true });
    } catch (e) {
        return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
    }
}
