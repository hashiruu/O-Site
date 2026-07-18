import { NextRequest, NextResponse } from "next/server";
import { touchSession, ensureReaper } from "@/lib/hls-manager";

export async function POST(req: NextRequest) {
    try {
        ensureReaper();
        const { sessionId } = await req.json();
        if (!sessionId) {
            return NextResponse.json({ error: "Missing sessionId" }, { status: 400 });
        }
        touchSession(sessionId);
        return NextResponse.json({ ok: true });
    } catch {
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
