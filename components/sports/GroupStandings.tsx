"use client";

// 小组积分榜弹窗：12 组排名 + 晋级/淘汰标记 + 顶部赛制规则说明。
// 数据从 /api/sports/schedule 拉，分组与积分由 lib/sports/groups 计算。
import { useEffect, useState } from "react";
import type { MatchEvent } from "../../lib/sports/types";
import { computeStandings } from "../../lib/sports/groups";

export function GroupStandings({ open, onClose }: { open: boolean; onClose: () => void }) {
    const [events, setEvents] = useState<MatchEvent[]>([]);

    useEffect(() => {
        if (!open) return;
        fetch("/api/sports/schedule")
            .then((r) => r.json())
            .then((d) => { if (d.success) setEvents(d.data.events); })
            .catch(() => { /* noop */ });
    }, [open]);

    if (!open) return null;
    const groups = computeStandings(events);
    const keys = Object.keys(groups).sort();
    const flat = Object.values(groups).flat();
    const inCount = flat.filter((t) => t.qualify === "in" || t.qualify === "maybe_in").length;
    const Q: Record<string, { label: string; badge: string; row: string }> = {
        in:        { label: "确定出线", badge: "bg-primary text-white",          row: "bg-primary/10" },
        maybe_in:  { label: "可能出线", badge: "bg-primary/15 text-primary",     row: "bg-primary/5" },
        maybe_out: { label: "可能淘汰", badge: "bg-bili-pink/15 text-bili-pink", row: "bg-bili-pink/5" },
        out:       { label: "确定淘汰", badge: "bg-bili-pink text-white",        row: "bg-bili-pink/10" },
    };

    return (
        <div className="fixed inset-0 z-[95] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
            <div className="bg-bg-nav border border-line rounded-2xl max-w-4xl w-full max-h-[88vh] overflow-y-auto p-5 custom-scrollbar" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-3">
                    <h2 className="font-display text-lg text-text-1">小组积分榜</h2>
                    <button type="button" onClick={onClose} className="text-text-3 hover:text-text-1 text-lg leading-none">✕</button>
                </div>

                {/* 赛制规则说明 */}
                <div className="bg-bg border border-line rounded-xl p-3 mb-4 text-[12px] text-text-2 leading-relaxed">
                    <b className="text-text-1">赛制：</b>胜 <b className="text-primary">3 分</b>，平 1 分，负 0 分。
                    每组前 <b className="text-primary">2 名直接出线</b>（24 队），再补 <b className="text-primary">8 个成绩最好的第三名</b> 凑齐 32 强，其余淘汰。
                    排名依次比：<b>积分 → 净胜球 → 进球数</b>。
                    <div className="mt-1 text-text-3">深色 = 已确定，浅色 = 仍可能变（组未打完 / 最佳第三待定）。当前预测 {inCount} / 32 队出线。</div>
                </div>

                <div className="flex flex-wrap gap-3 mb-3 text-[11px] text-text-3">
                    <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-primary inline-block" />确定出线</span>
                    <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-primary/30 inline-block" />可能出线</span>
                    <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-bili-pink/30 inline-block" />可能淘汰</span>
                    <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-bili-pink inline-block" />确定淘汰</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {keys.map((g) => (
                        <div key={g} className="bg-bg border border-line rounded-xl p-2">
                            <div className="text-[11px] font-bold text-text-1 px-1 py-1">{g} 组</div>
                            <table className="w-full text-[11px]">
                                <thead>
                                    <tr className="text-text-3 text-[10px]">
                                        <th className="text-left px-1 py-0.5 font-medium">#</th>
                                        <th className="text-left px-1 py-0.5 font-medium">球队</th>
                                        <th className="px-1 text-center font-medium">场</th>
                                        <th className="px-1 text-center font-medium">胜/负/平</th>
                                        <th className="px-1 text-center font-medium">进/失</th>
                                        <th className="px-1 text-center font-medium">分</th>
                                        <th className="px-1 text-center font-medium">资格</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {groups[g].map((t, i) => {
                                        const q = Q[t.qualify] ?? Q.maybe_out;
                                        return (
                                            <tr key={t.name} className={`border-t border-line/40 ${q.row}`}>
                                                <td className="px-1 py-1 whitespace-nowrap tabular-nums text-text-2">{i + 1}</td>
                                                <td className="px-1 py-1 truncate max-w-[82px] text-text-1">
                                                    {t.logo && (
                                                        <img src={t.logo} alt="" className="inline-block w-[18px] h-3 object-cover rounded-[2px] mr-1 align-middle" loading="lazy" />
                                                    )}
                                                    {t.name}
                                                </td>
                                                <td className="px-1 text-center tabular-nums">{t.played}</td>
                                                <td className="px-1 text-center tabular-nums text-text-3">{t.w}/{t.l}/{t.d}</td>
                                                <td className="px-1 text-center tabular-nums text-text-3">{t.gf}/{t.ga}</td>
                                                <td className="px-1 text-center tabular-nums font-bold text-text-1">{t.pts}</td>
                                                <td className="px-1 text-center">
                                                    <span className={`text-[9px] font-bold rounded px-1 py-0.5 leading-tight whitespace-nowrap ${q.badge}`}>
                                                        {q.label}
                                                    </span>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
