import { NextRequest, NextResponse } from "next/server";
import { resolveUserKeyOrNull } from "@/lib/identity";

export const dynamic = "force-dynamic";

// ── B站评论区代理（详情页「B站讨论区」用） ──
// GET /api/bili/comments?bvid=BVxxx&pn=1&sort=hot|time
// 链路：bvid → view API 拿 aid（评论 oid 吃 aid 不吃 bvid）→ x/v2/reply(type=1) 拿评论。
// 热评匿名可拉（UA/Referer/buvid cookie，与 /api/bili/search 同款姿势）；
// 5 分钟内存缓存，别频繁打扰 B站。头像统一走自家图片代理。
// 评论区是纯增强层：任何一步失败都返回 data:null，前端静默收起，绝不影响详情页本体。

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

const cache = new Map<string, { at: number; payload: unknown }>();
const CACHE_TTL = 300_000;

async function biliJson(url: string, cookie: string) {
    const res = await fetch(url, {
        headers: { "User-Agent": UA, Referer: "https://www.bilibili.com/", Cookie: cookie },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return res.json().catch(() => null);
}

export async function GET(req: NextRequest) {
    if (!(await resolveUserKeyOrNull(req))) return NextResponse.json({ success: false, error: "LOGIN_REQUIRED" }, { status: 401 });
    const bvid = (req.nextUrl.searchParams.get("bvid") || "").trim();
    const pn = Math.max(1, parseInt(req.nextUrl.searchParams.get("pn") || "1"));
    const sort = req.nextUrl.searchParams.get("sort") === "time" ? 0 : 2; // 2=热度 0=时间
    if (!/^BV[0-9A-Za-z]+$/.test(bvid)) return NextResponse.json({ success: false, error: "bad bvid" }, { status: 400 });

    const cacheKey = `${bvid}:${pn}:${sort}`;
    const hit = cache.get(cacheKey);
    if (hit && Date.now() - hit.at < CACHE_TTL) return NextResponse.json(hit.payload);

    try {
        const cookie = await biliCookie();
        const view = await biliJson(`https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`, cookie);
        const v = view?.data;
        if (!v?.aid) return NextResponse.json({ success: true, data: null }); // 视频没了/被 ban

        const j = await biliJson(
            `https://api.bilibili.com/x/v2/reply?type=1&oid=${v.aid}&sort=${sort}&ps=20&pn=${pn}`,
            cookie
        );
        const d = j?.data;
        if (j?.code !== 0 || !d) return NextResponse.json({ success: true, data: null });

        interface RawReply {
            rpid_str?: string; rpid?: number; like?: number; ctime?: number; rcount?: number;
            member?: { uname?: string; avatar?: string; level_info?: { current_level?: number } };
            content?: { message?: string };
            replies?: RawReply[] | null;
        }
        const mapReply = (r: RawReply) => ({
            rpid: r?.rpid_str || String(r?.rpid ?? ""),
            user: r?.member?.uname || "匿名",
            avatar: r?.member?.avatar ? proxy(r.member.avatar) : null,
            level: r?.member?.level_info?.current_level ?? 0,
            message: r?.content?.message || "",
            like: r?.like ?? 0,
            ctime: r?.ctime ?? 0,
            rcount: r?.rcount ?? 0,
            replies: Array.isArray(r?.replies)
                ? r.replies.slice(0, 3).map((s) => ({
                    user: s?.member?.uname || "匿名",
                    message: s?.content?.message || "",
                    like: s?.like ?? 0,
                }))
                : [],
        });

        const payload = {
            success: true,
            data: {
                video: {
                    bvid,
                    aid: v.aid as number,
                    title: (v.title as string) || "",
                    up: (v.owner?.name as string) || "",
                    replyTotal: (v.stat?.reply as number) ?? (d.page?.count as number) ?? 0,
                },
                page: { pn, count: (d.page?.count as number) ?? 0, size: (d.page?.size as number) ?? 20 },
                comments: ((d.replies || []) as RawReply[]).map(mapReply),
            },
        };
        cache.set(cacheKey, { at: Date.now(), payload });
        return NextResponse.json(payload);
    } catch {
        return NextResponse.json({ success: true, data: null }); // 静默降级
    }
}
