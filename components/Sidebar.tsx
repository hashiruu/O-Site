"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment, useEffect, useState } from "react";
import { useLang } from "@/lib/i18n";

function SidebarIcon({ path }: { path: string }) {
    return (
        <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="currentColor">
            <path d={path} />
        </svg>
    );
}

const icons: Record<string, string> = {
    home: "M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z",
    movie: "M18 4l2 4h-3l-2-4h-2l2 4h-3l-2-4H8l2 4H7L5 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V4h-4z",
    series: "M21 3H3c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h5v2h8v-2h5c1.1 0 1.99-.9 1.99-2L23 5c0-1.1-.9-2-2-2zm0 14H3V5h18v12z",
    anime: "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z",
    private: "M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z",
    playlist: "M4 6h16v2H4zm0 5h16v2H4zm0 5h10v2H4zm14-1v6l5-3-5-3z",
    settings: "M19.14 12.94c.04-.31.06-.63.06-.94 0-.31-.02-.63-.06-.94l2.03-1.58a.49.49 0 00.12-.61l-1.92-3.32a.49.49 0 00-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 00-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.49.49 0 00-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58a.49.49 0 00-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z",
    star: "M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z",
    travel: "M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z",
    tv: "M21 3H3c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h5v2h8v-2h5c1.1 0 1.99-.9 1.99-2L23 5c0-1.1-.9-2-2-2zm0 14H3V5h18v12z",
    trophy: "M19 5h-2V3H7v2H5c-1.1 0-2 .9-2 2v1c0 2.55 1.92 4.63 4.39 4.94.63 1.5 1.98 2.63 3.61 2.96V19H7v2h10v-2h-4v-3.1c1.63-.33 2.98-1.46 3.61-2.96C19.08 12.63 21 10.55 21 8V7c0-1.1-.9-2-2-2zM5 8V7h2v3.82C5.84 10.4 5 9.3 5 8zm14 0c0 1.3-.84 2.4-2 2.82V7h2v1z",
    default: "M4 6h16v2H4zm0 5h16v2H4zm0 5h16v2H4z",
};

const defaultTypeLabels: Record<string, string> = {
    movie: "电影", series: "电视剧", anime: "动漫", travel: "旅行相册", private: "私密空间",
};

function getIconKey(type: string): string {
    if (type in icons) return type;
    return "default";
}

const checkActive = (pathname: string, href: string) => {
    if (href === "/" && pathname === "/") return true;
    if (href !== "/" && pathname.startsWith(href)) return true;
    return false;
};

const NavItemDesktop = ({ href, label, iconKey, pathname }: { href: string, label: string, iconKey: string, pathname: string }) => {
    const isActive = checkActive(pathname, href);
    return (
        <Link href={href} prefetch={false}
            className={`group relative flex items-center gap-3.5 mx-3 px-4 py-2.5 rounded-[10px] text-[14px] transition-all duration-200 ${isActive
                ? "bg-primary/12 text-primary font-semibold"
                : "text-text-2 hover:bg-bg-hover hover:text-text-1"
                }`}>
            <span className={`shrink-0 transition-colors duration-200 ${isActive ? "text-primary" : "text-text-3 group-hover:text-text-2"}`}>
                <SidebarIcon path={icons[iconKey] || icons.default} />
            </span>
            <span className="tracking-tight">
                {label}
            </span>
        </Link>
    );
};

const NavItemMobile = ({ href, label, iconKey, pathname }: { href: string, label: string, iconKey: string, pathname: string }) => {
    const isActive = checkActive(pathname, href);
    return (
        <Link href={href} prefetch={false}
            className={`group flex flex-col items-center gap-1.5 px-4 py-2 rounded-lg transition-all duration-300 ${isActive
                ? "text-primary"
                : "text-text-3 hover:text-text-1 active:scale-90"
                }`}>
            <span className={`transition-all duration-300 ${isActive ? "text-primary" : "group-hover:scale-110"}`}>
                <SidebarIcon path={icons[iconKey] || icons.default} />
            </span>
            <span className={`text-[10px] font-bold tracking-widest transition-opacity duration-300 ${isActive ? "opacity-100" : "opacity-60"}`}>{label}</span>
        </Link>
    );
};

export function Sidebar() {
    const { t } = useLang();
    const pathname = usePathname();
    const [categories, setCategories] = useState<{ type: string; name: string }[]>([]);

    useEffect(() => {
        fetch('/api/settings')
            .then(res => res.json())
            .then(data => {
                if (data.success && data.data?.mediaDirs) {
                    const seen = new Set<string>();
                    const cats: { type: string; name: string }[] = [];
                    for (const dir of data.data.mediaDirs) {
                        if (!seen.has(dir.type) && dir.type !== 'private') {
                            seen.add(dir.type);
                            cats.push({ type: dir.type, name: defaultTypeLabels[dir.type] || dir.name });
                        }
                    }
                    setCategories(cats);
                }
            })
            .catch(console.error);
    }, []);

    return (
        <Fragment>
            <aside className="hidden md:flex flex-col w-[200px] lg:w-[220px] shrink-0 h-[calc(100vh-64px)] sticky top-16 overflow-y-auto z-40 custom-scrollbar pr-3">
                <div className="py-8 flex flex-col gap-1.5">
                    <NavItemDesktop href="/" label={t('首页探索')} iconKey="home" pathname={pathname} />
                    <div className="my-5 mx-4 h-px bg-gradient-to-r from-line/50 via-line to-transparent" />
                    <div className="px-6 mb-3 section-index text-[13px] uppercase tracking-[0.3em]">Channels</div>
                    {categories.map(cat => (
                        <NavItemDesktop key={cat.type} href={`/category/${cat.type}`} label={t(cat.name)} iconKey={getIconKey(cat.type)} pathname={pathname} />
                    ))}
                    <NavItemDesktop href="/sports" label={t('体育')} iconKey="trophy" pathname={pathname} />
                    <NavItemDesktop href="/live" label="Live TV" iconKey="tv" pathname={pathname} />
                    <div className="my-5 mx-4 h-px bg-gradient-to-r from-line/50 via-line to-transparent" />
                    <div className="px-6 mb-3 section-index text-[13px] uppercase tracking-[0.3em]">Collection</div>
                    <NavItemDesktop href="/favorites" label={t('我的收藏')} iconKey="star" pathname={pathname} />
                    <NavItemDesktop href="/playlists" label={t('播放列表')} iconKey="playlist" pathname={pathname} />
                    <NavItemDesktop href="/browse" label={t('文件巡航')} iconKey="default" pathname={pathname} />
                    <NavItemDesktop href="/category/private" label={t('私密保险箱')} iconKey="private" pathname={pathname} />
                    <div className="mt-auto pt-8 flex flex-col gap-1.5 border-t border-line/20">
                        <NavItemDesktop href="/admin" label={t('媒体库后台')} iconKey="settings" pathname={pathname} />
                        <NavItemDesktop href="/settings" label={t('系统偏好设置')} iconKey="settings" pathname={pathname} />
                    </div>
                </div>
            </aside>
            <nav className="md:hidden fixed bottom-0 left-0 right-0 h-[64px] bg-bg-nav/80 backdrop-blur-2xl border-t border-line/30 flex items-center justify-around z-50 pb-safe shadow-[0_-10px_30px_rgba(0,0,0,0.15)]">
                <NavItemMobile href="/" label={t('首页')} iconKey="home" pathname={pathname} />
                <NavItemMobile
                    href={categories.length > 0 ? `/category/${categories[0].type}` : "/category/series"}
                    label={t('分类')}
                    iconKey={categories.length > 0 ? getIconKey(categories[0].type) : "series"}
                    pathname={pathname}
                />
                <NavItemMobile href="/browse" label={t('文件')} iconKey="playlist" pathname={pathname} />
                <NavItemMobile href="/admin" label={t('管理')} iconKey="settings" pathname={pathname} />
            </nav>
        </Fragment>
    );
}
