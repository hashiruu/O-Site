"use client";

// /forum —— Reddit 风格论坛列表：hot/new/top 排序 + 行内发帖器 + 左侧投票列。
// 登录即可用（不走内容 scope）；未登录 LoginGate（后端同样 401）。
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useMe } from "@/components/useMe";
import { LoginGate } from "@/components/LoginGate";
import { VoteColumn, timeAgo } from "@/components/forum";
import { PageHeader } from "../../components/PageHeader";
import { useLang } from "@/lib/i18n";

interface ForumPost {
    id: number;
    title: string;
    body: string;
    author: string;
    score: number;
    commentCount: number;
    createdAt: string;
    myVote: number;
    mine: boolean;
    canDelete: boolean;
}

const SORTS = [
    { key: "hot", label: "热门" },
    { key: "new", label: "最新" },
    { key: "top", label: "高分" },
] as const;

export default function ForumPage() {
    const { t } = useLang();
    const me = useMe();
    const [sort, setSort] = useState<(typeof SORTS)[number]["key"]>("hot");
    const [posts, setPosts] = useState<ForumPost[]>([]);
    const [page, setPage] = useState(1);
    const [hasMore, setHasMore] = useState(false);
    const [loading, setLoading] = useState(true);
    const [showComposer, setShowComposer] = useState(false);
    const [title, setTitle] = useState("");
    const [body, setBody] = useState("");
    const [posting, setPosting] = useState(false);
    const [toast, setToast] = useState("");
    const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const showToast = useCallback((msg: string) => {
        setToast(msg);
        if (toastTimer.current) clearTimeout(toastTimer.current);
        toastTimer.current = setTimeout(() => setToast(""), 2800);
    }, []);

    const load = useCallback(async (s: string, p: number, append: boolean) => {
        if (!append) setLoading(true);
        try {
            const res = await fetch(`/api/forum/posts?sort=${s}&page=${p}`);
            const data = await res.json();
            if (data.success) {
                setPosts((prev) => (append ? [...prev, ...data.data] : data.data));
                setHasMore(data.hasMore);
                setPage(p);
            }
        } catch { /* noop */ }
        finally { setLoading(false); }
    }, []);

    useEffect(() => { if (me.loggedIn) load(sort, 1, false); }, [me.loggedIn, sort, load]);

    const submitPost = async () => {
        if (!title.trim() || posting) return;
        setPosting(true);
        try {
            const res = await fetch("/api/forum/posts", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ title: title.trim(), body: body.trim() }),
            });
            const data = await res.json();
            if (!data.success) throw new Error(data.error || "发布失败");
            setTitle(""); setBody(""); setShowComposer(false);
            setSort("new");
            load("new", 1, false);
            showToast("已发布");
        } catch (e) {
            showToast(e instanceof Error ? e.message : "发布失败");
        } finally { setPosting(false); }
    };

    const vote = async (post: ForumPost, v: number) => {
        // 乐观更新
        setPosts((list) => list.map((p) => p.id === post.id
            ? { ...p, myVote: v, score: p.score - p.myVote + v }
            : p));
        try {
            const res = await fetch("/api/forum/vote", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ type: "post", id: post.id, value: v }),
            });
            const data = await res.json();
            if (!data.success) throw new Error(data.error);
            setPosts((list) => list.map((p) => p.id === post.id ? { ...p, score: data.score, myVote: data.myVote } : p));
        } catch (e) {
            setPosts((list) => list.map((p) => p.id === post.id ? { ...p, myVote: post.myVote, score: post.score } : p));
            showToast(e instanceof Error ? e.message : "操作失败");
        }
    };

    const removePost = async (post: ForumPost) => {
        if (!confirm(`删除帖子「${post.title}」？`)) return;
        const res = await fetch("/api/forum/posts", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: post.id }),
        });
        const data = await res.json();
        if (data.success) { setPosts((list) => list.filter((p) => p.id !== post.id)); showToast("已删除"); }
        else showToast(data.error || "删除失败");
    };

    if (!me.loggedIn) return me.loading ? null : <LoginGate feature="讨论组" />;

    return (
        <div className="mx-auto w-full max-w-3xl pb-16">
            {/* 页头 */}
            <PageHeader
                title={t("讨论组")}
                description={t("随便聊聊")}
                actions={
                    <button
                        className="rounded-full bg-primary px-4 py-2 text-sm font-medium text-white transition-transform duration-200 hover:scale-105"
                        onClick={() => setShowComposer((v) => !v)}
                    >
                        {showComposer ? t("收起") : t("发帖")}
                    </button>
                }
            />

            {/* 发帖器 */}
            {showComposer && (
                <div className="animate-fadeIn mb-5 flex flex-col gap-3 rounded-xl border border-line bg-bg-card p-4">
                    <input
                        className="rounded-lg border border-line bg-bg-input px-3 py-2 text-sm text-text-1 outline-none focus:border-primary"
                        placeholder="标题（必填，150 字内）"
                        maxLength={150}
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        autoFocus
                    />
                    <textarea
                        className="min-h-28 resize-y rounded-lg border border-line bg-bg-input px-3 py-2 text-sm leading-relaxed text-text-1 outline-none focus:border-primary"
                        placeholder="正文（可选）"
                        maxLength={10000}
                        value={body}
                        onChange={(e) => setBody(e.target.value)}
                    />
                    <div className="flex justify-end">
                        <button
                            className="rounded-lg bg-primary px-5 py-1.5 text-sm text-white transition-opacity disabled:opacity-50"
                            disabled={!title.trim() || posting}
                            onClick={submitPost}
                        >
                            {posting ? "发布中…" : "发布"}
                        </button>
                    </div>
                </div>
            )}

            {/* 排序 tab */}
            <div className="mb-4 flex gap-1.5">
                {SORTS.map((s) => (
                    <button
                        key={s.key}
                        className={`cursor-pointer rounded-full px-3.5 py-1.5 text-sm transition-colors duration-200 ${sort === s.key ? "bg-primary text-white" : "bg-bg-card text-text-2 hover:text-text-1"}`}
                        onClick={() => setSort(s.key)}
                    >
                        {s.label}
                    </button>
                ))}
            </div>

            {/* 帖子列表 */}
            {loading ? (
                <div className="flex flex-col gap-3">
                    {Array.from({ length: 6 }).map((_, i) => (
                        <div key={i} className="h-24 animate-pulse rounded-xl bg-bg-hover" />
                    ))}
                </div>
            ) : posts.length === 0 ? (
                <div className="flex flex-col items-center gap-3 rounded-xl border border-line bg-bg-card py-20 text-center">
                    <svg viewBox="0 0 24 24" className="h-12 w-12 text-text-4" fill="currentColor">
                        <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H5.17L4 17.17V4h16v12z" />
                    </svg>
                    <p className="text-sm text-text-2">还没有帖子，来发第一帖吧</p>
                </div>
            ) : (
                <div className="grid-stagger flex flex-col gap-3">
                    {posts.map((post) => (
                        <Link
                            key={post.id}
                            href={`/forum/${post.id}`}
                            prefetch={false}
                            className="card-lift flex gap-3 rounded-xl border border-line bg-bg-card p-4"
                        >
                            {/* 左：投票列 */}
                            <div className="shrink-0 pt-0.5">
                                <VoteColumn score={post.score} myVote={post.myVote} onVote={(v) => vote(post, v)} />
                            </div>
                            {/* 右：内容 */}
                            <div className="min-w-0 flex-1">
                                <h2 className="line-clamp-2 text-[15px] font-semibold leading-snug text-text-1">{post.title}</h2>
                                {post.body && (
                                    <p className="mt-1 line-clamp-2 text-[13px] leading-relaxed text-text-3">{post.body}</p>
                                )}
                                <div className="mt-2 flex items-center gap-3 text-[12px] text-text-3">
                                    <span className="font-medium text-text-2">{post.author}</span>
                                    <span>{timeAgo(post.createdAt)}</span>
                                    <span className="flex items-center gap-1">
                                        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor">
                                            <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z" />
                                        </svg>
                                        {post.commentCount}
                                    </span>
                                    {post.canDelete && (
                                        <button
                                            className="ml-auto cursor-pointer text-text-4 transition-colors hover:text-primary"
                                            onClick={(e) => { e.preventDefault(); e.stopPropagation(); removePost(post); }}
                                        >
                                            删除
                                        </button>
                                    )}
                                </div>
                            </div>
                        </Link>
                    ))}
                </div>
            )}

            {/* 加载更多 */}
            {hasMore && !loading && (
                <div className="mt-6 flex justify-center">
                    <button
                        className="rounded-full border border-line bg-bg-card px-6 py-2 text-sm text-text-2 transition-colors hover:text-primary"
                        onClick={() => load(sort, page + 1, true)}
                    >
                        加载更多
                    </button>
                </div>
            )}

            {/* toast */}
            {toast && (
                <div className="fixed bottom-8 left-1/2 z-50 -translate-x-1/2 rounded-full bg-black/80 px-4 py-2 text-sm text-white shadow-lg">
                    {toast}
                </div>
            )}
        </div>
    );
}
