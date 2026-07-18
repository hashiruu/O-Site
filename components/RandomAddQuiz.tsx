"use client";

// 随机添加弹层：两个模式并列——
// 「随机」：问 3-4 个喜好问题，按答案从 TMDB/豆瓣拉 10 个不重复的高人气内容入库；
// 「搜索」：输关键词 → TMDB/豆瓣/音乐剧清单出候选 → 点选确认单条入库（带海报与简介预览）。
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLang } from "../lib/i18n";

interface Question { key: string; title: string; options: { value: string; label: string; desc?: string }[] }

const COMMON: Question[] = [
    {
        key: "mood", title: "今天想要什么感觉？",
        options: [
            { value: "relax", label: "轻松治愈", desc: "喜剧 · 家庭" },
            { value: "blood", label: "热血冒险", desc: "冒险 · 动作" },
            { value: "brain", label: "烧脑回味", desc: "剧情 · 悬疑" },
            { value: "dream", label: "奇幻脑洞", desc: "奇幻 · 科幻" },
        ],
    },
    {
        key: "era", title: "新老口味？",
        options: [
            { value: "new", label: "近三年新作" },
            { value: "classic", label: "十年以上经典" },
            { value: "any", label: "都可以" },
        ],
    },
    {
        key: "taste", title: "热门还是冷门？",
        options: [
            { value: "hot", label: "大家都在看的" },
            { value: "gem", label: "小众高分遗珠" },
        ],
    },
];

const QUIZ: Record<string, Question[]> = {
    movie: COMMON,
    series: COMMON,
    anime: COMMON.slice(1), // 动漫固定 genre，只问年代与冷热
    musical: [
        {
            key: "mood", title: "偏爱哪种音乐剧？",
            options: [
                { value: "classic", label: "经典正剧", desc: "剧情 · 舞台改编" },
                { value: "toon", label: "动画歌舞", desc: "迪士尼系" },
                { value: "love", label: "浪漫歌舞", desc: "爱情 · 歌舞片" },
            ],
        },
        ...COMMON.slice(1),
    ],
    book: [
        {
            key: "shelf", title: "想读哪一类？",
            options: [
                { value: "best", label: "综合畅销榜" },
                { value: "fiction", label: "虚构 · 小说" },
                { value: "nonfiction", label: "非虚构 · 纪实" },
            ],
        },
    ],
};

export function RandomAddQuiz({ type, onClose, onDone }: {
    type: string;
    onClose: () => void;
    onDone: (added: number) => void;
}) {
    const { t } = useLang();
    const questions = QUIZ[type] || COMMON;
    const [step, setStep] = useState(0);
    const [answers, setAnswers] = useState<Record<string, string>>({});
    const [busy, setBusy] = useState(false);
    const [result, setResult] = useState<{ added: number } | null>(null);
    const [err, setErr] = useState("");
    // 关键词添加模式
    const [mode, setMode] = useState<"quiz" | "search">("quiz");
    const [kw, setKw] = useState("");
    const [searching, setSearching] = useState(false);
    const [cands, setCands] = useState<{ key: string; title: string; poster: string | null; overview: string; year: number | null; rating: number | null; tmdbId: number | null }[]>([]);
    const [addedKeys, setAddedKeys] = useState<Set<string>>(new Set());
    const [addedCount, setAddedCount] = useState(0);
    const debRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // 输入防抖搜索
    useEffect(() => {
        if (mode !== "search") return;
        if (debRef.current) clearTimeout(debRef.current);
        const query = kw.trim();
        if (!query) { setCands([]); return; }
        debRef.current = setTimeout(async () => {
            setSearching(true);
            try {
                const r = await fetch(`/api/external/search?type=${type}&q=${encodeURIComponent(query)}`);
                const d = await r.json();
                setCands(d.success ? d.data || [] : []);
            } catch { setCands([]); }
            finally { setSearching(false); }
        }, 350);
    }, [kw, mode, type]);

    const addOne = async (c: { key: string; title: string; poster: string | null; overview: string; year: number | null; rating: number | null; tmdbId: number | null }) => {
        setErr("");
        try {
            const res = await fetch("/api/external", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ type, item: c }),
            });
            const d = await res.json();
            if (d.success) {
                setAddedKeys((prev) => new Set(prev).add(c.key));
                setAddedCount((n) => n + 1);
                onDone(1);
            } else {
                setErr(d.error === "DUPLICATE" ? `《${c.title}》已在库中` : d.error === "ADMIN_ONLY" ? "仅管理员可添加" : "添加失败，稍后再试");
            }
        } catch { setErr("网络开小差了，稍后再试"); }
    };

    const submit = async (final: Record<string, string>) => {
        setBusy(true); setErr("");
        try {
            const res = await fetch("/api/external", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ type, answers: final }),
            });
            const d = await res.json();
            if (d.success) { setResult({ added: d.added }); onDone(d.added); }
            else setErr(d.error === "LOGIN_REQUIRED" ? "请先登录再添加" : "添加失败，稍后再试");
        } catch { setErr("网络开小差了，稍后再试"); }
        finally { setBusy(false); }
    };

    const pick = (value: string) => {
        const q = questions[step];
        const next = { ...answers, [q.key]: value };
        setAnswers(next);
        if (step + 1 < questions.length) setStep(step + 1);
        else void submit(next);
    };

    const q = questions[step];
    // portal 到 body：同 FetchOutMenu——防 transform 父级劫持 fixed
    return createPortal(
        <div className="fixed inset-0 z-[210] flex items-end justify-center sm:items-center" role="dialog" aria-modal>
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={busy ? undefined : onClose} />
            <div className="animate-fadeIn relative w-full max-w-sm rounded-t-2xl border border-line bg-bg-card p-5 shadow-2xl sm:rounded-2xl">
                {result ? (
                    <div className="py-4 text-center">
                        <div className="font-display text-[34px] text-primary">+{result.added}</div>
                        <p className="mt-1.5 text-[14px] font-semibold text-text-1">
                            {result.added > 0 ? t("已添加到这个分区") : t("这个口味暂时没挖到新内容")}
                        </p>
                        <p className="mt-1 text-[12px] leading-relaxed text-text-3">
                            {result.added > 0 ? "带「外站」角标的就是新成员，点开可跳转合法平台观看。" : "换个口味再试一次？"}
                        </p>
                        <button onClick={onClose} className="mt-4 w-full cursor-pointer rounded-full bg-primary py-2 text-[13px] font-semibold text-white transition-transform hover:scale-[1.02]">
                            {t("好的")}
                        </button>
                    </div>
                ) : busy ? (
                    <div className="flex flex-col items-center py-8">
                        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                        <p className="mt-3 text-[13px] text-text-3">{t("正在按你的口味挑选…")}</p>
                    </div>
                ) : (
                    <>
                        {/* 模式切换：随机(问卷) / 搜索(关键词点选) */}
                        <div className="mb-3 flex rounded-full border border-line bg-bg-input p-0.5 text-[12.5px]">
                            {([["quiz", "🎲 随机添加"], ["search", "🔍 关键词添加"]] as const).map(([m, label]) => (
                                <button
                                    key={m}
                                    onClick={() => { setMode(m); setErr(""); }}
                                    className={`flex-1 cursor-pointer rounded-full py-1.5 text-center transition-colors ${mode === m ? "bg-bg-card font-semibold text-text-1 shadow-sm" : "text-text-3 hover:text-text-1"}`}
                                >
                                    {label}
                                </button>
                            ))}
                        </div>

                        {mode === "quiz" ? (
                            <>
                                <div className="text-[11px] font-semibold tracking-[0.22em] text-text-3">{t("随机添加 · 先聊聊口味")}</div>
                                <div className="mt-1.5 text-[16px] font-semibold text-text-1">{q.title}</div>
                                <div className="mt-3.5 space-y-2">
                                    {q.options.map((o) => (
                                        <button
                                            key={o.value}
                                            onClick={() => pick(o.value)}
                                            className="flex w-full cursor-pointer items-center justify-between rounded-xl border border-line bg-bg-input px-4 py-2.5 text-left text-[14px] text-text-1 transition-all hover:-translate-y-px hover:border-primary/50 hover:text-primary"
                                        >
                                            {o.label}
                                            {o.desc && <span className="text-[11px] text-text-3">{o.desc}</span>}
                                        </button>
                                    ))}
                                </div>
                                {err && <p className="mt-3 text-center text-[12px] text-red-500">{err}</p>}
                                <div className="mt-4 flex items-center justify-center gap-1.5">
                                    {questions.map((_, i) => (
                                        <span key={i} className={`rounded-full transition-all ${i === step ? "h-1.5 w-5 bg-primary" : "h-1.5 w-1.5 bg-line"}`} />
                                    ))}
                                </div>
                            </>
                        ) : (
                            <>
                                <div className="text-[11px] font-semibold tracking-[0.22em] text-text-3">{t("关键词添加 · 搜到什么加什么")}</div>
                                <input
                                    autoFocus
                                    value={kw}
                                    onChange={(e) => setKw(e.target.value)}
                                    placeholder={type === "book" ? "输入书名 / 作者…" : "输入片名 / 剧名…"}
                                    className="mt-2.5 w-full rounded-xl border border-line bg-bg-input px-4 py-2.5 text-[14px] text-text-1 outline-none transition-colors placeholder:text-text-3 focus:border-primary"
                                />
                                <div className="scrollbar-hide mt-3 max-h-[46vh] space-y-2 overflow-y-auto">
                                    {searching && <p className="py-6 text-center text-[12px] text-text-3">搜索中…</p>}
                                    {!searching && kw.trim() && cands.length === 0 && (
                                        <p className="py-6 text-center text-[12px] text-text-3">没搜到「{kw.trim()}」，换个词试试</p>
                                    )}
                                    {cands.map((c) => {
                                        const done = addedKeys.has(c.key);
                                        return (
                                            <div key={c.key} className="flex items-center gap-3 rounded-xl border border-line bg-bg-input p-2">
                                                {c.poster ? (
                                                    /* eslint-disable-next-line @next/next/no-img-element */
                                                    <img src={c.poster} alt="" className="h-[60px] w-[42px] shrink-0 rounded-md object-cover" loading="lazy" />
                                                ) : (
                                                    <span className="flex h-[60px] w-[42px] shrink-0 items-center justify-center rounded-md bg-bg-tag text-[10px] text-text-4">无图</span>
                                                )}
                                                <div className="min-w-0 flex-1">
                                                    <div className="line-clamp-1 text-[13.5px] font-medium text-text-1">{c.title}</div>
                                                    <div className="text-[11px] text-text-3">
                                                        {c.year || ""}{c.rating ? ` · ★ ${Number(c.rating).toFixed(1)}` : ""}
                                                    </div>
                                                    {c.overview && <div className="line-clamp-1 text-[11px] text-text-3">{c.overview}</div>}
                                                </div>
                                                <button
                                                    onClick={() => !done && void addOne(c)}
                                                    disabled={done}
                                                    className={`shrink-0 rounded-full px-3.5 py-1.5 text-[12px] font-semibold transition-all ${
                                                        done
                                                            ? "cursor-default bg-bg-tag text-text-3"
                                                            : "cursor-pointer bg-primary text-white hover:scale-105"
                                                    }`}
                                                >
                                                    {done ? t("已添加 ✓") : t("添加")}
                                                </button>
                                            </div>
                                        );
                                    })}
                                </div>
                                {err && <p className="mt-3 text-center text-[12px] text-red-500">{err}</p>}
                                {addedCount > 0 && (
                                    <p className="mt-3 text-center text-[12px] text-text-3">本次已添加 {addedCount} 部，关闭后即可在分区看到</p>
                                )}
                            </>
                        )}
                    </>
                )}
            </div>
        </div>,
        document.body
    );
}
