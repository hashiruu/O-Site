"use client";

// ── B站讨论区（详情页"活人感"）──
// 按片名搜 B站 → 取最相关视频 → 拉真实热评展示：头像、等级、点赞、楼中楼、翻页。
// 纯增强层：搜不到视频/评论接口失败就整块收起，绝不影响详情页本体。
// 评论文本清洗：[表情名] 形式的 B站表情降级为文本保留，控制符剔除。
import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useLang } from "../lib/i18n";

interface SubReply { user: string; message: string; like: number }
interface Reply {
    rpid: string; user: string; avatar: string | null; level: number;
    message: string; like: number; ctime: number; rcount: number; replies: SubReply[];
}
interface Payload {
    video: { bvid: string; title: string; up: string; replyTotal: number };
    page: { pn: number; count: number; size: number };
    comments: Reply[];
}

const fmtLike = (n: number) => (n >= 10000 ? `${(n / 10000).toFixed(1)}万` : String(n));
const fmtTime = (ts: number) => {
    if (!ts) return "";
    const diff = Date.now() / 1000 - ts;
    if (diff < 3600) return `${Math.max(1, Math.floor(diff / 60))} 分钟前`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
    if (diff < 86400 * 30) return `${Math.floor(diff / 86400)} 天前`;
    return new Date(ts * 1000).toLocaleDateString("zh-CN");
};
// B站评论清洗：控制符去掉;[表情] 保留成文本(有梗味,不渲染图省一堆请求)
const cleanMsg = (m: string) => m.replace(/[ -]/g, "").trim();
// 把评论正文里的裸 URL 替换为灰色 [链接] 标记，避免广告 URL 全文展示
const URL_RE = /https?:\/\/\S+/g;
const renderMsg = (raw: string): ReactNode => {
    const cleaned = cleanMsg(raw);
    const matches = cleaned.match(URL_RE);
    if (!matches) return cleaned;
    const parts = cleaned.split(URL_RE);
    return parts.reduce<ReactNode[]>((acc, part, i) => {
        acc.push(part);
        if (i < matches.length) {
            acc.push(<span key={i} className="text-text-3 text-[12px]">[链接]</span>);
        }
        return acc;
    }, []);
};

export function BiliComments({ title }: { title: string }) {
    const { t } = useLang();

    const displayName = (u: string) => /^bili_\d+$/.test(u) ? `用户${u.slice(-4)}` : u;
    const [brokenAvatars, setBrokenAvatars] = useState<Set<string>>(new Set());
    const [bvid, setBvid] = useState<string | null>(null);
    const [payload, setPayload] = useState<Payload | null>(null);
    const [sort, setSort] = useState<"hot" | "time">("hot");
    const [pn, setPn] = useState(1);
    const [loading, setLoading] = useState(true);
    const [gone, setGone] = useState(false); // 任一步失败 → 整块收起

    // 第一步:按片名搜 B站,拿最相关视频的 bvid
    useEffect(() => {
        let alive = true;
        fetch(`/api/bili/search?q=${encodeURIComponent(title)}`)
            .then((r) => r.json())
            .then((d) => {
                if (!alive) return;
                const first = d?.data?.[0];
                if (first?.bvid) setBvid(first.bvid);
                else setGone(true);
            })
            .catch(() => alive && setGone(true));
        return () => { alive = false; };
    }, [title]);

    // 第二步:拉评论
    const load = useCallback((page: number, s: "hot" | "time") => {
        if (!bvid) return;
        setLoading(true);
        fetch(`/api/bili/comments?bvid=${bvid}&pn=${page}&sort=${s}`)
            .then((r) => r.json())
            .then((d) => {
                if (d?.data?.comments?.length) { setPayload(d.data); setPn(page); }
                else if (page === 1) setGone(true); // 首页都没评论 → 收起
            })
            .catch(() => { if (page === 1) setGone(true); })
            .finally(() => setLoading(false));
    }, [bvid]);

    useEffect(() => { if (bvid) load(1, sort); }, [bvid, sort, load]);

    if (gone) return null;

    const totalPages = payload ? Math.max(1, Math.ceil(payload.page.count / payload.page.size)) : 1;

    return (
        <section className="max-w-[1200px] mx-auto pt-4 pb-0">
            <div className='rounded-2xl border border-line bg-bg-card p-6'>
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-baseline gap-3">
                    <h2 className="font-display text-[22px] tracking-tight text-text-1">B站讨论区</h2>
                    {payload && (
                        <span className="text-[12px] text-text-3">
                            {fmtLike(payload.video.replyTotal)} 条评论 · 来自「{payload.video.title.slice(0, 24)}」
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    <div className="flex rounded-full border border-line bg-bg-input p-0.5 text-[12px]">
                        {([["hot", "最热"], ["time", "最新"]] as const).map(([k, label]) => (
                            <button
                                key={k}
                                onClick={() => { setSort(k); setPn(1); }}
                                className={`cursor-pointer rounded-full px-3 py-1 transition-colors ${sort === k ? "bg-bg-card font-semibold text-text-1 shadow-sm" : "text-text-3 hover:text-text-1"}`}
                            >
                                {label}
                            </button>
                        ))}
                    </div>
                    {payload && (
                        <a
                            href={`https://www.bilibili.com/video/${payload.video.bvid}`}
                            target="_blank" rel="noopener noreferrer"
                            className="rounded-full border border-line px-3 py-1 text-[12px] text-text-3 transition-colors hover:border-primary/50 hover:text-primary"
                        >
                            {t("去B站打开 ↗")}
                        </a>
                    )}
                </div>
            </div>

            {loading && !payload ? (
                <div className="space-y-4">
                    {[0, 1, 2].map((i) => (
                        <div key={i} className="flex gap-3">
                            <div className="h-10 w-10 shrink-0 animate-pulse rounded-full bg-bg-hover" />
                            <div className="flex-1 space-y-2 pt-1">
                                <div className="h-3 w-28 animate-pulse rounded bg-bg-hover" />
                                <div className="h-3 w-3/4 animate-pulse rounded bg-bg-hover" />
                            </div>
                        </div>
                    ))}
                </div>
            ) : payload && (
                <>
                    <div className="divide-y divide-line/60">
                        {payload.comments.map((c) => (
                            <div key={c.rpid} className="flex gap-3 py-4">
                                {c.avatar && !brokenAvatars.has(c.rpid) ? (
                                    /* eslint-disable-next-line @next/next/no-img-element */
                                    <img
                                        src={c.avatar} alt="" loading="lazy"
                                        className="h-10 w-10 shrink-0 rounded-full object-cover"
                                        onError={() => setBrokenAvatars(prev => new Set(prev).add(c.rpid))}
                                    />
                                ) : (
                                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-white text-[13px] font-bold">
                                        {displayName(c.user)[0]?.toUpperCase() || 'B'}
                                    </div>
                                )}
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2">
                                        <span className="text-[13px] font-medium text-text-2">{displayName(c.user)}</span>
                                        {c.level >= 5 && (
                                            <span className="rounded bg-primary/10 px-1 py-px text-[10px] font-bold leading-none text-primary">LV{c.level}</span>
                                        )}
                                        <span className="text-[11px] text-text-4">{fmtTime(c.ctime)}</span>
                                    </div>
                                    <p className="mt-1 whitespace-pre-wrap break-words text-[14px] leading-relaxed text-text-1">
                                        {renderMsg(c.message)}
                                    </p>
                                    <div className="mt-1.5 flex items-center gap-3 text-[12px] text-text-3">
                                        <span className="flex items-center gap-1">
                                            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M1 21h4V9H1v12zm22-11c0-1.1-.9-2-2-2h-6.31l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L14.17 1 7.59 7.59C7.22 7.95 7 8.45 7 9v10c0 1.1.9 2 2 2h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-2z" /></svg>
                                            {fmtLike(c.like)}
                                        </span>
                                        {c.rcount > 0 && <span>{c.rcount} 条回复</span>}
                                    </div>
                                    {/* 楼中楼(最多 3 条) */}
                                    {c.replies.length > 0 && (
                                        <div className="mt-2.5 space-y-1.5 rounded-xl bg-bg-input/60 px-3.5 py-2.5">
                                            {c.replies.map((s, i) => (
                                                <p key={i} className="text-[13px] leading-relaxed text-text-2">
                                                    <span className="font-medium text-secondary">{displayName(s.user)}：</span>
                                                    {renderMsg(s.message)}
                                                    {s.like > 0 && <span className="ml-1.5 text-[11px] text-text-4">👍{fmtLike(s.like)}</span>}
                                                </p>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* 翻页 */}
                    {totalPages > 1 && (
                        <div className="mt-4 flex items-center justify-center gap-3">
                            <button
                                disabled={pn <= 1 || loading}
                                onClick={() => load(pn - 1, sort)}
                                className="cursor-pointer rounded-full border border-line px-4 py-1.5 text-[12.5px] text-text-2 transition-colors hover:border-primary/50 hover:text-primary disabled:cursor-default disabled:opacity-40"
                            >
                                ‹ 上一页
                            </button>
                            <span className="text-[12px] tabular-nums text-text-3">{pn} / {Math.min(totalPages, 99)}</span>
                            <button
                                disabled={pn >= totalPages || loading}
                                onClick={() => load(pn + 1, sort)}
                                className="cursor-pointer rounded-full border border-line px-4 py-1.5 text-[12.5px] text-text-2 transition-colors hover:border-primary/50 hover:text-primary disabled:cursor-default disabled:opacity-40"
                            >
                                下一页 ›
                            </button>
                        </div>
                    )}
                </>
            )}
                </div>
            </section>
    );
}
