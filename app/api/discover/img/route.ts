import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import crypto from "crypto";

export const dynamic = "force-dynamic";

// ── 外源图片代理 ──
// GET /api/discover/img?u=<encoded url>
// TMDB 图 / 豆瓣封面统一走自家服务器转发：客户端永远同源可达。只放行白名单域，防 SSRF。
//
// 缓存两级：内存 LRU + 磁盘（data/img-cache）。此前只有内存缓存，每次 nas build
// 重启进程即清零，重启后首访全部冷路径打 TMDB——"有时能加载有时不能"的真正来源。
// 磁盘缓存跨重启存活，冷启动每张图一生只发生一次。
// 上游失败返回 502 且不缓存（用户铁律：不要用占位符替换真实图片）——
// 前端 onError 有延迟重试 + onLoad 恢复，由真图自己活过来。

const ALLOW = /^https:\/\/(image\.tmdb\.org|img\d*\.doubanio\.com|i[0-2]\.hdslb\.com)\//;

const memCache = new Map<string, { buf: Buffer; ct: string }>();
const MEM_MAX = 300;

const DISK_DIR = path.join(process.cwd(), "data", "img-cache");
const DISK_MAX_FILES = 2000; // ~300MB 封顶，超出清最旧

function diskPath(u: string) {
    return path.join(DISK_DIR, crypto.createHash("sha1").update(u).digest("hex"));
}

function diskRead(u: string): { buf: Buffer; ct: string } | null {
    try {
        const p = diskPath(u);
        const meta = fs.readFileSync(p + ".ct", "utf-8");
        const buf = fs.readFileSync(p);
        return { buf, ct: meta || "image/jpeg" };
    } catch { return null; }
}

function diskWrite(u: string, buf: Buffer, ct: string) {
    try {
        fs.mkdirSync(DISK_DIR, { recursive: true });
        const p = diskPath(u);
        fs.writeFileSync(p, buf);
        fs.writeFileSync(p + ".ct", ct);
        // 粗粒度限容：文件数超限时清最旧的 10%
        const files = fs.readdirSync(DISK_DIR).filter((f) => !f.endsWith(".ct"));
        if (files.length > DISK_MAX_FILES) {
            const stats = files
                .map((f) => ({ f, t: fs.statSync(path.join(DISK_DIR, f)).mtimeMs }))
                .sort((a, b) => a.t - b.t)
                .slice(0, Math.ceil(DISK_MAX_FILES * 0.1));
            for (const { f } of stats) {
                try { fs.unlinkSync(path.join(DISK_DIR, f)); fs.unlinkSync(path.join(DISK_DIR, f + ".ct")); } catch { /* noop */ }
            }
        }
    } catch { /* 磁盘写失败不影响响应 */ }
}

const okResponse = (buf: Buffer, ct: string, tag: string) =>
    new NextResponse(new Uint8Array(buf), {
        headers: { "Content-Type": ct, "Cache-Control": "public, max-age=604800, immutable", "X-Cache": tag },
    });

export async function GET(req: NextRequest) {
    const u = req.nextUrl.searchParams.get("u") || "";
    if (!ALLOW.test(u)) return new NextResponse("forbidden", { status: 403 });

    // L1 内存
    const hit = memCache.get(u);
    if (hit) {
        memCache.delete(u); memCache.set(u, hit); // LRU 触摸
        return okResponse(hit.buf, hit.ct, "mem");
    }
    // L2 磁盘（重启后依然在——冷启动只有第一次）
    const disk = diskRead(u);
    if (disk) {
        memCache.set(u, disk);
        if (memCache.size > MEM_MAX) memCache.delete(memCache.keys().next().value!);
        return okResponse(disk.buf, disk.ct, "disk");
    }

    // L3 上游（失败 502 不缓存：不用假图顶替，前端重试拿真图）
    try {
        const res = await fetch(u, {
            signal: AbortSignal.timeout(12000),
            headers: u.includes("doubanio") ? { Referer: "https://m.douban.com/" } : {},
        });
        if (!res.ok) return new NextResponse("bad upstream", { status: 502, headers: { "Cache-Control": "no-store" } });
        const buf = Buffer.from(await res.arrayBuffer());
        const ct = res.headers.get("content-type") || "image/jpeg";
        memCache.set(u, { buf, ct });
        if (memCache.size > MEM_MAX) memCache.delete(memCache.keys().next().value!);
        diskWrite(u, buf, ct);
        return okResponse(buf, ct, "miss");
    } catch {
        return new NextResponse("upstream timeout", { status: 502, headers: { "Cache-Control": "no-store" } });
    }
}
