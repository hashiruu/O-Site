// GET /api/admin/ai-usage — 全站 AI 用量与账单（按组件汇总 + 合计）。仅站长/管理员可见。
import { NextRequest, NextResponse } from "next/server";
import { getAccess, canAdminSite } from "@/lib/roles";
import { getUsageSummary } from "@/lib/ai-usage";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
    if (!canAdminSite((await getAccess(req)).role)) {
        return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
    }
    try {
        return NextResponse.json({ success: true, ...getUsageSummary() });
    } catch (e) {
        return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
    }
}
