"use client";

// 淘汰斩杀条：对角线毛笔飞白，盖在「被淘汰队伍那一行」上（右上 → 左下劈斩）。
// 由父 TeamRow 以 absolute inset-0 约束，z-10 压在队名/比分之上。
import { useId } from "react";

export function KillStamp({ className }: { className?: string }) {
    const raw = useId();
    const ripId = `killrip-${raw.replace(/[:]/g, "")}`;
    const fbId = `killfb-${raw.replace(/[:]/g, "")}`;
    return (
        <svg
            className={`pointer-events-none absolute inset-0 z-10 h-full w-full ${className ?? ""}`}
            viewBox="0 0 220 48"
            preserveAspectRatio="none"
            aria-hidden
        >
            <defs>
                <filter id={ripId}>
                    <feTurbulence type="fractalNoise" baseFrequency="0.05 0.02" numOctaves={2} seed={4} />
                    <feDisplacementMap in="SourceGraphic" scale={5} />
                </filter>
                <linearGradient id={fbId} x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0" stopColor="#fff" stopOpacity=".28" />
                    <stop offset=".2" stopColor="#fff" stopOpacity="0" />
                    <stop offset=".35" stopColor="#fff" stopOpacity=".32" />
                    <stop offset=".55" stopColor="#fff" stopOpacity="0" />
                    <stop offset=".75" stopColor="#fff" stopOpacity=".22" />
                    <stop offset="1" stopColor="#fff" stopOpacity="0" />
                </linearGradient>
            </defs>
            <g filter={`url(#${ripId})`}>
                <polygon points="220,0 220,20 0,48 0,28" fill="#8e1414" fillOpacity={0.6} />
                <polygon points="220,0 220,20 0,48 0,28" fill={`url(#${fbId})`} />
            </g>
        </svg>
    );
}
