// 代理 vileembeds embed 页面：服务端带 Referer header 抓取，绕过防盗链审查。
// 客户端 iframe 加载同源地址，无跨域限制。
import { NextRequest, NextResponse } from "next/server";

const EMBED_BASE = "https://vileembeds.pages.dev/embed";
const REFERER = "https://timstreams.st/";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
    // 内容范围守卫：sports 栏目需 boss 授权（admin/boss 全开）
    {
        const { getAccess, allows } = await import("@/lib/roles");
        if (!allows(await getAccess(_req), "sports")) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }
    }
    const { slug } = await params;
    const slugSafe = (slug || "").replace(/[^a-zA-Z0-9_-]/g, "");
    if (!slugSafe) return NextResponse.json({ error: "invalid slug" }, { status: 400 });

    const target = `${EMBED_BASE}/${slugSafe}`;
    let res: Response;
    try {
        res = await fetch(target, {
            headers: { Referer: REFERER, "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36" },
        });
    } catch {
        return NextResponse.json({ error: "upstream unreachable" }, { status: 502 });
    }
    if (!res.ok) return NextResponse.json({ error: `upstream ${res.status}` }, { status: 502 });

    let html = await res.text();
    // 去掉反调试脚本（相对路径 /disable-devtool.js → 404，且 disable-devtool-auto 属性触发页面清空）
    html = html.replace(/<script[^>]*disable-devtool[^>]*>[^<]*<\/script>/gi, "");
    return new NextResponse(html, {
        headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "public, max-age=60, s-maxage=300",
        },
    });
}
