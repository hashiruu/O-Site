import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { Readable } from "stream";
import { isPathUnder } from "@/lib/path-guard";

// /api/books/file?path=<绝对路径>
// 只读文件路由，白名单严格限定书架两个数据源目录，防目录穿越（path-guard 的 relative 判定）。
export const dynamic = "force-dynamic";

import { BOOK_ALLOWED_ROOTS as ALLOWED_ROOTS } from "@/lib/paths";

const MIME: Record<string, string> = {
    ".pdf": "application/pdf",
    ".epub": "application/epub+zip",
    ".mobi": "application/x-mobipocket-ebook",
};

export async function GET(request: NextRequest) {
    // 内容范围守卫：书架栏目需 boss 授权 book scope（admin/boss 全开）
    const { getAccess, allows } = await import("@/lib/roles");
    if (!allows(await getAccess(request), "book")) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const raw = request.nextUrl.searchParams.get("path");
    if (!raw) {
        return NextResponse.json({ error: "缺少 path 参数" }, { status: 400 });
    }

    // resolve 后再做白名单判定，"../" 之类的穿越在这里被拍平并拒绝
    const resolved = path.resolve(raw);
    if (!ALLOWED_ROOTS.some((root) => isPathUnder(resolved, root))) {
        return NextResponse.json({ error: "无权访问此路径" }, { status: 403 });
    }

    const ext = path.extname(resolved).toLowerCase();
    const mime = MIME[ext];
    if (!mime || path.basename(resolved).startsWith(".")) {
        return NextResponse.json({ error: "不支持的文件类型" }, { status: 400 });
    }

    let stat: fs.Stats;
    try {
        stat = fs.statSync(resolved);
    } catch {
        return NextResponse.json({ error: "文件不存在" }, { status: 404 });
    }
    if (!stat.isFile()) {
        return NextResponse.json({ error: "不是文件" }, { status: 400 });
    }

    const stream = Readable.toWeb(fs.createReadStream(resolved)) as ReadableStream;
    return new NextResponse(stream, {
        headers: {
            "Content-Type": mime,
            "Content-Length": String(stat.size),
            // inline：PDF 直接在新标签页内嵌预览而非下载
            "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(path.basename(resolved))}`,
            "Cache-Control": "private, max-age=3600",
        },
    });
}
