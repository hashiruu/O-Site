import { NextRequest } from "next/server";
import { handlers } from "@/auth";

// Next 15 在 next start 下 request.url 是监听地址（localhost:3024），
// Auth.js 据此拼回调 → 两个入口全被送去 localhost。
// 修法：按请求真实来源（x-forwarded-host > host）重写 Request URL——
// mcvale.net 进来的回 mcvale.net，tailscale 进来的回 ts.net，各回各家。
function rewriteOrigin(req: NextRequest): NextRequest {
    const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
    if (!host || host.startsWith("localhost") || host.startsWith("127.")) return req;
    const proto = req.headers.get("x-forwarded-proto") || "https";
    const url = new URL(req.url);
    url.protocol = `${proto}:`;
    url.host = host;
    if (!host.includes(":")) url.port = ""; // URL 陷阱：host 不带端口时旧端口(3024)会残留
    // NextRequest 构造签名对 signal null 挑剔——req 本身满足 duplex/body 语义，硬断言即可
    return new NextRequest(url, req as unknown as ConstructorParameters<typeof NextRequest>[1]);
}

export const GET = (req: NextRequest) => handlers.GET(rewriteOrigin(req));
export const POST = (req: NextRequest) => handlers.POST(rewriteOrigin(req));
