import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

// /api/books：扫描书架两大数据源，返回 { 基础分类, 论文分类 }。
// - 基础分类：~/mydrive/book，5 个固定图书门类（推理悬疑/科幻/文学名著/科研学术/其他）
//     * 子目录名 = 分类（book/科幻/xxx.epub 直接归入"科幻"）
//     * 根目录散落文件按关键词映射兜底归类，映射不中落入"其他"
//     * 空分类也返回（前端渲染空书架，方便后台导入后立刻可见）
// - 论文分类：~/mydrive/PAPERS 的一级子目录（CV/LLM/NLP/Sys）即分类名
export const dynamic = "force-dynamic";

const BOOK_DIR = "/home/steven/mydrive/book";
const PAPERS_DIR = "/home/steven/mydrive/PAPERS";

const BOOK_EXTS = new Set([".pdf", ".epub", ".mobi", ".md"]);

export interface BookItem {
    title: string;      // 清洗后的书名
    file: string;       // 原始文件名（相对所属根目录）
    path: string;       // 绝对路径（喂给 /api/books/file、/api/books/cover）
    ext: string;        // "pdf" | "epub" | "mobi" | "md"
    size: number;       // bytes
    sizeText: string;   // "27.6 MB"
}

// ── 基础分类：5 个固定图书门类（顺序即前端书架顺序）──
// 按书店通行粗分法 + 站长实际书单定：推理悬疑（东野圭吾/阿加莎）、科幻（刘慈欣）、
// 文学名著、科研学术（教材/科研写作/技术书）、其他。
const BASE_CATEGORIES = ["推理悬疑", "科幻", "文学名著", "科研学术", "技术文档", "其他"] as const;
const FALLBACK_CATEGORY = "其他";

// ── 根目录散落文件的关键词兜底映射（可维护，统一小写匹配）──
// 按数组顺序匹配（先命中先归类）：学术/技术词先查，避免 "Foundations of ML" 之类误入小说。
// 新书直接放进对应分类子目录即可，不必依赖此表；此表只兜底根目录旧文件。
const CATEGORY_KEYWORDS: { category: string; keywords: string[] }[] = [
    {
        category: "科研学术",
        keywords: [
            "machine learning", "deep learning", "computer vision", "neural network",
            "reinforcement learning", "pattern recognition", "probabilistic",
            "research writing", "science-research-writing", "academic writing",
            "scientific writing", "thesis", "论文", "科研", "机器学习", "深度学习", "视觉",
            "programming", "handbook", "algorithm", "operating system", "database",
            "编程", "手册", "指南",
        ],
    },
    {
        category: "推理悬疑",
        keywords: [
            "东野圭吾", "阿加莎", "克里斯蒂", "higashino", "keigo", "agatha", "christie",
            "推理", "悬疑", "侦探", "mystery", "detective", "白夜行", "嫌疑人", "解忧",
            "无人生还", "东方快车", "波洛", "poirot", "福尔摩斯", "sherlock",
        ],
    },
    {
        category: "科幻",
        keywords: [
            "刘慈欣", "三体", "流浪地球", "球状闪电", "cixin",
            "science fiction", "sci-fi", "asimov", "dune", "hyperion", "cyberpunk",
            "科幻", "银河帝国", "沙丘", "基地",
        ],
    },
    {
        category: "文学名著",
        keywords: [
            "classic", "literature", "novel", "pride and prejudice", "gatsby",
            "dostoevsky", "tolstoy", "hemingway", "名著", "文学", "红楼梦", "百年孤独",
        ],
    },
];

function classifyBook(fileName: string): string {
    const lower = fileName.toLowerCase();
    for (const { category, keywords } of CATEGORY_KEYWORDS) {
        if (keywords.some((k) => lower.includes(k))) return category;
    }
    return FALLBACK_CATEGORY;
}

// ── 书名清洗 ──
// Anna's Archive 式长文件名：
//   "251219-Computer Vision_ Algorithms and Applications (Texts in -- Richard Szeliski; ... -- Anna's .pdf"
// 规则：去扩展名 → 去前缀日期(YYMMDD-) → 截断第一个 " -- " 之后（作者/出版社/ISBN/hash）
//       → 去尾部 "(N)" 重复下载序号 → 补回 "_ "→": " → 去尾部未闭合的 "(..." 残段
function cleanTitle(fileName: string): string {
    let t = fileName.replace(/\.(pdf|epub|mobi|md)$/i, "");
    t = t.replace(/^\d{6}[-_ ]+/, "");          // 前缀日期 251219-
    const cut = t.indexOf(" -- ");
    if (cut > 0) t = t.slice(0, cut);            // "--" 后的作者/出版社/ISBN/hash
    t = t.replace(/\s*\(\d+\)\s*$/, "");        // 尾部 "(2)" 下载序号
    t = t.replace(/_\s/g, ": ");                 // Anna's 用 "_ " 替代 ": "
    t = t.replace(/_/g, " ");                    // arXiv 式下划线连词还原为空格
    // 尾部未闭合括号残段（长名被截断产生），如 "... (Texts in"
    const open = t.lastIndexOf("(");
    if (open > 0 && !t.slice(open).includes(")")) t = t.slice(0, open);
    return t.replace(/[-_\s]+$/, "").trim() || fileName;
}

function formatSize(bytes: number): string {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const units = ["B", "KB", "MB", "GB"];
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), units.length - 1);
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + units[i];
}

// 跳过隐藏文件（含 macOS "._" 资源叉）与 .sb-* 等同步临时文件
function isJunk(name: string): boolean {
    return name.startsWith(".") || /\.sb-/i.test(name);
}

// 递归收集一个目录下的书籍文件（限深，论文分类里有 "2015 - ResNet/" 这类子文件夹）
function collectBooks(dir: string, depth = 2): BookItem[] {
    const items: BookItem[] = [];
    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return items;
    }
    for (const entry of entries) {
        if (isJunk(entry.name)) continue;
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (depth > 0) items.push(...collectBooks(fullPath, depth - 1));
            continue;
        }
        const ext = path.extname(entry.name).toLowerCase();
        if (!BOOK_EXTS.has(ext)) continue;
        try {
            const stat = fs.statSync(fullPath);
            items.push({
                title: cleanTitle(entry.name),
                file: entry.name,
                path: fullPath,
                ext: ext.slice(1),
                size: stat.size,
                sizeText: formatSize(stat.size),
            });
        } catch {
            continue; // 读不了就跳过
        }
    }
    return items;
}

// 扫描结果进程内缓存（书架内容对所有用户一致，与身份无关；15s 内多次进入不重复扫盘）。
// 鉴权仍每次校验，缓存只省磁盘 IO。导入书籍后最多 15s 可见，够用。
type ShelfPayload = { 基础分类: Record<string, BookItem[]>; 论文分类: Record<string, BookItem[]> };
const g = globalThis as typeof globalThis & { __shelfScan?: { ts: number; payload: ShelfPayload } };
const SHELF_TTL = 15_000;

export async function GET() {
    // 内容范围守卫：book 栏目需 boss 授权（admin/boss 全开）
    {
        const { getAccess, allows } = await import("@/lib/roles");
        if (!allows(await getAccess(), "book")) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }
    }
    // 缓存命中：跳过扫盘直接回
    if (g.__shelfScan && Date.now() - g.__shelfScan.ts < SHELF_TTL) {
        return NextResponse.json(g.__shelfScan.payload);
    }
    try {
        // ── Section 1：基础分类 ──
        // 5 个分类全部初始化（空分类也渲染空书架）
        const baseCategories: Record<string, BookItem[]> = {};
        for (const cat of BASE_CATEGORIES) baseCategories[cat] = [];

        let bookEntries: fs.Dirent[] = [];
        try {
            bookEntries = fs.readdirSync(BOOK_DIR, { withFileTypes: true });
        } catch {
            // book 目录不存在时全部空书架
        }
        for (const entry of bookEntries) {
            if (isJunk(entry.name)) continue;
            if (entry.isDirectory()) {
                // 子目录名 = 分类；未知子目录名的文件走关键词兜底
                const books = collectBooks(path.join(BOOK_DIR, entry.name), 1);
                if ((BASE_CATEGORIES as readonly string[]).includes(entry.name)) {
                    baseCategories[entry.name].push(...books);
                } else {
                    for (const b of books) baseCategories[classifyBook(b.file)].push(b);
                }
                continue;
            }
            // 根目录散落文件 → 关键词映射兜底
            const ext = path.extname(entry.name).toLowerCase();
            if (!BOOK_EXTS.has(ext)) continue;
            try {
                const fullPath = path.join(BOOK_DIR, entry.name);
                const stat = fs.statSync(fullPath);
                baseCategories[classifyBook(entry.name)].push({
                    title: cleanTitle(entry.name),
                    file: entry.name,
                    path: fullPath,
                    ext: ext.slice(1),
                    size: stat.size,
                    sizeText: formatSize(stat.size),
                });
            } catch {
                continue;
            }
        }
        for (const cat of BASE_CATEGORIES) {
            baseCategories[cat].sort((a, b) => a.title.localeCompare(b.title, "zh-CN"));
        }

        // ── Section 2：论文分类（PAPERS 一级子目录即分类，忽略 index.md 等散文件）──
        const paperCategories: Record<string, BookItem[]> = {};
        let subdirs: fs.Dirent[] = [];
        try {
            subdirs = fs
                .readdirSync(PAPERS_DIR, { withFileTypes: true })
                .filter((e) => e.isDirectory() && !isJunk(e.name));
        } catch {
            // PAPERS 目录不存在时该 section 为空
        }
        for (const sub of subdirs.sort((a, b) => a.name.localeCompare(b.name))) {
            const papers = collectBooks(path.join(PAPERS_DIR, sub.name), 2);
            if (papers.length > 0) {
                papers.sort((a, b) => a.title.localeCompare(b.title, "zh-CN"));
                paperCategories[sub.name] = papers;
            }
        }

        const payload: ShelfPayload = { 基础分类: baseCategories, 论文分类: paperCategories };
        g.__shelfScan = { ts: Date.now(), payload };
        return NextResponse.json(payload);
    } catch (error) {
        console.error("书架扫描失败:", error);
        return NextResponse.json({ error: "书架扫描失败" }, { status: 500 });
    }
}
