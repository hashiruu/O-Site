"use client";

// ── 轻量 i18n：字典法双语 ──
// 设计取舍：不引 next-intl 重构路由——以中文原文为 key 查字典，t("首页") → "Home"。
// 好处：改造点最小（包一层 t 即可），中文缺词条时原样返回，永不出 key 占位符。
// 语言态存 localStorage("lang")，切换即全站生效（Provider 触发重渲染）。
import { createContext, useCallback, useContext, useEffect, useState } from "react";

export type Lang = "zh" | "en";

const DICT: Record<string, string> = {
    // ── 顶栏/导航 ──
    "首页": "Home", "电影": "Movies", "剧集": "Series", "动漫": "Anime",
    "音乐剧": "Musicals", "旅行": "Travel", "直播": "Live", "体育": "Sports",
    "书架": "Books", "笔记": "Notes", "讨论组": "Forum", "搜索": "Search",
    "我的收藏": "Favorites", "观看历史": "History", "播放列表": "Playlists",
    "文件巡航": "File Browser", "私密保险箱": "Private Vault", "媒体库后台": "Admin",
    "系统设置": "Settings", "用户管理": "Users", "关于网站": "About",
    "登录": "Sign in", "退出登录": "Sign out", "更多功能": "More",
    "切换日间模式": "Switch to light mode", "切换夜间模式": "Switch to dark mode",
    // ── 通用动作 ──
    "立即播放": "Play now", "继续播放": "Resume", "详情": "Details", "返回": "Back",
    "关闭": "Close", "取消": "Cancel", "确认": "Confirm", "保存": "Save",
    "删除": "Delete", "移除": "Remove", "添加": "Add", "已添加 ✓": "Added ✓",
    "换一批": "Refresh", "每天换一批": "Refresh daily", "加载中...": "Loading...", "加载中…": "Loading…",
    "搜索中…": "Searching…", "保存中…": "Saving…", "已保存": "Saved",
    "全部": "All", "预览": "Preview", "编辑": "Edit", "重新看": "Rewatch",
    "继续看": "Continue", "继续读": "Keep reading", "重读": "Reread",
    "标记已看": "Mark watched", "已看完": "Watched", "已读完": "Finished",
    "加载更多": "Load more", "回到顶部": "Back to top",
    "命中": "matches found", "手动添加": "Add manually", "重新采集": "Re-scrape",
    "播放器加载中...": "Loading player...", "没有找到": "Not found", "清空": "Clear",
    "上一页": "Previous page", "下一页": "Next page", "最热": "Hottest", "最新": "Newest",
    "条评论": "comments", "条回复": "replies", "想看": "Want to watch",
    // ── 首页 ──
    "夜深了": "Late night", "晚上好": "Good evening", "下午好": "Good afternoon",
    "中午好": "Good noon", "早上好": "Good morning",
    "今天想看点什么？": "What shall we watch today?",
    "今日推荐": "Today's recommendations", "今日头条": "Headline", "今日热搜": "Trending today", "每天更新": "Daily",
    "接着看": "Continue", "继续阅读": "Keep reading", "手气": "Lucky",
    "随机来一部": "Surprise me", "交给命运": "Leave it to fate",
    "翻开一本书": "Open a book", "继续观看": "Continue watching",
    "全部记录 →": "All records →", "命运抽取中…": "Drawing your fate…",
    "就看它 →": "Watch it →", "算了": "Never mind",
    "电视剧": "TV Series", "旅行相册": "Travel albums",
    // ── 分区/详情 ──
    "电影大片": "Movies", "人气连续剧": "Series", "番剧动画": "Anime",
    "私密典藏": "Private", "部收录": "collected", "部外站": "external",
    "部今日推荐": "recommended today", "部收藏": "favorites",
    "排序:": "Sort:", "时间": "Date", "名称": "Name", "类型": "Type",
    "未收录": "No episodes", "外站": "External", "随机添加": "Random add",
    "选集": "Episodes", "剧情简介": "Synopsis", "重新刮削": "Re-scrape",
    "看到这": "You were here", "第": "S", "季": "", "集": "E",
    "该频道尚无收录内容或等待扫描": "No content in this channel yet or waiting for scan",
    "前往控制台添加映射": "Add mapping in console",
    // ── 弹层 ──
    "随机添加 · 先聊聊口味": "Random add · your taste first",
    "关键词添加 · 搜到什么加什么": "Keyword add · search and pick",
    "🎲 随机添加": "🎲 Random", "🔍 关键词添加": "🔍 Keyword",
    "已添加到这个分区": "Added to this section",
    "这个口味暂时没挖到新内容": "Nothing new for this taste yet",
    "换个口味再试一次？": "Try another taste?", "好的": "OK",
    "正在按你的口味挑选…": "Picking to your taste…",
    "视频源 · 站外观看": "Sources · watch elsewhere",
    "先搜搜本站有没有": "Search this site first",
    "英文平台": "English", "站外观看": "Watch elsewhere",
    "点卡片选平台观看": "Tap card to pick a platform",
    "点卡片跳合法平台观看": "Tap card to visit a licensed platform",
    "这部内容本站还没有可播放的文件。挑一个平台接着看：": "No playable file here yet. Pick a platform:",
    "本站暂无此资源，可以去这些平台找找：": "Not in the library yet. Try these platforms:",
    // ── 书架/阅读 ──
    "正在阅读": "Reading now", "在读": "Reading", "读完": "Finished", "藏书": "Total",
    "外站书单": "External booklist", "论文": "Papers", "搜书名 / 文件名…": "Search books…",
    "本 · 点封面选平台阅读": "books · pick a platform", "条标注": "highlights",
    "本": "books", "在看": "Watching", "看完": "Finished watching",
    // ── 笔记 ──
    "新建笔记": "New note", "新笔记": "New note", "书籍笔记": "Book notes",
    "无附加文字": "No additional text", "今天": "Today", "昨天": "Yesterday",
    "过去 7 天": "Past 7 days", "过去 30 天": "Past 30 days", "更早": "Earlier",
    "选一条笔记，或点 + 新建": "Pick a note, or tap + to create",
    "还没有笔记，点右上角 + 写一条": "No notes yet — tap + to write one",
    // ── 历史 ──
    "影音": "Video", "书": "Books", "看过的影音": "Videos watched",
    "翻过的书": "Books opened", "本周活跃": "Active this week", "已完成": "Completed",
    "累计观看(小时)": "Hours watched", "累计观看(分钟)": "Minutes watched",
    "这里还是空的": "Nothing here yet", "去首页看看": "Go browse",
    "影音与阅读的全部足迹，与首页「继续观看」同一本账。": "Every watch and read, same ledger as the home page.",
    // ── 嵌入观看 ──
    "嵌入观看": "Embedded viewing", "去B站打开 ↗": "Open on Bilibili ↗",
    "收起播放器": "Collapse player",
    "搜B站视频：片名 / UP主 / 关键词…": "Search Bilibili: title / creator / keyword…",
    // ── 其他页 ──
    "设置": "Settings", "收藏": "Favorites", "热点补课清单 · 标记你看过了没": "The catch-up list — mark what you've seen",
    "世界杯赛程 · 美东时间 · 点击比赛自动匹配直播源。": "World Cup schedule · ET · click a match to auto-find a stream.",
    "随便聊聊": "Casual talk", "发帖": "Post", "收起": "Collapse",
    "管理外观、媒体抓取接口以及播放偏好配置。": "Appearance, scraping APIs, and playback preferences.",
    "全部播放与阅读足迹": "All watching and reading footprints",
    "共": "Total", "项": "items", "决赛": "Final", "季军赛": "3rd place",
    "B站讨论区": "Bilibili discussions", "热点补课": "Trending catch-up", "正在拉取频道数据...": "Loading channel data...",
};

const LangCtx = createContext<{ lang: Lang; setLang: (l: Lang) => void }>({ lang: "zh", setLang: () => {} });

export function LangProvider({ children }: { children: React.ReactNode }) {
    const [lang, setLangState] = useState<Lang>("zh");
    useEffect(() => {
        try {
            const saved = localStorage.getItem("lang") as Lang | null;
            if (saved === "en" || saved === "zh") setLangState(saved);
        } catch { /* noop */ }
    }, []);
    const setLang = useCallback((l: Lang) => {
        setLangState(l);
        try { localStorage.setItem("lang", l); } catch { /* noop */ }
        document.documentElement.lang = l === "en" ? "en" : "zh-CN";
    }, []);
    return <LangCtx.Provider value={{ lang, setLang }}>{children}</LangCtx.Provider>;
}

export function useLang() {
    const { lang, setLang } = useContext(LangCtx);
    // t：中文原文为 key；缺词条回落中文原文（永不出占位符）
    const t = useCallback((zh: string) => (lang === "en" ? (DICT[zh] ?? zh) : zh), [lang]);
    return { lang, setLang, t };
}
