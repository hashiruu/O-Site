import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

// /api/books/import：后台书籍导入。
// POST multipart formData：files[]（多文件）+ category（5 个基础分类之一）。
// 校验：分类白名单、扩展名白名单、文件名 sanitize（去路径分隔符/隐藏前缀）、单文件 ≤300MB。
// 落盘 BOOK_DIR/<分类>/，同名加 " (2)" 后缀不覆盖。
export const dynamic = "force-dynamic";

import { BOOK_DIR } from "@/lib/paths";
const CATEGORIES = new Set(["推理悬疑", "科幻", "文学名著", "科研学术", "技术文档", "其他"]);
const ALLOWED_EXTS = new Set([".epub", ".pdf", ".md", ".mobi"]);
const MAX_FILE_SIZE = 300 * 1024 * 1024; // 300MB

interface ImportResult {
    name: string;
    ok: boolean;
    message: string; // 成功时为落盘文件名，失败时为原因
}

// 文件名 sanitize：只取 basename、去路径分隔符和控制字符、去隐藏文件前缀
function sanitizeFileName(name: string): string {
    let n = name.replace(/[/\\]/g, "_");                       // 路径分隔符
    n = path.basename(n);
    // eslint-disable-next-line no-control-regex
    n = n.replace(/[\x00-\x1f]/g, "").trim();                  // 控制字符
    n = n.replace(/^\.+/, "");                                  // 隐藏文件/穿越前缀 ".."
    return n;
}

// 同名不覆盖：foo.pdf → foo (2).pdf → foo (3).pdf ...
function uniquePath(dir: string, fileName: string): string {
    const ext = path.extname(fileName);
    const stem = fileName.slice(0, fileName.length - ext.length);
    let candidate = path.join(dir, fileName);
    let i = 2;
    while (fs.existsSync(candidate)) {
        candidate = path.join(dir, `${stem} (${i})${ext}`);
        i++;
    }
    return candidate;
}

export async function POST(request: NextRequest) {
    // 后台功能守卫：仅 admin/boss
    {
        const { getAccess, canAdminSite } = await import("@/lib/roles");
        if (!canAdminSite((await getAccess(request)).role)) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }
    }
    let form: FormData;
    try {
        form = await request.formData();
    } catch {
        return NextResponse.json({ error: "无效的 multipart 请求" }, { status: 400 });
    }

    const category = String(form.get("category") || "");
    if (!CATEGORIES.has(category)) {
        return NextResponse.json({ error: "分类不在白名单内" }, { status: 400 });
    }

    const files = form.getAll("files").filter((f): f is File => f instanceof File);
    if (files.length === 0) {
        return NextResponse.json({ error: "未收到任何文件" }, { status: 400 });
    }

    const targetDir = path.join(BOOK_DIR, category);
    try {
        fs.mkdirSync(targetDir, { recursive: true });
    } catch {
        return NextResponse.json({ error: "无法创建分类目录" }, { status: 500 });
    }

    const results: ImportResult[] = [];
    for (const file of files) {
        const rawName = file.name || "";
        const name = sanitizeFileName(rawName);
        if (!name) {
            results.push({ name: rawName || "(未命名)", ok: false, message: "文件名无效" });
            continue;
        }
        const ext = path.extname(name).toLowerCase();
        if (!ALLOWED_EXTS.has(ext)) {
            results.push({ name, ok: false, message: `不支持的格式 ${ext || "(无扩展名)"}，仅限 epub/pdf/md/mobi` });
            continue;
        }
        if (file.size > MAX_FILE_SIZE) {
            results.push({ name, ok: false, message: "超过单文件 300MB 上限" });
            continue;
        }
        if (file.size === 0) {
            results.push({ name, ok: false, message: "空文件" });
            continue;
        }
        try {
            const dest = uniquePath(targetDir, name);
            const buf = Buffer.from(await file.arrayBuffer());
            fs.writeFileSync(dest, buf);
            results.push({ name, ok: true, message: path.basename(dest) });
        } catch (error) {
            console.error("书籍导入写盘失败:", name, error);
            results.push({ name, ok: false, message: "写入磁盘失败" });
        }
    }

    return NextResponse.json({
        success: results.some((r) => r.ok),
        category,
        results,
    });
}
