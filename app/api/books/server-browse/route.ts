// GET /api/books/server-browse?dir=<绝对路径> → 浏览服务器目录，供后台"从服务器导入书籍"选文件。
// 根限定 ~/mydrive（isPathUnder 防穿越）；只返回子目录 + 电子书文件（epub/pdf/md/mobi）。
import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { isPathUnder } from "@/lib/path-guard";

export const dynamic = "force-dynamic";

const ROOT = "/home/steven/mydrive";
const BOOK_EXTS = new Set([".epub", ".pdf", ".md", ".mobi"]);
const MAX_ENTRIES = 800;

export async function GET(req: NextRequest): Promise<NextResponse> {
    // 后台功能守卫：仅 admin/boss
    {
        const { getAccess, canAdminSite } = await import("@/lib/roles");
        if (!canAdminSite((await getAccess(req)).role)) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }
    }
    const dir = req.nextUrl.searchParams.get("dir") || ROOT;
    const abs = path.resolve(dir);
    if (!isPathUnder(abs, ROOT)) {
        return NextResponse.json({ success: false, error: "路径越界" }, { status: 403 });
    }
    let stat: fs.Stats;
    try { stat = fs.statSync(abs); } catch {
        return NextResponse.json({ success: false, error: "目录不存在" }, { status: 404 });
    }
    if (!stat.isDirectory()) {
        return NextResponse.json({ success: false, error: "不是目录" }, { status: 400 });
    }

    const dirs: { name: string; path: string }[] = [];
    const files: { name: string; path: string; size: number; ext: string }[] = [];
    try {
        const entries = fs.readdirSync(abs, { withFileTypes: true });
        for (const e of entries) {
            if (dirs.length + files.length >= MAX_ENTRIES) break;
            // 隐藏文件/下载残留（.sb-*、._*）不展示
            if (e.name.startsWith(".")) continue;
            const p = path.join(abs, e.name);
            if (e.isDirectory()) {
                dirs.push({ name: e.name, path: p });
            } else if (e.isFile()) {
                const ext = path.extname(e.name).toLowerCase();
                if (!BOOK_EXTS.has(ext)) continue;
                let size = 0;
                try { size = fs.statSync(p).size; } catch { /* noop */ }
                files.push({ name: e.name, path: p, size, ext: ext.slice(1) });
            }
        }
    } catch (err) {
        return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
    }
    dirs.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
    files.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
    const parent = abs === path.resolve(ROOT) ? null : path.dirname(abs);
    return NextResponse.json({ success: true, data: { dir: abs, parent, root: ROOT, dirs, files } });
}
