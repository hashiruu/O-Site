// GET /api/media/image?filePath=X → 直接读取图片文件（jpg/png），带媒体目录安全检查。
// thumbnail API 只处理视频截图，图片封面走这里。
import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs";
import { getDb } from "@/lib/db";
import { isPathUnder } from "@/lib/path-guard";
import { Readable } from "stream";

export const dynamic = "force-dynamic";

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

    const db = getDb();
    const dirs = db.prepare("SELECT value FROM settings WHERE key LIKE 'media_dir_%'").all() as { value: string }[];
    const allowed = dirs.some((d) => {
        try { return isPathUnder(resolved, JSON.parse(d.value).path); }
        catch { return isPathUnder(resolved, d.value); }
    });
    if (!allowed) return new NextResponse("Forbidden", { status: 403 });
    if (!fs.existsSync(resolved)) return new NextResponse("Not Found", { status: 404 });

    const ext = path.extname(resolved).toLowerCase();
    const mime = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
    const nodeStream = fs.createReadStream(resolved);
    const webStream = Readable.toWeb(nodeStream) as any;
    return new NextResponse(webStream, {
        headers: { "Content-Type": mime, "Cache-Control": "public, max-age=31536000, immutable" },
    });
}
