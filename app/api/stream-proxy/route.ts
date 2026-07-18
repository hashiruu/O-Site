// GET /api/stream-proxy?url=<m3u8 或分片> → 代理直播流，解决 hls.js 跨域。
// m3u8 改写内部 URI（variant playlist / 分片 / key）为本代理 URL；分片字节透传。
// vileembeds 2026-07 换 Clappr + CDN inproviszon.st（Cloudflare 后，仅放行 Referer=vileembeds）。
// 切片 CDN 频繁轮换（kapwing → tiktokcdn 伪装图片 URL → ...），域名白名单追不住：
// 防 SSRF 改用两级放行 —— 入口 m3u8 仍须白名单主机；由合法 m3u8 改写出的内部 URI
// 一律附 HMAC 签名（sig），验签通过即放行任意主机（URL 只能源自合法 m3u8，不可伪造）。
import { NextRequest, NextResponse } from "next/server";
import { createHmac, randomBytes } from "crypto";

export const dynamic = "force-dynamic";

// 进程级密钥（重启失效无妨：hls.js 下一次 m3u8 刷新即拿到新签名）。挂 globalThis 防 dev 热重载换密钥。
const g = globalThis as unknown as { __streamProxyKey?: Buffer };
const KEY = (g.__streamProxyKey ??= randomBytes(32));
const sign = (u: string) => createHmac("sha256", KEY).update(u).digest("hex").slice(0, 32);

export async function GET(req: NextRequest): Promise<NextResponse> {
    // 内容范围守卫：live 栏目需 boss 授权（admin/boss 全开）
    {
        const { getAccess, allows } = await import("@/lib/roles");
        if (!allows(await getAccess(req), "live")) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }
    }
    const u = req.nextUrl.searchParams.get("url");
    const sig = req.nextUrl.searchParams.get("sig");
    if (!u) return new NextResponse("missing url", { status: 400 });
    let parsed: URL;
    try { parsed = new URL(u); } catch { return new NextResponse("bad url", { status: 400 }); }
    const h = parsed.hostname;
    const whitelisted = h.endsWith(".pages.dev") || h === "inproviszon.st";
    const signedOk = !!sig && sig === sign(u);
    if (!whitelisted && !signedOk) return new NextResponse("forbidden host", { status: 403 });

    let r: Response;
    try {
        r = await fetch(u, { headers: { "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36", "Referer": "https://vileembeds.pages.dev/" } });
    } catch {
        return new NextResponse("upstream fetch failed", { status: 502 });
    }
    if (!r.ok) return new NextResponse(`upstream ${r.status}`, { status: r.status });

    const ctype = r.headers.get("content-type") || "";
    const isM3u8 = u.includes(".m3u8") || ctype.includes("mpegurl");
    if (isM3u8) {
        const text = await r.text();
        const body = text.trimStart().startsWith("#EXTM3U") ? rewriteM3U8(text, u) : text;
        return new NextResponse(body, {
            headers: { "Content-Type": "application/vnd.apple.mpegurl", "Cache-Control": "no-store" },
        });
    }
    // 分片透传。切片 CDN 把 TS 伪装成图片（1×1 PNG 头 + 裸 TS），在此剥掉 PNG 前缀，
    // 播放端（hls.js）拿到纯 TS，无需自定义 loader。
    const buf = Buffer.from(await r.arrayBuffer());
    const body = stripPngPrefix(buf);
    return new NextResponse(new Uint8Array(body), {
        headers: { "Content-Type": body === buf && ctype ? ctype : "video/mp2t", "Cache-Control": "no-store" },
    });
}

// PNG 魔数开头 → 定位 IEND 块结束（IEND + 4 字节 CRC），其后即真实媒体流；结构不符则原样返回
function stripPngPrefix(buf: Buffer): Buffer {
    if (buf.length < 16 || buf.readUInt32BE(0) !== 0x89504e47) return buf;
    const iend = buf.indexOf("IEND");
    if (iend < 0 || iend + 8 >= buf.length) return buf;
    return buf.subarray(iend + 8);
}

// 改写 m3u8 内部 URI：URI= 属性（#EXT-X-KEY/#EXT-X-MEDIA/#EXT-X-STREAM-INF 等）+ 裸 URI 行 → 指向本代理（带签名）
function rewriteM3U8(text: string, baseUrl: string): string {
    const proxy = (uri: string) => {
        const abs = new URL(uri, baseUrl).href;
        return `/api/stream-proxy?url=${encodeURIComponent(abs)}&sig=${sign(abs)}`;
    };
    return text.split("\n").map((line) => {
        const t = line.trim();
        if (!t) return line;
        if (t.startsWith("#")) {
            if (t.includes("URI=\"")) {
                return line.replace(/URI="([^"]+)"/g, (_m, uri) => `URI="${proxy(uri)}"`);
            }
            return line;
        }
        return proxy(t);
    }).join("\n");
}
