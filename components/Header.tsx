"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useTheme } from "./ThemeProvider";
import { useLang } from "../lib/i18n";
import { openLoginPopup, signOutInPlace } from "./loginPopup";

// 频道 tab（spec §3.2：固定 5-6 个分类，不抄 B 站十几入口）
const CHANNELS = [
    { href: "/", label: "首页" },
    { href: "/category/movie", label: "电影" },
    { href: "/category/series", label: "剧集" },
    { href: "/category/anime", label: "动漫" },
    { href: "/category/musical", label: "音乐剧" },
    { href: "/category/travel", label: "旅行" },
    { href: "/live", label: "直播" },
    { href: "/sports", label: "体育" },
    { href: "/bookshelf", label: "书架" },
    { href: "/notes", label: "笔记" },
    { href: "/missed", label: "补片" },
    { href: "/forum", label: "讨论组" },
];

// 二级功能（spec §3.2：Sidebar 退役，收藏/播放列表/设置/管理 挪顶栏右侧下拉）
const SECONDARY = [
    { href: "/favorites", label: "我的收藏", icon: "M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" },
    { href: "/history", label: "观看历史", icon: "M13 3a9 9 0 00-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42A8.954 8.954 0 0013 21a9 9 0 000-18zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8H12z" },
    { href: "/playlists", label: "播放列表", icon: "M4 6h16v2H4zm0 5h16v2H4zm0 5h10v2H4zm14-1v6l5-3-5-3z" },
    { href: "/browse", label: "文件巡航", icon: "M4 6h16v2H4zm0 5h16v2H4zm0 5h16v2H4z" },
    { href: "/category/private", label: "私密保险箱", icon: "M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z" },
    { href: "/admin", label: "媒体库后台", icon: "M19.43 12.98c.04-.32.07-.64.07-.98 0-.34-.03-.66-.07-.98l2.11-1.65c.19-.15.24-.42.12-.64l-2-3.46c-.12-.22-.39-.3-.61-.22l-2.49 1c-.52-.4-1.08-.73-1.69-.98l-.38-2.65C14.46 2.18 14.25 2 14 2h-4c-.25 0-.46.18-.49.42l-.38 2.65c-.61.25-1.17.59-1.69.98l-2.49-1c-.23-.09-.49 0-.61.22l-2 3.46c-.13.22-.07.49.12.64l2.11 1.65c-.04.32-.07.65-.07.98 0 .33.03.66.07.98l-2.11 1.65c-.19.15-.24.42-.12.64l2 3.46c.12.22.39.3.61.22l2.49-1c.52.4 1.08.73 1.69.98l.38 2.65c.03.24.24.42.49.42h4c.25 0 .46-.18.49-.42l.38-2.65c.61-.25 1.17-.59 1.69-.98l2.49 1c.23.09.49 0 .61-.22l2-3.46c.12-.22.07-.49-.12-.64l-2.11-1.65zM12 15.5c-1.93 0-3.5-1.57-3.5-3.5s1.57-3.5 3.5-3.5 3.5 1.57 3.5 3.5-1.57 3.5-3.5 3.5z" },
    { href: "/settings", label: "系统设置", icon: "M19.14 12.94c.04-.31.06-.63.06-.94 0-.31-.02-.63-.06-.94l2.03-1.58a.49.49 0 00.12-.61l-1.92-3.32a.49.49 0 00-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 00-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.49.49 0 00-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58a.49.49 0 00-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z" },
    { href: "/admin/users", label: "用户管理", icon: "M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z" },
    { href: "/about", label: "关于网站", icon: "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z" },
];

// 导航按 boss 分配的内容范围过滤：默认用户 = 空白网站（只剩首页/个人页）。
// 内容栏目挂类别 scope；后台/设置/巡航需 admin；用户管理 + 私密/旅行相册仅 boss。
const HREF_CATEGORY: Record<string, string> = {
    "/category/movie": "movie", "/category/series": "series", "/category/anime": "anime",
    "/live": "live", "/sports": "sports", "/bookshelf": "book", "/missed": "missed",
    "/category/musical": "musical", "/notes": "notes",
};
const ADMIN_HREFS = new Set(["/browse", "/admin", "/settings"]);
const BOSS_HREFS = new Set(["/admin/users", "/category/travel", "/category/private"]);
function shouldShow(href: string, isAdmin: boolean, isBoss: boolean, scopes: Set<string> | null, loggedIn?: boolean): boolean {
    if (BOSS_HREFS.has(href)) return isBoss;
    if (ADMIN_HREFS.has(href)) return isAdmin;
    if (href === "/forum") return !!loggedIn; // 论坛：登录即用，不走内容 scope
    const cat = HREF_CATEGORY[href];
    if (cat) return scopes === null || scopes.has(cat);
    return true; // 首页/收藏/历史/播放列表/关于
}

const isChannelActive = (pathname: string, href: string) =>
    href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/");

export function Header() {
    const { theme, toggleTheme } = useTheme();
    const { lang, setLang, t } = useLang();
    const pathname = usePathname();
    const [scrolled, setScrolled] = useState(false);
    const [menuOpen, setMenuOpen] = useState(false);
    // 身份：{ user, role, permissions }（来自 /api/auth/me，按角色 + 内容范围过滤菜单）
    const [me, setMe] = useState<{ user: { name?: string; email?: string; image?: string } | null; role: "boss" | "admin" | "regular" | "guest"; permissions?: string | null } | null>(null);

    useEffect(() => {
        fetch("/api/auth/me")
            .then((r) => (r.ok ? r.json() : null))
            .then(setMe)
            .catch(() => setMe(null));
    }, []);
    const sessionUser = me?.user ?? null;
    const role = me?.role || "guest";
    const isAdmin = role === "boss" || role === "admin";
    const isBoss = role === "boss";
    // 内容范围：null = 不限（admin/boss 或 scope="*"）；空 Set = 全拒（默认用户/guest）
    const scopes: Set<string> | null = isAdmin || me?.permissions === "*"
        ? null
        : new Set((me?.permissions || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean));

    // B 站式滚动渐变：页面顶部时顶栏透明融进背景，下滑后渐显实底+毛玻璃+边框
    useEffect(() => {
        const onScroll = () => setScrolled(window.scrollY > 8);
        onScroll();
        window.addEventListener("scroll", onScroll, { passive: true });
        return () => window.removeEventListener("scroll", onScroll);
    }, []);

    return (
        <header
            className={`fixed top-0 left-0 right-0 z-50 ios-safe-top transition-[background-color,border-color,box-shadow,backdrop-filter] duration-300 ${
                scrolled
                    ? "border-b border-line bg-bg-nav shadow-[0_2px_8px_rgba(0,0,0,0.06)] backdrop-blur-md"
                    : "border-b border-transparent bg-transparent"
            }`}
        >
            {/* ── 单行顶栏 64px：logo + 频道 tab（原第二行并入）+ 徽章 + 搜索按钮 + 主题 + 菜单 ── */}
            <div className="flex h-16 items-center gap-3 px-5 sm:gap-5 sm:px-8 lg:px-12 2xl:px-20">
                {/* 左：圆形 icon（日夜都在） + 纯文字 logo（仅日间 + 宽屏显示） */}
                <Link href="/" className="flex shrink-0 items-center gap-2">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src="/logo/circle.png" alt="O-Site" className="h-11 w-11 object-contain" />
                    {theme !== "dark" && (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img
                            src="/logo/puretext.png"
                            srcSet="/logo/puretext.png 1x, /logo/puretext@2x.png 2x"
                            alt="O-Site"
                            className="hidden h-8 w-auto object-contain xl:block"
                        />
                    )}
                </Link>

                {/* 中：频道 tab 填满原搜索框的空白区（小屏横滑） */}
                <nav className="scrollbar-hide flex min-w-0 flex-1 items-center gap-4 overflow-x-auto sm:gap-6">
                    {CHANNELS.filter((ch) => shouldShow(ch.href, isAdmin, isBoss, scopes, !!sessionUser)).map((ch) => (
                        <Link
                            key={ch.href}
                            href={ch.href}
                            prefetch={false}
                            className={`shrink-0 text-[14px] transition-colors ${isChannelActive(pathname, ch.href) ? "font-medium text-primary" : "text-text-2 hover:text-text-1"}`}
                        >
                            {t(ch.label)}
                        </Link>
                    ))}
                </nav>

                {/* 右：Fable 5 认证徽章 + 搜索按钮 + 主题切换 + 二级菜单 */}
                <div className="flex shrink-0 items-center gap-0.5 sm:gap-1.5">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                        src="/fable-5-verified.png"
                        alt="Fable 5 Verified"
                        title="Fable 5 • Verified"
                        className="hidden h-8 w-auto shrink-0 lg:block"
                    />
                    {/* 搜索按钮：点击呼出搜索面板（面板从这里平移飞出）。桌面胶囊、小屏纯图标 */}
                    <button
                        onClick={(e) => {
                            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                            window.dispatchEvent(new CustomEvent("open-cmdk", { detail: { from: rect } }));
                        }}
                        aria-label="搜索"
                        className="flex h-10 cursor-pointer items-center justify-center gap-2 rounded-full text-text-2 transition-colors hover:bg-bg-hover hover:text-text-1 max-sm:w-10 sm:h-9 sm:border sm:border-line sm:bg-bg-input sm:pl-3.5 sm:pr-4 sm:text-[13px] sm:text-text-3"
                    >
                        <svg className="h-[18px] w-[18px] sm:h-4 sm:w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
                        </svg>
                        <span className="hidden sm:inline">{t("搜索")}</span>
                    </button>
                    {/* 中英切换：一键翻转，localStorage 记忆 */}
                    <button
                        onClick={() => setLang(lang === "zh" ? "en" : "zh")}
                        title={lang === "zh" ? "Switch to English" : "切换为中文"}
                        className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-full text-[12px] font-bold text-text-2 transition-colors hover:bg-bg-hover hover:text-text-1"
                    >
                        {lang === "zh" ? "EN" : "中"}
                    </button>
                    <button
                        onClick={toggleTheme}
                        title={theme === "dark" ? t("切换日间模式") : t("切换夜间模式")}
                        className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-full text-text-2 transition-colors hover:bg-bg-hover hover:text-text-1"
                    >
                        {theme === "dark" ? (
                            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M12 7c-2.76 0-5 2.24-5 5s2.24 5 5 5 5-2.24 5-5-2.24-5-5-5zM2 13h2c.55 0 1-.45 1-1s-.45-1-1-1H2c-.55 0-1 .45-1 1s.45 1 1 1zm18 0h2c.55 0 1-.45 1-1s-.45-1-1-1h-2c-.55 0-1 .45-1 1s.45 1 1 1zM11 2v2c0 .55.45 1 1 1s1-.45 1-1V2c0-.55-.45-1-1-1s-1 .45-1 1zm0 18v2c0 .55.45 1 1 1s1-.45 1-1v-2c0-.55-.45-1-1-1s-1 .45-1 1zM5.99 4.58a.996.996 0 00-1.41 0 .996.996 0 000 1.41l1.06 1.06c.39.39 1.03.39 1.41 0s.39-1.03 0-1.41L5.99 4.58zm12.37 12.37a.996.996 0 00-1.41 0 .996.996 0 000 1.41l1.06 1.06c.39.39 1.03.39 1.41 0a.996.996 0 000-1.41l-1.06-1.06zm1.06-10.96a.996.996 0 000-1.41.996.996 0 00-1.41 0l-1.06 1.06c-.39.39-.39 1.03 0 1.41s1.03.39 1.41 0l1.06-1.06zM7.05 18.36a.996.996 0 000-1.41.996.996 0 00-1.41 0l-1.06 1.06c-.39.39-.39 1.03 0 1.41s1.03.39 1.41 0l1.06-1.06z" />
                            </svg>
                        ) : (
                            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M12 3a9 9 0 109 9c0-.46-.04-.92-.1-1.36a5.389 5.389 0 01-4.4 2.26 5.403 5.403 0 01-3.14-9.8c-.44-.06-.9-.1-1.36-.1z" />
                            </svg>
                        )}
                    </button>

                    <div className="relative">
                        <button
                            onClick={() => setMenuOpen((o) => !o)}
                            aria-label="更多功能"
                            className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-full text-text-2 transition-colors hover:bg-bg-hover hover:text-text-1"
                        >
                            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M4 6h16v2H4zm0 5h16v2H4zm0 5h16v2H4z" />
                            </svg>
                        </button>
                        {menuOpen && (
                            <>
                                <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
                                <div className="absolute right-0 top-11 z-50 w-44 rounded-lg border border-line bg-bg-card py-1.5 shadow-[0_4px_16px_rgba(0,0,0,0.08)]">
                                    {/* 账号区：已登录显示头像+退出；未登录显示 Google 登录入口 */}
                                    {sessionUser ? (
                                        <div className="border-b border-line/60 px-3.5 py-2 mb-1">
                                            <div className="flex items-center gap-2">
                                                {sessionUser.image ? (
                                                    // eslint-disable-next-line @next/next/no-img-element
                                                    <img src={sessionUser.image} alt="" className="h-7 w-7 rounded-full" referrerPolicy="no-referrer" />
                                                ) : (
                                                    <div className="h-7 w-7 rounded-full bg-primary/15 text-primary flex items-center justify-center text-xs font-bold">
                                                        {(sessionUser.name || "U")[0]}
                                                    </div>
                                                )}
                                                <div className="min-w-0">
                                                    <div className="truncate text-[13px] text-text-1">{sessionUser.name}</div>
                                                    <button onClick={() => void signOutInPlace()} className="cursor-pointer text-[11px] text-text-3 hover:text-primary">{t("退出登录")}</button>
                                                </div>
                                            </div>
                                        </div>
                                    ) : (
                                        <button
                                            onClick={() => { setMenuOpen(false); openLoginPopup(); }}
                                            className="flex w-full cursor-pointer items-center gap-2.5 border-b border-line/60 px-3.5 py-2 mb-1 text-[14px] text-text-2 transition-colors hover:bg-bg-hover hover:text-text-1"
                                        >
                                            <svg className="h-[18px] w-[18px] shrink-0" viewBox="0 0 24 24" fill="currentColor">
                                                <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
                                            </svg>
                                            {t("登录")}
                                        </button>
                                    )}
                                    {SECONDARY.filter((item) => shouldShow(item.href, isAdmin, isBoss, scopes)).map((item) => (
                                        <Link
                                            key={item.href}
                                            href={item.href}
                                            prefetch={false}
                                            onClick={() => setMenuOpen(false)}
                                            className={`flex items-center gap-2.5 px-3.5 py-2 text-[14px] transition-colors ${isChannelActive(pathname, item.href) ? "text-primary" : "text-text-2 hover:bg-bg-hover hover:text-text-1"}`}
                                        >
                                            <svg className="h-[18px] w-[18px] shrink-0" viewBox="0 0 24 24" fill="currentColor">
                                                <path d={item.icon} />
                                            </svg>
                                            {t(item.label)}
                                        </Link>
                                    ))}
                                </div>
                            </>
                        )}
                    </div>
                </div>
            </div>
        </header>
    );
}
