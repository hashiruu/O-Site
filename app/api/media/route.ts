import { NextResponse } from "next/server";
import { getMediaStats } from "@/lib/db";

export async function GET() {
    try {
        const stats = getMediaStats();
        return NextResponse.json({ success: true, data: stats });
    } catch (error) {
        console.error("获取媒体统计失败:", error);
        return NextResponse.json(
            { success: false, error: "获取统计数据失败" },
            { status: 500 }
        );
    }
}
