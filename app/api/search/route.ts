// GET /api/search?q=<关键词> → 全站聚合搜索，四类并行、各源独立容错。
//   - media   ：media 表 title/overview LIKE（影音：电影/剧集/动漫/旅行/私密，按身份过滤私密）
//   - books   ：扫 ~/mydrive/book 五分类 + ~/mydrive/PAPERS 论文，文件名+清洗标题匹配
//   - albums  ：扫旅行相册根目录的文件夹名（相册级，非单条 media）
//   - pages   ：固定栏目入口关键词匹配（电影/直播/书架…），帮用户一键跳栏目
// 旧 /api/media/search 保留不动（向后兼容）。
import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { getDb } from "@/lib/db";
import { getAccess, allows, typeFilterSql, canAdminSite, canManageUsers, type Access } from "@/lib/roles";

export const dynamic = "force-dynamic";

const BOOK_DIR = "/home/steven/mydrive/book";
const PAPERS_DIR = "/home/steven/mydrive/PAPERS";
const BOOK_EXTS = new Set([".epub", ".pdf", ".md", ".mobi"]);
const BOOK_CATEGORIES = ["推理悬疑", "科幻", "文学名著", "科研学术", "技术文档", "其他"];
const MAX_PER_SOURCE = 30;

// 栏目入口：label + 别名（关键词命中任一即出）。覆盖全站主要功能页。
const PAGES = [
    { href: "/", label: "首页", aliases: ["首页", "主页", "home", "推荐"] },
    { href: "/category/movie", label: "电影", aliases: ["电影", "movie"] },
    { href: "/category/series", label: "剧集", aliases: ["剧集", "电视剧", "连续剧", "series"] },
    { href: "/category/anime", label: "动漫", aliases: ["动漫", "番剧", "anime"] },
    { href: "/category/private", label: "私密保险箱", aliases: ["私密", "保险箱", "private"] },
    { href: "/live", label: "直播", aliases: ["直播", "电视", "live", "tv"] },
    { href: "/sports", label: "体育", aliases: ["体育", "世界杯", "足球", "sports"] },
    { href: "/bookshelf", label: "书架", aliases: ["书架", "书", "书库", "book", "bookshelf"] },
    { href: "/missed", label: "热点补课 (Missed)", aliases: ["错过", "热点", "补课", "missed"] },
    { href: "/forum", label: "讨论组", aliases: ["讨论组", "讨论", "论坛", "社区", "forum"] },
    { href: "/favorites", label: "我的收藏", aliases: ["收藏", "favorites"] },
    { href: "/history", label: "观看历史", aliases: ["历史", "观看", "history"] },
    { href: "/playlists", label: "播放列表", aliases: ["播放列表", "歌单", "playlist"] },
    { href: "/browse", label: "文件巡航", aliases: ["文件", "巡航", "浏览", "browse"] },
    { href: "/admin", label: "媒体库后台", aliases: ["后台", "管理", "导入", "扫描", "admin"] },
    { href: "/settings", label: "系统设置", aliases: ["设置", "配置", "settings"] },
    { href: "/about", label: "关于网站", aliases: ["关于", "about"] },
];

interface MediaHit { kind: "media"; id: string; title: string; type: string; path: string; year: number | null; poster: string | null; overview: string | null; }
interface BookHit { kind: "book"; title: string; file: string; path: string; ext: string; category: string; isPaper: boolean; }
interface AlbumHit { kind: "album"; name: string; title: string; path: string; }
interface PageHit { kind: "page"; label: string; href: string; }
type Hit = MediaHit | BookHit | AlbumHit | PageHit;

function like(q: string) { return `%${q}%`; }

// 书名清洗（与 /api/books 一致：去前缀日期/--后元数据/序号/下划线）
function cleanTitle(fileName: string): string {
    let t = fileName.replace(/\.(pdf|epub|mobi|md)$/i, "");
    t = t.replace(/^\d{6}[-_ ]+/, "");
    const cut = t.indexOf(" -- ");
    if (cut > 0) t = t.slice(0, cut);
    t = t.replace(/\s*\(\d+\)\s*$/, "");
    t = t.replace(/_\s/g, ": ");
    t = t.replace(/_/g, " ");
    const open = t.lastIndexOf("(");
    if (open > 0 && !t.slice(open).includes(")")) t = t.slice(0, open);
    return t.replace(/[-_\s]+$/, "").trim() || fileName;
}

function searchMedia(q: string, access: Access): MediaHit[] {
    try {
        const db = getDb();
        const rows = db.prepare(
            `SELECT id, title, type, path, year, poster, overview FROM media
             WHERE (title LIKE ? OR overview LIKE ?)
             AND type != 'travel'  -- 旅行相册不进搜索（对 boss 也一样）
             AND ${typeFilterSql(access)}
             ORDER BY (title LIKE ?) DESC, created_at DESC LIMIT ?`
        ).all(like(q), like(q), like(q), MAX_PER_SOURCE) as any[];
        return rows.map((r) => ({
            kind: "media" as const,
            id: String(r.id), title: r.title, type: r.type, path: r.path,
            year: r.year ?? null, poster: r.poster ?? null, overview: r.overview ?? null,
        }));
    } catch { return []; }
}

function searchBooks(q: string): BookHit[] {
    const ql = q.toLowerCase();
    const hits: BookHit[] = [];
    const push = (file: string, fullPath: string, category: string, isPaper: boolean) => {
        if (hits.length >= MAX_PER_SOURCE) return;
        const cleaned = cleanTitle(file);
        if (cleaned.toLowerCase().includes(ql) || file.toLowerCase().includes(ql)) {
            const ext = path.extname(file).slice(1).toLowerCase();
            hits.push({ kind: "book", title: cleaned, file, path: fullPath, ext, category, isPaper });
        }
    };
    // 基础分类：扫各分类目录
    for (const cat of BOOK_CATEGORIES) {
        const dir = path.join(BOOK_DIR, cat);
        let entries: string[] = [];
        try { entries = fs.readdirSync(dir); } catch { continue; }
        for (const f of entries) {
            if (f.startsWith(".") || /\.sb-/.test(f)) continue;
            if (!BOOK_EXTS.has(path.extname(f).toLowerCase())) continue;
            push(f, path.join(dir, f), cat, false);
        }
        if (hits.length >= MAX_PER_SOURCE) break;
    }
    // 论文：PAPERS 一级子目录
    if (hits.length < MAX_PER_SOURCE) {
        try {
            for (const sub of fs.readdirSync(PAPERS_DIR, { withFileTypes: true })) {
                if (!sub.isDirectory()) continue;
                const dir = path.join(PAPERS_DIR, sub.name);
                for (const f of fs.readdirSync(dir)) {
                    if (f.startsWith(".") || /\.sb-/.test(f)) continue;
                    if (!BOOK_EXTS.has(path.extname(f).toLowerCase())) continue;
                    push(f, path.join(dir, f), sub.name, true);
                    if (hits.length >= MAX_PER_SOURCE) break;
                }
                if (hits.length >= MAX_PER_SOURCE) break;
            }
        } catch { /* noop */ }
    }
    return hits;
}

// 栏目入口按用户可见范围过滤：admin 页仅 admin，内容栏目按 scope，
// 私密/旅行相册仅 boss，个人页全员可见
const PAGE_CATEGORY: Record<string, string> = {
    "/category/movie": "movie", "/category/series": "series", "/category/anime": "anime",
    "/live": "live", "/sports": "sports", "/bookshelf": "book", "/missed": "missed",
};
const PAGE_ADMIN = new Set(["/browse", "/admin", "/settings"]);
const PAGE_BOSS = new Set(["/admin/users", "/category/travel", "/category/private"]);

function pageVisible(href: string, access: Access): boolean {
    if (PAGE_BOSS.has(href)) return canManageUsers(access.role);
    if (PAGE_ADMIN.has(href)) return canAdminSite(access.role);
    const cat = PAGE_CATEGORY[href];
    if (cat) return allows(access, cat);
    return true; // 首页/收藏/历史/关于等个人页
}

function searchPages(q: string, access: Access): PageHit[] {
    const ql = q.toLowerCase().trim();
    if (!ql) return [];
    return PAGES.filter((p) => pageVisible(p.href, access)).filter((p) =>
        p.label.toLowerCase().includes(ql) || p.aliases.some((a) => a.toLowerCase().includes(ql))
    ).map((p) => ({ kind: "page" as const, label: p.label, href: p.href }));
}

export async function GET(req: NextRequest): Promise<NextResponse> {
    // 铁律：未登录搜索是摆设——不查任何源、不留痕，直接 401
    const { resolveUserKeyOrNull } = await import("@/lib/identity");
    if (!(await resolveUserKeyOrNull(req))) {
        return NextResponse.json({ success: false, error: "LOGIN_REQUIRED" }, { status: 401 });
    }
    const q = (req.nextUrl.searchParams.get("q") || "").trim();
    if (!q) return NextResponse.json({ success: true, data: { media: [], books: [], albums: [], pages: [] } });

    // 搜索留痕（boss 监督用，失败不影响搜索）
    try {
        const { auth } = await import("@/auth");
        const { logSearch } = await import("@/lib/roles");
        const email = (await auth())?.user?.email;
        logSearch(email, q);
    } catch { /* noop */ }

    const access = await getAccess(req);
    // 三源并行，任一抛错不影响其余；每源都按用户内容范围过滤（默认用户=全空）。
    // 旅行相册不收录进搜索（私人内容不进任何检索面），albums 恒为空。
    const [media, books, pages] = await Promise.all([
        Promise.resolve(searchMedia(q, access)),
        Promise.resolve(allows(access, "book") ? searchBooks(q) : []),
        Promise.resolve(searchPages(q, access)),
    ]);
    const albums: AlbumHit[] = [];
    return NextResponse.json({
        success: true,
        data: { media, books, albums, pages },
        total: media.length + books.length + albums.length + pages.length,
    });
}
