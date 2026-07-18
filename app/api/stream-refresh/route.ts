// GET /api/stream-refresh?url=... → 把 timstreams watch 链接解析成 vileembeds embed id。
// 注意：vileembeds 的底层 m3u8 被混淆变量 + token 运行时解出，离开其播放器环境即失效，
// 无法抓流自播（已多次验证 NO_M3U8）。所以这里只做"链接 → embed id"解析，
// 实际播放交给 iframe 嵌 /api/embed-proxy/<embed>（vileembeds 自己的 JW Player 播）。
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
    // 内容范围守卫：live 栏目需 boss 授权（admin/boss 全开）
    {
        const { getAccess, allows } = await import("@/lib/roles");
        if (!allows(await getAccess(req), "live")) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }
    }
    const rawUrl = req.nextUrl.searchParams.get("url") || "";
    let embedId = "fox4k-usa"; // 默认 FOX 4K

    const tsMatch = rawUrl.match(/timstreams\.st\/watch\/([a-zA-Z0-9_-]+)/);
    if (tsMatch) {
        const slug = tsMatch[1];
        try {
            const apiRes = await fetch("https://api.vixnuvew.uk/api/streams", {
                headers: { "User-Agent": "Mozilla/5.0" },
            });
            const data = await apiRes.json() as any[];
            let found: string | null = null;
            for (const cat of data) {
                for (const ev of cat.events || []) {
                    if (ev.url === slug) {
                        const streams: { name: string; url: string }[] = ev.streams || [];
                        const fourK = streams.find((s) => s.name.toLowerCase().includes("4k"));
                        const fox = streams.find((s) => s.name.toUpperCase().includes("FOX"));
                        const picked = fourK || fox || streams[0];
                        if (picked) {
                            const m = picked.url.match(/embed\/([a-zA-Z0-9_-]+)/);
                            if (m) found = m[1];
                        }
                    }
                }
                if (found) break;
            }
            if (found) embedId = found;
        } catch { /* keep default */ }
    } else {
        const m = rawUrl.match(/(?:embed\/|^)([a-zA-Z0-9_-]+)$/);
        if (m) embedId = m[1];
    }

    return NextResponse.json({ success: true, embed: embedId });
}
