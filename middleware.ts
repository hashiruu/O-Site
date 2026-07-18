import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// 防"客户端用旧版本"：
// Next.js 对静态预渲染页（如首页 ○ Static）默认给 Cache-Control: s-maxage=31536000（一年），
// 导致浏览器长期缓存旧 HTML（旧 JS bundle），改了代码用户也看不到——
// 首页 banner 在 Chrome 上反复 broken image 的根因即此：Chrome 一直用一年前的旧 HTML，
// 里面的 banner img 还在直连 image.tmdb.org（CORS/网络失败），Safari 缓存策略不同故正常。
// 这里给所有页面 HTML 加 private, no-cache（浏览器可存但每次 ETag 验证），
// 静态资源（_next/static，hash 文件名）和接口保持各自缓存不动。
export function middleware(_req: NextRequest) {
    const res = NextResponse.next();
    res.headers.set("Cache-Control", "private, no-cache, must-revalidate");
    return res;
}

export const config = {
    // 只对页面路由生效：排除静态资源、接口、带扩展名的文件
    matcher: ["/((?!_next/static|_next/image|favicon.ico|api|.*\\..*).*)"],
};
