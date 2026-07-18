import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { v4 as uuidv4 } from "uuid";

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    try {
        const db = getDb();
        const url = new URL(request.url);
        const id = url.searchParams.get("id");

        if (!id) {
            return NextResponse.json({ code: 1, data: [] });
        }

        const danmakus = db.prepare("SELECT * FROM danmaku WHERE media_id = ? ORDER BY time ASC").all(id) as any[];

        // DPlayer 期望的返回格式:
        // [ [time, type, color, author, text] ]
        const formatted = danmakus.map(d => [
            d.time,
            d.type,
            parseInt(d.color.replace('#', ''), 16) || 16777215,
            d.author || "DPlayer",
            d.text
        ]);

        return NextResponse.json({ code: 0, data: formatted });
    } catch (e) {
        console.error("Failed to get danmaku:", e);
        return NextResponse.json({ code: 1, data: [] });
    }
}

export async function POST(request: NextRequest) {
    try {
        const db = getDb();
        const body = await request.json();
        const { id, author, time, text, color, type } = body;

        if (!id || !text) {
            return NextResponse.json({ code: 1, msg: "Bad request" }, { status: 400 });
        }

        const hexColor = `#${(color || 16777215).toString(16).padStart(6, '0')}`;

        db.prepare(
            `INSERT INTO danmaku (id, media_id, time, text, color, type, author, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
            uuidv4(),
            id,
            time || 0,
            text,
            hexColor,
            type || 0,
            author || "Guest",
            new Date().toISOString()
        );

        return NextResponse.json({ code: 0, data: { ...body } });
    } catch (e) {
        console.error("Failed to post danmaku:", e);
        return NextResponse.json({ code: 1, msg: "Failed" }, { status: 500 });
    }
}
