"use client";

// 全站搜索面板：点顶栏搜索按钮呼出（⌘K 已废除——移动端/Windows 体验不统一），
// 打开时面板从搜索按钮位置平移缩放飞到屏幕中央（FLIP）。
// 全站搜索（影音/书籍/栏目）+ 快捷动作（继续上次/切主题/直达页面），↑↓/Enter/Esc 键盘全导航。
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { HeroSilk } from "./HeroSilk";
import { useTheme } from "./ThemeProvider";

interface MediaHit { kind: "media"; id: string; title: string; type: string; path: string; year: number | null; poster: string | null }
interface BookHit { kind: "book"; title: string; path: string; ext: string; category: string; isPaper: boolean }
interface PageHit { kind: "page"; label: string; href: string }
interface ActionItem { kind: "action"; label: string; hint?: string; icon: string; run: () => void }
type Item = MediaHit | BookHit | PageHit | ActionItem;

const isCinema = (t: string) => t === "movie" || t === "series" || t === "anime";

export function CommandPalette() {
    const router = useRouter();
    const { theme, toggleTheme } = useTheme();
    const [open, setOpen] = useState(false);
    const [q, setQ] = useState("");
    const [results, setResults] = useState<{ media: MediaHit[]; books: BookHit[]; pages: PageHit[] }>({ media: [], books: [], pages: [] });
    const [active, setActive] = useState(0);
    const [cw, setCw] = useState<{ title: string; path: string; poster?: string | null } | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLDivElement>(null);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const close = useCallback(() => { setOpen(false); setQ(""); setResults({ media: [], books: [], pages: [] }); setActive(0); }, []);

    // 触发：顶栏搜索按钮 dispatch("open-cmdk", {detail:{from: DOMRect}})；Esc 关闭
    const fromRef = useRef<DOMRect | null>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
        const onOpen = (e: Event) => {
            fromRef.current = (e as CustomEvent).detail?.from ?? null;
            setOpen(true);
        };
        window.addEventListener("keydown", onKey);
        window.addEventListener("open-cmdk", onOpen);
        return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("open-cmdk", onOpen); };
    }, [close]);

    // FLIP 平移入场：面板先"站"在搜索按钮的位置与大小上，下一帧滑到中央
    useLayoutEffect(() => {
        const el = panelRef.current, from = fromRef.current;
        if (!open || !el || !from) return;
        const to = el.getBoundingClientRect();
        const dx = (from.left + from.width / 2) - (to.left + to.width / 2);
        const dy = (from.top + from.height / 2) - (to.top + to.height / 2);
        const sx = Math.max(0.12, from.width / to.width);
        const sy = Math.max(0.08, from.height / to.height);
        el.style.transition = "none";
        el.style.transform = `translateX(calc(-50% + ${dx}px)) translateY(${dy}px) scale(${sx}, ${sy})`;
        el.style.opacity = "0.4";
        requestAnimationFrame(() => requestAnimationFrame(() => {
            el.style.transition = "transform 0.32s cubic-bezier(0.22,1,0.36,1), opacity 0.25s ease";
            el.style.transform = "translateX(-50%)";
            el.style.opacity = "1";
        }));
        fromRef.current = null;
    }, [open]);

    // 打开时：聚焦输入 + 拉"继续上次"（快捷动作数据）
    useEffect(() => {
        if (!open) return;
        setTimeout(() => inputRef.current?.focus(), 30);
        fetch("/api/media/continue-watching").then((r) => r.json()).then((d) => {
            const first = d?.data?.[0];
            if (first) setCw({ title: first.title, path: first.path, poster: first.poster });
        }).catch(() => { /* noop */ });
    }, [open]);

    // 输入防抖搜索
    useEffect(() => {
        if (!open) return;
        if (debounceRef.current) clearTimeout(debounceRef.current);
        const query = q.trim();
        if (!query) { setResults({ media: [], books: [], pages: [] }); setActive(0); return; }
        debounceRef.current = setTimeout(async () => {
            try {
                const r = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
                const d = await r.json();
                if (d.success && d.data) {
                    setResults({ media: (d.data.media || []).slice(0, 8), books: (d.data.books || []).slice(0, 6), pages: (d.data.pages || []).slice(0, 4) });
                    setActive(0);
                }
            } catch { /* noop */ }
        }, 220);
    }, [q, open]);

    const go = useCallback((href: string) => { close(); router.push(href); }, [close, router]);

    const bookHref = (b: BookHit) => {
        const ext = (b.ext || "").replace(".", "");
        if (ext === "epub") return `/reader/epub?path=${encodeURIComponent(b.path)}`;
        if (ext === "pdf") return `/reader/pdf?path=${encodeURIComponent(b.path)}`;
        if (ext === "md") return `/reader/md?path=${encodeURIComponent(b.path)}`;
        return `/api/books/file?path=${encodeURIComponent(b.path)}`;
    };
    const mediaHref = (m: MediaHit) =>
        isCinema(m.type) ? `/detail?id=${m.id}` : `/watch?filePath=${encodeURIComponent(m.path)}`;

    // 空态快捷动作
    const actions: ActionItem[] = [
        ...(cw ? [{ kind: "action" as const, label: `继续上次 · ${cw.title}`, hint: "接着看", icon: "M8 5v14l11-7z", run: () => go(`/watch?filePath=${encodeURIComponent(cw.path)}`) }] : []),
        {
            kind: "action", label: theme === "dark" ? "切换到日间模式" : "切换到夜间模式", hint: "主题",
            icon: theme === "dark"
                ? "M12 7c-2.76 0-5 2.24-5 5s2.24 5 5 5 5-2.24 5-5-2.24-5-5-5zM2 13h2c.55 0 1-.45 1-1s-.45-1-1-1H2c-.55 0-1 .45-1 1s.45 1 1 1zm18 0h2c.55 0 1-.45 1-1s-.45-1-1-1h-2c-.55 0-1 .45-1 1s.45 1 1 1zM11 2v2c0 .55.45 1 1 1s1-.45 1-1V2c0-.55-.45-1-1-1s-1 .45-1 1zm0 18v2c0 .55.45 1 1 1s1-.45 1-1v-2c0-.55-.45-1-1-1s-1 .45-1 1z"
                : "M12 3a9 9 0 109 9c0-.46-.04-.92-.1-1.36a5.389 5.389 0 01-4.4 2.26 5.403 5.403 0 01-3.14-9.8c-.44-.06-.9-.1-1.36-.1z",
            run: () => { toggleTheme(); },
        },
        { kind: "action", label: "书架", hint: "阅读", icon: "M18 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 4h5v8l-2.5-1.5L6 12V4z", run: () => go("/bookshelf") },
        { kind: "action", label: "观看历史", hint: "记录", icon: "M13 3a9 9 0 00-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42A8.954 8.954 0 0013 21a9 9 0 000-18zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8H12z", run: () => go("/history") },
        { kind: "action", label: "讨论组", hint: "社区", icon: "M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z", run: () => go("/forum") },
        { kind: "action", label: "体育赛程", hint: "世界杯", icon: "M19 5h-2V3H7v2H5c-1.1 0-2 .9-2 2v1c0 2.55 1.92 4.63 4.39 4.94.63 1.5 1.98 2.63 3.61 2.96V19H7v2h10v-2h-4v-3.1c1.63-.33 2.98-1.46 3.61-2.96C19.08 12.63 21 10.55 21 8V7c0-1.1-.9-2-2-2zM5 8V7h2v3.82C5.84 10.4 5 9.3 5 8zm14 0c0 1.3-.84 2.4-2 2.82V7h2v1z", run: () => go("/sports") },
        { kind: "action", label: "热点补课", hint: "Missed", icon: "M13.5.67s.74 2.65.74 4.8c0 2.06-1.35 3.73-3.41 3.73-2.07 0-3.63-1.67-3.63-3.73l.03-.36C5.21 7.51 4 10.62 4 14c0 4.42 3.58 8 8 8s8-3.58 8-8C20 8.61 17.41 3.8 13.5.67zM11.71 19c-1.78 0-3.22-1.4-3.22-3.14 0-1.62 1.05-2.76 2.81-3.12 1.77-.36 3.6-1.21 4.62-2.58.39 1.29.59 2.65.59 4.04 0 2.65-2.15 4.8-4.8 4.8z", run: () => go("/missed") },
    ];

    const hasQuery = q.trim().length > 0;
    const flat: Item[] = hasQuery
        ? [...results.pages, ...results.media, ...results.books]
        : actions;

    const runItem = (it: Item) => {
        if (it.kind === "action") it.run();
        else if (it.kind === "page") go(it.href);
        else if (it.kind === "media") go(mediaHref(it));
        else go(bookHref(it));
    };

    // 键盘导航
    const onInputKey = (e: React.KeyboardEvent) => {
        if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(flat.length - 1, a + 1)); }
        else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
        else if (e.key === "Enter" && flat[active]) { e.preventDefault(); runItem(flat[active]); }
    };
    useEffect(() => {
        listRef.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" });
    }, [active]);

    if (!open) return null;

    let idx = -1;
    const Row = ({ it, icon, title, sub, thumb }: { it: Item; icon?: string; title: string; sub?: string; thumb?: string }) => {
        idx += 1;
        const i = idx;
        return (
            <button
                data-i={i}
                onClick={() => runItem(it)}
                onMouseMove={() => setActive(i)}
                className={`flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors ${
                    i === active ? "bg-primary/12 text-text-1" : "text-text-2 hover:bg-bg-hover"
                }`}
            >
                {thumb ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={thumb} alt="" className="h-9 w-9 shrink-0 rounded-md object-cover" loading="lazy" />
                ) : (
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-bg-input">
                        <svg viewBox="0 0 24 24" className="h-4.5 w-4.5 fill-text-3"><path d={icon} /></svg>
                    </span>
                )}
                <span className="min-w-0 flex-1">
                    <span className="line-clamp-1 text-[14px] font-medium text-text-1">{title}</span>
                    {sub && <span className="line-clamp-1 text-[11.5px] text-text-3">{sub}</span>}
                </span>
                {i === active && <kbd className="shrink-0 rounded border border-line px-1.5 py-0.5 text-[10px] text-text-3">↵</kbd>}
            </button>
        );
    };

    return (
        <div className="cmdk-root fixed inset-0 z-[200]" role="dialog" aria-modal>
            {/* 遮罩 */}
            <div className="absolute inset-0 bg-black/45 backdrop-blur-sm" onClick={close} />
            {/* 面板 */}
            <div ref={panelRef} className="cmdk-panel absolute left-1/2 top-[14vh] w-[640px] max-w-[94vw] -translate-x-1/2 overflow-hidden rounded-2xl border border-line bg-bg-card shadow-[0_24px_80px_rgba(0,0,0,0.35)]" style={{ transformOrigin: "center center" }}>
                {/* 输入行 */}
                <div className="flex items-center gap-3 border-b border-line px-4 py-3.5">
                    <svg className="h-4.5 w-4.5 shrink-0 text-text-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                        <circle cx="11" cy="11" r="7" /><path strokeLinecap="round" d="M21 21l-4.3-4.3" />
                    </svg>
                    <input
                        ref={inputRef}
                        value={q}
                        onChange={(e) => setQ(e.target.value)}
                        onKeyDown={onInputKey}
                        placeholder="搜全站：片名 / 书名 / 栏目…"
                        className="min-w-0 flex-1 bg-transparent text-[15px] text-text-1 outline-none placeholder:text-text-3"
                    />
                    <kbd className="shrink-0 rounded border border-line px-1.5 py-0.5 text-[10px] text-text-3">esc</kbd>
                </div>

                {/* 结果 / 空态 */}
                <div ref={listRef} className="max-h-[52vh] overflow-y-auto p-2">
                    {!hasQuery && (
                        <>
                            {/* 空态丝绸横幅（WebGL 复用） */}
                            <div className="relative mb-2 h-14 overflow-hidden rounded-xl">
                                <HeroSilk className="absolute inset-0" canvasClassName="opacity-80" />
                                <div className="absolute inset-0 flex items-center px-4 text-[13px] font-medium text-text-1">
                                    今天想来点什么？
                                </div>
                            </div>
                            <div className="px-3 pb-1 pt-2 text-[10.5px] font-semibold tracking-[0.2em] text-text-3">快捷动作</div>
                            {actions.map((a) => <Row key={a.label} it={a} icon={a.icon} title={a.label} sub={a.hint} />)}
                        </>
                    )}
                    {hasQuery && flat.length === 0 && (
                        <div className="px-3 py-10 text-center text-[13px] text-text-3">没有找到「{q.trim()}」</div>
                    )}
                    {hasQuery && results.pages.length > 0 && (
                        <>
                            <div className="px-3 pb-1 pt-2 text-[10.5px] font-semibold tracking-[0.2em] text-text-3">栏目</div>
                            {results.pages.map((p) => <Row key={p.href} it={p} icon="M12 4l-1.41 1.41L16.17 11H4v2h12.17l-5.58 5.59L12 20l8-8z" title={p.label} sub={p.href} />)}
                        </>
                    )}
                    {hasQuery && results.media.length > 0 && (
                        <>
                            <div className="px-3 pb-1 pt-2 text-[10.5px] font-semibold tracking-[0.2em] text-text-3">影音</div>
                            {results.media.map((m) => (
                                <Row key={m.id} it={m}
                                    thumb={m.poster || `/api/media/thumbnail?filePath=${encodeURIComponent(m.path)}`}
                                    title={m.title} sub={`${m.type}${m.year ? ` · ${m.year}` : ""}`} />
                            ))}
                        </>
                    )}
                    {hasQuery && results.books.length > 0 && (
                        <>
                            <div className="px-3 pb-1 pt-2 text-[10.5px] font-semibold tracking-[0.2em] text-text-3">书籍 · 论文</div>
                            {results.books.map((b) => (
                                <Row key={b.path} it={b} icon={b.isPaper
                                    ? "M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"
                                    : "M18 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 4h5v8l-2.5-1.5L6 12V4z"} title={b.title}
                                    sub={`${b.category}${b.ext ? ` · ${b.ext}` : ""}`} />
                            ))}
                        </>
                    )}
                </div>

                {/* 底部提示条 */}
                <div className="flex items-center gap-4 border-t border-line px-4 py-2 text-[10.5px] text-text-3">
                    <span><kbd className="rounded border border-line px-1">↑↓</kbd> 选择</span>
                    <span><kbd className="rounded border border-line px-1">↵</kbd> 打开</span>
                    <span className="ml-auto">点顶栏搜索随时呼出</span>
                </div>
            </div>

            {/* 原生 CSS 入场：@starting-style（2026 基线特性，零 JS 动画） */}
            <style>{`
                .cmdk-root { opacity: 1; transition: opacity 0.18s ease; }
                .cmdk-panel { transform: translateX(-50%) scale(1); opacity: 1; transition: transform 0.22s cubic-bezier(0.22,1,0.36,1), opacity 0.2s ease; }
                @starting-style {
                    .cmdk-root { opacity: 0; }
                    .cmdk-panel { transform: translateX(-50%) scale(0.96) translateY(8px); opacity: 0; }
                }
                @media (prefers-reduced-motion: reduce) {
                    .cmdk-root, .cmdk-panel { transition: none; }
                }
            `}</style>
        </div>
    );
}
