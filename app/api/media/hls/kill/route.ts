import { NextRequest, NextResponse } from "next/server";
import { killSession, killAllSessions } from "@/lib/hls-manager";

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { sessionId, killAll } = body;

        if (killAll) {
            const count = killAllSessions("kill-all requested");
            return NextResponse.json({ success: true, killed: count });
        }

        if (sessionId) {
            const killed = killSession(sessionId, "client requested");
            return NextResponse.json({ success: true, killed: killed ? 1 : 0 });
        }

        return NextResponse.json({ success: true, killed: 0 });
    } catch {
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
