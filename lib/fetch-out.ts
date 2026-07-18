// ── Fetch out as we can：外站跳转平台表 ──
// 本站没有的资源，点击后跳合法第三方平台的站内搜索页：
// 中文平台优先（腾讯视频/爱奇艺/B站/优酷…），中文没有再给英文平台兜底。
// 全部走各平台官方搜索 URL——不做任何盗链，跳过去看到什么、要不要开会员由平台说了算。

export interface OutLink { name: string; url: string; en?: boolean }

const q = encodeURIComponent;

export function fetchOutLinks(title: string, kind: string): OutLink[] {
    const t = q(title);
    if (kind === "book" || kind === "书") {
        return [
            { name: "微信读书", url: `https://weread.qq.com/web/search/global?keyword=${t}` },
            { name: "豆瓣读书", url: `https://search.douban.com/book/subject_search?search_text=${t}` },
            { name: "Anna's Archive", url: `https://annas-archive.gd/search?q=${t}` },
            { name: "京东图书", url: `https://search.jd.com/Search?keyword=${t}` },
            { name: "Google Books", url: `https://www.google.com/search?tbm=bks&q=${t}`, en: true },
        ];
    }
    if (kind === "anime" || kind === "动漫") {
        return [
            { name: "哔哩哔哩（站内看 · 记进度）", url: `/embed?q=${t}` },
            { name: "腾讯视频", url: `https://v.qq.com/x/search/?q=${t}` },
            { name: "爱奇艺", url: `https://so.iqiyi.com/so/q_${t}` },
            { name: "Crunchyroll", url: `https://www.crunchyroll.com/search?q=${t}`, en: true },
        ];
    }
    if (kind === "musical" || kind === "音乐剧") {
        return [
            { name: "哔哩哔哩（站内看 · 记进度）", url: `/embed?q=${t}` },
            { name: "腾讯视频", url: `https://v.qq.com/x/search/?q=${t}` },
            { name: "YouTube", url: `https://www.youtube.com/results?search_query=${t}`, en: true },
            { name: "BroadwayHD", url: `https://www.broadwayhd.com/search?q=${t}`, en: true },
        ];
    }
    // movie / series / 电影 / 剧集
    return [
        { name: "腾讯视频", url: `https://v.qq.com/x/search/?q=${t}` },
        { name: "爱奇艺", url: `https://so.iqiyi.com/so/q_${t}` },
        { name: "哔哩哔哩（站内看 · 记进度）", url: `/embed?q=${t}` },
        { name: "优酷", url: `https://so.youku.com/search_video/q_${t}` },
        { name: "JustWatch", url: `https://www.justwatch.com/us/search?q=${t}`, en: true },
    ];
}
