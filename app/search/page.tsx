"use client";
import { useState, useEffect, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useMe } from "@/components/useMe";
import { LoginGate } from "@/components/LoginGate";

// 合法 svg 占位（旧版 base64 不是合法 data URL，会触发 onError 死循环）
const FALLBACK_IMG = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjM2YzZjQ2IiBzdHJva2Utd2lkdGg9IjIiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCI+PHJlY3QgeD0iMyIgeT0iMyIgd2lkdGg9IjE4IiBoZWlnaHQ9IjE4IiByeD0iMiIgcnk9IjIiPjwvcmVjdD48Y2lyY2xlIGN4PSI4LjUiIGN5PSI4LjUiIHI9IjEuNSI+PC9jaXJjbGU+PHBvbHlsaW5lIHBvaW50cz0iMjEgMTUgMTYgMTAgNSAyMSI+PC9wb2x5bGluZT48L3N2Zz4=';

const typeCaption: Record<string, string> = {
    movie: "电影", series: "剧集", anime: "动漫", travel: "旅行相册", private: "私密",
};

// 全站搜索 tab（旅行相册不进搜索范围，私人内容不做检索面）
const TABS = [
    { key: "all", label: "全部" },
    { key: "media", label: "影音" },
    { key: "book", label: "书籍" },
    { key: "page", label: "栏目" },
] as const;
type TabKey = typeof TABS[number]["key"];

type MediaHit = { kind: "media"; id: string; title: string; type: string; path: string; year: number | null; poster: string | null; overview: string | null; };
type BookHit = { kind: "book"; title: string; file: string; path: string; ext: string; category: string; isPaper: boolean; };
type AlbumHit = { kind: "album"; name: string; title: string; path: string; };
type PageHit = { kind: "page"; label: string; href: string; };
type SearchData = { media: MediaHit[]; books: BookHit[]; albums: AlbumHit[]; pages: PageHit[]; };

function hrefForMedia(h: MediaHit): string {
    if (h.type === "series" || h.type === "anime") return `/detail?id=${h.id}`;
    return `/watch?filePath=${encodeURIComponent(h.path)}`;
}
function hrefForBook(h: BookHit): string {
    const p = encodeURIComponent(h.path);
    if (h.ext === "epub") return `/reader/epub?path=${p}`;
    if (h.ext === "md") return `/reader/md?path=${p}`;
    return `/api/books/file?path=${p}`;
}

// 书籍封面：优先真实封面（epub 内嵌图 / pdf 首页），失败或 md/mobi 落生成式书脊。
// 尺寸与书架一致（统一 2:3 比例，避免大小不一）。
function BookCover({ book }: { book: BookHit }) {
    const canHaveReal = book.ext === "epub" || book.ext === "pdf";
    const [failed, setFailed] = useState(false);
    const showReal = canHaveReal && !failed;
    return (
        <div className="relative aspect-[2/3] w-full overflow-hidden rounded-[5px] border border-line transition-transform duration-200 group-hover:-translate-y-1 group-hover:border-primary/50"
            style={{ background: showReal ? "var(--color-bg-input)" : book.isPaper ? "linear-gradient(155deg,#fafafa,#e8e8ec)" : "linear-gradient(155deg,var(--color-bg-card),var(--color-bg-hover))" }}>
            {showReal ? (
                <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                        src={`/api/books/cover?path=${encodeURIComponent(book.path)}`}
                        alt={book.title} loading="lazy"
                        className="h-full w-full object-cover"
                        onError={() => setFailed(true)}
                    />
                    {/* 右侧 3px 书页厚度（真实封面才贴纸边） */}
                    <span className="pointer-events-none absolute inset-y-0 right-0 w-[3px]"
                        style={{ background: "linear-gradient(90deg,rgba(0,0,0,0.18),rgba(255,255,255,0.65))" }} />
                </>
            ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center px-2.5 text-center">
                    <span className="line-clamp-5 text-[11.5px] font-medium leading-snug text-text-1">{book.title}</span>
                </div>
            )}
            <span className="absolute right-1 top-1 rounded-[3px] bg-black/55 px-1 py-px text-[9px] font-bold uppercase text-white">{book.ext}</span>
        </div>
    );
}

export default function SearchPage() {
    return <Suspense fallback={<div className="py-20 text-center text-text-3">加载中...</div>}><SearchContent /></Suspense>;
}

const SEARCH_HISTORY_KEY = "nas-search-history";
const MAX_HISTORY = 10;
function loadHistory(): string[] { try { const r = localStorage.getItem(SEARCH_HISTORY_KEY); return r ? JSON.parse(r) : []; } catch { return []; } }
function saveHistory(q: string): string[] {
    const t = q.trim(); if (!t) return loadHistory();
    const next = [t, ...loadHistory().filter(h => h !== t)].slice(0, MAX_HISTORY);
    try { localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(next)); } catch { /* */ }
    return next;
}
function removeHistory(q: string): string[] {
    const next = loadHistory().filter(h => h !== q);
    try { localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(next)); } catch { /* */ }
    return next;
}

function SectionHeader({ label, count }: { label: string; count: number }) {
    return (
        <div className="mb-3 mt-7 flex items-baseline gap-2.5 first:mt-0">
            <h2 className="text-[17px] font-semibold text-text-1">{label}</h2>
            <span className="text-[13px] text-text-3">{count} 项</span>
        </div>
    );
}

function SearchContent() {
    const searchParams = useSearchParams();
    const router = useRouter();
    const q = searchParams.get("q") || "";
    const me = useMe(); // 铁律：未登录搜索是摆设 → 结果页只出登录门

    const [data, setData] = useState<SearchData | null>(null);
    const [loading, setLoading] = useState(true);
    const [history, setHistory] = useState<string[]>([]);
    const [activeTab, setActiveTab] = useState<TabKey>("all");

    useEffect(() => { setHistory(loadHistory()); }, []);

    useEffect(() => {
        if (!q.trim()) { setData(null); setLoading(false); return; }
        setLoading(true);
        const ac = new AbortController();
        const timer = setTimeout(async () => {
            try {
                const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: ac.signal });
                const json = await res.json();
                if (json.success) {
                    setData(json.data);
                    setHistory(saveHistory(q));
                }
            } catch (e) {
                if ((e as Error).name !== 'AbortError') console.error(e);
            } finally {
                if (!ac.signal.aborted) setLoading(false);
            }
        }, 250);
        return () => { ac.abort(); clearTimeout(timer); };
    }, [q]);

    const media = data?.media ?? [];
    const books = data?.books ?? [];
    const albums = data?.albums ?? [];
    const pages = data?.pages ?? [];
    const total = media.length + books.length + albums.length + pages.length;

    const showSection = (key: string) => activeTab === "all" || activeTab === key;

    // 未登录：搜索是摆设（后端同样 401，不查任何源）
    if (!me.loggedIn) return me.loading ? null : <LoginGate feature="全站搜索" />;

    return (
        <div className="w-full pb-20">
            {/* 顶部 tab */}
            <div className="mb-6 flex gap-6 border-b border-line">
                {TABS.map(t => (
                    <button key={t.key} onClick={() => setActiveTab(t.key)}
                        className={`relative cursor-pointer pb-3 text-[14px] transition-colors ${activeTab === t.key ? "font-medium text-primary" : "text-text-2 hover:text-text-1"}`}>
                        {t.label}
                        {activeTab === t.key && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />}
                    </button>
                ))}
                {q.trim() && !loading && (
                    <span className="ml-auto self-center pb-3 text-[13px] text-text-3">与 “{q}” 相关 {total} 项</span>
                )}
            </div>

            {!q.trim() ? (
                <div className="py-12">
                    <div className="mb-10 text-center text-text-3">
                        <svg className="mx-auto mb-4 h-24 w-24 text-text-4 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607z" />
                        </svg>
                        <p className="text-lg font-medium text-text-2">想看点什么？</p>
                        <p className="mt-1 text-sm opacity-60">影音 / 书籍 / 旅行相册 / 栏目，全站一键搜</p>
                    </div>
                    {history.length > 0 && (
                        <div className="mx-auto max-w-2xl">
                            <div className="mb-3 flex items-center justify-between px-1">
                                <h3 className="text-[13px] text-text-3">最近搜索</h3>
                                <button onClick={() => { try { localStorage.removeItem(SEARCH_HISTORY_KEY); } catch { /* */ } setHistory([]); }}
                                    className="cursor-pointer text-[12px] text-text-3 transition-colors hover:text-primary">清空</button>
                            </div>
                            <div className="flex flex-wrap gap-2">
                                {history.map(h => (
                                    <div key={h} className="inline-flex items-center overflow-hidden rounded-full border border-line bg-bg-tag transition-colors hover:border-primary/40">
                                        <button onClick={() => router.push(`/search?q=${encodeURIComponent(h)}`)}
                                            className="cursor-pointer px-3.5 py-1.5 text-[13px] text-text-2 transition-colors hover:text-primary">{h}</button>
                                        <button onClick={() => setHistory(removeHistory(h))}
                                            className="cursor-pointer border-l border-line px-2 py-1.5 text-[14px] leading-none text-text-3 transition-colors hover:bg-primary hover:text-white" title="移除">×</button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            ) : loading ? (
                <div className="py-20 text-center text-text-3">正在检索…</div>
            ) : total === 0 ? (
                <div className="py-20 text-center text-text-3">
                    <svg className="mx-auto mb-4 h-20 w-20 text-text-4 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    未能找到匹配 “{q}” 的内容
                </div>
            ) : (
                <div>
                    {/* 栏目入口（最短决策路径，置顶） */}
                    {showSection("page") && pages.length > 0 && (
                        <>
                            <SectionHeader label="栏目" count={pages.length} />
                            <div className="flex flex-wrap gap-2">
                                {pages.map(p => (
                                    <Link key={p.href} href={p.href}
                                        className="flex items-center gap-2 rounded-full border border-line bg-bg-card px-4 py-2 text-[14px] text-text-1 transition-all hover:-translate-y-0.5 hover:border-primary hover:text-primary">
                                        <span className="text-primary">→</span>{p.label}
                                    </Link>
                                ))}
                            </div>
                        </>
                    )}

                    {/* 影音 */}
                    {showSection("media") && media.length > 0 && (
                        <>
                            <SectionHeader label="影音" count={media.length} />
                            <div className="space-y-4">
                                {media.map(item => (
                                    <Link key={item.id} href={hrefForMedia(item)} className="group flex gap-4">
                                        <div className="relative aspect-video w-[200px] shrink-0 overflow-hidden rounded-md bg-bg-input">
                                            {/* eslint-disable-next-line @next/next/no-img-element */}
                                            <img
                                                src={item.poster || `/api/media/thumbnail?filePath=${encodeURIComponent(item.path)}`}
                                                alt={item.title} loading="lazy"
                                                className="h-full w-full object-cover transition-[filter] duration-200 group-hover:brightness-105"
                                                onError={(e) => { const img = e.target as HTMLImageElement; if (img.dataset.fallback) return; img.dataset.fallback = "1"; img.src = FALLBACK_IMG; }}
                                            />
                                        </div>
                                        <div className="min-w-0 flex-1 pt-0.5">
                                            <h3 className="line-clamp-2 text-[15px] leading-[22px] text-text-1 transition-colors group-hover:text-primary">{item.title}</h3>
                                            <div className="mt-1.5 text-[13px] text-text-3">
                                                {typeCaption[item.type] || item.type}{item.year ? ` · ${item.year}` : ""}
                                            </div>
                                            {item.overview && <p className="mt-2 line-clamp-1 text-[13px] text-text-2">{item.overview}</p>}
                                        </div>
                                    </Link>
                                ))}
                            </div>
                        </>
                    )}

                    {/* 书籍 */}
                    {showSection("book") && books.length > 0 && (
                        <>
                            <SectionHeader label={books.some(b => b.isPaper) ? "书籍 / 论文" : "书籍"} count={books.length} />
                            <div className="grid grid-cols-3 gap-x-4 gap-y-5 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8">
                                {books.map(b => (
                                    <Link key={b.path} href={hrefForBook(b)} target={b.ext === "pdf" || b.ext === "mobi" ? "_blank" : undefined}
                                        className="group flex flex-col">
                                        <BookCover book={b} />
                                        <div className="mt-2 line-clamp-2 text-[12.5px] leading-snug text-text-1 transition-colors group-hover:text-primary">{b.title}</div>
                                        <div className="mt-0.5 text-[11px] text-text-3 truncate">{b.isPaper ? "论文" : b.category}</div>
                                    </Link>
                                ))}
                            </div>
                            {/* Fetch out：本站书不够？去 Internet Archive 接着搜 */}
                            {q.trim() && (
                                <div className="mt-3">
                                    <a
                                        href={`https://archive.org/search?query=${encodeURIComponent(q.trim())}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-line bg-bg-card px-4 py-1.5 text-[12.5px] text-text-2 transition-all hover:-translate-y-px hover:border-primary/50 hover:text-primary"
                                    >
                                        在 Internet Archive 搜索「{q.trim()}」
                                        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6m4-3h6m0 0v6m0-6L10 14" />
                                        </svg>
                                    </a>
                                </div>
                            )}
                        </>
                    )}

                    {/* 旅行相册不进搜索范围（私人内容不做检索面） */}
                </div>
            )}
        </div>
    );
}
