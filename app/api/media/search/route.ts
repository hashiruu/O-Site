import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getAccess, typeFilterSql } from "@/lib/roles";

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
    try {
        // 未登录搜索是摆设（与 /api/search 同一铁律）
        const { resolveUserKeyOrNull } = await import("@/lib/identity");
        if (!(await resolveUserKeyOrNull(req))) {
            return NextResponse.json({ success: false, error: "LOGIN_REQUIRED" }, { status: 401 });
        }
        const url = new URL(req.url);
        const q = url.searchParams.get("q") || "";

        const db = getDb();
        // 内容范围过滤：与 /api/search 一致（默认用户=全空）
        const typeFilter = typeFilterSql(await getAccess(req));

        let items: { id: number; title: string; type: string; path: string; created_at: string }[] = [];
        if (q.trim() !== "") {
            // 旅行相册不进搜索（与 /api/search 同一规则，对 boss 也一样）
            items = db.prepare(`SELECT id, title, type, path, created_at FROM media WHERE title LIKE ? AND type != 'travel' AND ${typeFilter} ORDER BY created_at DESC LIMIT 50`).all(`%${q}%`) as typeof items;
        }

        return NextResponse.json({ success: true, data: items });
    } catch (err) {
        console.error("Search API Error:", err);
        return NextResponse.json({ success: false, error: String(err) });
    }
}
