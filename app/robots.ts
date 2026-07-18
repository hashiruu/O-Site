import type { MetadataRoute } from "next";

// 私密个人站：全站谷歌登录门禁，绝不希望被搜索引擎索引。
// 明确 Disallow 全部——避免私密页/书目/相册被爬进搜索结果。
export default function robots(): MetadataRoute.Robots {
    return {
        rules: { userAgent: "*", disallow: "/" },
    };
}
