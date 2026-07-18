"use client";

// 每页标签页标题：大量页面是 "use client"，无法 export metadata。
// 这个挂在 layout 里的小组件按路由设置 document.title，一处覆盖全站。
import { useEffect } from "react";
import { usePathname } from "next/navigation";

const TITLES: { test: (p: string) => boolean; title: string }[] = [
    { test: (p) => p === "/", title: "首页" },
    { test: (p) => p.startsWith("/bookshelf"), title: "书架" },
    { test: (p) => p.startsWith("/reader/"), title: "阅读器" },
    { test: (p) => p.startsWith("/forum"), title: "论坛" },
    { test: (p) => p.startsWith("/sports"), title: "体育" },
    { test: (p) => p.startsWith("/travel"), title: "旅行相册" },
    { test: (p) => p.startsWith("/watch"), title: "播放" },
    { test: (p) => p.startsWith("/detail"), title: "详情" },
    { test: (p) => p.startsWith("/category"), title: "分类" },
    { test: (p) => p.startsWith("/browse"), title: "浏览" },
    { test: (p) => p.startsWith("/search"), title: "搜索" },
    { test: (p) => p.startsWith("/history"), title: "历史" },
    { test: (p) => p.startsWith("/favorites"), title: "收藏" },
    { test: (p) => p.startsWith("/playlists"), title: "播单" },
    { test: (p) => p.startsWith("/missed"), title: "补课" },
    { test: (p) => p.startsWith("/live"), title: "直播" },
    { test: (p) => p.startsWith("/admin"), title: "后台" },
    { test: (p) => p.startsWith("/settings"), title: "设置" },
    { test: (p) => p.startsWith("/about"), title: "关于" },
];

export function PageTitle() {
    const pathname = usePathname() || "/";
    useEffect(() => {
        const hit = TITLES.find((t) => t.test(pathname));
        document.title = hit ? `${hit.title} · O-Site` : "O-Site · 个人媒体中心";
    }, [pathname]);
    return null;
}
