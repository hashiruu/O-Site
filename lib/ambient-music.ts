// 阅读氛围音乐：用站长本地乐库 ~/Music，按情绪桶匹配纯音乐（LLM 一次性编目，见 data/music-index.json）。
// 运行时：情绪标签(bucket) + 温度(energy) → 挑一首（优先器乐、能量相近、避开最近放过的）。
import fs from "fs";
import path from "path";
import crypto from "crypto";

import { MUSIC_DIR } from "./paths";
export { MUSIC_DIR };
const INDEX_PATH = path.join(process.cwd(), "data", "music-index.json");

export const MOOD_BUCKETS = ["calm", "warm", "sad", "mystery", "tension", "dark", "epic", "wonder", "lonely", "romance"] as const;
export type MoodBucket = typeof MOOD_BUCKETS[number];

export interface Track { file: string; bucket: string; energy: number; vocal: number }

export function trackId(file: string): string {
    return crypto.createHash("sha1").update(file).digest("hex").slice(0, 16);
}

let cache: Track[] | null = null;
export function loadIndex(): Track[] {
    if (cache) return cache;
    try {
        const j = JSON.parse(fs.readFileSync(INDEX_PATH, "utf-8")) as { tracks?: Track[] };
        cache = Array.isArray(j.tracks) ? j.tracks.filter((t) => t?.file) : [];
    } catch { cache = []; }
    return cache;
}

/** id → 绝对文件路径（流式播放用），越权/不存在返回 null */
export function fileById(id: string): string | null {
    const t = loadIndex().find((x) => trackId(x.file) === id);
    if (!t) return null;
    const p = path.join(MUSIC_DIR, t.file);
    return p.startsWith(MUSIC_DIR + path.sep) && fs.existsSync(p) ? p : null;
}

function titleOf(file: string): string {
    return file.replace(/\.[^.]+$/, "").replace(/_/g, " ").replace(/\s+/g, " ").trim();
}
function energyOf(temp: number): number { return temp < 35 ? 0 : temp < 70 ? 1 : 2; }

// 相邻情绪桶（本桶没合适曲时按色彩就近借）
const NEIGHBORS: Record<string, string[]> = {
    calm: ["warm", "lonely", "romance"], warm: ["calm", "romance", "wonder"], sad: ["lonely", "calm"],
    lonely: ["sad", "calm"], romance: ["warm", "calm"], mystery: ["dark", "tension"], tension: ["dark", "epic", "mystery"],
    dark: ["tension", "mystery"], epic: ["tension", "wonder"], wonder: ["epic", "warm"],
};

/** 按 (情绪标签 tag, 温度 temp) 挑一首，排除最近放过的 exclude。挑不到返回 null。 */
export function pickTrack(tag: string, temp: number, exclude: string[]): { id: string; title: string; bucket: string } | null {
    const idx = loadIndex();
    if (!idx.length) return null;
    const ex = new Set(exclude);
    const e = energyOf(temp);
    // 候选桶顺序：本桶 → 相邻桶 → 其余（按曲多到少）保证总能找到
    const valid = (MOOD_BUCKETS as readonly string[]).includes(tag);
    const primary = valid ? tag : (e === 2 ? "tension" : e === 0 ? "calm" : "warm");
    const rest = [...MOOD_BUCKETS].filter((b) => b !== primary && !(NEIGHBORS[primary] || []).includes(b))
        .sort((a, b) => idx.filter((t) => t.bucket === b).length - idx.filter((t) => t.bucket === a).length);
    const order = [primary, ...(NEIGHBORS[primary] || []), ...rest];

    // 分级扫描：exclude（20 分钟内播过/该情境上次曲）是硬约束——先在"未排除"里找遍
    // （器乐优先，其次人声），整库都找不到新曲了，最后一级才允许重复（宁重勿断）。
    const scan = (allowVocal: boolean, allowRepeat: boolean): { id: string; title: string; bucket: string } | null => {
        for (const b of order) {
            let pool = idx.filter((t) => t.bucket === b && (allowVocal || !t.vocal) && (allowRepeat || !ex.has(trackId(t.file))));
            if (!pool.length) continue;
            const near = pool.filter((t) => Math.abs((t.energy ?? 1) - e) <= 1);
            if (near.length) pool = near;
            const t = pool[Math.floor(Math.random() * pool.length)];
            return { id: trackId(t.file), title: titleOf(t.file), bucket: b };
        }
        return null;
    };
    return scan(false, false) || scan(true, false) || scan(false, true) || scan(true, true);
}
