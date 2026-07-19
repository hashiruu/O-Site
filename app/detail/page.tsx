"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { Suspense, useEffect, useState, useCallback } from "react";
import { BiliComments } from "../../components/BiliComments";

// 外链图统一走同源代理(TMDB 直链在部分网络/Chrome 下偶发加载失败,首页同款铁律)
const proxyImg = (u?: string | null) => (u && /^https?:\/\//.test(u) ? `/api/discover/img?u=${encodeURIComponent(u)}` : u || "");

function DetailContent() {
    const searchParams = useSearchParams();
    const router = useRouter();
    const id = searchParams.get("id");

    const [data, setData] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [activeSeason, setActiveSeason] = useState<number>(1);
    // 重新刮削（修正错误匹配，如 House M.D.）
    const [rescrapeOpen, setRescrapeOpen] = useState(false);
    const [candidates, setCandidates] = useState<any[]>([]);
    const [rescrapeLoading, setRescrapeLoading] = useState(false);
    const [rescraping, setRescraping] = useState(false);
    const [showFullOverview, setShowFullOverview] = useState(false);
    const [similarItems, setSimilarItems] = useState<any[]>([]);

    useEffect(() => {
        if (!id) return;
        // AbortController：快速切换详情时 abort 旧请求，防慢的旧响应覆盖新结果（报告 #13）
        const ac = new AbortController();
        setLoading(true);
        fetch(`/api/media/detail?id=${id}`, { signal: ac.signal })
            .then(res => res.json())
            .then(res => {
                if (res.success) {
                    setData(res.data);
                    if (res.data.episodes && res.data.episodes.length > 0) {
                        const seasons = Array.from(new Set(res.data.episodes.map((e: any) => e.season))) as number[];
                        setActiveSeason(seasons[0]);
                    }
                }
            })
            .catch(err => { if ((err as Error).name !== 'AbortError') console.error(err); })
            .finally(() => { if (!ac.signal.aborted) setLoading(false); });
        return () => ac.abort();
    }, [id]);

    useEffect(() => {
        if (!data?.path) return;
        setSimilarItems([]);
        fetch('/api/media/recommend?context=' + encodeURIComponent(data.path) + '&exclude=' + encodeURIComponent(data.path) + '&limit=12')
            .then(r => r.json())
            .then(j => { if (j.success && Array.isArray(j.data)) setSimilarItems(j.data); })
            .catch(() => {});
    }, [data?.path]);

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] text-text-3">
                <div className="relative w-12 h-12">
                    <div className="absolute inset-0 rounded-full border-2 border-line" />
                    <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-bili-pink animate-spin" />
                </div>
                <p className="mt-5 text-sm text-text-3">加载中...</p>
            </div>
        );
    }

    if (!data) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[50vh] text-text-3">
                <p className="text-lg font-medium text-text-2">未找到该影片记录</p>
                <button onClick={() => router.back()} className="mt-6 px-6 py-2 rounded-md bg-bili-pink text-white font-medium text-sm">返回</button>
            </div>
        );
    }

    const seasons = data.episodes ? Array.from(new Set(data.episodes.map((e: any) => e.season))).sort((a: any, b: any) => a - b) as number[] : [];
    const currentEpisodes = data.episodes ? data.episodes.filter((e: any) => e.season === activeSeason).sort((a: any, b: any) => a.episode - b.episode) : [];

    const formatDuration = (seconds: number): string => {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        if (h > 0) return h + '小时' + (m > 0 ? m + '分' : '');
        return m + '分钟';
    };

    const typeLabel = data.type === 'movie' ? '电影' : data.type === 'anime' ? '番剧' : '剧集';

    // 解析 metadata（genres / cast，由重新刮削写入）
    const meta: any = (() => { try { return data.metadata ? JSON.parse(data.metadata) : {}; } catch { return {}; } })();

    const openRescrape = async () => {
        setRescrapeOpen(true);
        setRescrapeLoading(true);
        setCandidates([]);
        try {
            const r = await fetch(`/api/media/rescrape?query=${encodeURIComponent(data.title)}`);
            const j = await r.json();
            if (j.success) setCandidates(j.data);
        } catch (e) { console.error(e); }
        finally { setRescrapeLoading(false); }
    };

    const doRescrape = async (c: any) => {
        setRescraping(true);
        try {
            const r = await fetch('/api/media/rescrape', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mediaId: id, tmdbId: c.tmdbId, mediaType: c.mediaType })
            });
            const j = await r.json();
            if (j.success) {
                // 合并新刮削数据 + 重解 metadata
                const newMeta = j.data.metadata ? JSON.parse(j.data.metadata) : meta;
                setData({ ...data, poster: j.data.poster, backdrop: j.data.backdrop, overview: j.data.overview, year: j.data.year, rating: j.data.rating, metadata: j.data.metadata });
                (meta as any).genres = newMeta.genres; (meta as any).cast = newMeta.cast;
                setRescrapeOpen(false);
            } else {
                alert(j.error || '刮削失败');
            }
        } catch (e) { console.error(e); alert('刮削请求失败'); }
        finally { setRescraping(false); }
    };

    return (
        <div className="w-full text-text-1 pb-20">

            {/* ========== 影院 Hero：全幅 backdrop + 底部渐融 + 海报悬浮 ========== */}
            <section className="relative -mt-6 lg:-mt-8">
                {/* 全幅背景：backdrop 铺满、往下渐融进页面底色（无 backdrop 时品牌色氛围） */}
                <div className="absolute inset-x-0 top-0 h-[420px] overflow-hidden md:h-[480px]">
                    {data.backdrop ? (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img src={proxyImg(data.backdrop)} className="h-full w-full object-cover object-top" alt="" />
                    ) : (
                        <div className="h-full w-full" style={{ background: "radial-gradient(90% 120% at 70% 0%, var(--color-accent-glow) 0%, transparent 60%)" }} />
                    )}
                    <div className="absolute inset-0 bg-black/15" />
                    <div className="absolute inset-0 bg-gradient-to-t from-bg via-bg/80 to-bg/20" />
                    <div className="absolute inset-0 bg-gradient-to-r from-bg/90 via-transparent to-transparent" />
                </div>

                <div className="relative mx-auto max-w-[1200px] px-0 pt-40 md:pt-52">
                    <div className="flex flex-col gap-6 sm:flex-row md:gap-10">
                        {/* 左：悬浮海报（压在 backdrop 与内容区交界上，立体感的来源） */}
                        <div className="mx-auto w-[46%] shrink-0 sm:mx-0 sm:w-[190px] md:w-[230px] lg:w-[260px]">
                            <div className="aspect-[2/3] w-full overflow-hidden rounded-xl bg-bg-input shadow-[0_18px_50px_rgba(0,0,0,0.45)] ring-1 ring-white/15">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                    src={proxyImg(data.poster) || '/placeholder-poster.png'}
                                    className="h-full w-full object-cover"
                                    alt={data.title}
                                    onError={(e) => { (e.target as HTMLImageElement).src = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjM2YzZjQ2IiBzdHJva2Utd2lkdGg9IjIiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCI+PHJlY3QgeD0iMyIgeT0iMyIgd2lkdGg9IjE4IiBoZWlnaHQ9IjE4IiByeD0iMiIgcnk9IjIiPjwvcmVjdD48Y2lyY2xlIGN4PSI4LjUiIGN5PSI4LjUiIHI9IjEuNSI+PC9jaXJjbGU+PHBvbHlsaW5lIHBvaW50cz0iMjEgMTUgMTYgMTAgNSAyMSI+PC9wb2x5bGluZT48L3N2Zz4='; }}
                                />
                            </div>
                        </div>

                        {/* 右：信息区（标题压在 backdrop 下缘,自带投影保证可读） */}
                        <div className="flex min-w-0 flex-1 flex-col text-center sm:text-left">
                            <button onClick={() => router.back()} className='mb-4 self-start flex items-center gap-1 text-[13px] text-text-3 transition-colors hover:text-text-1 cursor-pointer sm:mb-3'>
                                <svg className='h-4 w-4' fill='none' stroke='currentColor' strokeWidth={2} viewBox='0 0 24 24'><path strokeLinecap='round' strokeLinejoin='round' d='M10 19l-7-7m0 0l7-7m-7 7h18' /></svg>
                                返回
                            </button>
                            <h1 className="mb-3 font-display text-[30px] leading-tight tracking-tight text-text-1 drop-shadow-sm md:mb-4 md:text-[40px]">
                                {data.title}
                            </h1>

                            {/* 元信息行：· 分隔的一行小字，比一排边框标签清爽 */}
                            <div className="mb-4 flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1 text-[13px] text-text-2 sm:justify-start md:mb-5">
                                <span className="font-semibold text-primary">{typeLabel}</span>
                                {data.year && <><span className="text-text-4">·</span><span>{data.year}</span></>}
                                {data.rating && (
                                    <>
                                        <span className="text-text-4">·</span>
                                        <span className="flex items-center gap-1 font-semibold text-[#f5c518]">
                                            <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" /></svg>
                                            {data.rating.toFixed(1)}
                                        </span>
                                    </>
                                )}
                                {data.episodes && <><span className="text-text-4">·</span><span>共 {data.episodes.length} 集</span></>}
                                {data.type === 'movie' && data.duration && data.duration > 0 && (
                                    <><span className='text-text-4'>·</span><span>{formatDuration(data.duration)}</span></>
                                )}
                                {meta?.genres?.length > 0 && (
                                    <>
                                        <span className="text-text-4">·</span>
                                        <span className="text-text-3">{meta.genres.slice(0, 3).join(" / ")}</span>
                                    </>
                                )}
                            </div>

                            {/* 简介：裸文字（去掉框中框），行首缩进呼吸感 */}
                            <div className='mb-6 max-w-3xl'>
                                <p className={'text-[14px] leading-[1.9] text-text-2 md:text-[15px] ' + (showFullOverview ? '' : 'line-clamp-2')}>
                                    {data.overview || "暂无该影片的剧情简介。可在设置中配置 TMDB API 后触发扫描获取。"}
                                </p>
                                {data.overview && data.overview.length > 80 && (
                                    <button
                                        onClick={() => setShowFullOverview(v => !v)}
                                        className='mt-1 text-[12px] text-primary cursor-pointer hover:opacity-80'
                                    >
                                        {showFullOverview ? '收起' : '展开'}
                                    </button>
                                )}
                            </div>

                            {/* 操作行：主按钮豪华化 + 次按钮弱化为文字钮 */}
                            <div className="mt-auto flex flex-wrap items-center justify-center gap-3 sm:justify-start">
                                {data.type === 'movie' || !data.episodes || data.episodes.length === 0 ? (
                                    <button
                                        onClick={() => router.push(`/watch?filePath=${encodeURIComponent(data.path)}`)}
                                        className="flex cursor-pointer items-center gap-2 rounded-full bg-primary px-7 py-3 text-[15px] font-semibold text-white shadow-[0_8px_24px_rgba(240,120,74,0.35)] transition-all hover:scale-[1.03] hover:bg-primary-hover active:scale-[0.98]"
                                    >
                                        <svg className="h-4.5 w-4.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
                                        {data.lastWatched && data.lastWatched.position > 5 ? '继续播放' : '立即播放'}
                                    </button>
                                ) : (
                                    <button
                                        onClick={() => {
                                            if (data.lastWatched) {
                                                router.push(`/watch?filePath=${encodeURIComponent(data.lastWatched.path)}`);
                                            } else {
                                                const firstEp = data.episodes.find((e: any) => e.season === activeSeason) || data.episodes[0];
                                                router.push(`/watch?filePath=${encodeURIComponent(firstEp.path)}`);
                                            }
                                        }}
                                        className="flex cursor-pointer items-center gap-2 rounded-full bg-primary px-7 py-3 text-[15px] font-semibold text-white shadow-[0_8px_24px_rgba(240,120,74,0.35)] transition-all hover:scale-[1.03] hover:bg-primary-hover active:scale-[0.98]"
                                    >
                                        <svg className="h-4.5 w-4.5 shrink-0" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
                                        {data.lastWatched ? `继续播放 S${data.lastWatched.season} E${data.lastWatched.episode}` : `从第 ${activeSeason} 季开始看`}
                                    </button>
                                )}

                                <button
                                    onClick={openRescrape}
                                    className="flex cursor-pointer items-center gap-1.5 rounded-full border border-line bg-bg-card/70 px-4 py-2.5 text-[13px] text-text-2 backdrop-blur transition-all hover:border-primary/50 hover:text-primary"
                                    title="海报/简介匹配错了？手动选择正确的 TMDB 条目"
                                >
                                    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" /></svg>
                                    重新刮削
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            {/* ========== 下半部分：选择剧集 ========== */}
            {data.episodes && data.episodes.length > 0 && (data.type !== 'movie' || data.episodes.length > 1) && (
                <section className="max-w-[1200px] mx-auto pt-6 md:pt-8">

                    {/* 标题 + 集数 + 季切换 */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5 md:mb-6">
                        <div className="flex items-baseline gap-3">
                            <h2 className="font-display text-[22px] tracking-tight text-text-1 md:text-[24px]">
                                选集
                            </h2>
                            <span className="text-sm text-text-3">
                                {currentEpisodes.length} 集
                            </span>
                        </div>

                        {/* 季数横向 Tab —— 胶囊式，可换行不挤竖 */}
                        {data.type !== 'movie' && seasons.length > 1 && (
                            <div className="flex flex-wrap items-center gap-1.5">
                                {seasons.map(s => (
                                    <button
                                        key={s}
                                        onClick={() => setActiveSeason(s)}
                                        className={`rounded-full border px-3.5 py-1 text-[13px] font-medium transition-all cursor-pointer ${activeSeason === s
                                            ? 'border-primary bg-primary/10 text-primary'
                                            : 'border-line bg-bg-card text-text-2 hover:border-text-3 hover:text-text-1'
                                            }`}
                                    >
                                        第 {s} 季
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* 剧集网格：集号压图角标 + 上次看到高亮 + hover 播放浮钮 */}
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 md:gap-4">
                        {currentEpisodes.map((ep: any) => {
                            const isLast = data.lastWatched && data.lastWatched.season === ep.season && data.lastWatched.episode === ep.episode;
                            return (
                                <div
                                    key={ep.id}
                                    onClick={() => router.push(`/watch?filePath=${encodeURIComponent(ep.path)}`)}
                                    className={`group cursor-pointer overflow-hidden rounded-xl border bg-bg-card transition-all duration-200 hover:-translate-y-1 hover:shadow-[0_12px_28px_rgba(0,0,0,0.14)] ${
                                        isLast ? 'border-primary/70 ring-1 ring-primary/30' : 'border-line/40 hover:border-primary/50'
                                    }`}
                                >
                                    <div className="relative aspect-video w-full overflow-hidden bg-bg-input">
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        <img
                                            src={`/api/media/thumbnail?filePath=${encodeURIComponent(ep.path)}`}
                                            className="h-full w-full object-cover transition-[filter,transform] duration-300 group-hover:scale-[1.04] group-hover:brightness-105"
                                            alt={`E${ep.episode}`}
                                            loading="lazy"
                                            onError={(e) => {
                                                const el = e.target as HTMLImageElement;
                                                el.src = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjM2YzZjQ2IiBzdHJva2Utd2lkdGg9IjIiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCI+PHJlY3QgeD0iMyIgeT0iMyIgd2lkdGg9IjE4IiBoZWlnaHQ9IjE4IiByeD0iMiIgcnk9IjIiPjwvcmVjdD48Y2lyY2xlIGN4PSI4LjUiIGN5PSI4LjUiIHI9IjEuNSI+PC9jaXJjbGU+PHBvbHlsaW5lIHBvaW50cz0iMjEgMTUgMTYgMTAgNSAyMSI+PC9wb2x5bGluZT48L3N2Zz4=';
                                            }}
                                        />
                                        {/* 集号：压图左下角，杂志编号感 */}
                                        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-black/70 to-transparent" />
                                        <span className="absolute bottom-1.5 left-2.5 font-display text-[17px] font-bold leading-none text-white drop-shadow">
                                            {String(ep.episode).padStart(2, '0')}
                                        </span>
                                        {isLast && (
                                            <span className="absolute right-1.5 top-1.5 rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold leading-none text-white">
                                                看到这
                                            </span>
                                        )}
                                        {/* hover 播放浮钮 */}
                                        <span className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                                            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white/90 text-black shadow-lg">
                                                <svg className="ml-0.5 h-4 w-4" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
                                            </span>
                                        </span>
                                    </div>
                                    <div className="px-3 py-2.5">
                                        <p className={`truncate text-[13px] transition-colors ${isLast ? 'font-semibold text-primary' : 'text-text-2 group-hover:text-primary'}`}>
                                            {ep.title || `第 ${ep.episode} 集`}
                                        </p>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </section>
            )}

            {/* 电影额外简介区（如果上面没展示过剧集） */}
            {data.type === 'movie' && !data.episodes?.length && data.overview && (
                <section className="max-w-[1200px] mx-auto pt-8 pb-10">
                    <h2 className="font-display mb-4 text-[22px] tracking-tight text-text-1">剧情简介</h2>
                    <p className="text-text-2 leading-[1.8] text-sm md:text-[15px] max-w-3xl">
                        {data.overview}
                    </p>
                </section>
            )}

            {/* 演职员横滑（metadata 含 cast 才渲染；兼容旧字符串数组和新对象数组） */}
            {(() => {
                const castList = Array.isArray(meta?.cast) && meta.cast.length > 0 ? meta.cast : [];
                if (castList.length === 0 && !meta?.director) return null;
                // 规范化：字符串格式 → 对象格式
                const persons: Array<{name: string; character: string; profile_path: string | null}> =
                    castList.map((c: any) => typeof c === 'string' ? {name: c, character: '', profile_path: null} : c);
                return (
                    <section className='max-w-[1200px] mx-auto pt-2 pb-6'>
                        {meta?.genres?.length > 0 && (
                            <div className='mb-4'>
                                <span className='text-[13px] text-text-3 mr-2'>类型</span>
                                {meta.genres.map((g: string) => (
                                    <span key={g} className='inline-block mr-2 mb-1 px-2.5 py-0.5 rounded border border-line/60 text-text-2 text-[12px]'>{g}</span>
                                ))}
                            </div>
                        )}
                        {(persons.length > 0 || meta?.director) && (
                            <>
                                <div className='flex items-center justify-between mb-4'>
                                    <h2 className='font-display text-[20px] tracking-tight text-text-1 md:text-[22px]'>演职员</h2>
                                </div>
                                {meta?.director && (
                                    <p className='mb-3 text-[13px] text-text-3'>导演：<span className='text-text-2'>{meta.director}</span></p>
                                )}
                                {persons.length > 0 && (
                                    <div className='flex gap-4 overflow-x-auto pb-3' style={{scrollbarWidth: 'none'}}>
                                        {persons.map((person, i) => (
                                            <div key={i} className='flex-shrink-0 w-[88px] text-center'>
                                                <div className='w-16 h-16 rounded-full mx-auto overflow-hidden bg-bg-input flex items-center justify-center mb-2'>
                                                    {person.profile_path ? (
                                                        /* eslint-disable-next-line @next/next/no-img-element */
                                                        <img
                                                            src={proxyImg(person.profile_path)}
                                                            alt={person.name}
                                                            className='w-full h-full object-cover'
                                                            onError={(e) => {
                                                                const el = e.target as HTMLImageElement;
                                                                el.style.display = 'none';
                                                                if (el.parentElement) el.parentElement.innerHTML = '<span style=\'font-size:22px;color:#888;\'>' + (person.name[0] || '?') + '</span>';
                                                            }}
                                                        />
                                                    ) : (
                                                        <span style={{fontSize:'22px', color:'#888'}}>{person.name[0] || '?'}</span>
                                                    )}
                                                </div>
                                                <p className='text-[12px] text-text-1 leading-tight line-clamp-2'>{person.name}</p>
                                                {person.character && <p className='text-[11px] text-text-3 mt-0.5 line-clamp-1'>{person.character}</p>}
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </>
                        )}
                    </section>
                );
            })()}

            {/* 相似内容横滑（同 type，至少 3 条才渲染） */}
            {similarItems.length >= 3 && (
                <section className='max-w-[1200px] mx-auto pt-2 pb-8'>
                    <h2 className='font-display mb-5 text-[20px] tracking-tight text-text-1 md:text-[22px]'>相似内容</h2>
                    <div className='flex gap-4 overflow-x-auto pb-3' style={{scrollbarWidth: 'none'}}>
                        {similarItems.map((item: any) => {
                            const href = '/detail?id=' + item.id;
                            return (
                                <a
                                    key={item.id}
                                    href={href}
                                    className='flex-shrink-0 w-[130px] group cursor-pointer'
                                >
                                    <div className='aspect-[2/3] rounded-md overflow-hidden bg-bg-input mb-2 transition-transform duration-200 group-hover:-translate-y-1'>
                                        {item.poster ? (
                                            /* eslint-disable-next-line @next/next/no-img-element */
                                            <img
                                                src={proxyImg(item.poster)}
                                                alt={item.title}
                                                className='w-full h-full object-cover'
                                                loading='lazy'
                                                onError={(e) => { (e.target as HTMLImageElement).style.opacity = '0'; }}
                                            />
                                        ) : (
                                            <div className='w-full h-full flex items-center justify-center text-text-4 text-[11px]'>无封面</div>
                                        )}
                                    </div>
                                    <p className='text-[13px] text-text-1 line-clamp-2 group-hover:text-primary transition-colors'>{item.title}</p>
                                    {item.year && <p className='text-[12px] text-text-3 mt-0.5'>{item.year}</p>}
                                </a>
                            );
                        })}
                    </div>
                </section>
            )}

            {/* B站讨论区："活人感"来源——按片名搜B站最相关视频,拉真实热评(搜不到就整块收起) */}
            {data?.title && <BiliComments title={data.title} />}

            {/* 重新刮削弹窗：列出 TMDB 候选供人工选择正确条目 */}
            {rescrapeOpen && (
                <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={() => !rescraping && setRescrapeOpen(false)}>
                    <div className="bg-bg-card border border-line rounded-2xl shadow-2xl w-[820px] max-w-full max-h-[85vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-between p-5 border-b border-line">
                            <div>
                                <h3 className="text-[17px] font-bold text-text-1">重新刮削 · 选择正确条目</h3>
                                <p className="text-[12px] text-text-3 mt-0.5">搜索「{data.title}」的 TMDB 候选，点选正确的一部覆盖本地信息</p>
                            </div>
                            <button onClick={() => setRescrapeOpen(false)} className="text-text-3 hover:text-text-1 text-xl leading-none w-8 h-8 flex items-center justify-center cursor-pointer">×</button>
                        </div>
                        <div className="overflow-y-auto p-5 flex-1 custom-scrollbar">
                            {rescrapeLoading ? (
                                <div className="text-center py-12 text-text-3">正在搜索 TMDB…</div>
                            ) : candidates.length === 0 ? (
                                <div className="text-center py-12 text-text-3">未找到候选。请在设置确认 TMDB API，或检查片名。</div>
                            ) : (
                                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                                    {candidates.map(c => (
                                        <button
                                            key={c.tmdbId + '-' + c.mediaType}
                                            disabled={rescraping}
                                            onClick={() => doRescrape(c)}
                                            className="text-left rounded-lg overflow-hidden border border-line/50 hover:border-bili-pink transition-colors disabled:opacity-50 cursor-pointer bg-bg-input"
                                        >
                                            <div className="aspect-[2/3] bg-bg-tag">
                                                {c.poster ? <img src={c.poster} alt={c.title} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-text-4 text-xs p-2 text-center">无海报</div>}
                                            </div>
                                            <div className="p-2">
                                                <p className="text-[12.5px] font-medium text-text-1 line-clamp-1">{c.title}</p>
                                                <p className="text-[11px] text-text-3">{c.year || '—'} · {c.mediaType === 'tv' ? '剧集' : '电影'} · ★{c.rating?.toFixed(1) || '—'}</p>
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                        {rescraping && <div className="p-3 text-center text-[13px] text-bili-pink border-t border-line">正在刮削并更新…</div>}
                    </div>
                </div>
            )}
        </div>
    );
}

export default function DetailPage() {
    return (
        <Suspense fallback={<div className="flex items-center justify-center min-h-[50vh]"><div className="animate-spin rounded-full h-8 w-8 border-2 border-transparent border-t-bili-pink" /></div>}>
            <DetailContent />
        </Suspense>
    );
}
