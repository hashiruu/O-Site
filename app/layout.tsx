import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Header } from "../components/Header";
import { Footer } from "../components/Footer";
import { MobileTabBar } from "../components/MobileTabBar";
import { ThemeProvider } from "../components/ThemeProvider";
import { PageTitle } from "../components/PageTitle";
import { CommandPalette } from "../components/CommandPalette";
import { BackToTop } from "../components/BackToTop";

export const metadata: Metadata = {
    // 标签页标题模板：各页 setTitle 时显示「书架 · O-Site」，未设时回落
    title: { default: "O-Site · 个人媒体中心", template: "%s · O-Site" },
    description: "O-Site — 影音 · 书籍 · 论文 · 论坛 · 体育，你的私人媒体空间",
    applicationName: "O-Site",
    manifest: "/manifest.webmanifest",
    appleWebApp: {
        capable: true,
        statusBarStyle: "black-translucent",
        title: "O-Site",
    },
    icons: {
        icon: [
            { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
            { url: "/favicon-64.png", sizes: "64x64", type: "image/png" },
        ],
        apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
    },
};

export const viewport: Viewport = {
    width: "device-width",
    initialScale: 1,
    maximumScale: 1,
    userScalable: false,
    viewportFit: "cover",
    themeColor: [
        { media: "(prefers-color-scheme: light)", color: "#F1F2F3" },
        { media: "(prefers-color-scheme: dark)", color: "#101014" },
    ],
};

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <html lang="zh-CN" suppressHydrationWarning>
            <head>
                {/* iOS: 禁止 Safari 自动把日期/电话/地址变成链接 */}
                <meta name="format-detection" content="telephone=no, date=no, address=no, email=no" />
                {/* 首屏前置：挂载前就按 localStorage 定主题，消除「先亮后暗」刷新闪烁 */}
                <script dangerouslySetInnerHTML={{
                    __html: `try{if(localStorage.getItem('theme')==='dark')document.documentElement.classList.add('dark')}catch(e){}`
                }} />
                <script dangerouslySetInnerHTML={{
                    __html: `if (!window.crypto) window.crypto = {}; if (!window.crypto.randomUUID) window.crypto.randomUUID = function() { return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) { var r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8); return v.toString(16); }); };`
                }} />
            </head>
            <body className="antialiased bg-bg text-text-1">
                <ThemeProvider>
                    <PageTitle />
                    <CommandPalette />
                    {/* B 站布局：顶栏 + safe-area 避让 + 主内容 + 移动底部 tab
                        顶栏本身已做 fixed top-0 + z-50，iOS 需要 safe-area-inset-top 避开刘海 */}
                    <Header />
                    {/* 防遮挡占位：顶栏 64px（两行已合一）+ safe-area-inset-top（iOS 刘海屏额外空间） */}
                    <div className="top-spacer h-16 ios-safe-top w-full shrink-0"></div>
                    <div className="content-shell flex w-full justify-center bg-bg px-5 pb-20 sm:px-8 lg:px-12 2xl:px-20 md:pb-12">
                        <div className="global-content-container w-full max-w-[1720px]">
                            <main className="main-content min-w-0 pt-6 lg:pt-8">
                                {children}
                            </main>
                        </div>
                    </div>
                    <BackToTop />
                    <Footer />
                    <MobileTabBar />
                </ThemeProvider>
            </body>
        </html>
    );
}
