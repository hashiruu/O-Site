// 被 nas-app 调用：launch headless chromium → goto timstreams watch → 把播放器 iframe 切到目标 embed（默认 4K）→ 抓该 embed 的 m3u8。
// 必须从 timstreams 进入（vileembeds 只在被 timstreams 嵌入时初始化播放器）；timstreams 默认嵌 fox-usa，需手动切 iframe 到目标频道。
// 按需起停：每次临时 launch，抓完 close。
import { chromium } from "playwright-core";
import path from "path";
import os from "os";
import fs from "fs";

function findChromium(): string | undefined {
    const base = path.join(os.homedir(), ".cache", "ms-playwright");
    try {
        const dirs = fs.readdirSync(base).filter((d) => d.startsWith("chromium-")).sort().reverse();
        for (const d of dirs) for (const sub of ["chrome-linux64/chrome", "chrome-linux/chrome"]) {
            const p = path.join(base, d, sub); if (fs.existsSync(p)) return p;
        }
    } catch { /* noop */ }
    return undefined;
}

const SLUG = process.argv[2] || "norway-vs-france";
const EMBED = process.argv[3] || "fox4k-usa"; // 目标频道 embed（默认 4K）

async function main() {
    const exec = findChromium();
    const b = await chromium.launch({
        headless: true,
        ...(exec ? { executablePath: exec } : {}),
        args: ["--no-sandbox", "--disable-gpu", "--mute-audio", "--autoplay-policy=no-user-gesture-required"],
    });
    const ctx = await b.newContext();
    const p = await ctx.newPage();
    let m3u8 = "";
    // 抓目标 embed 的主 m3u8（如 fox4k-usa.m3u8），排除 us-list/us-sgm 变体 playlist
    const re = new RegExp(`/${EMBED}\\.m3u8`);
    p.on("response", (res) => {
        const u = res.url();
        if (re.test(u) && res.status() === 200 && !m3u8 && !/\/(us-list|us-sgm)\//.test(u)) m3u8 = u;
    });

    await p.goto(`https://timstreams.st/watch/${SLUG}`, { waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => {});
    // 等初始 iframe（默认 fox-usa）就绪，再切到目标 embed
    await new Promise((r) => setTimeout(r, 5000));
    await p.evaluate((emb: string) => {
        const f = document.querySelector("iframe") as HTMLIFrameElement;
        if (f && !f.src.includes(`/embed/${emb}`)) f.src = `https://vileembeds.pages.dev/embed/${emb}`;
    }, EMBED);
    // 等目标 m3u8
    for (let i = 0; i < 14 && !m3u8; i++) await new Promise((r) => setTimeout(r, 1000));
    await b.close();
    if (!m3u8) { console.error("NO_M3U8"); process.exit(1); }
    console.log(m3u8);
}
main().catch((e) => { console.error(e.message); process.exit(1); });
