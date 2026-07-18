// GET /api/stream-list → 拉取 vixnuvew 当前所有直播（即 timstreams.st/watch/<slug> 下可看的全部子页面），
// 精简映射后返回，60s 模块缓存（避免每次展开面板都打上游）。给 /live 的 ChannelPanel 用。
// 上游结构：[{ category, events: [{ url(slug), name, logo, time, featured, vip, streams: [{ name, url, vip }] }] }]
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const VIXNUVEW_URL = "https://api.vixnuvew.uk/api/streams";
const CACHE_MS = 60_000;
const FETCH_TIMEOUT_MS = 8000;

interface ChannelEvent {
    slug: string;
    name: string;
    logo: string;
    time: string;
    featured: boolean;
    streamNames: string[];
    has4K: boolean;
    vip: boolean;
}
interface ChannelCategory {
    name: string;
    events: ChannelEvent[];
}
interface StreamListData {
    categories: ChannelCategory[];
    fetchedAt: number;
}

let cache: { at: number; data: StreamListData } | null = null;

export async function GET(): Promise<NextResponse> {
    // 内容范围守卫：live 栏目需 boss 授权（admin/boss 全开）
    {
        const { getAccess, allows } = await import("@/lib/roles");
        if (!allows(await getAccess(), "live")) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }
    }
    if (cache && Date.now() - cache.at < CACHE_MS) {
        return NextResponse.json({ success: true, data: cache.data });
    }
    try {
        const res = await fetch(VIXNUVEW_URL, {
            headers: { "User-Agent": "Mozilla/5.0" },
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
        if (!res.ok) throw new Error(`vixnuvew ${res.status}`);
        const raw = (await res.json()) as any[];

        const categories: ChannelCategory[] = (Array.isArray(raw) ? raw : []).map((cat) => ({
            name: String(cat?.category ?? "其他"),
            events: (Array.isArray(cat?.events) ? cat.events : []).map((ev: any): ChannelEvent => {
                const streams: any[] = Array.isArray(ev?.streams) ? ev.streams : [];
                return {
                    slug: String(ev?.url ?? ""),
                    name: String(ev?.name ?? "未命名"),
                    logo: String(ev?.logo ?? ""),
                    time: String(ev?.time ?? ""),
                    featured: !!ev?.featured,
                    streamNames: streams
                        .map((s) => String(s?.name ?? "").trim())
                        .filter(Boolean),
                    has4K: streams.some((s) => /4k/i.test(String(s?.name ?? ""))),
                    vip: !!ev?.vip || streams.some((s) => s?.vip),
                };
            }),
        }));

        const data: StreamListData = { categories, fetchedAt: Date.now() };
        cache = { at: Date.now(), data };
        return NextResponse.json({ success: true, data });
    } catch (e) {
        return NextResponse.json(
            { success: false, error: (e as Error).message },
            { status: 502 }
        );
    }
}
