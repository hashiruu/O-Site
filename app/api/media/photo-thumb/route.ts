// GET /api/media/photo-thumb?filePath=X → 瀑布流网格用的缩略图（sharp 转 webp，磁盘缓存）。
// 照片原图走 /api/media/image（给 lightbox），这里只产出 ~800px 宽小图给网格，省带宽/提速。
// 缓存 key 含文件 size+mtime：源文件被替换后自动重生成，不会拿到旧缩略图。
import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import sharp from "sharp";
import { getDb } from "@/lib/db";
import { isPathUnder } from "@/lib/path-guard";
import { ensureCacheCleaner } from "@/lib/cache-cleaner";

export const dynamic = "force-dynamic";

ensureCacheCleaner();

const CACHE_DIR = path.join(process.cwd(), "cache", "photo-thumbs");
const IMG_RE = /\.(jpg|jpeg|png|webp)$/i;

export async function GET(req: NextRequest): Promise<NextResponse> {
    const filePath = req.nextUrl.searchParams.get("filePath");
    if (!filePath) return new NextResponse("Missing filePath", { status: 400 });

    // 权限守卫：按内容类别对 scope，默认拒绝（boss 分配可见栏目）
    const { getCategoryByPath } = await import("@/lib/mediaDirs");
    const { getAccess, allows } = await import("@/lib/roles");
    if (!allows(await getAccess(req), getCategoryByPath(filePath))) {
        return new NextResponse("Forbidden", { status: 403 });
    }

    const resolved = path.resolve(filePath);

    // 安全：必须在某个 media_dir 下（与 image route 一致）
    const db = getDb();
    const dirs = db.prepare("SELECT value FROM settings WHERE key LIKE 'media_dir_%'").all() as { value: string }[];
    const allowed = dirs.some((d) => {
        try { return isPathUnder(resolved, JSON.parse(d.value).path); }
        catch { return isPathUnder(resolved, d.value); }
    });
    if (!allowed) return new NextResponse("Forbidden", { status: 403 });
    if (!IMG_RE.test(resolved)) return new NextResponse("Not an image", { status: 400 });

    let stat: fs.Stats;
    try { stat = fs.statSync(resolved); } catch { return new NextResponse("Not Found", { status: 404 }); }

    if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

    const key = crypto.createHash("md5").update(`${resolved}@${stat.size}@${stat.mtimeMs}`).digest("hex");
    const cachePath = path.join(CACHE_DIR, `${key}.webp`);

    // 命中磁盘缓存：直接吐
    if (fs.existsSync(cachePath)) {
        const data = fs.readFileSync(cachePath);
        return new NextResponse(new Uint8Array(data), {
            headers: { "Content-Type": "image/webp", "Cache-Control": "public, max-age=31536000, immutable" },
        });
    }

    // 现生成：resize 到 800 宽 + webp，顺带按 EXIF 旋转
    try {
        const buf = await sharp(resolved)
            .rotate()
            .resize({ width: 800, withoutEnlargement: true })
            .webp({ quality: 78 })
            .toBuffer();
        try { fs.writeFileSync(cachePath, buf); } catch { /* 缓存写失败不影响返回 */ }
        return new NextResponse(new Uint8Array(buf), {
            headers: { "Content-Type": "image/webp", "Cache-Control": "public, max-age=31536000, immutable" },
        });
    } catch (e) {
        console.error("photo-thumb error:", e);
        return new NextResponse("Internal Server Error", { status: 500 });
    }
}
