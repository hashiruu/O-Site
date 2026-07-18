// 关于网站：商业站规格 —— Hero 大标题 + 功能卡网格 + 团队 + Fable 5 认证。
// 顶栏右上角菜单「系统设置」下一行进入。
import pkg from "../../package.json";

export const metadata = { title: "关于网站 · O-Site" };

// 图标：Material Design 官方 path（24×24 fill），与顶栏菜单图标同一体系，不用 emoji
const FEATURES = [
    { title: "影视", desc: "电影 / 剧集 / 动漫，高清海报墙，点开即看，自动记住看到哪", tint: "bg-primary/10 text-primary", icon: "M18 4l2 4h-3l-2-4h-2l2 4h-3l-2-4H8l2 4H7L5 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V4h-4z" },
    { title: "直播", desc: "热门频道实时转播，还能开弹幕一起看", tint: "bg-secondary/10 text-secondary", icon: "M21 6h-7.59l3.29-3.29L16 2l-4 4-4-4-.71.71L10.59 6H3c-1.1 0-2 .89-2 2v12c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V8c0-1.11-.9-2-2-2zm0 14H3V8h18v12zM9 10v8l7-4z" },
    { title: "体育", desc: "世界杯赛程与对阵图一目了然，比赛一键直达直播", tint: "bg-primary/10 text-primary", icon: "M19 5h-2V3H7v2H5c-1.1 0-2 .9-2 2v1c0 2.55 1.92 4.63 4.39 4.94.63 1.5 1.98 2.63 3.61 2.96V19H7v2h10v-2h-4v-3.1c1.63-.33 2.98-1.46 3.61-2.96C19.08 12.63 21 10.55 21 8V7c0-1.1-.9-2-2-2zM5 8V7h2v3.82C5.84 10.4 5 9.3 5 8zm14 0c0 1.3-.84 2.4-2 2.82V7h2v1z" },
    { title: "书架", desc: "像真书架一样的书墙，字号、背景、翻页都随你调", tint: "bg-secondary/10 text-secondary", icon: "M21 5c-1.11-.35-2.33-.5-3.5-.5-1.95 0-4.05.4-5.5 1.5-1.45-1.1-3.55-1.5-5.5-1.5S2.45 4.9 1 6v14.65c0 .25.25.5.5.5.1 0 .15-.05.25-.05C3.1 20.45 5.05 20 6.5 20c1.95 0 4.05.4 5.5 1.5 1.35-.85 3.8-1.5 5.5-1.5 1.65 0 3.35.3 4.75 1.05.1.05.15.05.25.05.25 0 .5-.25.5-.5V6c-.6-.45-1.25-.75-2-1zm0 13.5c-1.1-.35-2.3-.5-3.5-.5-1.7 0-4.15.65-5.5 1.5V8c1.35-.85 3.8-1.5 5.5-1.5 1.2 0 2.4.15 3.5.5v11.5z" },
    { title: "旅行相册", desc: "值得纪念的旅程，随时翻回那一天", tint: "bg-secondary/10 text-secondary", icon: "M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z" },
    { title: "收藏与清单", desc: "收藏、播放列表、热点补课清单，把想看的都存下来", tint: "bg-primary/10 text-primary", icon: "M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" },
];

const CONTRIBUTORS = [
    { name: "Steven", role: "站长 · 产品与开发", icon: "M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" },
    { name: "Claude Fable 5", role: "AI 协作开发 · Anthropic", icon: "M20 9V7c0-1.1-.9-2-2-2h-3c0-1.66-1.34-3-3-3S9 3.34 9 5H6c-1.1 0-2 .9-2 2v2c-1.66 0-3 1.34-3 3s1.34 3 3 3v4c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2v-4c1.66 0 3-1.34 3-3s-1.34-3-3-3zM7.5 11.5c0-.83.67-1.5 1.5-1.5s1.5.67 1.5 1.5S9.83 13 9 13s-1.5-.67-1.5-1.5zM16 17H8v-2h8v2zm-1-4c-.83 0-1.5-.67-1.5-1.5S14.17 10 15 10s1.5.67 1.5 1.5S15.83 13 15 13z" },
];

export default function AboutPage() {
    return (
        <div className="mx-auto w-full max-w-5xl text-text-1">
            {/* ── Hero：居中大标题（商业站头版规格） ── */}
            <section
                className="relative mb-14 flex flex-col items-center overflow-hidden rounded-3xl border border-line bg-bg-card px-6 py-16 text-center sm:py-20"
            >
                {/* 品牌色氛围光（面积克制，遵守彩色 ≤10%） */}
                <div
                    className="pointer-events-none absolute inset-x-0 top-0 h-52"
                    style={{ background: "radial-gradient(60% 100% at 50% 0%, var(--color-accent-glow), transparent 70%)" }}
                />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/logo/circle.png" alt="O-Site" className="relative mb-6 h-20 w-20 object-contain" />
                <h1 className="font-display relative text-[38px] leading-tight tracking-tight sm:text-[48px]">O-Site</h1>
                <p className="relative mt-4 max-w-xl text-[15px] leading-relaxed text-text-2">
                    电影、剧集、动漫、直播、体育与好书，
                    <br className="hidden sm:block" />
                    想看的，打开就有。
                </p>
                <div className="relative mt-6 flex items-center gap-3">
                    <span className="rounded-full border border-line bg-bg px-3.5 py-1 text-[12px] font-medium text-text-2">
                        v{pkg.version}
                    </span>
                    <span className="rounded-full border border-line bg-bg px-3.5 py-1 text-[12px] font-medium text-text-2">
                        无广告
                    </span>
                    <span className="rounded-full bg-primary/10 px-3.5 py-1 text-[12px] font-semibold text-primary">
                        Fable 5 Verified
                    </span>
                </div>
            </section>

            {/* ── 功能矩阵 ── */}
            <section className="mb-14">
                <div className="mb-7 text-center">
                    <h2 className="text-2xl font-bold tracking-tight">一站式家庭媒体平台</h2>
                    <p className="mt-2 text-[14px] text-text-3">六大核心模块，覆盖全家的观看、阅读与收藏</p>
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {FEATURES.map((f) => (
                        <div
                            key={f.title}
                            className="card-lift rounded-2xl border border-line bg-bg-card p-5"
                        >
                            <div className={`mb-4 flex h-11 w-11 items-center justify-center rounded-xl ${f.tint}`}>
                                <svg viewBox="0 0 24 24" className="h-6 w-6" fill="currentColor" aria-hidden="true">
                                    <path d={f.icon} />
                                </svg>
                            </div>
                            <h3 className="text-[15px] font-semibold">{f.title}</h3>
                            <p className="mt-1.5 text-[13px] leading-relaxed text-text-3">{f.desc}</p>
                        </div>
                    ))}
                </div>
            </section>

            {/* ── 团队 ── */}
            <section className="mb-14">
                <div className="mb-7 text-center">
                    <h2 className="text-2xl font-bold tracking-tight">Contributors</h2>
                </div>
                <div className="mx-auto grid max-w-2xl grid-cols-1 gap-4 sm:grid-cols-2">
                    {CONTRIBUTORS.map((c) => (
                        <div key={c.name} className="card-lift flex items-center gap-4 rounded-2xl border border-line bg-bg-card p-5">
                            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                                <svg viewBox="0 0 24 24" className="h-7 w-7" fill="currentColor" aria-hidden="true">
                                    <path d={c.icon} />
                                </svg>
                            </div>
                            <div className="min-w-0">
                                <div className="text-[15px] font-semibold">{c.name}</div>
                                <div className="mt-0.5 text-[12px] text-text-3">{c.role}</div>
                            </div>
                        </div>
                    ))}
                </div>
            </section>

            {/* ── Fable 5 认证 ── */}
            <section className="mb-10 flex flex-col items-center rounded-3xl border border-line bg-bg-card px-6 py-12">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/fable-5-verified.png" alt="Fable 5 Verified" className="w-[300px] max-w-full" />
                <p className="mt-4 text-center text-[13px] text-text-3">
                    本站由 Claude Fable 5 参与构建并通过验证 · Built with Claude Fable 5
                </p>
            </section>
        </div>
    );
}
