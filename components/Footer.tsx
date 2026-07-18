// 全站页脚：品牌标识 + 快速链接 + Fable 5 认证徽章。
// 仅桌面端显示（移动端有底部 tab 栏，footer 会让页面过长）。
import Link from "next/link";
import pkg from "../package.json";

const LINKS: { href: string; label: string }[] = [
    { href: "/", label: "首页" },
    { href: "/bookshelf", label: "书架" },
    { href: "/missed", label: "Missed" },
    { href: "/live", label: "直播" },
    { href: "/sports", label: "体育" },
    { href: "/about", label: "关于" },
];

export function Footer() {
    return (
        <footer className="hidden md:block border-t border-line bg-bg-card mt-12">
            <div className="mx-auto max-w-[1720px] px-8 lg:px-12 2xl:px-20 py-10">
                {/* 品牌区（整行） */}
                <div className="mb-8">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src="/logo/circle_and_text.png" alt="O-Site" className="h-10 w-auto mb-3" />
                    <p className="text-[13px] text-text-3 leading-relaxed max-w-md">
                        自托管媒体中心
                    </p>
                </div>

                {/* 导航（单列，技术栈不对外暴露） */}
                <div className="max-w-md">
                    <h3 className="text-[12px] font-semibold uppercase tracking-wider text-text-3 mb-3">导航</h3>
                    <ul className="grid grid-cols-3 gap-y-2">
                        {LINKS.map((l) => (
                            <li key={l.href}>
                                <Link href={l.href} className="text-[14px] text-text-2 hover:text-primary transition-colors">
                                    {l.label}
                                </Link>
                            </li>
                        ))}
                    </ul>
                </div>

                <div className="mt-8 pt-5 border-t border-line/60 flex items-end justify-between gap-4">
                    <div className="flex flex-col gap-1">
                        <span className="text-[12px] text-text-4">© {new Date().getFullYear()} O-Site · v{pkg.version}</span>
                        <span className="text-[12px] text-text-4">Built with Claude Fable 5 · 美东时间</span>
                    </div>
                    {/* Fable 5 认证徽章：底部右上角，放大 */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src="/fable-5-verified.png" alt="Fable 5 Verified" className="h-14 w-auto" />
                </div>
            </div>
        </footer>
    );
}
