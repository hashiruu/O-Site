// 磁盘缓存 LRU 清理：photo-thumbs / thumbnails / ass-danmaku 三个平铺缓存目录
// 此前只增不减（photo-thumbs 已 200MB+），超过阈值后按最近使用时间淘汰到 70% 水位。
// HLS 分片不归这里管——hls-manager 的 reaper 自己清理会话目录。
import fs from "fs";
import path from "path";

const CACHE_ROOT = path.join(process.cwd(), "cache");
const SWEEP_DIRS = ["photo-thumbs", "thumbnails", "ass-danmaku"];
const MAX_TOTAL_BYTES = 500 * 1024 * 1024;
const TARGET_RATIO = 0.7;
const SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000;

// globalThis 持久化，防止 Next.js HMR 重建模块时叠加多个定时器（与 lib/db.ts 同理）
const g = globalThis as typeof globalThis & { __nasCacheCleaner?: ReturnType<typeof setInterval> };

export function ensureCacheCleaner() {
    if (g.__nasCacheCleaner) return;
    g.__nasCacheCleaner = setInterval(sweepCaches, SWEEP_INTERVAL_MS);
    // 首扫延迟到启动后，不拖慢冷启动的首个请求
    setTimeout(sweepCaches, 60_000);
}

export function sweepCaches() {
    try {
        const files: { p: string; size: number; used: number }[] = [];
        for (const name of SWEEP_DIRS) {
            const dir = path.join(CACHE_ROOT, name);
            if (!fs.existsSync(dir)) continue;
            for (const f of fs.readdirSync(dir)) {
                const p = path.join(dir, f);
                try {
                    const st = fs.statSync(p);
                    // relatime 挂载下 atime 更新不及时，取 atime/mtime 较大者作为"最近使用"
                    if (st.isFile()) files.push({ p, size: st.size, used: Math.max(st.atimeMs, st.mtimeMs) });
                } catch { /* 文件可能刚被并发删除 */ }
            }
        }

        let total = files.reduce((s, f) => s + f.size, 0);
        if (total <= MAX_TOTAL_BYTES) return;

        files.sort((a, b) => a.used - b.used);
        const target = MAX_TOTAL_BYTES * TARGET_RATIO;
        let removed = 0;
        for (const f of files) {
            if (total <= target) break;
            try {
                fs.unlinkSync(f.p);
                total -= f.size;
                removed++;
            } catch { /* 单个删除失败不中断 */ }
        }
        console.log(`[cache-cleaner] LRU 清理 ${removed} 个文件，缓存剩余 ${(total / 1048576).toFixed(0)}MB`);
    } catch (e) {
        console.error("[cache-cleaner] sweep failed:", e);
    }
}
