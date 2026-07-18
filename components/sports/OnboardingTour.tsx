"use client";

// 首访引导动画：全屏步进（赛制结构 → 用法 → 进展）。可跳过；localStorage 记已看。
import { useState } from "react";

const STEPS = [
    { icon: "🏆", title: "赛制结构", body: "48 队分 12 组，小组赛前二 + 8 个最佳第三名出线 32 强，之后单场淘汰，一路到决赛。" },
    { icon: "🖱️", title: "怎么用", body: "点击任意比赛卡片 → 自动用队名匹配直播源抓流播放。时间统一美东 24 小时制。" },
    { icon: "📈", title: "当前进展", body: "顶部全景条实时显示赛程阶段、已完成场次与 LIVE 计数。已被淘汰的队伍会被红色斩杀条标记。" },
];

export function OnboardingTour({ open, onClose }: { open: boolean; onClose: () => void }) {
    const [i, setI] = useState(0);
    if (!open) return null;
    const step = STEPS[i];
    const last = i === STEPS.length - 1;

    return (
        <div className="fixed inset-0 z-[100] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 animate-in" onClick={onClose}>
            <div className="bg-bg-nav border border-line rounded-2xl p-6 max-w-md w-full shadow-2xl" onClick={(e) => e.stopPropagation()}>
                <div className="text-5xl mb-3 text-center animate-bounce">{step.icon}</div>
                <h3 className="font-display text-lg text-text-1 text-center mb-2">{step.title}</h3>
                <p className="text-sm text-text-2 text-center leading-relaxed mb-5 min-h-[60px]">{step.body}</p>

                <div className="flex justify-center gap-1.5 mb-4">
                    {STEPS.map((_, idx) => (
                        <span key={idx} className={`h-1.5 rounded-full transition-all ${idx === i ? "w-6 bg-primary" : "w-1.5 bg-line"}`} />
                    ))}
                </div>

                <div className="flex items-center justify-between">
                    <button type="button" onClick={onClose} className="text-xs text-text-3 hover:text-text-1 transition-colors">跳过</button>
                    <button
                        type="button"
                        onClick={() => (last ? onClose() : setI((v) => v + 1))}
                        className="px-4 py-1.5 rounded-lg bg-primary text-white text-sm font-semibold hover:opacity-90 transition-opacity"
                    >
                        {last ? "开始观看" : "下一步"}
                    </button>
                </div>
            </div>
        </div>
    );
}
