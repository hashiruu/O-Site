// 连接 dev-browser Playwright 服务，伪装 timstreams Referer，从 vileembeds embed 抓出真实 m3u8 URL。
// 用法: node scripts/capture-stream.mjs [fox4k-usa|fox-usa|beinsportsmax-sa|...]
import { chromium } from "playwright-core";

const EMBED = process.argv[2] || "fox4k-usa";
const CDP = process.env.CDP_URL || "http://127.0.0.1:9223";

async function main() {
    const browser = await chromium.connectOverCDP(CDP);
    const context = browser.contexts()[0];
    const page = await context.newPage();

    let m3u8Url = "";

    page.on("response", (res) => {
        const u = res.url();
        if (/\.m3u8($|\?)/.test(u) && res.status() === 200 && !m3u8Url) {
            m3u8Url = u;
        }
    });

    await page.route("**/*", async (route) => {
        const headers = route.request().headers();
        headers["Referer"] = "https://timstreams.st/watch/turkey-vs-usa";
        headers["Origin"] = "https://timstreams.st";
        await route.continue({ headers });
    });

    try {
        await page.goto(`https://vileembeds.pages.dev/embed/${EMBED}`, {
            waitUntil: "load", timeout: 15000,
        });
        // 等 JW Player 解码出 stream URL
        for (let i = 0; i < 12 && !m3u8Url; i++) {
            await new Promise((r) => setTimeout(r, 1000));
        }
    } finally {
        await page.close();
    }

    if (!m3u8Url) {
        console.error("NO_M3U8");
        process.exit(1);
    }
    console.log(m3u8Url);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
