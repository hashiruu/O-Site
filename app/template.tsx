"use client";

// 路由切换统一入场动画：template 在每次导航时重新挂载，天然触发 CSS 入场。
// - 普通路由：.page-enter 上浮淡入
// - 阅读器路由（/reader/*）：.reader-slide-in —— 自带全屏层（盖住顶栏，真沉浸），
//   从右侧带投影滑入，像一本书被推到桌面正中。动画终态 transform:none（铁律：
//   非 none 的 transform 会劫持内部 fixed 元素的包含块，PDF 阅读器就是 fixed 全屏）。
import { usePathname } from "next/navigation";

export default function Template({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();
    const isReader = !!pathname && pathname.startsWith("/reader/");
    return <div className={isReader ? "reader-slide-in" : "page-enter"}>{children}</div>;
}
