"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMe } from "./useMe";

// 移动端底部 tab（角色过滤同 Header：管理仅 admin/boss 可见，收藏仅已登录）
const TABS = [
    { href: "/", label: "首页", icon: "M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z", requireLogin: false },
    { href: "/category/movie", label: "影库", icon: "M18 4l2 4h-3l-2-4h-2l2 4h-3l-2-4H8l2 4H7L5 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V4h-4z", requireLogin: false },
    { href: "/favorites", label: "收藏", icon: "M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z", requireLogin: true },
    { href: "/admin", label: "管理", icon: "M19.14 12.94c.04-.31.06-.63.06-.94 0-.31-.02-.63-.06-.94l2.03-1.58a.49.49 0 00.12-.61l-1.92-3.32a.49.49 0 00-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 00-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.49.49 0 00-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58a.49.49 0 00-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z", requireAdmin: true },
];

const isActive = (pathname: string, href: string) =>
    href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/");

export function MobileTabBar() {
    const pathname = usePathname();
    const { me, loading } = useMe();
    const role = me?.role || "guest";
    const isAdmin = role === "boss" || role === "admin";
    const loggedIn = !!me?.user;

    // 还在查身份：先不出 tab，避免闪现"管理"
    if (loading) return null;

    const visible = TABS.filter((t) => {
        if (t.requireAdmin && !isAdmin) return false;
        if (t.requireLogin && !loggedIn) return false;
        return true;
    });

    return (
        <nav className="mobile-tabbar fixed bottom-0 left-0 right-0 z-50 flex h-14 items-center justify-around border-t border-line bg-bg-card ios-safe-bottom md:hidden">
            {visible.map((tab) => {
                const active = isActive(pathname, tab.href);
                return (
                    <Link
                        key={tab.href}
                        href={tab.href}
                        prefetch={false}
                        className={`flex flex-col items-center gap-0.5 px-3 py-1 ${active ? "text-primary" : "text-text-3"}`}
                    >
                        <svg className="h-[22px] w-[22px]" viewBox="0 0 24 24" fill="currentColor">
                            <path d={tab.icon} />
                        </svg>
                        <span className="text-[11px]">{tab.label}</span>
                    </Link>
                );
            })}
        </nav>
    );
}
