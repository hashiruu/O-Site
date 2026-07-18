"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { MediaCard, MediaCardSkeleton } from "../components/MediaCard";
import { HeroDissolve } from "../components/HeroDissolve";
import { FetchOutMenu } from "../components/FetchOutMenu";
import { RandomAddQuiz } from "../components/RandomAddQuiz";
import { useMe } from "../components/useMe";
import { openLoginPopup } from "../components/loginPopup";

// 谷歌官方四色 G 标志（品牌规范配色）
function GoogleG({ className }: { className?: string }) {
    return (
        <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
        </svg>
    );
}

// 已登录但首页空空如也（内容权限待开通 / 媒体库还没入库）：安抚文案 + 插画
function EmptyHome() {
    return (
        <div className="animate-fadeIn mx-auto flex w-full max-w-md flex-col items-center gap-5 py-10 text-center md:py-16">
            {/* 插画：客厅小电视，安静待机（品牌橙/蓝，跟随日夜主题） */}
            <svg viewBox="0 0 240 170" className="w-56 max-w-full" fill="none" aria-hidden="true">
                {/* 地面 */}
                <ellipse cx="120" cy="152" rx="86" ry="10" className="fill-[var(--color-bg-hover)]" />
                {/* 电视机身 */}
                <rect x="52" y="34" width="136" height="92" rx="12" className="fill-[var(--color-bg-card)] stroke-[var(--color-line)]" strokeWidth="3" />
                {/* 屏幕 */}
                <rect x="64" y="46" width="112" height="68" rx="7" className="fill-[var(--color-bg-input)]" />
                {/* 屏幕里睡着的月亮 + zzz */}
                <path d="M116 90a16 16 0 0 1-5-31 13 13 0 1 0 17 17 16 16 0 0 1-12 14z" fill="var(--color-primary)" opacity="0.85" />
                <text x="136" y="70" fontSize="13" fontWeight="700" fill="var(--color-secondary)">z</text>
                <text x="145" y="62" fontSize="10" fontWeight="700" fill="var(--color-secondary)" opacity="0.7">z</text>
                <text x="152" y="55" fontSize="8" fontWeight="700" fill="var(--color-secondary)" opacity="0.45">z</text>
                {/* 底座 + 天线 */}
                <rect x="104" y="126" width="32" height="8" rx="4" className="fill-[var(--color-line)]" />
                <rect x="92" y="136" width="56" height="7" rx="3.5" className="fill-[var(--color-line)]" />
                <path d="M96 34 78 12M144 34l18-22" stroke="var(--color-line)" strokeWidth="3.5" strokeLinecap="round" className="stroke-[var(--color-line)]" />
                <circle cx="76" cy="10" r="4" fill="var(--color-primary)" opacity="0.7" />
                <circle cx="164" cy="10" r="4" fill="var(--color-secondary)" opacity="0.7" />
            </svg>
            <div>
                <p className="text-base font-semibold text-text-1">内容正在赶来的路上</p>
                <p className="mt-2 text-[14px] leading-relaxed text-text-3">
                    媒体库正在整理中，很快就好。
                    <br className="hidden sm:block" />
                    泡杯茶，稍后再来看看吧。
                </p>
            </div>
        </div>
    );
}

// 未登录引导：页面正中的矩形卡片，谷歌标志 + 登录入口（弹窗式，登录后即消失）
function GoogleLoginBanner() {
    return (
        <div className="animate-fadeIn mx-auto flex w-full max-w-md flex-col items-center gap-5 rounded-2xl border border-line bg-bg-card px-10 py-12 text-center shadow-sm">
            <GoogleG className="h-14 w-14" />
            <p className="text-base font-semibold text-text-1">此网站需要登录才能使用基础功能。</p>
            <button
                onClick={openLoginPopup}
                className="flex cursor-pointer items-center gap-2.5 rounded-full border border-line bg-bg-card px-6 py-2.5 text-sm font-medium text-text-1 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md"
            >
                <GoogleG className="h-4.5 w-4.5" />
                使用 Google 登录
            </button>
        </div>
    );
}

interface MediaItem {
    id: string;
    title: string;
    path: string;
    type: string;
    poster?: string | null;
    backdrop?: string | null;
    overview?: string | null;
    year?: number | null;
    rating?: number | null;
    firstEpisodePath?: string | null;
}

interface ContinueItem {
    id: string;
    mediaId: string;
    title: string;
    type: string;
    path: string;
    poster?: string | null;
    backdrop?: string | null;
    year?: number | null;
    rating?: number | null;
    progressPct: number;
    episodeLabel: string | null;
}

interface LatestData {
    recommended: MediaItem[];
    movie: MediaItem[];
    series: MediaItem[];
    anime: MediaItem[];
    [key: string]: MediaItem[];
}

const typeCaption: Record<string, string> = {
    travel: "旅行相册",
    movie: "电影",
    series: "剧集",
    anime: "动漫",
    recommended: "为你推荐",
};

const isCinema = (t: string) => t === "movie" || t === "series" || t === "anime";

const playTargetOf = (item: MediaItem) => {
    const playable = item.firstEpisodePath || (!isCinema(item.type) ? item.path : null);
    return playable ? `/watch?filePath=${encodeURIComponent(playable)}` : `/detail?id=${item.id}`;
};

// 外链图统一走自家代理：Chrome 对 image.tmdb.org 直连偶发失败（网络层，Safari 侥幸），
// 同源代理 + 服务器缓存后永远稳定可达
const proxyImg = (u: string) => (/^https?:\/\//.test(u) ? `/api/discover/img?u=${encodeURIComponent(u)}` : u);

const thumbOf = (item: MediaItem) =>
    item.poster ? proxyImg(item.poster) : `/api/media/thumbnail?filePath=${encodeURIComponent(item.firstEpisodePath || item.path)}`;

const FALLBACK_IMG = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjM2YzZjQ2IiBzdHJva2Utd2lkdGg9IjIiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCI+PHJlY3QgeD0iMyIgeT0iMyIgd2lkdGg9IjE4IiBoZWlnaHQ9IjE4IiByeD0iMiIgcnk9IjIiPjwvcmVjdD48Y2lyY2xlIGN4PSI4LjUiIGN5PSI4LjUiIHI9IjEuNSI+PC9jaXJjbGU+PHBvbHlsaW5lIHBvaW50cz0iMjEgMTUgMTYgMTAgNSAyMSI+PC9wb2x5bGluZT48L3N2Zz4=';

// img onError 自愈：第一次失败延迟 1.5s 原地重试（网络瞬断/反代抖动不留永久灰图），
// 第二次才落灰占位——onError 手改 DOM src 后 React 不会自动复原，必须自己兜
const retryThenFallback = (e: React.SyntheticEvent<HTMLImageElement>, fallback: string = FALLBACK_IMG) => {
    const el = e.target as HTMLImageElement;
    if (!el.dataset.retried) {
        el.dataset.retried = "1";
        const orig = el.src;
        setTimeout(() => { el.src = orig; }, 1500);
    } else {
        el.src = fallback;
    }
};

// banner 专用：白字压在图上，图加载失败时不能落浅灰占位（白字白底会消失）——
// 重试一次后直接隐藏 img，露出 banner 容器的深色兜底，白字始终可读（日间模式看不见的根因）
const bannerImgFallback = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const el = e.target as HTMLImageElement;
    if (!el.dataset.retried) {
        el.dataset.retried = "1";
        const orig = el.src;
        setTimeout(() => { el.src = orig; }, 1500);
    } else {
        el.style.opacity = "0";
    }
};

// 失败期写过内联 opacity:0 后，一旦图片真正加载成功必须清掉——
// 内联样式永远压过轮播的 opacity-100/opacity-0 class，不清就出现
// "检查器里图加载了、页面上却看不见"（把显隐控制权还给 class）
const bannerImgLoaded = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const el = e.target as HTMLImageElement;
    el.style.opacity = "";
    delete el.dataset.retried;
};

const metaText = (item: { type: string; year?: number | null }) =>
    `${typeCaption[item.type] || item.type}${item.year ? ` · ${item.year}` : ""}`;

const itemHref = (item: MediaItem) =>
    isCinema(item.type) ? `/detail?id=${item.id}` : `/watch?filePath=${encodeURIComponent(item.firstEpisodePath || item.path)}`;

/* ─────────────── StarHero：双 section 头版 ───────────────
   左：干净底问候卡（流光艺术字 + 库内今日头条浮卡，文字不压海报）；
   右：Everyday Different——TMDB 每日主题频道新鲜推荐，与左下轮播完全解耦，
       每天换主题换内容（健康阳光向），拉不到时回落库内轮播。 */
/* 问候正文自适应：二分搜索"恰好填满容器不溢出"的最大字号。
   容器由 flex-1 撑满 greeting 头与浮卡之间的全部空隙——文字始终占满，不留大片空白。
   依赖 ResizeObserver：窗口/浮卡尺寸一变就重算。 */
function FitText({ text, className }: { text: string; className?: string }) {
    const boxRef = useRef<HTMLDivElement>(null);
    const [size, setSize] = useState(14);

    useEffect(() => {
        const box = boxRef.current;
        if (!box) return;
        const fit = () => {
            const inner = box.firstElementChild as HTMLElement | null;
            if (!inner || box.clientHeight < 20) return;
            let lo = 12, hi = 34, best = 12;
            while (lo <= hi) {
                const mid = Math.floor((lo + hi) / 2);
                inner.style.fontSize = `${mid}px`;
                if (inner.scrollHeight <= box.clientHeight) { best = mid; lo = mid + 1; }
                else { hi = mid - 1; }
            }
            inner.style.fontSize = `${best}px`;
            setSize(best);
        };
        fit();
        const ro = new ResizeObserver(fit);
        ro.observe(box);
        return () => ro.disconnect();
    }, [text]);

    return (
        <div ref={boxRef} className="min-h-0 flex-1 overflow-hidden">
            <div className={className} style={{ fontSize: size }}>{text}</div>
        </div>
    );
}

interface FreshPick {
    id: number; title: string; overview: string; backdrop: string;
    poster: string | null; year: number | null; rating: number | null; media: string; theme: string;
}

function StarHero({ heroItems, pool }: { heroItems: MediaItem[]; pool: MediaItem[] }) {
    const router = useRouter();
    const [active, setActive] = useState(0);
    const [paused, setPaused] = useState(false);
    // Everyday Different：右侧轮播的每日新鲜推荐（TMDB，每天换主题；拉不到回落库内）
    const [fresh, setFresh] = useState<FreshPick[]>([]);
    const [activeR, setActiveR] = useState(0);
    const [pausedR, setPausedR] = useState(false);

    const [hot, setHot] = useState<{ rank: number; title: string; kind: string; heat: number | null; overview?: string }[]>([]);
    const [hotFo, setHotFo] = useState<{ title: string; kind: string; overview?: string; x: number; y: number } | null>(null);
    // AI 个性化问候（DeepSeek：时间+天气+书影足迹 → 温情便条）；拉不到用默认时间问候
    const [aiGreet, setAiGreet] = useState<{ head: string; line: string } | null>(null);

    useEffect(() => {
        fetch("/api/greeting")
            .then((r) => r.json())
            .then((d) => { if (d.success && d.data?.head && d.data?.line) setAiGreet(d.data); })
            .catch(() => { /* 静默回落 */ });
    }, []);

    useEffect(() => {
        // 每日推荐：图走 fetch→blob→objectURL,全部就位才上 banner。
        // 双保险:①预载后切换,banner 只从"能看的图"换到"能看的图",无空窗;
        // ②blob 绕过 Chromium LazyLoad 干预(crbug.com/40577771:省流/慢网下浏览器在
        //   网络调度层推迟图片资源、用占位符顶替,连 eager 的 <img src=URL> 都躲不掉;
        //   fetch() 不算图片资源加载,blob: 地址是本地内存,干预无从下手)。
        // 坏图剔除;好图不足 3 张不切,保持库内轮播。
        fetch("/api/discover/daily")
            .then((r) => r.json())
            .then(async (d) => {
                if (!(d.success && Array.isArray(d.data) && d.data.length)) return;
                const picks = d.data as FreshPick[];
                const withBlob = await Promise.all(picks.map(async (p) => {
                    try {
                        const res = await fetch(p.backdrop, { signal: AbortSignal.timeout(8000) });
                        if (!res.ok) return null;
                        const blob = await res.blob();
                        if (!blob.type.startsWith("image/")) return null;
                        return { ...p, backdrop: URL.createObjectURL(blob) };
                    } catch { return null; }
                }));
                const good = withBlob.filter((p): p is FreshPick => p !== null);
                if (good.length >= 3) setFresh(good);
            })
            .catch(() => { /* 静默回落 */ });
        fetch("/api/discover/hot")
            .then((r) => r.json())
            .then((d) => { if (d.success && Array.isArray(d.data)) setHot(d.data); })
            .catch(() => { /* 拉不到整栏隐藏 */ });
    }, []);

    useEffect(() => {
        if (paused || heroItems.length <= 1) return;
        const t = setInterval(() => setActive((a) => (a + 1) % heroItems.length), 8000);
        return () => clearInterval(t);
    }, [paused, heroItems.length]);

    // banner 点击弹 fetch out 悬浮窗（先看简介再选平台），不再直接跳走
    const [banFo, setBanFo] = useState<{ title: string; kind: string; overview?: string; x: number; y: number } | null>(null);

    // 右侧统一视图：有新鲜推荐用推荐（点击弹 fetch out 菜单），否则回落库内头条（点击直接播放）
    const rightItems = useMemo(() => (
        fresh.length > 0
            ? fresh.map((f) => ({
                key: `f${f.id}`, img: f.backdrop, title: f.title, overview: f.overview,
                year: f.year, rating: f.rating, theme: f.theme,
                go: (e: React.MouseEvent) => setBanFo({
                    title: f.title, kind: f.media === "tv" ? "series" : "movie",
                    overview: f.overview, x: e.clientX, y: e.clientY,
                }),
            }))
            : heroItems.map((m) => ({
                key: m.id, img: m.backdrop ? proxyImg(m.backdrop) : thumbOf(m), title: m.title, overview: m.overview || "",
                year: m.year ?? null, rating: m.rating ?? null, theme: null as string | null,
                go: (_e: React.MouseEvent) => router.push(playTargetOf(m)),
            }))
        // eslint-disable-next-line react-hooks/exhaustive-deps
    ), [fresh, heroItems]);

    useEffect(() => {
        if (pausedR || rightItems.length <= 1) return;
        const t = setInterval(() => setActiveR((a) => (a + 1) % rightItems.length), 8000);
        return () => clearInterval(t);
    }, [pausedR, rightItems.length]);

    const idx = heroItems.length === 0 ? 0 : Math.min(active, heroItems.length - 1);
    const current = heroItems[idx] || null;
    const idxR = rightItems.length === 0 ? 0 : Math.min(activeR, rightItems.length - 1);
    // 上一帧追踪：转场时旧帧保持不透明垫底、新帧在其上淡入——
    // 交叉淡化(旧帧同时淡出)在中点只剩 ~75% 亮度,深底上就是"暗一闪/黑一下"(探针抓到的 dip)
    const [prevR, setPrevR] = useState(-1);
    const lastRRef = useRef(idxR);
    useEffect(() => {
        if (lastRRef.current !== idxR) { setPrevR(lastRRef.current); lastRRef.current = idxR; }
    }, [idxR]);
    const curR = rightItems[idxR] || null;
    const h = new Date().getHours();
    const greet = h < 5 ? "夜深了" : h < 11 ? "早上好" : h < 14 ? "中午好" : h < 18 ? "下午好" : "晚上好";
    const srcs = rightItems.map((it) => it.img);

    return (
        <div className="grid gap-4 lg:h-[400px] lg:grid-cols-5">
            {/* ── 左 section：问候 + 头条浮卡（干净底：日间白、夜间深空，--gx-sky） ── */}
            <div
                className="relative flex flex-col justify-between overflow-hidden rounded-2xl border border-line p-5 sm:p-6 lg:col-span-2"
                style={{ background: "var(--gx-sky)" }}
            >
                {/* 顶部品牌渐变发丝线 */}
                <div aria-hidden className="absolute inset-x-0 top-0 h-[2.5px] bg-gradient-to-r from-primary/80 via-secondary/60 to-transparent" />
                {/* 星图点缀：几颗缓慢明灭的小星，呼应 --gx-sky 星图底（reduced-motion 静止） */}
                <div aria-hidden className="pointer-events-none absolute inset-0">
                    <span className="gx-star right-[18%] top-[24%]" style={{ animationDelay: "0s" }} />
                    <span className="gx-star right-[30%] top-[46%]" style={{ width: 3, height: 3, animationDelay: "1.2s" }} />
                    <span className="gx-star right-[12%] top-[62%]" style={{ animationDelay: "2.1s" }} />
                    <span className="gx-star left-[46%] top-[14%]" style={{ width: 2, height: 2, animationDelay: "0.6s" }} />
                </div>
                {/* 右上角日期徽章（日期从副文案里提出来，不再和问候正文挤一起） */}
                <span className="absolute right-4 top-4 rounded-full border border-line/60 bg-white/50 px-2.5 py-1 text-[11px] leading-none text-text-3 backdrop-blur dark:border-white/10 dark:bg-white/5 dark:text-white/50 sm:right-5 sm:top-5">
                    {new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "short" }).format(new Date())}
                </span>
                <div className="pointer-events-none flex min-h-0 flex-1 flex-col">
                    <div className="gx-greet shrink-0 font-display text-[40px] font-bold leading-none tracking-tight sm:text-[52px]">
                        {aiGreet?.head || greet}
                    </div>
                    {/* 正文动态字号：flex-1 吃掉到浮卡之间的全部空白，二分出恰好填满的字号 */}
                    <div className="mt-2.5 flex min-h-0 flex-1 flex-col">
                        <FitText
                            className="leading-relaxed text-text-2 dark:text-white/60"
                            text={(() => {
                                const raw = aiGreet
                                    ? aiGreet.line
                                    : `今天想看点什么？${pool.length > 0 ? ` 你的 ${pool.length} 部收藏都在这里` : ""}`;
                                const t = raw.trim();
                                return /[。！？!?…”）)]$/.test(t) ? t : `${t}。`; // 句末补句号
                            })()}
                        />
                    </div>
                </div>

                {/* 左下：今日头条浮卡（轮播控制） */}
                {current && (
                    <div
                        className="mt-5 rounded-2xl border border-line/80 bg-white/65 p-3 shadow-lg backdrop-blur-md dark:border-white/12 dark:bg-black/35"
                        onMouseEnter={() => setPaused(true)}
                        onMouseLeave={() => setPaused(false)}
                    >
                        <div className="flex items-stretch gap-3.5">
                            <div className="relative aspect-video w-[128px] shrink-0 overflow-hidden rounded-xl sm:w-[148px]">
                                {heroItems.map((item, i) => (
                                    /* eslint-disable-next-line @next/next/no-img-element */
                                    <img
                                        key={item.id}
                                        src={item.backdrop ? proxyImg(item.backdrop) : thumbOf(item)}
                                        alt={item.title}
                                        loading="eager"
                                        decoding="async"
                                        className={`absolute inset-0 h-full w-full scale-105 object-cover transition-opacity duration-[1200ms] ease-in-out ${i === idx ? "opacity-100" : "opacity-0"}`}
                                        onError={(e) => { (e.target as HTMLImageElement).src = item.poster ? proxyImg(item.poster) : FALLBACK_IMG; }}
                                    />
                                ))}
                            </div>
                            <div className="flex min-w-0 flex-1 flex-col justify-center">
                                <div className="text-[10px] font-semibold tracking-[0.24em] text-text-3 dark:text-white/50">
                                    今日头条 · {typeCaption[current.type] || current.type}{current.year ? ` · ${current.year}` : ""}{current.rating ? ` · ★ ${Number(current.rating).toFixed(1)}` : ""}
                                </div>
                                <div className="mt-1 line-clamp-1 font-display text-[16px] tracking-tight text-text-1 dark:text-white sm:text-[18px]">{current.title}</div>
                                <div className="mt-2.5 flex flex-wrap items-center gap-2">
                                    <button
                                        onClick={() => router.push(playTargetOf(current))}
                                        className="flex cursor-pointer items-center gap-1.5 rounded-full bg-primary px-3.5 py-1.5 text-[12.5px] font-semibold text-white shadow-sm transition-transform hover:scale-105"
                                    >
                                        <svg className="h-3 w-3" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
                                        立即播放
                                    </button>
                                    {isCinema(current.type) && (
                                        <button
                                            onClick={() => router.push(`/detail?id=${current.id}`)}
                                            className="cursor-pointer rounded-full border border-line bg-bg-card/60 px-3 py-1.5 text-[12.5px] text-text-2 backdrop-blur transition-colors hover:bg-bg-hover dark:border-white/30 dark:bg-white/10 dark:text-white dark:hover:bg-white/20"
                                        >
                                            详情
                                        </button>
                                    )}
                                    {heroItems.length > 1 && (
                                        <span className="ml-auto flex items-center gap-1.5">
                                            {heroItems.map((_, i) => (
                                                <button
                                                    key={i}
                                                    onClick={() => setActive(i)}
                                                    className={`cursor-pointer rounded-full transition-all ${i === idx ? "h-1 w-5 bg-text-1 dark:bg-white" : "h-1 w-2.5 bg-text-1/30 hover:bg-text-1/60 dark:bg-white/40 dark:hover:bg-white/70"}`}
                                                    aria-label={`第 ${i + 1} 张`}
                                                />
                                            ))}
                                        </span>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* ── 右 section：75% Everyday Different banner + 25% 每日热搜 ── */}
            <div className="flex gap-4 lg:col-span-3 lg:h-full">
            <div
                className="relative aspect-video flex-[3] overflow-hidden rounded-2xl border border-white/10 bg-zinc-900 lg:aspect-auto lg:h-full"
                onMouseEnter={() => setPausedR(true)}
                onMouseLeave={() => setPausedR(false)}
            >
                {rightItems.map((item, i) => (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                        key={item.key}
                        src={item.img}
                        alt={item.title}
                        // 全部显式 eager：Chromium 在慢网/省流下有 Lazy-Load 干预，会把 lazy 图
                        // 换成占位符、推迟 load——叠放轮播的隐藏帧被顶替，转过去就是空白（Safari 无此机制）。
                        // 显式 eager 可对抗干预；8 张 hero 图本就该首屏加载。
                        loading="eager"
                        decoding="async"
                        fetchPriority={i === idxR ? "high" : "low"}
                        className={`absolute inset-0 h-full w-full scale-105 object-cover transition-opacity duration-[1400ms] ease-in-out ${
                            i === idxR ? "z-[2] opacity-100" : i === prevR ? "z-[1] opacity-100" : "z-0 opacity-0"
                        }`}
                        onError={bannerImgFallback}
                        onLoad={bannerImgLoaded}
                    />
                ))}
                <HeroDissolve srcs={srcs} active={idxR} className="pointer-events-none absolute inset-0 z-[3] h-full w-full" />
                {/* 顶部压暗：主题徽章在任何海报上都读得清（z-[4]:压过图层与溶解层） */}
                <div className="absolute inset-x-0 top-0 z-[4] h-20 bg-gradient-to-b from-black/45 to-transparent" />
                <div className="absolute inset-x-0 bottom-0 z-[4] h-32 bg-gradient-to-t from-black/85 via-black/40 to-transparent" />
                {/* 左上角主题徽章：每天一个频道 */}
                {curR?.theme && (
                    <div className="absolute left-4 top-3.5 z-[5] rounded-full border border-white/15 bg-black/45 px-3 py-1 text-[10px] font-semibold tracking-[0.22em] text-white/85 backdrop-blur-md">
                        EVERYDAY DIFFERENT · {curR.theme}
                    </div>
                )}
                {/* 左下：玻璃播放钮 + 片名（年份/评分做成胶片徽章）+ 两行简介 */}
                {curR && (
                    <button onClick={curR.go} className="group/ban absolute bottom-3.5 left-4 right-4 z-[5] flex cursor-pointer items-center gap-3 text-left sm:right-24">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/30 bg-white/15 text-white shadow-lg backdrop-blur-md transition-transform duration-200 group-hover/ban:scale-110 sm:h-10 sm:w-10">
                            <svg className="ml-0.5 h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
                        </span>
                        <span className="min-w-0">
                            <span className="flex items-center gap-2">
                                <span className="line-clamp-1 font-display text-[18px] tracking-tight text-white drop-shadow sm:text-[22px]">{curR.title}</span>
                                {curR.year ? <span className="hidden shrink-0 rounded-full border border-white/20 bg-white/10 px-2 py-0.5 text-[11px] text-white/75 backdrop-blur sm:inline">{curR.year}</span> : null}
                                {curR.rating ? <span className="hidden shrink-0 rounded-full border border-white/20 bg-white/10 px-2 py-0.5 text-[11px] text-white/75 backdrop-blur sm:inline">★ {Number(curR.rating).toFixed(1)}</span> : null}
                            </span>
                            {curR.overview && (
                                <span className="mt-1 line-clamp-1 block text-[12px] text-white/65 sm:line-clamp-2">{curR.overview}</span>
                            )}
                        </span>
                    </button>
                )}
                {/* 右下轮播点（独立于左卡的点） */}
                {rightItems.length > 1 && (
                    <span className="absolute bottom-4 right-4 z-[5] hidden items-center gap-1.5 sm:flex">
                        {rightItems.map((_, i) => (
                            <button
                                key={i}
                                onClick={() => setActiveR(i)}
                                className={`cursor-pointer rounded-full transition-all ${i === idxR ? "h-1 w-6 bg-white" : "h-1 w-3 bg-white/40 hover:bg-white/70"}`}
                                aria-label={`第 ${i + 1} 张`}
                            />
                        ))}
                    </span>
                )}
            </div>

            {/* 每日热搜（25%）：TMDB 当日趋势 + Apple 中国区图书畅销榜，点条目跳站内搜索 */}
            {hot.length > 0 && (
                <div className="hidden flex-1 flex-col overflow-hidden rounded-2xl border border-line bg-bg-card lg:flex">
                    {/* 顶部品牌渐变发丝线，与左问候卡呼应 */}
                    <div aria-hidden className="h-[2.5px] w-full shrink-0 bg-gradient-to-r from-primary/80 via-secondary/60 to-transparent" />
                    <div className="flex items-baseline justify-between border-b border-line/70 px-4 py-2.5">
                        <span className="flex items-center gap-1.5 text-[13.5px] font-semibold text-text-1">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5 text-primary" aria-hidden="true"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" /></svg>
                            今日热搜
                        </span>
                        <span className="text-[10px] tracking-[0.18em] text-text-3">每天更新</span>
                    </div>
                    <ol className="scrollbar-hide min-h-0 flex-1 divide-y divide-line/60 overflow-y-auto py-1">
                        {hot.map((x) => (
                            <li key={x.rank}>
                                <button
                                    onClick={(e) => setHotFo({ title: x.title, kind: x.kind, overview: x.overview, x: e.clientX, y: e.clientY })}
                                    className="group flex w-full cursor-pointer items-center gap-2.5 px-4 py-[7px] text-left transition-colors hover:bg-bg-hover"
                                >
                                    <span className={`w-4 shrink-0 text-center font-display text-[13px] ${x.rank <= 3 ? "font-semibold text-primary" : "text-text-3"}`}>
                                        {x.rank}
                                    </span>
                                    <span className="min-w-0 flex-1 truncate text-[13px] text-text-1 transition-colors group-hover:text-primary">
                                        {x.title}
                                    </span>
                                    <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] ${x.kind === "电影" ? "bg-primary/10 text-primary" : x.kind === "书" ? "bg-amber-500/10 text-amber-600 dark:text-amber-400" : "bg-secondary/10 text-secondary"}`}>{x.kind}</span>
                                </button>
                            </li>
                        ))}
                    </ol>
                </div>
            )}
            {banFo && (
                <FetchOutMenu
                    title={banFo.title}
                    kind={banFo.kind}
                    overview={banFo.overview}
                    anchor={{ x: banFo.x, y: banFo.y }}
                    onClose={() => setBanFo(null)}
                    extraActions={[{ label: "先搜搜本站有没有", run: () => { window.location.href = `/search?q=${encodeURIComponent(banFo.title)}`; } }]}
                />
            )}
            {hotFo && (
                <FetchOutMenu
                    title={hotFo.title}
                    kind={hotFo.kind}
                    overview={hotFo.overview}
                    anchor={{ x: hotFo.x, y: hotFo.y }}
                    onClose={() => setHotFo(null)}
                    extraActions={[{ label: "先搜搜本站有没有", run: () => { window.location.href = `/search?q=${encodeURIComponent(hotFo.title)}`; } }]}
                />
            )}
            </div>
        </div>
    );
}

/* ─────────────── LuckyDraw：手气抽卡 ───────────────
   全屏黑幕，卡面快速轮播候选海报、按二次曲线减速，定格揭晓命运之选：
   卡片放大 + 品牌橙光环，1.6s 后自动进入（也可手动"就看它/算了"）。 */
function LuckyDraw({ pool, onClose }: { pool: MediaItem[]; onClose: () => void }) {
    const router = useRouter();
    const [frame, setFrame] = useState(0);
    const [done, setDone] = useState(false);
    const seq = useMemo(() => {
        const arr = Array.from({ length: 14 }, () => pool[Math.floor(Math.random() * pool.length)]);
        arr.push(pool[Math.floor(Math.random() * pool.length)]); // 最后一张 = 命运之选
        return arr;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    const pick = seq[seq.length - 1];

    // 预载轮播图，避免快速切换时白闪
    useEffect(() => { seq.forEach((m) => { const im = new Image(); im.src = thumbOf(m); }); }, [seq]);

    useEffect(() => {
        let i = 0;
        let t: ReturnType<typeof setTimeout>;
        const step = () => {
            i++;
            if (i >= seq.length - 1) { setFrame(seq.length - 1); setDone(true); return; }
            setFrame(i);
            t = setTimeout(step, 55 + Math.pow(i / (seq.length - 1), 2.2) * 300); // 越抽越慢
        };
        t = setTimeout(step, 55);
        return () => clearTimeout(t);
    }, [seq]);

    useEffect(() => {
        if (!done) return;
        const t = setTimeout(() => router.push(itemHref(pick)), 1600);
        return () => clearTimeout(t);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [done]);

    const cur = seq[frame];
    return createPortal(
        <div className="fixed inset-0 z-[200] flex flex-col items-center justify-center bg-black/70 backdrop-blur-sm">
            <div
                className={`relative w-[190px] overflow-hidden rounded-xl shadow-2xl transition-all duration-300 sm:w-[210px] ${
                    done ? "scale-110 shadow-[0_0_70px_rgba(240,120,74,0.6)] ring-4 ring-primary" : ""
                }`}
                style={{ aspectRatio: "2 / 3" }}
            >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={thumbOf(cur)} alt="" className="h-full w-full object-cover"
                    onError={(e) => { (e.target as HTMLImageElement).src = FALLBACK_IMG; }} />
                {!done && <div className="absolute inset-0 bg-gradient-to-t from-black/45 to-transparent" />}
            </div>
            <div className="mt-5 h-7 text-center">
                {done
                    ? <span className="text-[17px] font-semibold text-white">{pick.title}</span>
                    : <span className="text-[13px] tracking-[0.2em] text-white/60">命运抽取中…</span>}
            </div>
            {done && (
                <div className="mt-3 flex items-center gap-2.5">
                    <button onClick={() => router.push(itemHref(pick))}
                        className="cursor-pointer rounded-full bg-primary px-5 py-2 text-[13px] font-semibold text-white transition-transform hover:scale-105">
                        就看它 →
                    </button>
                    <button onClick={onClose}
                        className="cursor-pointer rounded-full border border-white/30 px-4 py-2 text-[13px] text-white/80 transition-colors hover:bg-white/10">
                        算了
                    </button>
                </div>
            )}
        </div>,
        document.body
    );
}

/* ─────────────── DeckRow：掌舵台 ───────────────
   四张"马上出发"卡（接着看/继续阅读/热门/随机）+ 全站分区药丸一排——
   easy to fetch：所有去处一屏拿齐，不用翻、不用找。 */
function DeckRow({ continueItems, allPool }: {
    continueItems: ContinueItem[]; allPool: MediaItem[];
}) {
    const cw = continueItems.find((i) => i.type !== "book") || continueItems[0] || null;
    const book = continueItems.find((i) => i.type === "book") || null;
    const [drawing, setDrawing] = useState(false);

    const Card = ({ href, onClick, tag, title, sub, thumb, icon }: {
        href?: string; onClick?: () => void; tag: string; title: string; sub?: string; thumb?: string; icon?: string;
    }) => {
        const inner = (
            <>
                {thumb ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={thumb} alt="" loading="eager" className="h-[52px] w-[76px] shrink-0 rounded-lg object-cover"
                        onError={(e) => { (e.target as HTMLImageElement).src = FALLBACK_IMG; }} />
                ) : (
                    <span className="flex h-[52px] w-[76px] shrink-0 items-center justify-center rounded-lg bg-bg-input">
                        <svg viewBox="0 0 24 24" className="h-6 w-6 fill-text-3 transition-colors group-hover:fill-primary"><path d={icon} /></svg>
                    </span>
                )}
                <div className="min-w-0 flex-1">
                    <div className="text-[10px] font-semibold tracking-[0.22em] text-text-3">{tag}</div>
                    <div className="line-clamp-1 text-[14px] font-semibold text-text-1 transition-colors group-hover:text-primary">{title}</div>
                    {sub && <div className="line-clamp-1 text-[11.5px] text-text-3">{sub}</div>}
                </div>
            </>
        );
        const cls = "group flex cursor-pointer items-center gap-3 rounded-xl border border-line bg-bg-card p-2.5 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/45 hover:shadow-md";
        return href ? <a href={href} className={cls}>{inner}</a> : <button onClick={onClick} className={cls}>{inner}</button>;
    };

    return (
        <section>
            {drawing && allPool.length > 0 && <LuckyDraw pool={allPool} onClose={() => setDrawing(false)} />}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                {cw && (
                    <Card
                        href={cw.type === "book" ? `/reader/epub?path=${encodeURIComponent(cw.path)}` : `/watch?filePath=${encodeURIComponent(cw.path)}`}
                        tag="接着看" title={cw.title}
                        sub={`${cw.episodeLabel ? `看到 ${cw.episodeLabel} · ` : ""}${cw.progressPct}%`}
                        thumb={cw.poster ? proxyImg(cw.poster) : `/api/media/thumbnail?filePath=${encodeURIComponent(cw.path)}`}
                    />
                )}
                <Card
                    href={book ? `/reader/epub?path=${encodeURIComponent(book.path)}` : "/bookshelf"}
                    tag={book ? "继续阅读" : "书架"} title={book ? book.title : "翻开一本书"}
                    sub={book ? `已读 ${book.progressPct}%` : undefined}
                    icon="M18 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 4h5v8l-2.5-1.5L6 12V4z"
                />
                <Card onClick={() => setDrawing(true)} tag="手气" title="随机来一部" sub="交给命运"
                    icon="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM7.5 18c-.83 0-1.5-.67-1.5-1.5S6.67 15 7.5 15s1.5.67 1.5 1.5S8.33 18 7.5 18zm0-9C6.67 9 6 8.33 6 7.5S6.67 6 7.5 6 9 6.67 9 7.5 8.33 9 7.5 9zm4.5 4.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm4.5 4.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm0-9c-.83 0-1.5-.67-1.5-1.5S15.67 6 16.5 6s1.5.67 1.5 1.5S17.33 9 16.5 9z" />
            </div>
        </section>
    );
}

/* ─────────────── 长廊滚动壳 ───────────────
   左缘羽化只在滚离起点后出现（贴左时不挡内容），右缘羽化恒在；
   pt-7 给行内巨型描边编号留出探头空间（overflow 裁剪发生在 padding 边缘之外）。 */
function GalleryScroller({ children }: { children: React.ReactNode }) {
    const ref = useRef<HTMLDivElement>(null);
    const [atStart, setAtStart] = useState(true);
    return (
        <div
            ref={ref}
            onScroll={() => setAtStart((ref.current?.scrollLeft ?? 0) < 8)}
            className="ios-scroll scrollbar-hide -mx-1 snap-x overflow-x-auto px-1 pb-2 pt-7"
            style={{
                maskImage: atStart
                    ? "linear-gradient(90deg, #000 0, #000 calc(100% - 28px), transparent 100%)"
                    : "linear-gradient(90deg, transparent 0, #000 24px, #000 calc(100% - 28px), transparent 100%)",
            }}
        >
            <div className="w-max space-y-7">{children}</div>
        </div>
    );
}

/* ─────────────── 继续观看：单行混排 ───────────────
   竖版就竖版（有正式海报/书封 2:3）、横版就横版（截帧缩略 16:9），不强行转化。
   封面统一高度、宽度各按天生比例；一行放得下几张放几张，超出裁掉 + 右缘渐隐。 */
function ContinueRow({ items }: { items: ContinueItem[] }) {
    if (items.length === 0) return null;
    return (
        <section>
            <div className="mb-3 flex items-baseline justify-between">
                <h2 className="text-[20px] font-medium text-text-1">继续观看</h2>
                <a href="/history" className="text-[13px] text-text-3 transition-colors hover:text-primary">全部记录 →</a>
            </div>
            <div
                className="flex items-start gap-3 overflow-hidden"
                style={{ maskImage: "linear-gradient(90deg, #000 calc(100% - 56px), transparent 100%)" }}
            >
                {items.map((item) => {
                    const isBook = item.type === "book";
                    const portrait = !!item.poster; // 有正式海报/书封 → 竖版；只有截帧 → 横版
                    return (
                        <div key={item.id + (item.episodeLabel || "")} className={`shrink-0 ${portrait ? "w-[118px]" : "w-[315px]"}`}>
                            <MediaCard
                                item={{
                                    id: item.id,
                                    title: item.title,
                                    thumb: item.poster ? proxyImg(item.poster) : `/api/media/thumbnail?filePath=${encodeURIComponent(item.path)}`,
                                    rating: item.rating,
                                    year: item.year,
                                    type: item.type,
                                }}
                                href={isBook
                                    ? `/reader/epub?path=${encodeURIComponent(item.path)}`
                                    : `/watch?filePath=${encodeURIComponent(item.path)}`}
                                variant={portrait ? "portrait" : "landscape"}
                                badge={isBook ? "书籍" : item.episodeLabel || undefined}
                                progress={item.progressPct}
                                meta={
                                    isBook
                                        ? `已读 ${item.progressPct}%`
                                        : item.episodeLabel
                                            ? `${item.episodeLabel} · ${item.progressPct}%`
                                            : `已看 ${item.progressPct}%`
                                }
                            />
                        </div>
                    );
                })}
            </div>
        </section>
    );
}

/* ─────────────── 分区长廊块 ───────────────
   巨型描边编号 + 标题 + 卡片横排（w-max，不自己滚）。
   多个块拼进外层的两行网格里，整体一个横向滚动条同步滑。 */
function GalleryRow({ no, title, items, onRefresh }: {
    no: string;
    title: string;
    items: MediaItem[];
    onRefresh: () => void;
}) {
    if (!items || items.length === 0) return null;
    const cinema = isCinema(items[0]?.type);
    return (
        <section className="relative w-max shrink-0 snap-start">
            {/* 背景巨型描边编号：杂志刊号感，纯装饰 */}
            <div
                aria-hidden
                className="pointer-events-none absolute -top-6 left-0 select-none font-display text-[96px] leading-none opacity-[0.07] sm:text-[128px]"
                style={{ WebkitTextStroke: "2.5px var(--color-text-1)", color: "transparent" }}
            >
                {no}
            </div>
            <div className="relative mb-3 flex items-end gap-5 pt-5">
                <div className="flex items-baseline gap-3">
                    <span className="font-display text-[13px] tracking-[0.35em] text-primary">{no}</span>
                    <h2 className="font-display text-[24px] tracking-tight text-text-1">{title}</h2>
                </div>
                <button
                    onClick={onRefresh}
                    className="flex cursor-pointer items-center gap-1 text-[13px] text-text-3 transition-colors hover:text-primary"
                >
                    换一批 <span className="text-[15px]">↻</span>
                </button>
            </div>
            <div className="flex w-max gap-4">
                {items.slice(0, 10).map((item) => (
                    <div key={item.id} className={`shrink-0 ${cinema ? "w-[150px] sm:w-[164px]" : "w-[240px] sm:w-[272px]"}`}>
                        <MediaCard
                            item={{
                                id: item.id,
                                title: item.title,
                                thumb: item.poster ? proxyImg(item.poster) : thumbOf(item),
                                rating: item.rating,
                                year: item.year,
                                type: item.type,
                            }}
                            href={itemHref(item)}
                            variant={cinema ? "portrait" : "landscape"}
                            meta={metaText(item)}
                        />
                    </div>
                ))}
            </div>
        </section>
    );
}

/* ─────────────── 首页 ─────────────── */
export default function Home() {
    const [data, setData] = useState<LatestData>({
        recommended: [], movie: [], series: [], anime: [], travel: [],
    });
    const [continueItems, setContinueItems] = useState<ContinueItem[]>([]);
    const [loading, setLoading] = useState(true);
    const me = useMe(); // 未登录 → 顶部谷歌登录引导横幅

    useEffect(() => {
        const load = async () => {
            try {
                const [latestRes, cwRes] = await Promise.allSettled([
                    fetch("/api/media/latest").then((r) => r.json()),
                    fetch("/api/media/continue-watching").then((r) => r.json()),
                ]);
                if (latestRes.status === "fulfilled" && latestRes.value.success && latestRes.value.data) {
                    setData(latestRes.value.data);
                }
                if (cwRes.status === "fulfilled" && cwRes.value.success && cwRes.value.data) {
                    setContinueItems(cwRes.value.data);
                }
            } catch (e) {
                console.error("Failed to load latest media", e);
            } finally {
                setLoading(false);
            }
        };
        load();
    }, []);

    const handleRefresh = async (sectionKey: string) => {
        try {
            const res = await fetch(`/api/media/latest?type=${sectionKey}&random=1`);
            const json = await res.json();
            if (json.success && json.data && json.data[sectionKey]) {
                setData((prev) => ({ ...prev, [sectionKey]: json.data[sectionKey] }));
            }
        } catch (e) {
            console.error("Failed to refresh", e);
        }
    };

    // banner 候选：带横版背景图的影剧优先
    const heroItems = useMemo(() => {
        const pool = [
            ...(data.series || []),
            ...(data.anime || []),
            ...(data.movie || []),
            ...(data.recommended || []),
        ];
        const seen = new Set<string>();
        return pool.filter((i) => {
            if (!i.backdrop || seen.has(i.id)) return false;
            seen.add(i.id);
            return true;
        }).slice(0, 5);
    }, [data]);

    const recommended = data.recommended || [];
    // 随机一部/星图的候选池：全部分区打平
    const bentoPool = useMemo(
        () => Object.values(data).flat().filter((i): i is MediaItem => !!i && !!(i as MediaItem).id),
        [data]
    );
    const sections = [
        { key: "movie", title: "电影" },
        { key: "series", title: "电视剧" },
        { key: "anime", title: "动漫" },
        { key: "travel", title: "旅行相册" },
    ];

    // 未登录：首页只出居中的登录卡片，不渲染 Banner/货架骨架（避免大片空白）
    if (!me.loading && !me.loggedIn) {
        return (
            <div className="flex w-full items-center justify-center py-10 md:py-16">
                <GoogleLoginBanner />
            </div>
        );
    }

    // 已登录但一条内容都没有（权限待开通/媒体库空）：安抚插画，不渲染空货架
    const hasAnyContent =
        continueItems.length > 0 ||
        Object.values(data).some((arr) => Array.isArray(arr) && arr.length > 0);
    if (!loading && !hasAnyContent) {
        return (
            <div className="flex w-full items-center justify-center">
                <EmptyHome />
            </div>
        );
    }

    return (
        <div className="w-full space-y-6 pb-10">
            {loading ? (
                <div className="space-y-8">
                    {/* 骨架：天窗 + 掌舵台 + 长廊 */}
                    <div className="h-[420px] w-full animate-pulse rounded-2xl bg-bg-hover sm:h-[380px]" />
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                        {Array.from({ length: 3 }).map((_, i) => (
                            <div key={i} className="h-[73px] animate-pulse rounded-xl bg-bg-hover" />
                        ))}
                    </div>
                    <div>
                        <div className="mb-4 h-7 w-40 animate-pulse rounded bg-bg-hover" />
                        <div className="flex gap-4 overflow-hidden">
                            {Array.from({ length: 6 }).map((_, i) => (
                                <div key={i} className="w-[160px] shrink-0"><MediaCardSkeleton /></div>
                            ))}
                        </div>
                    </div>
                </div>
            ) : (
                <>
                    {/* ① 双 section 头版：左问候卡（干净底）+ 右轮播图（独立块，不拉糊） */}
                    <StarHero heroItems={heroItems} pool={bentoPool} />

                    {/* ② 掌舵台：四张"马上出发"卡 + 全站入口药丸，一屏拿齐 */}
                    <DeckRow continueItems={continueItems} allPool={bentoPool} />

                    {/* ③ 继续观看：掌舵台已含第一条，这里放随后的（一行放得下几张放几张） */}
                    {continueItems.length > 1 && (
                        <div className="scroll-reveal"><ContinueRow items={continueItems.slice(1, 15)} /></div>
                    )}

                    {/* ④ 分区长廊：两行并排（行1=01·02，行2=03·04），整体一个横向滚动同步滑 */}
                    <GalleryScroller>
                        <div className="flex items-start gap-16">
                            {sections.slice(0, 2).map((sec, i) => (
                                <GalleryRow key={sec.key} no={String(i + 1).padStart(2, "0")} title={sec.title}
                                    items={data[sec.key]} onRefresh={() => handleRefresh(sec.key)} />
                            ))}
                        </div>
                        <div className="flex items-start gap-16">
                            {sections.slice(2, 4).map((sec, i) => (
                                <GalleryRow key={sec.key} no={String(i + 3).padStart(2, "0")} title={sec.title}
                                    items={data[sec.key]} onRefresh={() => handleRefresh(sec.key)} />
                            ))}
                        </div>
                    </GalleryScroller>
                </>
            )}
        </div>
    );
}
