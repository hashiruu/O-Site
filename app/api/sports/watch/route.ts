// GET /api/sports/watch?name=队名 → 查 vixnuvew 匹配 event 拿 embed slug → 抓 m3u8。
// 抓流依赖 dev-browser CDP chrome（端口 9223）；chrome 未起则返回 watchUrl 让前端回退。
import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import path from "path";

export const dynamic = "force-dynamic";

function pickEmbed(streams: { name: string; url: string }[]): { embedId: string; raw: string } | null {
    const fourK = streams.find((s) => /4k/i.test(s.name));
    const fox = streams.find((s) => /fox/i.test(s.name));
    const picked = fourK || fox || streams[0];
    if (!picked) return null;
    const m = picked.url.match(/embed\/([a-zA-Z0-9_-]+)/);
    return m ? { embedId: m[1], raw: picked.url } : null;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
    // 内容范围守卫：sports 栏目需 boss 授权（admin/boss 全开）
    {
        const { getAccess, allows } = await import("@/lib/roles");
        if (!allows(await getAccess(req), "sports")) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }
    }
    const name = (req.nextUrl.searchParams.get("name") || "").trim();
    if (!name) return NextResponse.json({ success: false, error: "missing name" }, { status: 400 });

    // 1. 查 vixnuvew 匹配 event
    let slug = "";
    let watchUrl = "";
    let embedId = "";
    try {
        const apiRes = await fetch("https://api.vixnuvew.uk/api/streams", { headers: { "User-Agent": "Mozilla/5.0" } });
        const data = (await apiRes.json()) as any[];
        const target = name.toLowerCase();
        let best: any = null;
        let bestScore = Infinity;
        for (const cat of data) {
            for (const ev of cat.events || []) {
                const evName = String(ev.name || "").toLowerCase();
                const hit = evName.includes(target) || target.includes(evName.split(/\s+/)[0] || "");
                if (hit) {
                    const score = Math.abs(evName.length - target.length);
                    if (score < bestScore) { bestScore = score; best = ev; }
                }
            }
        }
        if (best) {
            slug = best.url;
            watchUrl = `https://timstreams.st/watch/${slug}`;
            const picked = pickEmbed(best.streams || []);
            if (picked) embedId = picked.embedId;
        }
    } catch { /* keep empty */ }

    if (!embedId) {
        return NextResponse.json({ success: false, error: "no match", watchUrl, name });
    }

    // 2. 抓 m3u8（连 CDP chrome）；失败 → 返回 watchUrl 回退
    const scriptPath = path.join(process.cwd(), "scripts", "capture-stream.ts");
    try {
        const m3u8 = await new Promise<string>((resolve, reject) => {
            const child = spawn("npx", ["tsx", scriptPath, embedId], {
                timeout: 35000,
                env: { ...process.env, CDP_URL: "http://127.0.0.1:9223" },
                cwd: process.cwd(),
            });
            let out = "";
            let err = "";
            child.stdout.on("data", (d: Buffer) => { out += d.toString(); });
            child.stderr.on("data", (d: Buffer) => { err += d.toString(); });
            child.on("close", (code) => {
                const u = out.trim();
                if (code === 0 && u) resolve(u);
                else reject(new Error(err || out || "抓流失败（chrome 未起或流离线）"));
            });
            child.on("error", (e) => reject(e));
        });
        return NextResponse.json({ success: true, url: m3u8, watchUrl, embed: embedId, name });
    } catch (e) {
        return NextResponse.json({ success: false, error: (e as Error).message, watchUrl, embed: embedId, name });
    }
}
