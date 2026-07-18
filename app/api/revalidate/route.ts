import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";

export async function POST() {
    // 后台功能守卫：仅 admin/boss
    {
        const { getAccess, canAdminSite } = await import("@/lib/roles");
        if (!canAdminSite((await getAccess()).role)) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }
    }
    try {
        revalidatePath("/");
        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("Revalidate failed:", error);
        return NextResponse.json({ success: false, error: "Failed" }, { status: 500 });
    }
}
