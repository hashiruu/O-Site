import type { NextConfig } from "next";

const nextConfig: NextConfig = {
    serverExternalPackages: ["better-sqlite3"],
    // 隐藏左下角 Next.js dev indicator（N 图标）
    devIndicators: false,
    // 允许从 TMDB 加载图片
    images: {
        remotePatterns: [
            {
                protocol: "https",
                hostname: "image.tmdb.org",
            },
        ],
    },
};

export default nextConfig;
