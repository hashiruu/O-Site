import type { MetadataRoute } from "next";

// PWA manifest：让 O-Site 能"添加到主屏幕"，以独立全屏 App 形态启动（无浏览器地址栏）。
// 这是家庭媒体站留住用户的关键——iPad/iPhone 上装一次，之后像原生 App 一样打开。
export default function manifest(): MetadataRoute.Manifest {
    return {
        name: "O-Site 个人媒体中心",
        short_name: "O-Site",
        description: "影音 · 书籍 · 论文 · 论坛 · 体育 —— 你的私人媒体空间",
        start_url: "/",
        scope: "/",
        display: "standalone",
        orientation: "any",
        background_color: "#101014",
        theme_color: "#101014",
        lang: "zh-CN",
        categories: ["entertainment", "books", "news"],
        icons: [
            { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
            { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
            { src: "/icons/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
    };
}
