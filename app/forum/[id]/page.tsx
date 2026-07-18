"use client";

// /forum/[id] —— 帖子详情：正文 + 投票 + 嵌套评论（回复缩进，软删除占位）。
// 登录即可用；未登录 LoginGate（后端同样 401）。
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useMe } from "@/components/useMe";
import { LoginGate } from "@/components/LoginGate";
import { VoteColumn, timeAgo } from "@/components/forum";

interface PostDetail {
    id: number; title: string; body: string; author: string;
    score: number; commentCount: number; createdAt: string;
    myVote: number; mine: boolean; canDelete: boolean;
}
interface CommentItem {
    id: number; parentId: number | null; author: string; body: string; deleted: boolean;
    score: number; createdAt: string; myVote: number; canDelete: boolean;
    children?: CommentItem[];
}

// 平铺 → 楼中楼树
function buildTree(flat: CommentItem[]): CommentItem[] {
    const byId = new Map<number, CommentItem>();
    const roots: CommentItem[] = [];
    for (const c of flat) byId.set(c.id, { ...c, children: [] });
    for (const c of byId.values()) {
        if (c.parentId && byId.has(c.parentId)) byId.get(c.parentId)!.children!.push(c);
        else roots.push(c);
    }
    return roots;
}

function CommentNode({
    c, depth, onVote, onReply, onDelete,
}: {
    c: CommentItem; depth: number;
    onVote: (c: CommentItem, v: number) => void;
    onReply: (parentId: number, body: string) => Promise<boolean>;
    onDelete: (c: CommentItem) => void;
}) {
    const [replying, setReplying] = useState(false);
    const [text, setText] = useState("");
    const [sending, setSending] = useState(false);

    const send = async () => {
        if (!text.trim() || sending) return;
        setSending(true);
        const ok = await onReply(c.id, text.trim());
        setSending(false);
        if (ok) { setText(""); setReplying(false); }
    };

    return (
        <div className={depth > 0 ? "ml-4 border-l-2 border-line/70 pl-3 sm:ml-5 sm:pl-4" : ""}>
            <div className="py-2.5">
                <div className="flex items-center gap-2.5 text-[12px] text-text-3">
                    <span className="font-medium text-text-2">{c.deleted ? "[已删除]" : c.author}</span>
                    <span>{timeAgo(c.createdAt)}</span>
                </div>
                <p className={`mt-1 whitespace-pre-wrap text-[14px] leading-relaxed ${c.deleted ? "italic text-text-4" : "text-text-1"}`}>
                    {c.deleted ? "该评论已删除" : c.body}
                </p>
                {!c.deleted && (
                    <div className="mt-1.5 flex items-center gap-3">
                        <VoteColumn compact score={c.score} myVote={c.myVote} onVote={(v) => onVote(c, v)} />
                        <button
                            className="cursor-pointer text-[12px] text-text-3 transition-colors hover:text-primary"
                            onClick={() => setReplying((v) => !v)}
                        >
                            回复
                        </button>
                        {c.canDelete && (
                            <button
                                className="cursor-pointer text-[12px] text-text-4 transition-colors hover:text-primary"
                                onClick={() => onDelete(c)}
                            >
                                删除
                            </button>
                        )}
                    </div>
                )}
                {replying && (
                    <div className="mt-2 flex flex-col gap-2">
                        <textarea
                            className="min-h-16 resize-y rounded-lg border border-line bg-bg-input px-3 py-2 text-sm text-text-1 outline-none focus:border-primary"
                            placeholder={`回复 ${c.author}…`}
                            maxLength={5000}
                            value={text}
                            onChange={(e) => setText(e.target.value)}
                            autoFocus
                        />
                        <div className="flex justify-end gap-2">
                            <button className="cursor-pointer rounded-lg px-3 py-1 text-xs text-text-3 hover:text-text-1" onClick={() => setReplying(false)}>取消</button>
                            <button
                                className="rounded-lg bg-primary px-4 py-1 text-xs text-white transition-opacity disabled:opacity-50"
                                disabled={!text.trim() || sending}
                                onClick={send}
                            >
                                {sending ? "回复中…" : "回复"}
                            </button>
                        </div>
                    </div>
                )}
            </div>
            {(c.children || []).map((child) => (
                <CommentNode key={child.id} c={child} depth={depth + 1} onVote={onVote} onReply={onReply} onDelete={onDelete} />
            ))}
        </div>
    );
}

export default function ForumPostPage() {
    const me = useMe();
    const router = useRouter();
    const params = useParams<{ id: string }>();
    const postId = Number(params.id);

    const [post, setPost] = useState<PostDetail | null>(null);
    const [comments, setComments] = useState<CommentItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [notFound, setNotFound] = useState(false);
    const [commentText, setCommentText] = useState("");
    const [sending, setSending] = useState(false);
    const [toast, setToast] = useState("");
    const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const showToast = useCallback((msg: string) => {
        setToast(msg);
        if (toastTimer.current) clearTimeout(toastTimer.current);
        toastTimer.current = setTimeout(() => setToast(""), 2800);
    }, []);

    const load = useCallback(async () => {
        try {
            const res = await fetch(`/api/forum/post?id=${postId}`);
            if (res.status === 404) { setNotFound(true); return; }
            const data = await res.json();
            if (data.success) { setPost(data.post); setComments(data.comments); }
        } catch { /* noop */ }
        finally { setLoading(false); }
    }, [postId]);

    useEffect(() => { if (me.loggedIn && Number.isInteger(postId)) load(); }, [me.loggedIn, postId, load]);

    const votePost = async (v: number) => {
        if (!post) return;
        const prev = { myVote: post.myVote, score: post.score };
        setPost({ ...post, myVote: v, score: post.score - post.myVote + v });
        try {
            const res = await fetch("/api/forum/vote", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ type: "post", id: post.id, value: v }),
            });
            const data = await res.json();
            if (!data.success) throw new Error(data.error);
            setPost((p) => p ? { ...p, score: data.score, myVote: data.myVote } : p);
        } catch (e) {
            setPost((p) => p ? { ...p, ...prev } : p);
            showToast(e instanceof Error ? e.message : "操作失败");
        }
    };

    const voteComment = async (c: CommentItem, v: number) => {
        const patch = (list: CommentItem[], id: number, fn: (x: CommentItem) => CommentItem): CommentItem[] =>
            list.map((x) => (x.id === id ? fn(x) : x));
        setComments((list) => patch(list, c.id, (x) => ({ ...x, myVote: v, score: x.score - x.myVote + v })));
        try {
            const res = await fetch("/api/forum/vote", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ type: "comment", id: c.id, value: v }),
            });
            const data = await res.json();
            if (!data.success) throw new Error(data.error);
            setComments((list) => patch(list, c.id, (x) => ({ ...x, score: data.score, myVote: data.myVote })));
        } catch (e) {
            setComments((list) => patch(list, c.id, (x) => ({ ...x, myVote: c.myVote, score: c.score })));
            showToast(e instanceof Error ? e.message : "操作失败");
        }
    };

    const submitComment = async (parentId: number | null, body: string): Promise<boolean> => {
        try {
            const res = await fetch("/api/forum/comments", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ postId, parentId, body }),
            });
            const data = await res.json();
            if (!data.success) throw new Error(data.error || "评论失败");
            await load(); // 重拉，保证楼层/计数一致
            return true;
        } catch (e) {
            showToast(e instanceof Error ? e.message : "评论失败");
            return false;
        }
    };

    const deleteComment = async (c: CommentItem) => {
        if (!confirm("删除这条评论？")) return;
        const res = await fetch("/api/forum/comments", {
            method: "DELETE", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: c.id }),
        });
        const data = await res.json();
        if (data.success) load();
        else showToast(data.error || "删除失败");
    };

    const deletePost = async () => {
        if (!post || !confirm(`删除帖子「${post.title}」？`)) return;
        const res = await fetch("/api/forum/posts", {
            method: "DELETE", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: post.id }),
        });
        const data = await res.json();
        if (data.success) router.push("/forum");
        else showToast(data.error || "删除失败");
    };

    if (!me.loggedIn) return me.loading ? null : <LoginGate feature="讨论组" />;
    if (notFound) {
        return (
            <div className="flex flex-col items-center gap-4 py-24 text-center">
                <p className="text-sm text-text-2">帖子不存在或已被删除</p>
                <Link href="/forum" className="text-sm text-primary hover:underline">← 返回讨论组</Link>
            </div>
        );
    }
    if (loading || !post) {
        return (
            <div className="mx-auto w-full max-w-3xl">
                <div className="h-40 animate-pulse rounded-xl bg-bg-hover" />
            </div>
        );
    }

    const tree = buildTree(comments);

    return (
        <div className="mx-auto w-full max-w-3xl pb-16">
            <Link href="/forum" className="mb-4 inline-block text-[13px] text-text-3 transition-colors hover:text-primary">← 返回讨论组</Link>

            {/* 帖子主体 */}
            <div className="flex gap-4 rounded-xl border border-line bg-bg-card p-5">
                <div className="shrink-0 pt-1">
                    <VoteColumn score={post.score} myVote={post.myVote} onVote={votePost} />
                </div>
                <div className="min-w-0 flex-1">
                    <h1 className="text-xl font-bold leading-snug text-text-1">{post.title}</h1>
                    <div className="mt-2 flex items-center gap-3 text-[12px] text-text-3">
                        <span className="font-medium text-text-2">{post.author}</span>
                        <span>{timeAgo(post.createdAt)}</span>
                        <span>{post.commentCount} 条评论</span>
                        {post.canDelete && (
                            <button className="ml-auto cursor-pointer text-text-4 transition-colors hover:text-primary" onClick={deletePost}>删除</button>
                        )}
                    </div>
                    {post.body && (
                        <p className="mt-4 whitespace-pre-wrap text-[14.5px] leading-relaxed text-text-1">{post.body}</p>
                    )}
                </div>
            </div>

            {/* 评论输入 */}
            <div className="mt-5 flex flex-col gap-2 rounded-xl border border-line bg-bg-card p-4">
                <textarea
                    className="min-h-20 resize-y rounded-lg border border-line bg-bg-input px-3 py-2 text-sm leading-relaxed text-text-1 outline-none focus:border-primary"
                    placeholder="说点什么…"
                    maxLength={5000}
                    value={commentText}
                    onChange={(e) => setCommentText(e.target.value)}
                />
                <div className="flex justify-end">
                    <button
                        className="rounded-lg bg-primary px-5 py-1.5 text-sm text-white transition-opacity disabled:opacity-50"
                        disabled={!commentText.trim() || sending}
                        onClick={async () => {
                            setSending(true);
                            const ok = await submitComment(null, commentText.trim());
                            setSending(false);
                            if (ok) setCommentText("");
                        }}
                    >
                        {sending ? "评论中…" : "评论"}
                    </button>
                </div>
            </div>

            {/* 评论树 */}
            <div className="mt-4 rounded-xl border border-line bg-bg-card px-4 py-2 sm:px-5">
                {tree.length === 0 ? (
                    <p className="py-10 text-center text-sm text-text-3">还没有评论，抢个沙发</p>
                ) : (
                    tree.map((c) => (
                        <div key={c.id} className="border-b border-line/50 last:border-b-0">
                            <CommentNode c={c} depth={0} onVote={voteComment} onReply={(pid, body) => submitComment(pid, body)} onDelete={deleteComment} />
                        </div>
                    ))
                )}
            </div>

            {toast && (
                <div className="fixed bottom-8 left-1/2 z-50 -translate-x-1/2 rounded-full bg-black/80 px-4 py-2 text-sm text-white shadow-lg">
                    {toast}
                </div>
            )}
        </div>
    );
}
