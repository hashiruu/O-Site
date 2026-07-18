"use client";

import { useState, useEffect, useRef, use } from "react";
import { useRouter } from "next/navigation";
import { FetchOutMenu } from "../../../components/FetchOutMenu";
import { RandomAddQuiz } from "../../../components/RandomAddQuiz";
import { useMe } from "../../../components/useMe";
import { PageHeader } from "../../../components/PageHeader";

function PlayIcon() { return <svg className="w-[12px] h-[12px]" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>; }

const typeLabels: Record<string, string> = {
    movie: "电影大片",
    series: "人气连续剧",
    anime: "番剧动画",
    travel: "旅行相册",
    private: "私密典藏",
};

export default function CategoryPage({ params }: { params: Promise<{ type: string }> }) {
    const router = useRouter();
    const { type } = use(params);
    const [items, setItems] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    // Fetch out：外站条目（第三态）+ 随机添加问卷 + 跳转菜单
    const canFetchOut = type === "movie" || type === "series" || type === "anime";
    const { me } = useMe();
    const isAdmin = me?.role === "boss" || me?.role === "admin";
    const [extItems, setExtItems] = useState<any[]>([]);
    const [quizOpen, setQuizOpen] = useState(false);
    const [foItem, setFoItem] = useState<{ title: string; overview?: string; x: number; y: number } | null>(null);

    const loadExternal = () => {
        if (!canFetchOut) return;
        fetch(`/api/external?type=${type}`)
            .then((r) => r.json())
            .then((d) => { if (d.success) setExtItems(d.data || []); })
            .catch(() => { /* noop */ });
    };
    useEffect(() => { setExtItems([]); loadExternal(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [type]);

    const removeExternal = async (id: string) => {
        setExtItems((m) => m.filter((x) => x.id !== id));
        try { await fetch("/api/external", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) }); } catch { /* noop */ }
    };

    // 排序状态
    const [sortBy, setSortBy] = useState<"date" | "name" | "ext">("date");
    const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

    // 计算排序后的列表
    const sortedItems = [...items].sort((a, b) => {
        let cmp = 0;
        if (sortBy === "name") {
            cmp = a.title.localeCompare(b.title, "zh-CN");
        } else if (sortBy === "date") {
            // DB 存的是 created_at
            cmp = new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime();
        } else if (sortBy === "ext") {
            const getExt = (p: string) => {
                if (!p) return "";
                const match = p.match(/\.([a-zA-Z0-9]+)$/);
                return match ? match[1].toLowerCase() : "folder";
            };
            cmp = getExt(a.path).localeCompare(getExt(b.path));
        }
        return sortOrder === "asc" ? cmp : -cmp;
    });

    // 授权守卫状态（private + travel 同一套门禁）。
    // 设备信任：验证过口令的设备被种 1 年期 HttpOnly cookie，进页先 GET 查信任态，已信任免输。
    const gated = type === "private" || type === "travel";
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [trustChecked, setTrustChecked] = useState(false);
    const [passwordInput, setPasswordInput] = useState("");
    const [passwordError, setPasswordError] = useState(false);

    useEffect(() => {
        // 切分类重置门禁态；非门禁分类直接放行
        setIsAuthenticated(false);
        setTrustChecked(!gated);
        if (!gated) return;
        const ac = new AbortController();
        fetch("/api/media/private", { signal: ac.signal })
            .then((r) => r.json())
            .then((d) => { if (d.success && d.data?.trusted) setIsAuthenticated(true); })
            .catch(() => { /* 未信任按需输码 */ })
            .finally(() => setTrustChecked(true));
        return () => ac.abort();
    }, [type, gated]);

    // 分块渲染：大分类一次性挂几百张卡片会卡，先渲染一批，滚近底部再补
    const CHUNK = 60;
    const [visibleCount, setVisibleCount] = useState(CHUNK);
    const sentinelRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => { setVisibleCount(CHUNK); }, [type, sortBy, sortOrder]);

    useEffect(() => {
        const el = sentinelRef.current;
        if (!el) return;
        const io = new IntersectionObserver((entries) => {
            if (entries[0].isIntersecting) setVisibleCount((c) => c + CHUNK);
        }, { rootMargin: "800px" });
        io.observe(el);
        return () => io.disconnect();
    }, [loading, items.length, visibleCount]);

    useEffect(() => {
        // 门禁分类（private/travel）先过设备信任/口令，通过后才拉列表（列表 API 服务端也会验 cookie）
        if (gated && !isAuthenticated) return;
        // AbortController：快速切换分类时 abort 旧请求，防慢的旧响应覆盖新结果（报告 #13）
        const ac = new AbortController();
        const load = async () => {
            try {
                // 利用 search 接口或 latest 接口，但 latest 目前限制了 7 个
                // 为了快速实现类别浏览，我们暂时请求一个能全量或者大批量返回数据的路由
                // 或者我们专门造一个 category api。复用 search 也能做到。
                const res = await fetch(type === "travel" ? "/api/media/travel-albums" : `/api/media/category?type=${type}`, { signal: ac.signal });
                const json = await res.json();
                if (json.success) {
                    setItems(json.data);
                }
            } catch (e) {
                if ((e as Error).name !== 'AbortError') console.error(e);
            } finally {
                if (!ac.signal.aborted) setLoading(false);
            }
        };
        load();
        return () => ac.abort();
    }, [type, gated, isAuthenticated]);

    const title = typeLabels[type] || "全部分类";

    // 信任态未查完前不渲染锁屏，避免已信任设备闪一下密码框
    if (gated && !trustChecked) {
        return (
            <div className="w-full h-full flex items-center justify-center pt-24 pb-20">
                <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
        );
    }

    if (gated && !isAuthenticated) {
        return (
            <div className="w-full h-full flex items-center justify-center pt-24 pb-20 fade-in">
                <div className="bg-bg-nav p-8 rounded-2xl shadow-xl shadow-black/10 border border-line flex flex-col items-center max-w-sm w-full mx-4">
                    <div className="w-16 h-16 bg-bili-pink/10 rounded-full flex items-center justify-center mb-5">
                        <svg className="w-8 h-8 text-bili-pink" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
                    </div>
                    <h2 className="text-xl font-medium text-text-1 mb-2">{type === "travel" ? "旅行相册 · 私密空间" : "受保护的私有领域"}</h2>
                    <p className="text-text-3 text-[14px] mb-6 text-center leading-relaxed">{type === "travel" ? "旅行相册已私密化。新设备首次访问需输入一次口令，本设备验证后一年内免输。" : "该分区包含隐私影音库内容，禁止外部访客直连探测。请输入验证口令才能解锁浏览权限。"}</p>

                    <form onSubmit={async (e) => {
                        e.preventDefault();
                        if (!passwordInput) return;
                        try {
                            const res = await fetch('/api/media/private', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ action: 'verify', password: passwordInput })
                            });
                            const data = await res.json();
                            if (data.success) {
                                setIsAuthenticated(true);
                                setPasswordError(false);
                            } else {
                                setPasswordError(true);
                                setTimeout(() => setPasswordError(false), 2000);
                            }
                        } catch (err) {
                            console.error("验证失败", err);
                            setPasswordError(true);
                            setTimeout(() => setPasswordError(false), 2000);
                        }
                    }} className="w-full relative group">
                        <input
                            type="password"
                            value={passwordInput}
                            onChange={(e) => setPasswordInput(e.target.value)}
                            className="w-full h-12 bg-bg-input px-4 rounded-xl border border-line focus:border-bili-pink focus:ring-1 focus:ring-bili-pink transition-all outline-none font-medium placeholder-text-4"
                            placeholder="请输入私密空间保护口令"
                            autoFocus
                        />
                        <button type="submit" className="absolute right-1.5 top-1.5 bottom-1.5 bg-bili-pink text-white px-5 rounded-lg text-sm font-medium hover:bg-bili-pink/90 active:scale-95 transition-all">安全核验</button>
                    </form>
                    {passwordError && <p className="text-red-500 text-[13px] mt-4 flex items-center gap-1 animate-pulse"><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg> 密码错误或凭证失效</p>}
                </div>
            </div>
        );
    }

    return (
        <div className="w-full text-text-1 pb-20">
            {quizOpen && <RandomAddQuiz type={type} onClose={() => setQuizOpen(false)} onDone={loadExternal} />}
            {foItem && <FetchOutMenu title={foItem.title} overview={foItem.overview} anchor={{ x: foItem.x, y: foItem.y }} kind={type} onClose={() => setFoItem(null)} />}
            <div className="w-full">
                <PageHeader
                    title={title}
                    description={`${items.length} 部收录${extItems.length > 0 ? ` · ${extItems.length} 部外站` : ""}`}
                    actions={
                    <div className="flex items-center gap-2 text-[13px]">
                        <span className="text-text-3 mr-1">排序:</span>
                        <div className="flex bg-bg-input rounded-lg p-1 border border-line">
                            {(["date", "name", "ext"] as const).map(option => (
                                <button
                                    key={option}
                                    onClick={() => setSortBy(option)}
                                    className={`px-3 py-1.5 rounded-md transition-colors ${sortBy === option ? "bg-bg-tag text-text-1 font-medium shadow-sm" : "text-text-3 hover:text-text-2"}`}
                                >
                                    {option === "date" ? "时间" : option === "name" ? "名称" : "类型"}
                                </button>
                            ))}
                        </div>
                        <button
                            onClick={() => setSortOrder(prev => prev === "asc" ? "desc" : "asc")}
                            className="p-1.5 rounded-lg border border-line bg-bg-input text-text-2 hover:text-text-1 hover:bg-bg-hover transition-colors flex items-center justify-center w-[34px] h-[34px] ml-1"
                            title={sortOrder === "asc" ? "当前正序" : "当前倒序"}
                        >
                            {sortOrder === "asc" ? (
                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4h13M3 8h9m-9 4h6m4 0l4-4m0 0l4 4m-4-4v12" /></svg>
                            ) : (
                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4h13M3 8h9m-9 4h9m5-4v12m0 0l-4-4m4 4l4-4" /></svg>
                            )}
                        </button>
                    </div>
                    }
                />

                {loading ? (
                    <div className="text-center py-20 text-text-3">正在拉取频道数据...</div>
                ) : items.length === 0 && extItems.length === 0 ? (
                    <div className="text-center py-20">
                        <p className="text-text-3 mb-2">该频道尚无收录内容或等待扫描</p>
                        <div className="flex items-center justify-center gap-4">
                            <button onClick={() => router.push('/admin')} className="text-primary hover:underline text-sm">前往控制台添加映射</button>
                            {canFetchOut && isAdmin && <button onClick={() => setQuizOpen(true)} className="text-primary hover:underline text-sm">＋随机添加外站内容</button>}
                        </div>
                    </div>
                ) : (
                    <>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-x-4 gap-y-6 sm:gap-x-5 sm:gap-y-8 grid-stagger">
                        {/* ＋随机添加：问 3 个口味问题，自动补 10 部不重复的高人气外站内容（仅管理员） */}
                        {canFetchOut && isAdmin && (
                            <button
                                onClick={() => setQuizOpen(true)}
                                className="group flex cursor-pointer flex-col rounded-xl text-left"
                            >
                                <div className="relative flex aspect-[2/3] w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-line bg-bg-input/50 transition-all duration-250 group-hover:-translate-y-1 group-hover:border-primary/60">
                                    <svg className="h-9 w-9 fill-text-3 transition-colors group-hover:fill-primary" viewBox="0 0 24 24"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" /></svg>
                                    <span className="text-[13px] font-medium text-text-3 transition-colors group-hover:text-primary">随机添加</span>
                                    <span className="px-4 text-center text-[11px] leading-relaxed text-text-4">按你的口味补 10 部<br />本站没有就跳外站看</span>
                                </div>
                            </button>
                        )}
                        {sortedItems.slice(0, visibleCount).map(item => {
                            // 判断是否为需要展示长海报/进详情页的类型
                            const isCinemaType = type === "movie" || type === "series" || type === "anime" || type === "travel";

                            // 封面逻辑：优先使用 TMDB 海报，其次使用第一集截图，最后使用文件自身截图
                            const thumbnailPath = item.poster || `/api/media/thumbnail?filePath=${encodeURIComponent(item.firstEpisodePath || item.path)}`;

                            // 点击跳转路由
                            const targetRoute = type === "travel" ? `/travel?album=${encodeURIComponent(item.name)}` : isCinemaType ? `/detail?id=${item.id}` : `/watch?filePath=${encodeURIComponent(item.path)}`;

                            return (
                                <div key={item.id} onClick={() => router.push(targetRoute)} className="group cursor-pointer flex flex-col rounded-xl" style={{ contentVisibility: "auto", containIntrinsicSize: "auto 320px" }}>
                                    <div className={`relative w-full rounded-xl overflow-hidden bg-bg-input border border-transparent group-hover:border-primary/50 transition-[transform,border-color,box-shadow] duration-250 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:-translate-y-1 group-hover:shadow-[0_12px_28px_rgba(0,0,0,0.14)] shadow-sm ${isCinemaType ? 'aspect-[2/3]' : 'aspect-video'}`}>
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        <img
                                            src={thumbnailPath}
                                            alt={item.title}
                                            className="w-full h-full object-cover relative z-10 transition-transform duration-300 group-hover:brightness-105"
                                            loading="lazy"
                                            onError={(e) => { (e.target as HTMLImageElement).src = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjM2YzZjQ2IiBzdHJva2Utd2lkdGg9IjIiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCI+PHJlY3QgeD0iMyIgeT0iMyIgd2lkdGg9IjE4IiBoZWlnaHQ9IjE4IiByeD0iMiIgcnk9IjIiPjwvcmVjdD48Y2lyY2xlIGN4PSI4LjUiIGN5PSI4LjUiIHI9IjEuNSI+PC9jaXJjbGU+PHBvbHlsaW5lIHBvaW50cz0iMjEgMTUgMTYgMTAgNSAyMSI+PC9wb2x5bGluZT48L3N2Zz4='; }}
                                        />
                                        <div className="absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-black/60 to-transparent z-20 pointer-events-none" />
                                        <div className="absolute bottom-1.5 left-2 flex items-center text-white text-[12px] opacity-90 z-20">
                                            <PlayIcon />
                                        </div>
                                        {/* 剧集数量标签 */}
                                        {item.episodeCount > 0 && (
                                            <div className="absolute top-1.5 right-1.5 bg-black/70 text-white text-[11px] px-1.5 py-0.5 rounded z-20 font-medium">
                                                {item.episodeCount}集
                                            </div>
                                        )}
                                        {/* 未收录角标：剧集/动漫库里有条目但一集都没有（点进去没内容）。胶囊形（两端半圆）横排 */}
                                        {(type === "series" || type === "anime") && !item.episodeCount && (
                                            <div className="absolute top-1.5 right-1.5 rounded-full bg-black/65 backdrop-blur-[2px] border border-bili-pink/70 text-bili-pink text-[10px] font-bold px-2.5 py-[3px] leading-none whitespace-nowrap z-20"
                                                title="该剧集尚未收录任何分集">
                                                未收录
                                            </div>
                                        )}
                                    </div>
                                    <div className="mt-2.5 px-1">
                                        <h3 className="text-[14px] sm:text-[15px] font-medium text-text-1 line-clamp-2 leading-snug group-hover:text-primary transition-colors">{item.title}</h3>
                                        <div className="text-[11px] text-text-3 mt-1 truncate">
                                            {type === "travel" ? `${item.date || ""} · ${item.episodeCount || 0}项素材` :
                                                sortBy === "ext" ? (item.path.match(/\.([^.]+)$/) ? item.path.match(/\.([^.]+)$/)[1].toUpperCase() : '文件夹') :
                                                sortBy === "date" ? new Date(item.created_at).toLocaleDateString() : ''}
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                        {/* 外站条目（第三态）：没有本地文件，点击弹 fetch-out 菜单跳合法平台 */}
                        {visibleCount >= sortedItems.length && extItems.map((item) => (
                            <div key={item.id} onClick={(e) => setFoItem({ title: item.title, overview: item.overview, x: e.clientX, y: e.clientY })} className="group cursor-pointer flex flex-col rounded-xl relative">
                                <div className="relative w-full rounded-xl overflow-hidden bg-bg-input border border-transparent group-hover:border-brand-cyan/60 transition-[transform,border-color,box-shadow] duration-250 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:-translate-y-1 group-hover:shadow-[0_12px_28px_rgba(0,0,0,0.14)] shadow-sm aspect-[2/3]">
                                    {item.poster ? (
                                        /* eslint-disable-next-line @next/next/no-img-element */
                                        <img src={item.poster} alt={item.title} loading="lazy" className="w-full h-full object-cover" />
                                    ) : (
                                        <div className="flex h-full w-full items-center justify-center p-3 text-center text-[13px] text-text-3">{item.title}</div>
                                    )}
                                    <div className="absolute top-1.5 right-1.5 rounded-full bg-black/65 backdrop-blur-[2px] border border-brand-cyan/70 text-brand-cyan text-[10px] font-bold px-2.5 py-[3px] leading-none whitespace-nowrap z-20" title="外部站点资源，点击选择平台观看">
                                        外站
                                    </div>
                                    <button
                                        onClick={(e) => { e.stopPropagation(); void removeExternal(item.id); }}
                                        aria-label="移除"
                                        className="absolute left-1.5 top-1.5 z-20 hidden h-6 w-6 cursor-pointer items-center justify-center rounded-full bg-black/60 text-[13px] text-white/85 hover:bg-black/80 group-hover:flex"
                                    >×</button>
                                </div>
                                <div className="mt-2.5 px-1">
                                    <h3 className="text-[14px] sm:text-[15px] font-medium text-text-1 line-clamp-2 leading-snug group-hover:text-primary transition-colors">{item.title}</h3>
                                    <div className="text-[11px] text-text-3 mt-1 truncate">{item.year || ""}{item.rating ? ` · ★ ${Number(item.rating).toFixed(1)}` : ""}</div>
                                </div>
                            </div>
                        ))}
                    </div>
                    {visibleCount < sortedItems.length && (
                        <div ref={sentinelRef} className="py-8 text-center text-text-3 text-sm">加载中…</div>
                    )}
                    </>
                )}
            </div>
        </div>
    );
}
