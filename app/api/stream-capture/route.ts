// GET /api/stream-capture?url=<timstreams watch url 或 slug> → 解析 4K embed → 直接构造 inproviszon.st m3u8 → 返回 stream-proxy 代理 URL。
// 默认 4K 优先（4K → FOX → 第一路）；vileembeds 2026-07 换 Clappr 后 m3u8 为明文 {cdn}/{embedId}.m3u8，无需 CDP 抓流。
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
    let slug = "fox4k-usa";
    const tsMatch = rawUrl.match(/timstreams\.st\/watch\/([a-zA-Z0-9_-]+)/);
    if (tsMatch) slug = tsMatch[1];
    else if (rawUrl) slug = rawUrl;

    // 解析 embed id，4K 优先（与 stream-refresh 一致）
    let embedId = "fox4k-usa";
    if (tsMatch) {
        try {
            const apiRes = await fetch("https://api.vixnuvew.uk/api/streams", { headers: { "User-Agent": "Mozilla/5.0" } });
            const data = await apiRes.json() as any[];
            outer: for (const cat of data) {
                for (const ev of cat.events || []) {
                    if (ev.url === slug) {
                        const streams: { name: string; url: string }[] = ev.streams || [];
                        const fourK = streams.find((s) => s.name.toLowerCase().includes("4k"));
                        const fox = streams.find((s) => s.name.toUpperCase().includes("FOX"));
                        const picked = fourK || fox || streams[0];
                        if (picked) { const m = picked.url.match(/embed\/([a-zA-Z0-9_-]+)/); if (m) embedId = m[1]; }
                        break outer;
                    }
                }
            }
        } catch { /* keep default */ }
    }

    // vileembeds 改用 Clappr + 明文 CDN（2026-07）：m3u8 直接构造，无需 CDP 抓流。
    // CDN 在 Cloudflare 后仅放行 Referer=vileembeds.pages.dev，stream-proxy 已统一带该 Referer。
    const m3u8 = `https://inproviszon.st/${embedId}.m3u8`;
    const proxy = `/api/stream-proxy?url=${encodeURIComponent(m3u8)}`;
    return NextResponse.json({ success: true, url: proxy, embed: embedId, raw: m3u8 });
}
