"use client";

// 论坛共享件：投票列 + 相对时间（列表页/详情页共用）

export function timeAgo(iso: string): string {
    if (!iso) return "";
    const d = new Date(iso.replace(" ", "T") + "Z");
    const diff = (Date.now() - d.getTime()) / 1000;
    if (diff < 60) return "刚刚";
    if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
    if (diff < 86400 * 30) return `${Math.floor(diff / 86400)} 天前`;
    return d.toLocaleDateString("zh-CN");
}

// 投票列（帖子/评论通用）：▲ 分数 ▼，橙=顶，蓝=踩；compact 用于评论行（横排小号）
export function VoteColumn({
    score, myVote, onVote, compact,
}: { score: number; myVote: number; onVote: (v: number) => void; compact?: boolean }) {
    const size = compact ? "h-4 w-4" : "h-5 w-5";
    return (
        <div className={`flex ${compact ? "flex-row items-center gap-1" : "flex-col items-center gap-0.5"}`}>
            <button
                aria-label="顶"
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); onVote(myVote === 1 ? 0 : 1); }}
                className={`cursor-pointer rounded p-0.5 transition-colors ${myVote === 1 ? "text-primary" : "text-text-3 hover:text-primary"}`}
            >
                <svg viewBox="0 0 24 24" className={size} fill="currentColor"><path d="M12 4l8 10h-5v6H9v-6H4z" /></svg>
            </button>
            <span className={`tabular-nums text-[13px] font-semibold ${myVote === 1 ? "text-primary" : myVote === -1 ? "text-secondary" : "text-text-2"}`}>
                {score}
            </span>
            <button
                aria-label="踩"
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); onVote(myVote === -1 ? 0 : -1); }}
                className={`cursor-pointer rounded p-0.5 transition-colors ${myVote === -1 ? "text-secondary" : "text-text-3 hover:text-secondary"}`}
            >
                <svg viewBox="0 0 24 24" className={size} fill="currentColor"><path d="M12 20L4 10h5V4h6v6h5z" /></svg>
            </button>
        </div>
    );
}
