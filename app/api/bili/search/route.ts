import { NextRequest, NextResponse } from "next/server";
import { resolveUserKeyOrNull } from "@/lib/identity";

export const dynamic = "force-dynamic";

// ── B站搜索代理（站内嵌入浏览层用） ──
// GET /api/bili/search?q=关键词
// B站公开搜索 API 需要 buvid3 cookie（无则 412）——服务端先访问一次主站领 cookie 并缓存。
// 返回精简候选：bvid/标题/封面(走图片代理)/UP主/时长/播放数。登录用户可用。

const FETCH_TIMEOUT_MS = 12000;
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

let cookieCache: { value: string; at: number } | null = null;

async function biliCookie(): Promise<string> {
    if (cookieCache && Date.now() - cookieCache.at < 3600_000) return cookieCache.value;
    const res = await fetch("https://www.bilibili.com/", {
        headers: { "User-Agent": UA },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        redirect: "manual",
    });
    const cookies = (res.headers.getSetCookie?.() || [])
        .map((c) => c.split(";")[0])
        .filter((c) => /^(buvid3|buvid4|b_nut)=/.test(c))
        .join("; ");
    cookieCache = { value: cookies, at: Date.now() };
    return cookies;
}

const proxy = (u: string) => `/api/discover/img?u=${encodeURIComponent(u.startsWith("//") ? `https:${u}` : u)}`;

export async function GET(req: NextRequest) {
    if (!(await resolveUserKeyOrNull(req))) return NextResponse.json({ success: false, error: "LOGIN_REQUIRED" }, { status: 401 });
    const q = (req.nextUrl.searchParams.get("q") || "").trim();
    if (!q) return NextResponse.json({ success: true, data: [] });

    try {
        const cookie = await biliCookie();
        const res = await fetch(
            `https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword=${encodeURIComponent(q)}&page=1`,
            {
                headers: { "User-Agent": UA, Referer: "https://www.bilibili.com/", Cookie: cookie },
                signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
            }
        );
        if (!res.ok) return NextResponse.json({ success: true, data: [] });
        const j = await res.json();
        const rows = (j?.data?.result || []) as {
            bvid?: string; title?: string; pic?: string; author?: string;
            duration?: string; play?: number; description?: string;
        }[];
        const data = rows
            .filter((r) => r.bvid && r.title)
            .slice(0, 24)
            .map((r) => ({
                bvid: r.bvid!,
                // 标题里的 <em class="keyword"> 高亮标签去掉
                title: (r.title || "").replace(/<[^>]+>/g, ""),
                cover: r.pic ? proxy(r.pic) : null,
                author: r.author || "",
                duration: r.duration || "",
                play: r.play ?? null,
                desc: (r.description || "").slice(0, 80),
            }));
        return NextResponse.json({ success: true, data });
    } catch {
        return NextResponse.json({ success: true, data: [] });
    }
}
