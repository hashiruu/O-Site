"use client";

import { ChangeEvent } from "react";

interface RangeSliderProps {
    label: string;
    value: number;
    min: number;
    max: number;
    step?: number;
    defaultValue?: number;
    onChange: (v: number) => void;
    format?: (v: number) => string;
}

// 项目无现成滑块组件，手写一个：原生 range + 语义 token 美化轨道/滑块头。
export function RangeSlider({ label, value, min, max, step = 0.01, defaultValue, onChange, format }: RangeSliderProps) {
    const pct = ((value - min) / (max - min)) * 100;
    const dirty = defaultValue !== undefined && Math.abs(value - defaultValue) > 0.001;
    return (
        <div className="flex flex-col gap-1.5 min-w-[120px] flex-1">
            <div className="flex items-center justify-between text-xs">
                <span className="text-text-2 font-medium">{label}</span>
                <div className="flex items-center gap-2">
                    <span className="text-text-3 tabular-nums">{format ? format(value) : value.toFixed(2)}</span>
                    {dirty && (
                        <button
                            type="button"
                            onClick={() => onChange(defaultValue!)}
                            className="text-text-3 hover:text-primary transition-colors text-sm leading-none"
                            title="重置默认"
                            aria-label={`重置${label}`}
                        >↺</button>
                    )}
                </div>
            </div>
            <input
                type="range"
                min={min}
                max={max}
                step={step}
                value={value}
                onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(parseFloat(e.target.value))}
                className="live-range w-full"
                style={{ background: `linear-gradient(to right, var(--color-primary) ${pct}%, var(--color-bg-tag) ${pct}%)` }}
            />
            <style jsx global>{`
                .live-range { -webkit-appearance: none; appearance: none; height: 4px; border-radius: 999px; outline: none; cursor: pointer; }
                .live-range::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 14px; height: 14px; border-radius: 50%; background: var(--color-primary); border: 2px solid var(--color-bg); box-shadow: 0 1px 4px rgba(0,0,0,.35); cursor: pointer; transition: transform .15s; }
                .live-range::-webkit-slider-thumb:hover { transform: scale(1.15); }
                .live-range::-moz-range-thumb { width: 14px; height: 14px; border-radius: 50%; background: var(--color-primary); border: 2px solid var(--color-bg); cursor: pointer; }
            `}</style>
        </div>
    );
}
