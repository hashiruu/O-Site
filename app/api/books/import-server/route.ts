// POST /api/books/import-server → 把服务器上已有的电子书收进书库分类目录。
// body: { paths: string[], category: 五分类之一, move?: boolean（默认 false=复制保留原文件）}
// paths 可含目录：服务端递归展开（限深 4 层、总量 500 个文件），只收白名单扩展名。
// 校验与 /api/books/import 对齐：分类白名单、扩展名白名单、路径限定 ~/mydrive、同名 " (2)" 不覆盖。
import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { isPathUnder } from "@/lib/path-guard";

export const dynamic = "force-dynamic";

const SOURCE_ROOT = "/home/steven/mydrive";
const BOOK_DIR = "/home/steven/mydrive/book";
const CATEGORIES = new Set(["推理悬疑", "科幻", "文学名著", "科研学术", "技术文档", "其他"]);
const ALLOWED_EXTS = new Set([".epub", ".pdf", ".md", ".mobi"]);
const MAX_FILES = 500;
const MAX_DEPTH = 4;

// 递归收集目录下的电子书文件（跳过隐藏/临时文件；书库自身目录不收，防自我复制）
function collectBooks(dir: string, out: string[], depth: number): void {
    if (depth > MAX_DEPTH || out.length >= MAX_FILES) return;
    if (isPathUnder(dir, BOOK_DIR)) return;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
        if (out.length >= MAX_FILES) return;
        if (e.name.startsWith(".")) continue;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) collectBooks(p, out, depth + 1);
        else if (e.isFile() && ALLOWED_EXTS.has(path.extname(e.name).toLowerCase())) out.push(p);
    }
}

function uniqueDest(dir: string, fileName: string): string {
    const ext = path.extname(fileName);
    const base = fileName.slice(0, -ext.length || undefined);
    let dest = path.join(dir, fileName);
    for (let i = 2; fs.existsSync(dest); i++) dest = path.join(dir, `${base} (${i})${ext}`);
    return dest;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
    // 后台功能守卫：仅 admin/boss
    {
        const { getAccess, canAdminSite } = await import("@/lib/roles");
        if (!canAdminSite((await getAccess(req)).role)) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }
    }
    let body: { paths?: string[]; category?: string; move?: boolean };
    try { body = await req.json(); } catch {
        return NextResponse.json({ success: false, error: "无效请求体" }, { status: 400 });
    }
    const { paths, category, move = false } = body;
    if (!category || !CATEGORIES.has(category)) {
        return NextResponse.json({ success: false, error: "无效分类" }, { status: 400 });
    }
    if (!Array.isArray(paths) || paths.length === 0 || paths.length > 100) {
        return NextResponse.json({ success: false, error: "请选择 1-100 个文件" }, { status: 400 });
    }

    const destDir = path.join(BOOK_DIR, category);
    fs.mkdirSync(destDir, { recursive: true });

    // 展开目录选择 → 平铺为文件清单（越界的原样保留，让下面按文件报错）
    const expanded: string[] = [];
    for (const raw of paths) {
        try {
            const abs = path.resolve(raw);
            if (isPathUnder(abs, SOURCE_ROOT) && fs.statSync(abs).isDirectory()) {
                const before = expanded.length;
                collectBooks(abs, expanded, 0);
                if (expanded.length === before) {
                    expanded.push(abs); // 空目录：保留原路径，让结果里报"目录内没有电子书"
                }
                continue;
            }
        } catch { /* 非目录/不存在 → 按文件处理 */ }
        expanded.push(raw);
        if (expanded.length >= MAX_FILES) break;
    }

    const results = expanded.slice(0, MAX_FILES).map((raw) => {
        const name = path.basename(raw);
        try {
            const abs = path.resolve(raw);
            if (!isPathUnder(abs, SOURCE_ROOT)) return { name, ok: false, message: "路径越界" };
            if (!ALLOWED_EXTS.has(path.extname(abs).toLowerCase())) {
                const st0 = fs.statSync(abs);
                return { name, ok: false, message: st0.isDirectory() ? "目录内没有电子书文件" : "不支持的格式" };
            }
            const st = fs.statSync(abs);
            if (!st.isFile()) return { name, ok: false, message: "不是文件" };
            if (isPathUnder(abs, destDir)) return { name, ok: false, message: "已在该分类中，跳过" };
            const dest = uniqueDest(destDir, name);
            if (move) {
                fs.renameSync(abs, dest);
            } else {
                fs.copyFileSync(abs, dest);
            }
            return { name, ok: true, message: `${move ? "已移入" : "已复制到"}「${category}」/${path.basename(dest)}` };
        } catch (err) {
            return { name, ok: false, message: String(err) };
        }
    });

    return NextResponse.json({ success: true, results });
}
