// GET /api/reader/music/pick?tag=&temp=&exclude=id,id → { success, id, title, bucket, url }
// 按情绪桶+温度挑一首氛围曲（登录即可）。挑曲逻辑在 lib/ambient-music。
import { NextRequest, NextResponse } from "next/server";
import { resolveUserKeyOrNull } from "@/lib/identity";
import { pickTrack } from "@/lib/ambient-music";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
    if (!(await resolveUserKeyOrNull(req))) {
        return NextResponse.json({ success: false, error: "LOGIN_REQUIRED" }, { status: 401 });
    }
    const sp = req.nextUrl.searchParams;
    const tag = String(sp.get("tag") || "");
    const temp = Math.max(0, Math.min(100, Number(sp.get("temp")) || 50));
    const exclude = String(sp.get("exclude") || "").split(",").filter(Boolean);
    const picked = pickTrack(tag, temp, exclude);
    if (!picked) return NextResponse.json({ success: true, empty: true }); // 乐库为空 → 静默无乐，不报错
    return NextResponse.json({ success: true, ...picked, url: `/api/reader/music/stream?id=${picked.id}` });
}
