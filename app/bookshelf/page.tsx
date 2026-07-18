"use client";

// /bookshelf 书架 —— Apple Books「书库」观感：
//   1. 基础分类：5 个固定图书门类（推理悬疑/科幻/文学名著/科研学术/其他），
//      每类一行"书架"——封面立在浅色搁板上，空分类渲染空书架（后台导入后立刻有位置放）。
//   2. 论文分类：PAPERS 子目录（CV/LLM/NLP/Sys），朴素 A4 文档网格，与书架区分。
// 封面：/api/books/cover 提取真实封面（epub 内嵌图 / pdf 首页渲染），
//       失败或 md/mobi 落生成式封面（分类固定渐变底 + 衬线书名，像素色精装书）。
// 点击路由：epub → /reader/epub，md → /reader/md，pdf/mobi → /api/books/file 新标签。
import { useEffect, useRef, useState } from "react";
import { FetchOutMenu } from "../../components/FetchOutMenu";
import { RandomAddQuiz } from "../../components/RandomAddQuiz";
import { useMe } from "../../components/useMe";

interface BookItem {
    title: string;
    file: string;
    path: string;
    ext: string;
    size: number;
    sizeText: string;
}

interface BooksResponse {
    基础分类: Record<string, BookItem[]>;
    论文分类: Record<string, BookItem[]>;
}

// 与 API 一致的固定门类顺序（前端兜底排序，防 JSON key 顺序意外）
const BASE_ORDER = ["推理悬疑", "科幻", "文学名著", "科研学术", "技术文档", "其他"];

// 生成式封面：每个分类固定一组渐变底色（素色精装书质感）
const COVER_GRADIENTS: Record<string, string> = {
    推理悬疑: "linear-gradient(155deg, #4a2c3e 0%, #331d2b 55%, #1f1119 100%)",
    科幻: "linear-gradient(155deg, #2e3f6e 0%, #1a2344 55%, #10162c 100%)",
    文学名著: "linear-gradient(155deg, #7d4032 0%, #5a2a22 55%, #3a1a15 100%)",
    科研学术: "linear-gradient(155deg, #23566b 0%, #173d4e 55%, #0e2833 100%)",
    技术文档: "linear-gradient(155deg, #2f5d47 0%, #1e4032 55%, #122a20 100%)",
    其他: "linear-gradient(155deg, #6e6057 0%, #4e433c 55%, #332c26 100%)",
};
const DEFAULT_GRADIENT = COVER_GRADIENTS["其他"];

// 封面统一尺寸（书架整齐度 > 真实开本差异）
const COVER_W = 126;
const COVER_H = 178;

function hrefFor(book: BookItem): { href: string; newTab: boolean } {
    const fileUrl = `/api/books/file?path=${encodeURIComponent(book.path)}`;
    if (book.ext === "epub") return { href: `/reader/epub?path=${encodeURIComponent(book.path)}`, newTab: false };
    if (book.ext === "md") return { href: `/reader/md?path=${encodeURIComponent(book.path)}`, newTab: false };
    if (book.ext === "pdf") return { href: `/reader/pdf?path=${encodeURIComponent(book.path)}`, newTab: false };
    return { href: fileUrl, newTab: true }; // mobi 等：下载
}

// ── 圆环进度（Reading Now 大卡 / hero 用）──
function RingProgress({ percent, size = 40 }: { percent: number; size?: number }) {
    const r = size / 2 - 3.5;
    const c = 2 * Math.PI * r;
    const p = Math.max(0, Math.min(100, percent));
    return (
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0">
            <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-line)" strokeWidth={3.5} />
            <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-primary)" strokeWidth={3.5}
                strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - p / 100)}
                transform={`rotate(-90 ${size / 2} ${size / 2})`}
                style={{ transition: "stroke-dashoffset 0.8s cubic-bezier(0.22,1,0.36,1)" }} />
            <text x="50%" y="50%" textAnchor="middle" dominantBaseline="central"
                fontSize={size * 0.28} fontWeight={700} fill="var(--color-text-1)">
                {Math.max(1, Math.round(p))}
            </text>
        </svg>
    );
}

// ── 藏书阁 hero：最近在读封面做环境光晕（页面顶色随你读的书变化）+ 阅读统计 + 继续阅读主卡 ──
function LibraryHero({ current, stats }: {
    current: { book: BookItem; category: string; percent: number } | null;
    stats: { reading: number; finished: number; total: number };
}) {
    const cover = current ? `/api/books/cover?path=${encodeURIComponent(current.book.path)}` : null;
    return (
        <div className="relative mb-7 overflow-hidden rounded-3xl border border-line bg-bg-card">
            {/* 环境光晕：在读封面模糊放大铺底，缓慢漂移；无在读书时给品牌色微光 */}
            {cover ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={cover} alt="" aria-hidden
                    className="hero-ambient pointer-events-none absolute inset-0 h-full w-full object-cover opacity-30 blur-3xl saturate-150 dark:opacity-25" />
            ) : (
                <div className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(120% 160% at 85% 20%, var(--color-accent-glow) 0%, transparent 55%)" }} />
            )}
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-bg-card/95 via-bg-card/70 to-bg-card/30" />

            <div className="relative flex flex-wrap items-center gap-x-10 gap-y-5 px-6 py-6 sm:px-9 sm:py-8">
                {/* 左：标题 + 统计 */}
                <div className="min-w-[240px] flex-1">
                    <h1 className="font-display text-[30px] leading-tight tracking-tight text-text-1 sm:text-[38px]">书架</h1>
                    <p className="mt-2 text-[13px] text-text-3">epub / pdf / markdown 全站内阅读 · AI 陪读</p>
                    <div className="mt-5 flex items-end gap-8">
                        {[
                            { n: stats.reading, label: "在读" },
                            { n: stats.finished, label: "读完" },
                            { n: stats.total, label: "藏书" },
                        ].map((s) => (
                            <div key={s.label}>
                                <div className="font-display text-[26px] leading-none tabular-nums text-text-1">{s.n}</div>
                                <div className="mt-1.5 text-[11px] tracking-[0.2em] text-text-3">{s.label}</div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* 右：继续阅读主卡（真实封面立起来 + 圆环 + 按钮） */}
                {current && (
                    <a href={hrefFor(current.book).href}
                        className="group hidden items-center gap-5 rounded-2xl px-2 py-1 sm:flex">
                        <div style={{ perspective: 700 }}>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={cover!} alt={current.book.title}
                                className="book3d h-[132px] w-auto rounded-md object-cover shadow-[0_10px_24px_rgba(0,0,0,0.30)]"
                                style={{ transform: "rotateY(-8deg)" }} />
                        </div>
                        <div className="max-w-[220px]">
                            <div className="text-[11px] font-semibold tracking-[0.18em] text-primary">继续阅读</div>
                            <div className="mt-1.5 line-clamp-2 text-[15px] font-semibold leading-snug text-text-1">{current.book.title}</div>
                            <div className="mt-3 flex items-center gap-3">
                                <RingProgress percent={current.percent} size={44} />
                                <span className="rounded-full bg-primary px-4 py-1.5 text-[12px] font-medium text-white transition-transform group-hover:scale-105">
                                    翻开 →
                                </span>
                            </div>
                        </div>
                    </a>
                )}
            </div>
        </div>
    );
}

// ── 生成式封面：渐变底 + 居中衬线书名 + 细内边框，像一本素色精装书 ──
function GenerativeCover({ title, category }: { title: string; category: string }) {
    return (
        <div
            className="relative flex flex-col items-center justify-center overflow-hidden rounded-[5px] px-3.5 text-center"
            style={{
                width: COVER_W,
                height: COVER_H,
                background: COVER_GRADIENTS[category] || DEFAULT_GRADIENT,
                boxShadow: "0 4px 10px rgba(0,0,0,0.28), 0 1px 3px rgba(0,0,0,0.22)",
            }}
        >
            {/* 精装书细内边框 */}
            <div className="pointer-events-none absolute inset-[7px] rounded-[3px] border border-white/25" />
            {/* 左侧装订槽 */}
            <div className="pointer-events-none absolute inset-y-0 left-0 w-[7px] bg-gradient-to-r from-black/35 to-transparent" />
            <div
                className="relative line-clamp-6 text-[12.5px] font-medium leading-[1.45] text-white/95"
                style={{ fontFamily: 'Georgia, "Times New Roman", "Songti SC", "Noto Serif SC", serif' }}
            >
                {title}
            </div>
            <div className="absolute bottom-[18px] h-px w-8 bg-white/40" />
            {/* 右侧书页厚度 */}
            <div
                className="pointer-events-none absolute inset-y-0 right-0 w-[3px] rounded-r-[5px]"
                style={{ background: "linear-gradient(90deg, rgba(0,0,0,0.25) 0%, rgba(255,255,255,0.55) 100%)" }}
            />
        </div>
    );
}

// ── 单本书卡：真实封面（cover API）→ 失败落生成式封面；percent = 当前用户阅读进度 ──
function BookCard({ book, category, percent }: { book: BookItem; category: string; percent?: number }) {
    // epub/pdf 才有真实封面可提取；md/mobi 直接生成式封面
    const canHaveCover = book.ext === "epub" || book.ext === "pdf";
    const [coverFailed, setCoverFailed] = useState(false);
    const showImage = canHaveCover && !coverFailed;
    const { href, newTab } = hrefFor(book);

    return (
        <a
            href={href}
            target={newTab ? "_blank" : undefined}
            rel={newTab ? "noreferrer" : undefined}
            title={book.file}
            className="group w-[126px] shrink-0"
        >
            {/* 封面区：底对齐搁板；hover 时封面本体 3D 翻开（.book3d，见 globals） */}
            <div
                className="relative z-[1] flex items-end justify-center"
                style={{ height: COVER_H, perspective: 900 }}
            >
                {/* 阅读进度条：贴在书脚（每用户一份，读过才出现） */}
                {typeof percent === "number" && percent > 0 && (
                    <div className="absolute inset-x-0 bottom-0 z-[2] h-[4px] overflow-hidden rounded-b-[5px] bg-black/30">
                        <div className="h-full bg-primary" style={{ width: `${Math.min(100, percent)}%` }} />
                    </div>
                )}
                {showImage ? (
                    <span className="book3d relative inline-block">
                        <img
                            src={`/api/books/cover?path=${encodeURIComponent(book.path)}`}
                            alt={book.title}
                            loading="lazy"
                            decoding="async"
                            onError={() => setCoverFailed(true)}
                            className="rounded-[5px] object-cover"
                            style={{
                                width: COVER_W,
                                height: COVER_H,
                                boxShadow: "0 4px 10px rgba(0,0,0,0.28), 0 1px 3px rgba(0,0,0,0.22)",
                            }}
                        />
                        {/* 右侧 3px 书页厚度（浅色渐变模拟纸边） */}
                        <span
                            className="pointer-events-none absolute inset-y-0 right-0 w-[3px] rounded-r-[5px]"
                            style={{ background: "linear-gradient(90deg, rgba(0,0,0,0.18) 0%, rgba(255,255,255,0.65) 100%)" }}
                        />
                        {/* 封面高光内描边 */}
                        <span className="pointer-events-none absolute inset-0 rounded-[5px] ring-1 ring-inset ring-black/10" />
                    </span>
                ) : (
                    <span className="book3d inline-block">
                        <GenerativeCover title={book.title} category={category} />
                    </span>
                )}
            </div>

            {/* 搁板占位（12px 板 + 间距）后的书名 + 副行 */}
            <div className="mt-[24px] px-0.5">
                <div className="line-clamp-2 text-[13px] font-medium leading-snug text-text-1 transition-colors group-hover:text-primary">
                    {book.title}
                </div>
                <div className="mt-1 flex items-center gap-1.5 text-[11px] text-text-3">
                    <span className="rounded-[3px] bg-bg-input px-1 py-px font-semibold uppercase tracking-wider">
                        {book.ext}
                    </span>
                    <span>{book.sizeText}</span>
                </div>
            </div>
        </a>
    );
}

// ── 可折叠 section（Apple Books 式）：标题行点击折叠，箭头旋转 + 内容高度/透明度过渡 ──
// 折叠动画用 grid-template-rows 0fr↔1fr（内容自适应高度也能平滑收起）；状态记 localStorage。
function CollapsibleSection({ id, title, subtitle, children, headerSize = 22, forceOpen = false }: {
    id: string; title: string; subtitle: string; children: React.ReactNode; headerSize?: number; forceOpen?: boolean;
}) {
    const [open, setOpen] = useState(true);
    useEffect(() => {
        try { if (localStorage.getItem(`bookshelf-fold:${id}`) === "0") setOpen(false); } catch { /* noop */ }
    }, [id]);
    const toggle = () => {
        setOpen((v) => {
            try { localStorage.setItem(`bookshelf-fold:${id}`, v ? "0" : "1"); } catch { /* noop */ }
            return !v;
        });
    };

    const effOpen = forceOpen || open; // 搜索时强制展开：命中的书不能藏在折叠区里
    return (
        <section id={`sec-${id}`} className="mb-6 scroll-mt-44">
            <button
                type="button"
                onClick={toggle}
                className="group/hd -mx-2 flex w-[calc(100%+16px)] items-baseline gap-3 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-bg-hover"
            >
                {/* 箭头：折叠→ 指右，展开→ 转 90° 指下（Apple Books 同款） */}
                <svg
                    className={`h-[15px] w-[15px] shrink-0 self-center text-text-3 transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${effOpen ? "rotate-90" : "rotate-0"}`}
                    viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}
                >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
                <h2 className="font-bold tracking-tight text-text-1" style={{ fontSize: headerSize }}>{title}</h2>
                <span className="text-[14px] font-medium text-text-3">{subtitle}</span>
            </button>

            <div
                className="grid transition-[grid-template-rows,opacity] ease-[cubic-bezier(0.22,1,0.36,1)]"
                style={{ gridTemplateRows: effOpen ? "1fr" : "0fr", opacity: effOpen ? 1 : 0, transitionDuration: "350ms" }}
            >
                <div className="min-h-0 overflow-hidden">{children}</div>
            </div>
        </section>
    );
}

// ── 书架网格：自动换行的多层书架，每一行书底下都有一条搁板 ──
// 单元格总高固定（封面 178 + 搁板 12 + 书名区 74 = 264），搁板用 repeating-linear-gradient
// 画在容器背景上——不管多少行，每层封面底部都精确落在板上。
const BOARD_H = 12;
const CAPTION_H = 74;
const CELL_H = COVER_H + BOARD_H + CAPTION_H;

function ShelfGrid({ books, category, progress }: { books: BookItem[]; category: string; progress?: Map<string, number> }) {
    const shelfBg = `repeating-linear-gradient(180deg,
        transparent 0px, transparent ${COVER_H - 1}px,
        var(--color-line) ${COVER_H - 1}px, var(--color-bg-card) ${COVER_H}px,
        var(--color-line) ${COVER_H + BOARD_H}px,
        rgba(0,0,0,0.14) ${COVER_H + BOARD_H}px, rgba(0,0,0,0) ${COVER_H + BOARD_H + 12}px,
        transparent ${COVER_H + BOARD_H + 12}px, transparent ${CELL_H}px)`;

    // 入场 stagger：书卡进入视口后按列号错峰浮现（一次性，单 IO 全 grid 共享）
    const gridRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const el = gridRef.current;
        if (!el) return;
        // 无 IntersectionObserver（老浏览器）：直接全部显示，绝不让书隐形
        if (typeof IntersectionObserver === "undefined") {
            el.querySelectorAll(".reveal-item").forEach((c) => c.classList.add("in"));
            return;
        }
        const io = new IntersectionObserver((entries) => {
            for (const en of entries) {
                if (!en.isIntersecting) continue;
                const t = en.target as HTMLElement;
                t.style.transitionDelay = `${(Number(t.dataset.i || 0) % 8) * 40}ms`;
                t.classList.add("in");
                io.unobserve(t);
            }
        }, { rootMargin: "80px" });
        el.querySelectorAll(".reveal-item:not(.in)").forEach((c) => io.observe(c));
        return () => io.disconnect();
    }, [books]);

    return (
        <div
            ref={gridRef}
            className="grid pb-2"
            style={{
                gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
                gridAutoRows: `${CELL_H}px`,
                backgroundImage: shelfBg,
            }}
        >
            {books.length === 0 ? (
                <div className="justify-self-center">
                    <div className="relative z-[1] flex items-end justify-center" style={{ height: COVER_H }}>
                        <div
                            className="flex flex-col items-center justify-center rounded-[5px] border-2 border-dashed border-line text-text-3"
                            style={{ width: COVER_W, height: COVER_H - 6 }}
                        >
                            <svg className="mb-2 h-7 w-7 text-text-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                            </svg>
                            <span className="text-[12px]">暂无藏书</span>
                        </div>
                    </div>
                    <div className="mt-[20px] text-center text-[11px] text-text-4">去后台导入</div>
                </div>
            ) : (
                books.map((b, i) => (
                    <div key={b.path} data-i={i} className="reveal-item justify-self-center">
                        <BookCard book={b} category={category} percent={progress?.get(b.path)} />
                    </div>
                ))
            )}
        </div>
    );
}

// ── 论文分类：朴素 A4 文档网格（白纸质感小卡 + 标题），与书架观感区分 ──
// 论文生成式封面的期刊色带：按研究方向名稳定取色（同组同色）
const PAPER_ACCENTS = ["#4a6fa5", "#7d5ba6", "#3d8a72", "#b3703f", "#8a5a44", "#5a7d8a"];
function paperAccent(key: string): string {
    let h = 0;
    for (const c of key) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return PAPER_ACCENTS[h % PAPER_ACCENTS.length];
}

function PaperCard({ paper, group, percent }: { paper: BookItem; group?: string; percent?: number }) {
    // PDF 优先用真实首页缩略图（cover API 渲染），失败/非 PDF 落期刊风生成式封面
    const [coverFailed, setCoverFailed] = useState(false);
    const showImage = paper.ext === "pdf" && !coverFailed;
    const accent = paperAccent(group || paper.title);

    // 路由与书架完全一致（hrefFor）：pdf/epub/md 全部站内阅读器，mobi 才下载——
    // 之前论文区的 epub/md 被扔去下载，与书架区同格式行为不一致
    const { href, newTab } = hrefFor(paper);
    return (
        <a
            href={href}
            target={newTab ? "_blank" : undefined}
            rel={newTab ? "noreferrer" : undefined}
            title={paper.file}
            className="group"
        >
            <div
                className="relative aspect-[3/4] overflow-hidden rounded-md bg-white ring-1 ring-black/10 transition-transform duration-200 ease-out group-hover:-translate-y-1 group-hover:shadow-[0_8px_18px_rgba(0,0,0,0.15)]"
                style={{ boxShadow: "0 2px 6px rgba(0,0,0,0.10)" }}
            >
                {showImage ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                        src={`/api/books/cover?path=${encodeURIComponent(paper.path)}`}
                        alt={paper.title}
                        loading="lazy"
                        onError={() => setCoverFailed(true)}
                        className="h-full w-full object-cover object-top"
                    />
                ) : (
                    /* 期刊风生成式封面：色带 + 方向名 + 真实标题（serif），不再是假线条 */
                    <div className="absolute inset-0 flex flex-col bg-[#fdfdfb]">
                        <div style={{ height: 6, background: accent }} />
                        <div className="min-h-0 flex-1 px-3 pt-3.5">
                            {group && (
                                <div className="truncate text-[8px] font-bold uppercase tracking-[0.18em]" style={{ color: accent }}>
                                    {group}
                                </div>
                            )}
                            <div
                                className="mt-2 line-clamp-5 text-[11px] font-medium leading-snug text-[#26262a]"
                                style={{ fontFamily: 'Georgia, "Times New Roman", "Songti SC", "Noto Serif SC", serif' }}
                            >
                                {paper.title}
                            </div>
                            <div className="mt-2 h-px w-8" style={{ background: accent, opacity: 0.5 }} />
                        </div>
                        {/* 底部摘要质感行 */}
                        <div className="space-y-[3px] px-3 pb-3">
                            {[100, 88, 94].map((w, i) => (
                                <div key={i} className="h-[2.5px] rounded-full bg-[#e2e2e6]" style={{ width: `${w}%` }} />
                            ))}
                        </div>
                    </div>
                )}
                {/* 折角（hover 翻大一点，像被手指掀起）+ 格式徽章常驻 */}
                <div className="absolute right-0 top-0 h-0 w-0 border-l-[12px] border-t-[12px] border-l-transparent border-t-[#e8e8ec] transition-all duration-200 group-hover:border-l-[20px] group-hover:border-t-[20px] group-hover:border-t-[#dcdce2]" />
                <span className="absolute bottom-2 right-2 rounded-[3px] bg-[#f1f1f4]/90 px-1 py-px text-[9px] font-bold uppercase tracking-wider text-[#7a7a82]">
                    {paper.ext}
                </span>
                {/* 阅读进度条（与书架书卡一致，读过才出现） */}
                {typeof percent === "number" && percent > 0 && (
                    <div className="absolute inset-x-0 bottom-0 h-[3px] overflow-hidden bg-black/15">
                        <div className="h-full bg-primary" style={{ width: `${Math.min(100, percent)}%` }} />
                    </div>
                )}
            </div>
            <div className="mt-2 line-clamp-2 text-[12px] leading-snug text-text-2 transition-colors group-hover:text-primary">
                {paper.title}
            </div>
        </a>
    );
}

function PaperSection(props: { groups: Record<string, BookItem[]>; progress?: Map<string, number>; forceOpen?: boolean }) {
    const entries = Object.entries(props.groups);
    return (
        <section id="sec-papers" className="mt-10 scroll-mt-20 border-t border-line pt-8">
            <div className="mb-4 flex items-baseline gap-3 px-1">
                <h2 className="text-[26px] font-bold tracking-tight text-text-1">论文</h2>
                <span className="text-[14px] font-medium text-text-3">
                    PAPERS 收藏 · 按研究方向目录归类
                </span>
            </div>
            {entries.length === 0 ? (
                <div className="rounded-xl border border-line bg-bg-nav py-10 text-center text-[14px] text-text-3">
                    暂无论文
                </div>
            ) : (
                entries.map(([name, papers]) => (
                    <CollapsibleSection key={name} id={`paper-${name}`} title={name} subtitle={`${papers.length} 篇`} headerSize={17} forceOpen={props.forceOpen}>
                        <div className="grid grid-cols-3 gap-x-5 gap-y-6 pt-1 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-7 xl:grid-cols-8">
                            {papers.map((p) => (
                                <PaperCard key={p.path} paper={p} group={name} percent={props.progress?.get(p.path)} />
                            ))}
                        </div>
                    </CollapsibleSection>
                ))
            )}
        </section>
    );
}

interface ProgressItem { bookPath: string; title: string; percent: number; updatedAt: string; }

// 模块级缓存：跨路由跳转存活（切到书再回来瞬开），整页刷新才清空。
// 只缓存书单（对所有授权用户一致）；阅读进度是【每用户】的，绝不进模块缓存——
// 否则同浏览器换账号会短暂看到上一个人的"正在阅读"。
const shelfCache: { books: BooksResponse | null } = { books: null };

export default function BookshelfPage() {
    // stale-while-revalidate：从模块级缓存拿上次结果先渲染（再进书架瞬开、不再转圈），后台再刷新
    const [data, setData] = useState<BooksResponse | null>(shelfCache.books);
    const [error, setError] = useState<string | null>(null);
    // 阅读进度（每用户一份；未登录返回空数组，界面自然没有进度）
    const [progressItems, setProgressItems] = useState<ProgressItem[]>([]);

    useEffect(() => {
        fetch("/api/books")
            .then((r) => {
                if (r.status === 403) throw new Error("FORBIDDEN");
                if (!r.ok) throw new Error(`HTTP ${r.status}`);
                return r.json();
            })
            .then((d) => { shelfCache.books = d; setData(d); setError(null); })
            .catch((e) => {
                if (e?.message === "FORBIDDEN") {
                    // 未登录/无 book 权限：清掉缓存（防上一个账号的书单残留给游客看），给明确指引
                    shelfCache.books = null;
                    setData(null);
                    setError("没有书架访问权限——请先登录（或找站长开通图书权限）。");
                } else if (!shelfCache.books) {
                    setError("书架加载失败，请稍后重试。");
                }
            });
        fetch("/api/reader-progress")
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => { if (d?.items) setProgressItems(d.items); })
            .catch(() => { /* 无进度不影响书架 */ });
    }, []);

    // 基础分类固定顺序渲染（API 已含全部门类，含空类）——默认排序保持不变
    const baseEntries = data
        ? BASE_ORDER.filter((k) => k in data.基础分类).map((k) => [k, data.基础分类[k]] as const)
        : [];

    // ── 即时搜索：标题/文件名过滤全部分类与论文；搜索时空分类隐藏、正在阅读/已读完收起 ──
    const [query, setQuery] = useState("");
    const q = query.trim().toLowerCase();
    const match = (b: BookItem) => !q || b.title.toLowerCase().includes(q) || b.file.toLowerCase().includes(q);
    const shownBase = q
        ? baseEntries.map(([n, bs]) => [n, bs.filter(match)] as const).filter(([, bs]) => bs.length > 0)
        : baseEntries;
    const shownPapers: Record<string, BookItem[]> = {};
    if (data) {
        for (const [n, ps] of Object.entries(data.论文分类 || {})) {
            const hit = q ? ps.filter(match) : ps;
            if (hit.length > 0) shownPapers[n] = hit;
        }
    }
    const hitCount = q ? shownBase.reduce((s, [, bs]) => s + bs.length, 0) + Object.values(shownPapers).reduce((s, ps) => s + ps.length, 0) : 0;

    // path → percent（书卡进度条用）
    const progressMap = new Map(progressItems.map((p) => [p.bookPath, p.percent]));

    // 「正在阅读」：读过且没读完的书，按最近阅读时间排（API 已按 updated_at DESC 返回）
    // 只收还在书架上的书（progress 里可能有已删除的旧书）
    const allBooks = new Map<string, { book: BookItem; category: string }>();
    if (data) {
        for (const [cat, books] of Object.entries(data.基础分类)) {
            for (const b of books) allBooks.set(b.path, { book: b, category: cat });
        }
        // 论文（PDF）也纳入——现在论文走 /reader/pdf，有进度，应能进「正在阅读 / 已读完」
        for (const [grp, papers] of Object.entries(data.论文分类 || {})) {
            for (const b of papers) if (!allBooks.has(b.path)) allBooks.set(b.path, { book: b, category: grp });
        }
    }
    // Fetch out：外站书单（豆瓣榜单随机添加，点击跳微信读书/豆瓣等合法平台）
    const { me } = useMe();
    const isAdmin = me?.role === "boss" || me?.role === "admin";
    const [extBooks, setExtBooks] = useState<{ id: string; title: string; poster: string | null; overview: string; rating: number | null }[]>([]);
    const [bookQuiz, setBookQuiz] = useState(false);
    const [bookFo, setBookFo] = useState<{ title: string; overview?: string; x: number; y: number } | null>(null);
    const loadExtBooks = () => {
        fetch("/api/external?type=book")
            .then((r) => r.json())
            .then((d) => { if (d.success) setExtBooks(d.data || []); })
            .catch(() => { /* noop */ });
    };
    useEffect(() => { loadExtBooks(); }, []);
    const removeExtBook = async (id: string) => {
        setExtBooks((m) => m.filter((x) => x.id !== id));
        try { await fetch("/api/external", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) }); } catch { /* noop */ }
    };

    const FINISHED = 98; // 读到 98% 以上视为读完（epub 末页百分比常差一两个点）
    const reading = progressItems
        .filter((p) => p.percent < FINISHED && allBooks.has(p.bookPath))
        .slice(0, 12)
        .map((p) => ({ ...allBooks.get(p.bookPath)!, percent: p.percent }));
    const finished = progressItems
        .filter((p) => p.percent >= FINISHED && allBooks.has(p.bookPath))
        .slice(0, 30)
        .map((p) => ({ ...allBooks.get(p.bookPath)!, percent: p.percent }));

    return (
        <div className="w-full text-text-1">
            {bookQuiz && <RandomAddQuiz type="book" onClose={() => setBookQuiz(false)} onDone={loadExtBooks} />}
            {bookFo && <FetchOutMenu title={bookFo.title} overview={bookFo.overview} anchor={{ x: bookFo.x, y: bookFo.y }} kind="book" onClose={() => setBookFo(null)} />}
            {/* 藏书阁 hero：环境光晕随在读的书变色 + 阅读统计 + 继续阅读主卡；数据未到时先简单标题 */}
            {data ? (
                <LibraryHero
                    current={reading[0] || null}
                    stats={{ reading: reading.length, finished: finished.length, total: allBooks.size }}
                />
            ) : (
                <div className="mb-8 px-1">
                    <h1 className="font-display text-[30px] leading-tight tracking-tight text-text-1 sm:text-[38px]">书架</h1>
                    <p className="mt-1 text-[14px] text-text-3">epub / pdf / markdown 全站内阅读 · AI 陪读</p>
                </div>
            )}

            {error && (
                <div className="rounded-xl border border-line bg-bg-nav px-4 py-6 text-center text-[14px] text-text-2">
                    {error}
                </div>
            )}

            {/* 首次加载骨架屏：书架形状的灰块（分类条 + 一排封面），替代干巴巴的转圈 */}
            {!data && !error && (
                <div className="animate-pulse">
                    {[0, 1].map((r) => (
                        <div key={r} className="mb-10">
                            <div className="mb-5 h-6 w-36 rounded-md bg-bg-input" />
                            <div className="flex gap-8 overflow-hidden">
                                {[0, 1, 2, 3, 4, 5].map((i) => (
                                    <div key={i} className="shrink-0">
                                        <div className="rounded-[5px] bg-bg-input" style={{ width: COVER_W, height: COVER_H }} />
                                        <div className="mt-3 h-3 w-24 rounded bg-bg-input" />
                                        <div className="mt-1.5 h-3 w-14 rounded bg-bg-input" />
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {data && (
                <>
                    {/* 搜索 + 分类快跳（sticky 悬浮条，长书架不迷路） */}
                    <div className="sticky top-16 z-30 -mx-1 mb-5 flex flex-wrap items-center gap-2 rounded-xl bg-bg/85 px-1 py-2 backdrop-blur">
                        <div className="relative">
                            <svg className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                                <circle cx="11" cy="11" r="7" /><path strokeLinecap="round" d="M21 21l-4.3-4.3" />
                            </svg>
                            <input
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                                placeholder="搜书名 / 文件名…"
                                className="h-9 w-56 rounded-full border border-line bg-bg-input pl-9 pr-8 text-[13px] text-text-1 outline-none transition-colors placeholder:text-text-3 focus:border-primary sm:w-64"
                            />
                            {query && (
                                <button onClick={() => setQuery("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-3 hover:text-text-1" aria-label="清空">✕</button>
                            )}
                        </div>
                        {q ? (
                            <span className="text-[12px] text-text-3">命中 {hitCount} 本</span>
                        ) : (
                            <div className="flex flex-wrap items-center gap-1.5">
                                {[
                                    ...(reading.length ? [{ id: "reading-now", label: "正在阅读" }] : []),
                                    ...(finished.length ? [{ id: "finished", label: "已读完" }] : []),
                                    ...baseEntries.filter(([, bs]) => bs.length > 0).map(([n]) => ({ id: `base-${n}`, label: n })),
                                    ...(Object.keys(data.论文分类 || {}).length ? [{ id: "papers", label: "论文" }] : []),
                                ].map((t) => (
                                    <button
                                        key={t.id}
                                        onClick={() => document.getElementById(`sec-${t.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" })}
                                        className="rounded-full border border-line px-2.5 py-1 text-[12px] text-text-3 transition-colors hover:border-primary hover:text-primary"
                                    >
                                        {t.label}
                                    </button>
                                ))}
                                {isAdmin && (
                                    <button
                                        onClick={() => setBookQuiz(true)}
                                        className="flex items-center gap-1 rounded-full border border-dashed border-line px-2.5 py-1 text-[12px] text-text-3 transition-colors hover:border-primary hover:text-primary"
                                        title="按口味从中文书榜随机添加 10 本，站内没有就跳外站阅读（管理员）"
                                    >
                                        <svg className="h-3 w-3 fill-current" viewBox="0 0 24 24"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" /></svg>
                                        随机添加
                                    </button>
                                )}
                            </div>
                        )}
                    </div>

                    {/* 外站书单：豆瓣榜单来的推荐，本站没有实体文件，点击跳微信读书/豆瓣读书 */}
                    {!q && extBooks.length > 0 && (
                        <section id="sec-extbooks" className="mb-8">
                            <div className="mb-3 flex items-baseline gap-3">
                                <h2 className="font-display text-[20px] tracking-tight text-text-1">外站书单</h2>
                                <span className="text-[12px] text-text-3">{extBooks.length} 本 · 点封面选平台阅读</span>
                            </div>
                            <div className="ios-scroll scrollbar-hide flex gap-4 overflow-x-auto pb-2">
                                {extBooks.map((b) => (
                                    <div key={b.id} className="group/eb relative w-[104px] shrink-0">
                                        <button onClick={(e) => setBookFo({ title: b.title, overview: b.overview, x: e.clientX, y: e.clientY })} className="block w-full cursor-pointer text-left">
                                            <div className="relative aspect-[3/4.3] w-full overflow-hidden rounded-lg bg-bg-input shadow-[0_4px_10px_rgba(0,0,0,0.18)] transition-transform duration-200 group-hover/eb:-translate-y-1">
                                                {b.poster ? (
                                                    /* eslint-disable-next-line @next/next/no-img-element */
                                                    <img src={b.poster} alt={b.title} loading="lazy" className="h-full w-full object-cover" />
                                                ) : (
                                                    <div className="flex h-full w-full items-center justify-center p-2 text-center text-[12px] text-text-3">{b.title}</div>
                                                )}
                                                <div className="absolute top-1 right-1 rounded-full border border-brand-cyan/70 bg-black/65 px-1.5 py-[2px] text-[9px] font-bold leading-none text-brand-cyan backdrop-blur-[2px]">外站</div>
                                            </div>
                                            <div className="mt-1.5 line-clamp-2 text-[12.5px] font-medium leading-snug text-text-1 transition-colors group-hover/eb:text-primary">{b.title}</div>
                                            {b.rating ? <div className="text-[11px] text-text-3">★ {Number(b.rating).toFixed(1)}</div> : null}
                                        </button>
                                        <button
                                            onClick={(e) => { e.stopPropagation(); void removeExtBook(b.id); }}
                                            aria-label="移除"
                                            className="absolute left-1 top-1 z-10 hidden h-5 w-5 cursor-pointer items-center justify-center rounded-full bg-black/60 text-[12px] text-white/85 hover:bg-black/80 group-hover/eb:flex"
                                        >×</button>
                                    </div>
                                ))}
                            </div>
                        </section>
                    )}

                    {/* 正在阅读：Reading Now 信息大卡（封面 + 圆环进度 + 继续阅读），横滑（搜索时收起） */}
                    {!q && reading.length > 0 && (
                        <CollapsibleSection id="reading-now" title="正在阅读" subtitle={`${reading.length} 本`}>
                            <div className="ios-scroll flex gap-4 overflow-x-auto pb-3 pt-3 scrollbar-hide">
                                {reading.map(({ book, category, percent }) => {
                                    const canCover = book.ext === "epub" || book.ext === "pdf";
                                    return (
                                        <a key={book.path} href={hrefFor(book).href}
                                            className="group flex w-[292px] shrink-0 gap-3.5 rounded-2xl border border-line bg-bg-card p-3.5 transition-all duration-200 hover:-translate-y-1 hover:border-primary/40 hover:shadow-[0_12px_28px_rgba(0,0,0,0.14)]">
                                            {canCover ? (
                                                /* eslint-disable-next-line @next/next/no-img-element */
                                                <img src={`/api/books/cover?path=${encodeURIComponent(book.path)}`} alt={book.title}
                                                    loading="lazy" decoding="async"
                                                    className="h-[118px] w-[84px] shrink-0 rounded-lg object-cover shadow-[0_4px_10px_rgba(0,0,0,0.25)]" />
                                            ) : (
                                                <div className="flex h-[118px] w-[84px] shrink-0 items-center justify-center rounded-lg px-2 text-center text-[10px] leading-snug text-white/95"
                                                    style={{ background: COVER_GRADIENTS[category] || DEFAULT_GRADIENT }}>
                                                    {book.title}
                                                </div>
                                            )}
                                            <div className="flex min-w-0 flex-1 flex-col">
                                                <div className="line-clamp-2 text-[13.5px] font-semibold leading-snug text-text-1 transition-colors group-hover:text-primary">{book.title}</div>
                                                <div className="mt-1 text-[11px] text-text-3">{category}</div>
                                                <div className="mt-auto flex items-center justify-between">
                                                    <RingProgress percent={percent} size={40} />
                                                    <span className="text-[12px] font-medium text-primary opacity-80 transition-opacity group-hover:opacity-100">继续阅读 →</span>
                                                </div>
                                            </div>
                                        </a>
                                    );
                                })}
                            </div>
                        </CollapsibleSection>
                    )}
                    {/* 已读完：读到 98% 以上的书（搜索时收起） */}
                    {!q && finished.length > 0 && (
                        <CollapsibleSection id="finished" title="已读完" subtitle={`${finished.length} 本`}>
                            <div className="flex gap-6 overflow-x-auto pb-3 pt-3 scrollbar-hide">
                                {finished.map(({ book, category }) => (
                                    <div key={book.path} className="flex shrink-0 flex-col items-center">
                                        <BookCard book={book} category={category} percent={100} />
                                        <span className="mt-1 flex items-center gap-1 text-[11px] text-primary">
                                            <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><polyline points="20 6 9 17 4 12" strokeLinecap="round" strokeLinejoin="round" /></svg>
                                            已读完
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </CollapsibleSection>
                    )}
                    {shownBase.map(([name, books]) => (
                        <CollapsibleSection key={name} id={`base-${name}`} title={name} subtitle={`${books.length} 本`} forceOpen={!!q}>
                            <div className="pt-3">
                                <ShelfGrid books={books} category={name} progress={progressMap} />
                            </div>
                        </CollapsibleSection>
                    ))}
                    {(!q || Object.keys(shownPapers).length > 0) && (
                        <PaperSection groups={shownPapers} progress={progressMap} forceOpen={!!q} />
                    )}
                    {q && hitCount === 0 && (
                        <div className="rounded-xl border border-line bg-bg-nav py-14 text-center text-[14px] text-text-3">
                            没有找到「{query.trim()}」——换个关键词试试
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
