// /api/books/text?path=<绝对路径> → { success, text }
// 抽出书籍全文（epub/pdf），给 PDF 阅读器做问答助手/温度的 readText 底料。服务端一次抽好，前端缓存复用。
import { NextRequest, NextResponse } from "next/server";
import path from "path";
import { isPathUnder } from "@/lib/path-guard";
import { resolveUserKeyOrNull } from "@/lib/identity";
import { extractBookText, isReadableBook } from "@/lib/book-text";

export const dynamic = "force-dynamic";
import { BOOK_ALLOWED_ROOTS as ALLOWED_ROOTS } from "@/lib/paths";

export async function GET(req: NextRequest) {
    if (!(await resolveUserKeyOrNull(req))) {
        return NextResponse.json({ success: false, error: "LOGIN_REQUIRED" }, { status: 401 });
    }
    const raw = req.nextUrl.searchParams.get("path");
    if (!raw) return NextResponse.json({ success: false, error: "缺少 path" }, { status: 400 });
    const resolved = path.resolve(raw);
    if (!ALLOWED_ROOTS.some((r) => isPathUnder(resolved, r))) {
        return NextResponse.json({ success: false, error: "无权访问" }, { status: 403 });
    }
    if (!isReadableBook(resolved)) return NextResponse.json({ success: true, text: "" });
    try {
        const text = await extractBookText(resolved);
        return NextResponse.json({ success: true, text });
    } catch (e) {
        return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
    }
}
