"use client";

// 音乐剧专区：独立页面（与电影/剧集同级），导航栏直达。
// 内容全是外站资源——每日精选（TMDB 音乐类高分轮换）+ 我的外站收藏（随机添加入库），
// 点卡片弹 fetch-out 菜单跳合法平台（B站官摄/腾讯/YouTube/BroadwayHD）。
// 随机添加仅管理员；普通用户可看可点跳转，不能往里加。
import { useEffect, useState } from "react";
import { FetchOutMenu } from "../../../components/FetchOutMenu";
import { RandomAddQuiz } from "../../../components/RandomAddQuiz";
import { useMe } from "../../../components/useMe";
import { LoginGate } from "../../../components/LoginGate";
import { PageHeader } from "../../../components/PageHeader";
import { useLang } from "../../../lib/i18n";

const FALLBACK_IMG = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjM2YzZjQ2IiBzdHJva2Utd2lkdGg9IjIiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCI+PHJlY3QgeD0iMyIgeT0iMyIgd2lkdGg9IjE4IiBoZWlnaHQ9IjE4IiByeD0iMiIgcnk9IjIiPjwvcmVjdD48Y2lyY2xlIGN4PSI4LjUiIGN5PSI4LjUiIHI9IjEuNSI+PC9jaXJjbGU+PHBvbHlsaW5lIHBvaW50cz0iMjEgMTUgMTYgMTAgNSAyMSI+PC9wb2x5bGluZT48L3N2Zz4=';

interface Item {
    id: string | number;
    title: string;
    poster: string | null;
    overview?: string;
    year?: number | null;
    rating?: number | null;
    ext?: boolean; // true = 我的外站收藏，false = 今日推荐
}

export default function MusicalPage() {
    const [recs, setRecs] = useState<Item[]>([]);
    const [mine, setMine] = useState<Item[]>([]);
    const [quiz, setQuiz] = useState(false);
    const [fo, setFo] = useState<{ title: string; overview?: string; x: number; y: number } | null>(null);
    const { me } = useMe();
    const isAdmin = me?.role === "boss" || me?.role === "admin";
    const { t } = useLang();

    const loadMine = () => {
        fetch("/api/external?type=musical")
            .then((r) => r.json())
            .then((d) => {
                if (d.success) setMine((d.data || []).map((x: { id: string; title: string; poster: string | null; overview: string; year: number | null; rating: number | null }) => ({ ...x, ext: true })));
            })
            .catch(() => { /* noop */ });
    };

    useEffect(() => {
        fetch("/api/discover/musicals")
            .then((r) => r.json())
            .then((d) => { if (d.success) setRecs((d.data || []).map((x: { id: number; title: string; poster: string | null; overview: string; year: number | null; rating: number | null }) => ({ ...x, ext: false }))); })
            .catch(() => { /* noop */ });
        loadMine();
    }, []);

    const removeMine = async (id: string | number) => {
        setMine((m) => m.filter((x) => x.id !== id));
        try { await fetch("/api/external", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) }); } catch { /* noop */ }
    };

    if (!me?.user && me !== null) return <LoginGate feature="音乐剧" />;
    // scope 守卫：boss/admin 或 scope 含 musical/'*' 才可见
    const musicalAllowed = me == null ? true
        : me.role === "boss" || me.role === "admin" || me.permissions === "*"
        || (me.permissions || "").split(",").map((x) => x.trim()).includes("musical");
    if (me && !musicalAllowed) {
        return (
            <div className="py-24 text-center text-text-3">
                <p className="text-[15px] font-medium text-text-2">音乐剧栏目未对你开放</p>
                <p className="mt-1.5 text-[13px]">找管理员在用户管理里勾选「音乐剧」即可解锁。</p>
            </div>
        );
    }

    return (
        <div className="w-full pb-20 text-text-1">
            {quiz && <RandomAddQuiz type="musical" onClose={() => setQuiz(false)} onDone={loadMine} />}
            {fo && <FetchOutMenu title={fo.title} overview={fo.overview} anchor={{ x: fo.x, y: fo.y }} kind="musical" onClose={() => setFo(null)} />}

            {/* 标题栏 */}
            <PageHeader
                title={t("音乐剧")}
                description={`${recs.length} 部今日推荐${mine.length > 0 ? ` · ${mine.length} 部收藏` : ""} · 舞台音乐剧，点卡片跳合法平台观看`}
                actions={isAdmin ? (
                    <button
                        onClick={() => setQuiz(true)}
                        className="flex cursor-pointer items-center gap-1 rounded-full border border-line px-3.5 py-1.5 text-[13px] text-text-2 transition-all hover:-translate-y-px hover:border-primary/50 hover:text-primary"
                    >
                        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" /></svg>
                        {t("随机添加")}
                    </button>
                ) : undefined}
            />

            {/* 今日推荐（TMDB 每日轮换）：横排，点卡跳外站 */}
            {recs.length > 0 && (
                <section className="mb-10">
                    <div className="mb-3 flex items-baseline gap-3">
                        <h2 className="font-display text-[20px] tracking-tight text-text-1">{t("今日推荐") /* fallback zh */}</h2>
                        <span className="text-[12px] text-text-3">每天换一批 · 点卡片选平台观看</span>
                    </div>
                    <div className="ios-scroll scrollbar-hide -mx-1 flex snap-x gap-4 overflow-x-auto px-1 pb-2">
                        {recs.map((m) => (
                            <Card key={`r${m.id}`} item={m} onOpen={setFo} />
                        ))}
                    </div>
                </section>
            )}

            {/* 我的外站收藏：网格 + 随机添加卡（admin） */}
            <section>
                <div className="mb-3 flex items-baseline gap-3">
                    <h2 className="font-display text-[20px] tracking-tight text-text-1">{t("我的收藏")}</h2>
                    <span className="text-[12px] text-text-3">{mine.length} 部 · 点卡片选平台观看</span>
                </div>
                {mine.length === 0 && !isAdmin ? (
                    <div className="rounded-xl border border-dashed border-line bg-bg-input/40 px-4 py-10 text-center text-[13px] text-text-3">
                        还没有收藏的音乐剧，问问管理员帮你加几部？
                    </div>
                ) : (
                    <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7">
                        {isAdmin && (
                            <button
                                onClick={() => setQuiz(true)}
                                className="group flex cursor-pointer flex-col rounded-xl text-left"
                            >
                                <div className="relative flex aspect-[2/3] w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-line bg-bg-input/50 transition-all duration-250 group-hover:-translate-y-1 group-hover:border-primary/60">
                                    <svg className="h-9 w-9 fill-text-3 transition-colors group-hover:fill-primary" viewBox="0 0 24 24"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" /></svg>
                                    <span className="text-[13px] font-medium text-text-3 transition-colors group-hover:text-primary">随机添加</span>
                                    <span className="px-4 text-center text-[11px] leading-relaxed text-text-4">按口味补 10 部<br />音乐剧</span>
                                </div>
                            </button>
                        )}
                        {mine.map((m) => (
                            <Card key={m.id} item={m} onOpen={setFo} onRemove={isAdmin ? removeMine : undefined} />
                        ))}
                    </div>
                )}
            </section>
        </div>
    );
}

function Card({ item, onOpen, onRemove }: {
    item: Item;
    onOpen: (v: { title: string; overview?: string; x: number; y: number }) => void;
    onRemove?: (id: string | number) => void;
}) {
    return (
        <div className="group/mus relative w-[124px] shrink-0 snap-start sm:w-[150px]">
            <button
                onClick={(e) => onOpen({ title: item.title, overview: item.overview, x: e.clientX, y: e.clientY })}
                className="block w-full cursor-pointer text-left"
            >
                <div className="relative aspect-[2/3] w-full overflow-hidden rounded-xl bg-bg-input transition-transform duration-250 group-hover/mus:-translate-y-1 group-hover/mus:shadow-[0_12px_28px_rgba(0,0,0,0.14)]">
                    {item.poster ? (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img src={item.poster} alt={item.title} loading="lazy" className="h-full w-full object-cover"
                            onError={(e) => { (e.target as HTMLImageElement).src = FALLBACK_IMG; }} />
                    ) : (
                        <div className="flex h-full w-full items-center justify-center p-2 text-center text-[12px] text-text-3">{item.title}</div>
                    )}
                    <div className={`absolute top-1.5 right-1.5 rounded-full px-2 py-[3px] text-[10px] font-bold leading-none backdrop-blur-[2px] ${item.ext ? "border border-brand-cyan/70 bg-black/65 text-brand-cyan" : "bg-black/60 text-white/85"}`}>
                        {item.ext ? "外站" : "今日"}
                    </div>
                </div>
                <div className="mt-2 line-clamp-1 text-[13px] font-medium text-text-1 transition-colors group-hover/mus:text-primary">{item.title}</div>
                <div className="text-[11px] text-text-3">{item.year || ""}{item.rating ? ` · ★ ${Number(item.rating).toFixed(1)}` : ""}</div>
            </button>
            {onRemove && (
                <button
                    onClick={(e) => { e.stopPropagation(); onRemove(item.id); }}
                    aria-label="移除"
                    className="absolute left-1.5 top-1.5 z-10 hidden h-6 w-6 cursor-pointer items-center justify-center rounded-full bg-black/60 text-[13px] text-white/85 hover:bg-black/80 group-hover/mus:flex"
                >×</button>
            )}
        </div>
    );
}
