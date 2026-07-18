"use client";

// /reader/epub?path=<绝对路径>
// 客户端 epubjs 阅读器：文件流走 /api/books/file（application/epub+zip），
// epubjs 仅在浏览器端动态 import（避免 SSR 阶段碰 window）。
// 交互：左右按钮 + 键盘 ←/→ 翻页，顶部返回书架 + 书名 + "Aa" 阅读设置。
//
// 阅读设置三层方案：书籍默认 < 用户级方案 < 单本书覆盖（/api/reader-settings 持久化，跟账号走）。
// 全部为 default 时完全不干预书籍自带样式。
// 外观应用走 themes.override（body 内联样式，可干净回退）+ 深层选择器 stylesheet
// （压住书内写死在 p/div 上的颜色字体；每次用递增 key 注册，后插入者胜）。
// 翻页方式切换、回退到"书籍默认"时重建 rendition（记下 cfi，重建后 display 回原位）。
import Link from "next/link";
import { Suspense, useEffect, useLayoutEffect, useReducer, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { marked } from "marked";
import type { Book, Rendition } from "epubjs";
import { useTheme } from "@/components/ThemeProvider";

type ThemeKey = "default" | "light" | "sepia" | "green" | "dark";
type FontKey = "default" | "serif" | "sans" | "kai" | "yuan" | "shsSerif";
type FlowKey = "paginated" | "scrolled" | "slide";
type MarginKey = "narrow" | "standard" | "wide";

type ReaderSettings = {
    fontSize: number; // 80-160，步进 10，100 = 默认
    theme: ThemeKey;
    font: FontKey;
    flow: FlowKey;
    margin: MarginKey;   // 页边距：控制书页列宽（边距越宽列越窄）
    lineHeight: number;  // 行距 ×10：0 = 书籍默认，15/18/22 = 1.5/1.8/2.2
    bold: boolean;       // 字重：正文整体加粗
    ttsVoice: string;    // 朗读音色（edge-tts voice id）
    ttsRate: number;     // 朗读语速 %：-25/0/25/50（edge-tts --rate）
};

// 默认上下滚动（站长钦定：网页阅读的自然姿势），左右翻页作为可选项保留
const DEFAULT_SETTINGS: ReaderSettings = {
    fontSize: 100, theme: "default", font: "default", flow: "scrolled",
    margin: "standard", lineHeight: 0, bold: false,
    ttsVoice: "zh-CN-XiaoxiaoNeural", ttsRate: 50,
};

const TTS_VOICE_OPTIONS: { key: string; label: string }[] = [
    { key: "zh-CN-XiaoxiaoNeural", label: "晓晓·女" },
    { key: "zh-CN-XiaoyiNeural", label: "晓伊·女" },
    { key: "zh-CN-YunxiNeural", label: "云希·男" },
    { key: "zh-CN-YunyangNeural", label: "云扬·男" },
];
// 语速整体上调一档（站长实测原速太拖）：慢=原正常，正常=+50%，快=+100%，很快=+150%
const TTS_RATE_OPTIONS: { key: number; label: string }[] = [
    { key: 0, label: "慢" },
    { key: 50, label: "正常" },
    { key: 100, label: "快" },
    { key: 150, label: "很快" },
];

// 页边距 → 书页列宽。用 min(视口百分比, 上限px)：不同设备按实际宽度动态缩放，
// 窄/标准/宽在手机/平板/桌面上都各有区别；大屏又被上限 px 兜住，不会宽到离谱。
// [vw%, 最大px]，边距越"宽"→ 列越窄（vw 和 px 都更小）
const MARGIN_WIDTHS: Record<MarginKey, { paginated: [number, number]; scrolled: [number, number] }> = {
    narrow: { paginated: [96, 1360], scrolled: [94, 1000] },
    standard: { paginated: [82, 1100], scrolled: [80, 820] },
    wide: { paginated: [66, 880], scrolled: [64, 660] },
};
const marginWidth = (m: MarginKey, flow: FlowKey): string => {
    const [vw, px] = MARGIN_WIDTHS[m][flow === "scrolled" ? "scrolled" : "paginated"];
    return `min(${vw}vw, ${px}px)`;
};

const THEME_COLORS: Record<Exclude<ThemeKey, "default">, { bg: string; fg: string }> = {
    light: { bg: "#ffffff", fg: "#1a1a1a" },
    sepia: { bg: "#f3efdc", fg: "#3a3428" }, // 纸黄压低红分量（旧值 #f6f0e0 R-G 差 6 偏红，现在差 4 偏黄）
    green: { bg: "#cfe8d2", fg: "#22322a" }, // 护眼：经典淡绿纸
    dark: { bg: "#111111", fg: "#c8c8c8" },
};

// 荧光笔色板（半透明，各背景下都能透出文字）：黄/绿/粉/蓝
const HL_COLORS = [
    { bg: "rgba(255,213,74,0.45)", label: "黄" },
    { bg: "rgba(129,212,131,0.42)", label: "绿" },
    { bg: "rgba(244,143,177,0.42)", label: "粉" },
    { bg: "rgba(129,199,245,0.42)", label: "蓝" },
];

const FONT_STACKS: Record<Exclude<FontKey, "default">, string> = {
    serif: 'Georgia, "Noto Serif SC", serif',
    sans: 'system-ui, "PingFang SC", sans-serif',
    // 楷体/圆体走系统字体（Mac: Kaiti SC/Yuanti SC；Win: 楷体/幼圆），思源宋体注入网络字体兜底
    kai: '"Kaiti SC", "楷体", KaiTi, STKaiti, "AR PL UKai CN", serif',
    yuan: '"Yuanti SC", "圆体-简", YouYuan, "幼圆", "PingFang SC", "Microsoft YaHei", sans-serif',
    // Noto Serif SC 在前：自托管 webfont 必定可用；系统装了正版思源宋体（Source Han Serif）同款设计
    shsSerif: '"Noto Serif SC", "Source Han Serif SC", "思源宋体", Georgia, serif',
};

const THEME_OPTIONS: { key: ThemeKey; label: string }[] = [
    { key: "default", label: "默认" },
    { key: "light", label: "白" },
    { key: "sepia", label: "米黄" },
    { key: "green", label: "护眼" },
    { key: "dark", label: "夜间" },
];
const FONT_OPTIONS: { key: FontKey; label: string }[] = [
    { key: "default", label: "默认" },
    { key: "serif", label: "衬线" },
    { key: "sans", label: "无衬线" },
    { key: "kai", label: "楷体" },
    { key: "yuan", label: "圆体" },
    { key: "shsSerif", label: "思源宋" },
];
const FLOW_OPTIONS: { key: FlowKey; label: string }[] = [
    { key: "scrolled", label: "上下滚动" },
    { key: "paginated", label: "左右翻页" },
    { key: "slide", label: "仿真滑动" },
];
const MARGIN_OPTIONS: { key: MarginKey; label: string }[] = [
    { key: "narrow", label: "窄" },
    { key: "standard", label: "标准" },
    { key: "wide", label: "宽" },
];
const LINE_HEIGHT_OPTIONS: { key: number; label: string }[] = [
    { key: 0, label: "默认" },
    { key: 15, label: "紧凑" },
    { key: 18, label: "舒适" },
    { key: 22, label: "疏朗" },
];

/** 服务端数据可能残缺/越界，落地前统一收敛 */
function normalize(raw: Partial<ReaderSettings> | null | undefined): ReaderSettings {
    const s = { ...DEFAULT_SETTINGS, ...(raw || {}) };
    const size = Number(s.fontSize);
    const lh = Number(s.lineHeight);
    return {
        fontSize: Number.isFinite(size) ? Math.min(160, Math.max(80, Math.round(size / 10) * 10)) : 100,
        theme: THEME_OPTIONS.some((o) => o.key === s.theme) ? s.theme : "default",
        font: FONT_OPTIONS.some((o) => o.key === s.font) ? s.font : "default",
        flow: s.flow === "scrolled" || s.flow === "slide" ? s.flow : "paginated", // 旧存档的 flip 自动落回左右翻页
        margin: MARGIN_OPTIONS.some((o) => o.key === s.margin) ? s.margin : "standard",
        lineHeight: LINE_HEIGHT_OPTIONS.some((o) => o.key === lh) ? lh : 0,
        bold: !!s.bold,
        ttsVoice: TTS_VOICE_OPTIONS.some((o) => o.key === s.ttsVoice) ? s.ttsVoice : "zh-CN-XiaoxiaoNeural",
        ttsRate: TTS_RATE_OPTIONS.some((o) => o.key === Number(s.ttsRate)) ? Number(s.ttsRate) : 50,
    };
}

/** 设置面板的通用胶囊选项按钮 */
function Pill({
    active,
    onClick,
    children,
    style,
}: {
    active: boolean;
    onClick: () => void;
    children: React.ReactNode;
    style?: React.CSSProperties;
}) {
    return (
        <button
            onClick={onClick}
            style={style}
            className={`cursor-pointer rounded-full border px-2.5 py-1 text-[12px] transition-colors ${
                active ? "border-primary text-primary" : "border-line text-text-2 hover:border-text-3 hover:text-text-1"
            }`}
        >
            {children}
        </button>
    );
}

function EpubReader() {
    const searchParams = useSearchParams();
    const filePath = searchParams.get("path") || "";

    const viewerRef = useRef<HTMLDivElement>(null);
    const bookRef = useRef<Book | null>(null);
    const renditionRef = useRef<Rendition | null>(null);
    const [title, setTitle] = useState("");
    const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
    const [errorMsg, setErrorMsg] = useState("");

    // 阅读设置状态（settingsRef 供事件回调读最新值，避免闭包旧值）
    const [settings, setSettings] = useState<ReaderSettings>(DEFAULT_SETTINGS);
    const router = useRouter();
    // 阅读器背景主题 ↔ 全站主题双向同步：
    //   进入时：阅读器初始背景跟随全站（夜间站 → 直接滑进深色阅读器，绝不闪白）
    //   进入后：用户在阅读器里切背景 → 全站跟随（settingsLoaded 门闩防"默认白"误触发把夜间站切白）
    const { setThemeMode } = useTheme();
    const settingsLoadedRef = useRef(false);
    useLayoutEffect(() => {
        // 首帧前：全站是夜间就先把阅读器置为深色背景（存档设置随后到，再按站点模式覆盖）
        if (document.documentElement.classList.contains("dark")) {
            settingsRef.current = { ...settingsRef.current, theme: "dark" };
            setSettings((s) => ({ ...s, theme: "dark" }));
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    useEffect(() => {
        if (!settingsLoadedRef.current) return; // 存档设置未就绪前不反向影响全站
        setThemeMode(settings.theme === "dark" ? "dark" : "light");
    }, [settings.theme, setThemeMode]);

    /** 返回书架：整层向右滑出后再导航（撤回去的效果；书架有缓存，回去即开） */
    const exitToShelf = (e?: { preventDefault?: () => void }) => {
        e?.preventDefault?.();
        saveCheckpoint();
        const layer = document.querySelector(".reader-slide-in");
        if (layer) {
            layer.classList.add("reader-slide-out");
            setTimeout(() => router.push("/bookshelf"), 320);
        } else {
            router.push("/bookshelf");
        }
    };
    const settingsRef = useRef<ReaderSettings>(DEFAULT_SETTINGS);
    const [panelOpen, setPanelOpen] = useState(false);
    const panelWrapRef = useRef<HTMLDivElement>(null);
    // 手机小屏：顶栏工具组默认折叠，点「⋯」展开成第二行（iPad/桌面恒显示单行）
    const [mobileToolsOpen, setMobileToolsOpen] = useState(false);
    const [bookOnly, setBookOnly] = useState(false);
    const bookOnlyRef = useRef(false);
    const userSchemeRef = useRef<Partial<ReaderSettings> | null>(null);
    const bookSchemeRef = useRef<Partial<ReaderSettings> | null>(null);
    const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const themeCounterRef = useRef(0); // 深层 stylesheet 主题递增 key：后注册的后插入，同优先级下胜出

    // ── 阅读进度（每用户一份，/api/reader-progress）──
    const progressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const locationsReadyRef = useRef(false); // book.locations 生成完才有全书百分比
    const titleRef = useRef("");

    /** 立即存档（离开前的检查点）：聚焦模式存聚焦段的 cfi（回来精确接上），
     *  否则存当前页位置。离开路径优先 sendBeacon（SPA 导航/关页最不易被丢），退化 keepalive fetch。 */
    const saveCheckpoint = () => {
        // ① 聚焦段 cfi（精确接上）——单独兜住：cfiFromNode 抛异常也绝不能吃掉后面的兜底与保存
        let cfi: string | null = null;
        if (focusOnRef.current) {
            try {
                const el = focusParasRef.current[focusIdxRef.current];
                const contents = (renditionRef.current as unknown as { getContents?: () => Array<{ document?: Document; cfiFromNode?: (n: Node) => string }> })?.getContents?.() || [];
                const holder = el ? contents.find((c) => c.document === el.ownerDocument) : undefined;
                cfi = el && holder?.cfiFromNode ? holder.cfiFromNode(el) : null;
            } catch { cfi = null; } // 失败就退回当前页位置，别整条链断掉
        }
        // ② 兜底：当前页 cfi（翻页自动保存用的就是它，稳）
        if (!cfi) {
            try { cfi = (renditionRef.current?.currentLocation() as unknown as { start?: { cfi?: string } })?.start?.cfi || null; }
            catch { cfi = null; }
        }
        if (!cfi) return;
        let percent = 0;
        if (locationsReadyRef.current && bookRef.current) {
            try { percent = Math.round((bookRef.current.locations.percentageFromCfi(cfi) || 0) * 100); } catch { /* noop */ }
        }
        if (progressTimerRef.current) clearTimeout(progressTimerRef.current); // 防抖里的旧存档作废
        const payload = JSON.stringify({ bookPath: filePath, cfi, percent, title: titleRef.current });
        // sendBeacon 走 Blob(application/json)，服务端 req.json() 才认；带 cookie，鉴权照常
        let beaconed = false;
        try {
            if (typeof navigator !== "undefined" && navigator.sendBeacon) {
                beaconed = navigator.sendBeacon("/api/reader-progress", new Blob([payload], { type: "application/json" }));
            }
        } catch { beaconed = false; }
        if (!beaconed) {
            void fetch("/api/reader-progress", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: payload,
                keepalive: true,
            }).catch(() => { /* noop */ });
        }
    };

    /** 翻页防抖 1.5s 上报进度（cfi 永远存；percent 在 locations 就绪后才准确） */
    const scheduleProgressSave = (cfi: string) => {
        if (progressTimerRef.current) clearTimeout(progressTimerRef.current);
        progressTimerRef.current = setTimeout(() => {
            const book = bookRef.current;
            let percent = 0;
            if (book && locationsReadyRef.current) {
                try { percent = Math.round((book.locations.percentageFromCfi(cfi) || 0) * 100); } catch { /* noop */ }
            }
            fetch("/api/reader-progress", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ bookPath: filePath, cfi, percent, title: titleRef.current }),
            }).catch(() => { /* 未登录 401 / 网络失败都不打断阅读 */ });
        }, 1500);
    };

    /** 把外观设置应用到 rendition（不含 flow，flow 靠重建） */
    const applyAppearance = (rendition: Rendition, s: ReaderSettings) => {
        const t = s.theme === "default" ? null : THEME_COLORS[s.theme];
        // 内联 override：可用空值干净回退，且对后续新章节自动生效
        rendition.themes.override("background", t ? t.bg : "");
        rendition.themes.override("color", t ? t.fg : "");
        rendition.themes.override("font-family", s.font === "default" ? "" : FONT_STACKS[s.font]);
        rendition.themes.override("font-size", s.fontSize === 100 ? "" : `${s.fontSize}%`);
        rendition.themes.override("line-height", s.lineHeight === 0 ? "" : `${s.lineHeight / 10}`);
        rendition.themes.override("font-weight", s.bold ? "600" : "");
        // 2026 中文排版三件套（CSS Text L4，渐进增强，不支持的引擎自动忽略）：
        // text-autospace 中西文/数字混排自动加空（告别手动"盘古之白"）；
        // text-spacing-trim 连续 CJK 标点挤压（需字体带 halt/chws，Chromium 生效）；
        // text-wrap:pretty 正文断行防孤字（慢算法只用于排版质量优先的正文，恰是这里）。
        rendition.themes.override("text-autospace", "normal");
        rendition.themes.override("text-spacing-trim", "trim-start");
        rendition.themes.override("text-wrap", "pretty");
        // 深层选择器：压住书内写死在 p/div/span 上的颜色与字体
        const deep: Record<string, string> = {};
        if (t) deep.color = `${t.fg} !important`;
        if (s.font !== "default") deep["font-family"] = `${FONT_STACKS[s.font]} !important`;
        if (s.lineHeight !== 0) deep["line-height"] = `${s.lineHeight / 10} !important`;
        if (s.bold) deep["font-weight"] = "600 !important";
        if (Object.keys(deep).length > 0) {
            const rules: Record<string, Record<string, string>> = {
                "p, div, span, li, td, th, blockquote, h1, h2, h3, h4, h5, h6": deep,
            };
            if (t) rules.body = { background: `${t.bg} !important` };
            const key = `custom-${++themeCounterRef.current}`;
            rendition.themes.register(key, rules);
            rendition.themes.select(key);
        }
    };

    // ── 聚焦模式（ADHD 友好：聚光灯打在单个段落上，↑↓ 移动，Esc/按钮退出）──
    const [focusOn, setFocusOn] = useState(false);
    const focusOnRef = useRef(false);
    const focusIdxRef = useRef(0);
    const focusParasRef = useRef<HTMLElement[]>([]);
    // 跨章节移动时的落点：first=翻下一章聚焦章首段，last=翻上一章聚焦章尾段，null=按当前阅读位置
    const pendingFocusRef = useRef<"first" | "last" | null>(null);

    // ── Debug：默认开启（修完 iOS 触控后改回 false）。记录所有触控事件，定位失效根因 ──
    const debugOn = false;
    // 触屏设备判定（iPad/iPhone）：覆盖层方案只在这类设备启用，电脑端鼠标操作不受影响
    const isCoarseDevice = typeof window !== "undefined" && !!window.matchMedia?.("(pointer: coarse)").matches;
    const debugLog = useRef<{ t: string; msg: string }[]>([]);
    const [, debugRender] = useReducer((x: number) => x + 1, 0);
    const pushLog = (msg: string) => {
        if (!debugOn) return;
        const d = new Date();
        const t = `${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}.${String(d.getMilliseconds()).padStart(3, "0")}`;
        debugLog.current.unshift({ t, msg });
        if (debugLog.current.length > 40) debugLog.current.pop();
        debugRender();
    };
    const describeEl = (el: EventTarget | null): string => {
        if (!(el instanceof Element)) return String(el);
        const e = el as HTMLElement;
        const tag = e.tagName?.toLowerCase() || "?";
        const cls = e.className && typeof e.className === "string" ? e.className.split(" ").slice(0, 2).join(".") : "";
        return cls ? `${tag}.${cls}` : tag;
    };

    // 诊断：原生事件捕获监听（React 合成 pointer 事件在 iOS PWA 对非交互元素可能不触发，
    // 用 addEventListener + capture 直接抓底层事件，定位触摸到底到达哪一层）
    const outerAreaRef = useRef<HTMLDivElement>(null);
    // 聚焦覆盖层：iOS 上 iframe 是事件孤岛（父文档收不到 iframe 区域触摸，iframe 内监听也不工作）。
    // 聚焦模式时盖一层父文档透明 div 接管点击 → 推进聚焦。父文档 div 事件正常。
    const focusOverlayRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const div = focusOverlayRef.current;
        if (!div) return;
        let x0 = 0, y0 = 0;
        let lastTapAt = 0; // pointerup 与 touchend 在 iOS 双发，500ms 去重
        const onDown = (e: PointerEvent) => { x0 = e.clientX; y0 = e.clientY; };
        const onDownT = (e: TouchEvent) => { const t = e.changedTouches[0]; if (t) { x0 = t.clientX; y0 = t.clientY; } };

        // 点击坐标 → iframe 内 elementFromPoint → 是人名就弹浮窗，否则推进聚焦。
        // 跨越覆盖层→iframe 的桥梁：用 epubjs contents 的 iframe document 做内部命中测试
        const handleTap = (clientX: number, clientY: number) => {
            const contents = (renditionRef.current as unknown as { getContents?: () => Array<{ document?: Document }> })?.getContents?.() || [];
            for (const c of contents) {
                const frame = c.document?.defaultView?.frameElement as HTMLElement | null;
                if (!frame) continue;
                const rect = frame.getBoundingClientRect();
                const ix = clientX - rect.left;
                const iy = clientY - rect.top;
                if (ix < 0 || iy < 0 || ix > rect.width || iy > rect.height) continue;
                const el = c.document?.elementFromPoint(ix, iy) as HTMLElement | null;
                const span = el?.closest?.(".osite-char") as HTMLElement | null;
                if (span && charOnRef.current) {
                    const ch = charListRef.current.find((x) => x.name === span.dataset.char);
                    if (ch) { setCharPopup({ char: ch, ...popupPosFor(span) }); return; }
                }
            }
            // 没命中人名：聚焦模式推进下一段（moveFocus 内部会关浮窗）；非聚焦则只关浮窗
            if (focusOnRef.current) moveFocus(1);
            else if (charPopupRef.current) setCharPopup(null);
        };
        const fire = (x: number, y: number) => { lastTapAt = Date.now(); handleTap(x, y); };
        const onUp = (e: PointerEvent) => {
            if (Date.now() - lastTapAt < 500) return; // touchend 已处理
            if (Math.abs(e.clientX - x0) > 14 || Math.abs(e.clientY - y0) > 14) return;
            fire(e.clientX, e.clientY);
        };
        const onUpT = (e: TouchEvent) => {
            const t = e.changedTouches[0];
            if (!t) return;
            if (Date.now() - lastTapAt < 500) return; // pointerup 已处理（iOS 双发去重）
            if (Math.abs(t.clientX - x0) > 14 || Math.abs(t.clientY - y0) > 14) return;
            fire(t.clientX, t.clientY);
        };
        div.addEventListener("pointerdown", onDown, { passive: true });
        div.addEventListener("pointerup", onUp, { passive: true });
        div.addEventListener("touchstart", onDownT, { passive: true });
        div.addEventListener("touchend", onUpT, { passive: true });
        return () => {
            div.removeEventListener("pointerdown", onDown);
            div.removeEventListener("pointerup", onUp);
            div.removeEventListener("touchstart", onDownT);
            div.removeEventListener("touchend", onUpT);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        if (!debugOn) return;
        const evts = ["pointerdown", "pointerup", "touchstart", "touchend", "mousedown", "mouseup", "click"];
        const winLog = (e: Event) => pushLog(`🌍win ${e.type} tg=${describeEl(e.target)}`);
        evts.forEach((t) => window.addEventListener(t, winLog, { capture: true, passive: true }));
        const div = outerAreaRef.current;
        const divLog = (e: Event) => pushLog(`📎div ${e.type} tg=${describeEl(e.target)}`);
        if (div) evts.forEach((t) => div.addEventListener(t, divLog, { capture: true, passive: true }));
        pushLog("诊断监听已挂载（点阅读区看事件是否到达 win/div）");
        return () => {
            evts.forEach((t) => window.removeEventListener(t, winLog));
            if (div) evts.forEach((t) => div.removeEventListener(t, divLog));
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // 设置切换（翻页方式/字体/行距等）触发重建时，记住聚焦段的 cfi，重建后精确找回同一段
    const pendingFocusCfiRef = useRef<string | null>(null);
    // applyFocus 自己触发的 display() 也会发 relocated——挂旗子避免被"翻页跟焦"处理器抢走焦点
    const internalNavRef = useRef(false);
    // 最近一次聚焦移动方向（1=↓ / -1=↑）：跨栏附加游标条的插入动画方向据此定
    const lastMoveDirRef = useRef<1 | -1>(1);
    // 温度感知（故事温度 → 光标颜色）
    const [moodOn, setMoodOn] = useState(false);
    const moodOnRef = useRef(false);
    const [moodTemp, setMoodTemp] = useState(50);
    const moodTempRef = useRef(50);
    const moodTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    // 气氛关键词（大模型判温度时顺手给的，如"山雨欲来"），写在聚焦光标左侧给读者看
    const moodWordRef = useRef("");
    const moodTagRef = useRef("");            // 情绪标签(bucket)：给氛围音乐匹配用
    // 客户端温度缓存：窗口文本 → {温度, 关键词, 标签}。翻回看过的地方直接回读不再请求。
    const moodCacheRef = useRef<Map<string, { temp: number; word: string; tag: string }>>(new Map());

    // ── 氛围音乐（联动温度按钮）：情绪桶 → 本地乐库挑曲 → Web Audio crossfade。宗旨：非必要不切。 ──
    const [musicOn, setMusicOn] = useState(false);       // 是否出声（默认跟温度一起开，可单独静音）
    const musicOnRef = useRef(false);
    const [nowPlaying, setNowPlaying] = useState("");    // 当前曲名（右下角显示）
    const audioCtxRef = useRef<AudioContext | null>(null);
    const audioARef = useRef<{ el: HTMLAudioElement; gain: GainNode } | null>(null);
    const audioBRef = useRef<{ el: HTMLAudioElement; gain: GainNode } | null>(null);
    const activeDeckRef = useRef<"A" | "B">("A");
    const curBucketRef = useRef("");                     // 当前在播曲的情绪桶
    const curTrackStartRef = useRef(0);                  // 当前曲开始播放的时刻（防频繁切）
    const curPageAtSwitchRef = useRef(0);                // 上次切曲时的页码（页数节流）
    const recentTracksRef = useRef<{ id: string; t: number }[]>([]); // 播放记录：20 分钟内不重播同一首
    const REPEAT_WINDOW_MS = 20 * 60_000;
    const lastByBucketRef = useRef<Record<string, string>>({});     // 每个情境上次播的曲：下次进同情境换一首，不形成"专属曲"
    const MUSIC_VOL = 0.26;                              // 主音量（氛围音要克制）
    const pageCounterRef = useRef(0);                    // 翻页计数（用于"3~5页才允许切"）
    // 温度变色的 10 秒缓慢渐变：逐帧插值，绝不"噔"地跳色吓人
    const moodRafRef = useRef<number | null>(null);
    // 跨页段落翻页后待重画的聚焦段：relocated 到达即画（不等固定延时）
    const pendingGlideElRef = useRef<HTMLElement | null>(null);

    /** 所有章节 iframe 的 document（上下滚动的 continuous 模式会同时挂多个章节） */
    const getFocusDocs = (): Document[] => {
        const contents = (renditionRef.current as unknown as { getContents?: () => Array<{ document?: Document }> })?.getContents?.() || [];
        return contents.map((c) => c.document).filter(Boolean) as Document[];
    };

    const PARA_SELECTOR = "p, h1, h2, h3, h4, h5, h6, blockquote, li";
    /** 全部已挂载章节的"段落"清单（文档顺序），跳过空白与 li 里嵌套的 p */
    const collectParas = (): HTMLElement[] =>
        getFocusDocs().flatMap((doc) =>
            (Array.from(doc.querySelectorAll(PARA_SELECTOR)) as HTMLElement[])
                .filter((el) => (el.textContent || "").trim().length > 0)
                .filter((el) => !(el.tagName === "P" && el.closest("li")))
        );

    const FOCUS_STYLE_ID = "osite-focus-style";
    const GLIDE_ID = "osite-focus-glide";
    /** 段落高亮底色跟随背景主题（同色系轻微加深） */
    const glideTint = (): string => {
        const k = settingsRef.current.theme;
        if (k === "dark") return "rgba(255,255,255,0.07)";
        if (k === "sepia") return "rgba(58,50,38,0.07)";
        if (k === "green") return "rgba(34,50,42,0.07)";
        return "rgba(0,0,0,0.05)";
    };
    // 21 档温度色谱（0→100，每 5 一档）：深靛蓝(死寂) → 蓝 → 青 → 绿 → 黄绿 → 黄 → 金 → 橙 → 朱 → 红 → 暗红(极端)
    const MOOD_SPECTRUM: [number, number, number][] = [
        [40, 60, 140],   [50, 90, 170],   [55, 120, 195], [60, 150, 205], [65, 175, 195],
        [70, 190, 170],  [80, 195, 140],  [110, 195, 110],[150, 195, 90], [190, 195, 75],
        [215, 190, 65],  [225, 175, 60],  [230, 155, 58], [232, 135, 55], [234, 112, 52],
        [232, 92, 52],   [226, 72, 55],   [214, 55, 58],  [195, 45, 58],  [170, 40, 55],
        [140, 34, 50],
    ];
    /** 温度 0-100 → 21 档色谱线性插值，颜色平滑细腻 */
    const tempColor = (t: number): string => {
        const v = Math.max(0, Math.min(100, t));
        const n = MOOD_SPECTRUM.length - 1;
        const p = (v / 100) * n;
        const i = Math.min(n - 1, Math.floor(p));
        const f = p - i;
        const a = MOOD_SPECTRUM[i], b = MOOD_SPECTRUM[i + 1];
        const c = a.map((x, k) => Math.round(x + (b[k] - x) * f));
        return `rgb(${c[0]},${c[1]},${c[2]})`;
    };
    /** 游标条颜色：温度感知开启时按故事温度上色；否则与背景一一对应 */
    const glideBar = (): string => {
        if (moodOnRef.current) return tempColor(moodTempRef.current);
        const k = settingsRef.current.theme;
        if (k === "dark") return "#e8e8ea";
        if (k === "green") return "#2f6b48";
        if (k === "sepia") return "#8a6f45";
        return "#4b4b52";
    };
    const ensureFocusStyle = (doc: Document) => {
        if (doc.getElementById(FOCUS_STYLE_ID)) return;
        const st = doc.createElement("style");
        st.id = FOCUS_STYLE_ID;
        st.textContent = `
            body.osite-focusmode :is(${PARA_SELECTOR}) { opacity: 0.3; transition: opacity 0.35s ease; }
            body.osite-focusmode .osite-focus, body.osite-focusmode .osite-focus :is(p, li) { opacity: 1 !important; }
            /* 高亮底色画在段落自身上：box-decoration-break clone 让浏览器按分栏原生拆片——
               跨页/跨栏段落两半各自高亮，不会并成一个横跨全页的大框 */
            body.osite-focusmode .osite-focus {
                background: var(--osite-focus-tint, rgba(0,0,0,0.05));
                border-radius: 6px;
                box-decoration-break: clone;
                -webkit-box-decoration-break: clone;
            }
            /* 游标条（每栏一根）：常驻过渡放 stylesheet——内联 transition 清空后回落到这里，
               绝不会出现"过渡被清光后全部瞬移"的死动画 */
            .${GLIDE_ID}-bar {
                position: absolute; pointer-events: none; width: 3px; border-radius: 2px;
                top: 0; left: 0; opacity: 0; will-change: transform;
                transition: transform 0.38s cubic-bezier(0.22,1,0.36,1), height 0.38s cubic-bezier(0.22,1,0.36,1), opacity 0.25s ease;
            }
            /* 气氛关键词：竖排写在光标条左侧的空白里，颜色跟着温度走，颜色渐变时一起过渡 */
            .${GLIDE_ID}-word {
                position: absolute; right: 7px; top: 0; pointer-events: none;
                writing-mode: vertical-rl; text-orientation: upright;
                font-size: 11px; letter-spacing: 2px; line-height: 1; font-weight: 600;
                white-space: nowrap; opacity: 0.85; transition: color 0.3s ease, opacity 0.3s ease;
            }
        `;
        doc.head.appendChild(st);
    };

    /** 段落在当前视口内的可见分片（getClientRects），按【栏】分组——
     *  跨栏/跨页段落每个可见栏返回一个矩形（游标条两边都要有），
     *  绝不并集成横跨全页的大框（高亮本体由段落背景负责，这里只喂游标条） */
    const visibleRectsOf = (el: HTMLElement): { top: number; left: number; width: number; height: number }[] => {
        const rects = Array.from(el.getClientRects()).filter((r) => r.width > 0 && r.height > 0);
        if (!rects.length) return [];
        let x0 = -Infinity;
        let x1 = Infinity;
        let colThresh = Infinity;
        if (settingsRef.current.flow !== "scrolled") {
            const container = viewerRef.current?.querySelector(".epub-container") as HTMLElement | null;
            if (container) {
                x0 = container.scrollLeft;
                x1 = x0 + container.clientWidth;
                colThresh = container.clientWidth * 0.25; // 左缘差超过 1/4 屏宽 = 不同栏
            }
        }
        const vis = rects.filter((r) => r.right > x0 + 1 && r.left < x1 - 1);
        const pool = (vis.length ? vis : rects).slice().sort((a, b) => a.left - b.left || a.top - b.top);
        // 按左缘聚簇成栏组，每组并出一个矩形
        const groups: DOMRect[][] = [];
        for (const r of pool) {
            const g = groups.find((grp) => Math.abs(grp[0].left - r.left) < colThresh);
            if (g) g.push(r); else groups.push([r]);
        }
        return groups.map((grp) => {
            const top = Math.min(...grp.map((r) => r.top));
            const bottom = Math.max(...grp.map((r) => r.bottom));
            const left = Math.min(...grp.map((r) => r.left));
            const right = Math.max(...grp.map((r) => r.right));
            return { top, left, width: right - left, height: bottom - top };
        });
    };

    /** 当前聚焦段在本页是否还有可见片段（还看得见就别动它——"回退聚焦点"的守卫） */
    const focusedElVisible = (): boolean => {
        const el = focusParasRef.current[focusIdxRef.current];
        if (!el || !el.isConnected) return false;
        const rects = Array.from(el.getClientRects()).filter((r) => r.width > 0);
        if (!rects.length) return false;
        if (settingsRef.current.flow === "scrolled") return true; // 滚动模式不存在"翻走"
        const container = viewerRef.current?.querySelector(".epub-container") as HTMLElement | null;
        if (!container) return true;
        const cx0 = container.scrollLeft;
        const cx1 = cx0 + container.clientWidth;
        return rects.some((r) => r.right > cx0 + 1 && r.left < cx1 - 1);
    };

    /** 游标条（无感原则）：每【栏】一根条，按栏号 col-N 配对复用。
     *  - 同栏已有条 → 垂直滑到新位置（唯一的移动动画，永远只有纵向）
     *  - 新出现的栏 → 条在目标位【原地淡入】：像早就在那儿等着，零位移零方向感
     *  - 消失的栏 → 原地淡出
     *  跨页/跨栏/换栏/翻页全部同一语义，不存在任何横向飞行或"传送"。 */
    const glideTo = (el: HTMLElement) => {
        for (const doc of getFocusDocs()) {
            const bars = () => Array.from(doc.querySelectorAll(`.${GLIDE_ID}-bar`)) as HTMLElement[];
            if (el.ownerDocument !== doc) {
                bars().forEach((b) => { b.style.opacity = "0"; }); // 焦点不在这个章节：藏起来
                continue;
            }
            const win = doc.defaultView;
            const rs = visibleRectsOf(el);
            if (!rs.length) { bars().forEach((b) => { b.style.opacity = "0"; }); continue; }
            // 段落底色 tint 通过 CSS 变量喂给 .osite-focus（随主题实时换）
            doc.body.style.setProperty("--osite-focus-tint", glideTint());
            const bar = glideBar();
            const colW = (viewerRef.current?.querySelector(".epub-container") as HTMLElement | null)?.clientWidth || 1200;
            const existing = bars();
            const used = new Set<HTMLElement>();
            for (const r of rs) {
                const tx = r.left + (win?.scrollX || 0) - 12;
                const ty = r.top + (win?.scrollY || 0) - 2;
                // 条↔栏配对按【x 距离最近】（阈值 1/4 屏宽）——不用取整栏号，边界不抖、同栏必配对
                let b: HTMLElement | null = null;
                let best = colW * 0.25;
                for (const e of existing) {
                    if (used.has(e)) continue;
                    const d = Math.abs(Number(e.dataset.tx || NaN) - tx);
                    if (!Number.isNaN(d) && d < best) { best = d; b = e; }
                }
                const isNew = !b;
                if (!b) {
                    b = doc.createElement("div");
                    b.className = `${GLIDE_ID}-bar`;
                    doc.body.appendChild(b);
                }
                used.add(b);
                b.dataset.tx = String(tx);
                b.style.backgroundColor = bar;
                b.style.height = `${r.height + 4}px`;
                // 气氛关键词标签（温度感知开启且有词时显示在条左侧）
                let w = b.querySelector(`.${GLIDE_ID}-word`) as HTMLElement | null;
                const word = moodOnRef.current ? moodWordRef.current : "";
                if (word) {
                    if (!w) { w = doc.createElement("span"); w.className = `${GLIDE_ID}-word`; b.appendChild(w); }
                    w.textContent = word;
                    w.style.color = bar;
                } else if (w) { w.remove(); }
                if (isNew) {
                    // 新栏：transition:none 把位置+透明度0 一次提交到目标位，
                    // 强制 reflow 后【下一帧】淡入——保证 opacity 过渡真的播（原地出现，零位移）
                    b.style.transition = "none";
                    b.style.transform = `translate3d(${tx}px, ${ty}px, 0)`;
                    b.style.opacity = "0";
                    void b.offsetHeight;
                    b.style.transition = "";
                    const bb = b;
                    requestAnimationFrame(() => { bb.style.opacity = "1"; });
                } else {
                    // 已有条：平滑滑动（stylesheet 常驻 0.38s transform 过渡——基础动画的来源）
                    b.style.transform = `translate3d(${tx}px, ${ty}px, 0)`;
                    b.style.opacity = "1";
                }
            }
            // 不再占用的条：原地淡出后移除
            for (const b of existing) {
                if (!used.has(b)) {
                    b.style.opacity = "0";
                    setTimeout(() => b.remove(), 300);
                }
            }
        }
    };

    /** 聚焦到第 idx 段：打光 + 聚光条滑过去 + （翻页类）跳到该段所在页 / （滚动）滚到屏幕中央 */
    /** 某段落在【当前页】是否有可见片段（getClientRects 逐片判断——
     *  跨页段落的 boundingRect 横跨两页会误判，必须用分片） */
    const elVisibleInPage = (el: HTMLElement): boolean => {
        const rects = Array.from(el.getClientRects()).filter((r) => r.width > 0 && r.height > 0);
        if (!rects.length) return false;
        if (settingsRef.current.flow === "scrolled") {
            const fr = el.ownerDocument.defaultView?.frameElement?.getBoundingClientRect();
            return rects.some((r) => (fr?.top || 0) + r.bottom > 0 && (fr?.top || 0) + r.top < window.innerHeight);
        }
        const container = viewerRef.current?.querySelector(".epub-container") as HTMLElement | null;
        if (!container) return true;
        const x0 = container.scrollLeft;
        const x1 = x0 + container.clientWidth;
        return rects.some((r) => r.right > x0 + 1 && r.left < x1 - 1);
    };

    const applyFocus = async (idx: number, navigate = true) => {
        const paras = focusParasRef.current;
        if (!paras.length) return;
        const clamped = Math.max(0, Math.min(paras.length - 1, idx));
        focusIdxRef.current = clamped;
        for (const p of paras) p.classList.remove("osite-focus");
        const el = paras[clamped];
        el.classList.add("osite-focus");
        glideTo(el);
        if (!navigate) return;
        // 关键守卫（跨页段落 bug 家族的总根源）：段落在当前页已有可见片段就【不导航】。
        // display(段首 cfi) 会跳到段首所在页——从下一页 ↑ 回到跨页段时，段首在上一页，
        // 无条件 display = 页面被拽回上一页，而用户明明正看着它的后半部分
        if (elVisibleInPage(el)) return;
        if (settingsRef.current.flow === "scrolled") {
            try { el.scrollIntoView({ block: "center", behavior: "smooth" }); } catch { /* noop */ }
        } else {
            // 同章节内 display(cfi) 只平移分栏不重渲染，光标跨页时页面自动跟过去。
            // internalNav 旗子：这次 relocated 是我们自己发的，翻页跟焦处理器别插手
            try {
                const contents = (renditionRef.current as unknown as { getContents?: () => Array<{ document?: Document; cfiFromNode?: (n: Node) => string }> })?.getContents?.() || [];
                const holder = contents.find((c) => c.document === el.ownerDocument);
                const cfi = holder?.cfiFromNode?.(el);
                if (cfi) {
                    internalNavRef.current = true;
                    await renditionRef.current?.display(cfi);
                    setTimeout(() => { internalNavRef.current = false; }, 300);
                    // 跨页段落：display(段首) 后焦点段可能仍延伸到下一页，游标要按新页重画
                    setTimeout(() => { if (focusParasRef.current[focusIdxRef.current] === el) glideTo(el); }, 150);
                }
            } catch { internalNavRef.current = false; }
        }
    };

    /** 几何法：当前页面上第一个可见段落（翻页类布局 = 分栏横排，用容器 scrollLeft 圈出可视窗口）。
     *  这是"翻页跟焦"的主路径——直接回答"新页第一段是谁"，比 cfi 反查可靠得多 */
    const idxFirstVisible = (): number => {
        const paras = focusParasRef.current;
        if (!paras.length) return -1;
        if (settingsRef.current.flow === "scrolled") {
            // 连续滚动：段落 rect 是相对各自 iframe 的，借外层视口判断（iframe 在页面流里）
            for (let i = 0; i < paras.length; i++) {
                const fr = paras[i].ownerDocument.defaultView?.frameElement?.getBoundingClientRect();
                const r = paras[i].getBoundingClientRect();
                const topInPage = (fr?.top || 0) + r.top;
                if (topInPage + r.height > 80 && topInPage < window.innerHeight) return i;
            }
            return -1;
        }
        // 分页布局：epub-container 的 scrollLeft ~ scrollLeft+clientWidth 即当前可见页
        const container = viewerRef.current?.querySelector(".epub-container") as HTMLElement | null;
        if (!container) return -1;
        const x0 = container.scrollLeft;
        const x1 = x0 + container.clientWidth;
        for (let i = 0; i < paras.length; i++) {
            const r = paras[i].getBoundingClientRect();
            if (r.width > 0 && r.right > x0 + 1 && r.left < x1 - 1) return i;
        }
        return -1;
    };

    /** cfi → 段落下标（重建后找回聚焦段用），找不到返回 -1 */
    const idxFromCfi = async (cfi: string): Promise<number> => {
        try {
            const rend = renditionRef.current as unknown as { getRange?: (c: string) => Range | null };
            let range: Range | null | undefined = null;
            try { range = rend?.getRange?.(cfi); } catch { /* noop */ }
            if (!range) { try { range = await bookRef.current?.getRange(cfi); } catch { /* noop */ } }
            let node: Node | null = range?.startContainer || null;
            if (node && node.nodeType === 1 && range) {
                const holder = node as HTMLElement;
                node = holder.childNodes[Math.min(range.startOffset, Math.max(0, holder.childNodes.length - 1))] || holder;
            }
            const el = node ? (node.nodeType === 1 ? (node as HTMLElement) : node.parentElement) : null;
            const para = el?.closest?.(PARA_SELECTOR) as HTMLElement | null;
            return para ? focusParasRef.current.indexOf(para) : -1;
        } catch { return -1; }
    };

    /** 当前阅读位置 → 该聚焦哪一段：先几何法，再 cfi 反查兜底 */
    const idxFromLocation = async (): Promise<number> => {
        const geo = idxFirstVisible();
        if (geo >= 0) return geo;
        try {
            const rend = renditionRef.current as unknown as {
                currentLocation?: () => { start?: { cfi?: string } };
                getRange?: (cfi: string) => Range | null;
            };
            const cfi = rend?.currentLocation?.()?.start?.cfi;
            if (!cfi) return 0;
            let range: Range | null | undefined = null;
            try { range = rend?.getRange?.(cfi); } catch { /* noop */ }
            if (!range) { try { range = await bookRef.current?.getRange(cfi); } catch { /* noop */ } }
            let node: Node | null = range?.startContainer || null;
            if (node && node.nodeType === 1 && range) {
                const holder = node as HTMLElement;
                node = holder.childNodes[Math.min(range.startOffset, Math.max(0, holder.childNodes.length - 1))] || holder;
            }
            const el = node ? (node.nodeType === 1 ? (node as HTMLElement) : node.parentElement) : null;
            let para = el?.closest?.(PARA_SELECTOR) as HTMLElement | null;
            if (!para && el) {
                // cfi 落在段落之间（如 section 容器）：往后找第一个段落
                para = focusParasRef.current.find(
                    (p) => el.compareDocumentPosition(p) & Node.DOCUMENT_POSITION_FOLLOWING
                ) || null;
            }
            const idx = para ? focusParasRef.current.indexOf(para) : -1;
            return idx >= 0 ? idx : 0;
        } catch { return 0; }
    };

    /** 给已挂载章节装上聚焦（样式 + body 类 + 段落清单 + 初始光标位） */
    const setupFocus = async (target: "first" | "last" | "location") => {
        const docs = getFocusDocs();
        if (!docs.length) return;
        for (const doc of docs) {
            ensureFocusStyle(doc);
            doc.body.classList.add("osite-focusmode");
        }
        focusParasRef.current = collectParas();
        if (target === "last") await applyFocus(focusParasRef.current.length - 1);
        else if (target === "first") await applyFocus(0);
        else await applyFocus(await idxFromLocation(), false); // 已在当前页，只打光不跳页
    };

    const setFocusMode = (on: boolean) => {
        setFocusOn(on);
        focusOnRef.current = on;
        try { localStorage.setItem("reader-focus-mode", on ? "1" : "0"); } catch { /* noop */ }
        if (on) {
            void setupFocus("location");
        } else {
            for (const doc of getFocusDocs()) {
                doc.body.classList.remove("osite-focusmode");
                doc.querySelectorAll(`.${GLIDE_ID}-bar`).forEach((x) => x.remove());
            }
            focusParasRef.current.forEach((p) => p.classList.remove("osite-focus"));
        }
    };

    // ── 人物识别标注：每本书一份人名索引（服务端启发式提取+缓存），
    //    正文中人名上色（每人固定一色），点击弹人物卡（desc 预留 LLM 解读写回）──
    type CharKind = "person" | "place" | "org" | "term" | "other";
    interface BookChar { name: string; count: number; color: string; desc: string; contexts: string[]; kind?: CharKind; gender?: string }
    const charListRef = useRef<BookChar[]>([]);
    const [charOn, setCharOn] = useState(true);
    const charOnRef = useRef(true);
    // 浮窗带坐标：弹在注解旁边（iframe 内 span 坐标 + frame 偏移 = 父文档视口坐标）。
    // pinned：钉住（新录入词条/AI 解读中）——悬停移开不关，只能手动 ✕ / 点空白关。
    // 展开方向按标签所在 3×3 分区翻转（anchorFlip 给出 tx/ty transform 百分比）
    interface CharPopup { char: BookChar; top: number; left: number; pinned?: boolean; tx?: string; ty?: string; }
    const [charPopup, setCharPopupState] = useState<CharPopup | null>(null);
    const charPopupRef = useRef<CharPopup | null>(null);
    const setCharPopup = (v: CharPopup | null) => { charPopupRef.current = v; setCharPopupState(v); };
    // 悬停关闭缓冲：移开人名 300ms 后关浮窗；缓冲期内移进浮窗/另一个人名则取消；钉住的不关
    const hoverCloseRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const scheduleHoverClose = () => {
        if (charPopupRef.current?.pinned) return;
        if (hoverCloseRef.current) clearTimeout(hoverCloseRef.current);
        hoverCloseRef.current = setTimeout(() => {
            hoverCloseRef.current = null;
            if (!charPopupRef.current?.pinned) setCharPopup(null);
        }, 300);
    };
    const cancelHoverClose = () => {
        if (hoverCloseRef.current) { clearTimeout(hoverCloseRef.current); hoverCloseRef.current = null; }
    };
    // textarea 自动撑高到内容高度（AI 解读后 desc 变长，浮窗跟着变高，无需手动滚动）
    const charDescRef = useRef<HTMLTextAreaElement>(null);
    useEffect(() => {
        const ta = charDescRef.current;
        if (!ta) return;
        ta.style.height = "auto";
        ta.style.height = `${ta.scrollHeight}px`;
    }, [charPopup?.char.name, charPopup?.char.desc]);
    /** 八方位展开规则：把锚点矩形（视口坐标）按屏幕 3×3 分区决定浮窗从哪个点、朝哪展开——
     *  · 四角 → 对角展开（纵向带间隙上/下 + 横向对齐左/右）＝原「四角规则」
     *  · 左边缘 → 往右展开、纵向居中；右边缘 → 往左、纵向居中
     *  · 上边缘 → 往下展开、横向居中；下边缘 → 往上、横向居中
     *  · 正中 → 默认向下、横向居中
     *  返回 top/left（锚点视口坐标）+ tx/ty（transform 百分比，浏览器自解算尺寸）。 */
    const anchorFlip = (rect: { top: number; left: number; right: number; bottom: number; width: number; height: number }, gap = 8) => {
        const W = window.innerWidth, H = window.innerHeight;
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const col = cx < W / 3 ? "L" : cx > (W * 2) / 3 ? "R" : "C"; // 左/中/右
        const row = cy < H / 3 ? "T" : cy > (H * 2) / 3 ? "B" : "C"; // 上/中/下
        let top: number, left: number, tx: string, ty: string;
        if (row === "C" && col !== "C") {
            // 纯左右边缘：横向展开、纵向居中（不覆盖选中词，弹到词的侧旁）
            if (col === "L") { left = rect.right + gap; tx = "0"; }      // 靠左 → 往右
            else { left = rect.left - gap; tx = "-100%"; }               // 靠右 → 往左
            top = cy; ty = "-50%";
        } else {
            // 四角 + 上/下边缘 + 正中：纵向带间隙（上/下），横向对齐（左/中/右）
            if (row === "B") { top = rect.top - gap; ty = "-100%"; }     // 靠下 → 往上
            else { top = rect.bottom + gap; ty = "0"; }                  // 靠上/居中 → 往下
            if (col === "L") { left = rect.left; tx = "0"; }             // 靠左 → 往右（左缘对齐）
            else if (col === "R") { left = rect.right; tx = "-100%"; }   // 靠右 → 往左（右缘对齐）
            else { left = cx; tx = "-50%"; }                             // 居中 → 横向居中
        }
        return { top: Math.max(6, Math.min(top, H - 6)), left: Math.max(6, Math.min(left, W - 6)), tx, ty };
    };

    /** span（iframe 内）→ 浮窗位置 + 八方位展开（anchorFlip）。锚点矩形换算到视口坐标后交给通用规则。 */
    const popupPosFor = (span: HTMLElement): { top: number; left: number; tx: string; ty: string } => {
        try {
            const frame = span.ownerDocument?.defaultView?.frameElement as HTMLElement | null;
            if (!frame) return { top: 120, left: 120, tx: "0", ty: "0" };
            const fr = frame.getBoundingClientRect();
            const sr = span.getBoundingClientRect();
            return anchorFlip({
                top: fr.top + sr.top, left: fr.left + sr.left,
                right: fr.left + sr.right, bottom: fr.top + sr.bottom,
                width: sr.width, height: sr.height,
            });
        } catch { return { top: 120, left: 120, tx: "0", ty: "0" }; }
    };
    const CHAR_STYLE_ID = "osite-char-style";

    /** 给一个章节 doc 打人名标注（幂等：标过的跳过，开关走 body class 秒切） */
    const markCharacters = (doc: Document) => {
        const chars = charListRef.current;
        if (!chars.length) return;
        doc.body.classList.toggle("osite-chars-off", !charOnRef.current);
        if (doc.body.dataset.ositeChars === "1") return;
        doc.body.dataset.ositeChars = "1";
        if (!doc.getElementById(CHAR_STYLE_ID)) {
            const st = doc.createElement("style");
            st.id = CHAR_STYLE_ID;
            st.textContent = `
                .osite-char { border-radius: 3px; padding: 0 1px; cursor: pointer;
                    box-decoration-break: clone; -webkit-box-decoration-break: clone; }
                body.osite-chars-off .osite-char { background: transparent !important; cursor: inherit; }
            `;
            doc.head.appendChild(st);
        }
        const colorMap = new Map(chars.map((c) => [c.name, c.color]));
        const pattern = new RegExp(
            chars.map((c) => c.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
                .sort((a, b) => b.length - a.length).join("|"),
            "g"
        );
        const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
        const nodes: Text[] = [];
        while (walker.nextNode()) {
            const t = walker.currentNode as Text;
            pattern.lastIndex = 0;
            if (t.nodeValue && pattern.test(t.nodeValue) && !t.parentElement?.closest("script,style,.osite-char")) {
                nodes.push(t);
            }
        }
        for (const t of nodes) {
            const s = t.nodeValue || "";
            const frag = doc.createDocumentFragment();
            let last = 0;
            pattern.lastIndex = 0;
            for (let m = pattern.exec(s); m; m = pattern.exec(s)) {
                frag.append(s.slice(last, m.index));
                const span = doc.createElement("span");
                span.className = "osite-char";
                span.dataset.char = m[0];
                span.style.background = colorMap.get(m[0]) || "";
                span.textContent = m[0];
                frag.append(span);
                last = m.index + m[0].length;
            }
            frag.append(s.slice(last));
            t.parentNode?.replaceChild(frag, t);
        }
    };

    const markAllDocs = () => { for (const doc of getFocusDocs()) markCharacters(doc); };

    /** 单名增量标注（手动录入后不用整页重扫） */
    const markOneName = (name: string, color: string) => {
        const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const re = new RegExp(esc, "g");
        for (const doc of getFocusDocs()) {
            const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
            const nodes: Text[] = [];
            while (walker.nextNode()) {
                const t = walker.currentNode as Text;
                if (t.nodeValue?.includes(name) && !t.parentElement?.closest("script,style,.osite-char")) nodes.push(t);
            }
            for (const t of nodes) {
                const s = t.nodeValue || "";
                const frag = doc.createDocumentFragment();
                let last = 0;
                re.lastIndex = 0;
                for (let m = re.exec(s); m; m = re.exec(s)) {
                    frag.append(s.slice(last, m.index));
                    const span = doc.createElement("span");
                    span.className = "osite-char";
                    span.dataset.char = name;
                    span.style.background = color;
                    span.textContent = name;
                    frag.append(span);
                    last = m.index + name.length;
                }
                frag.append(s.slice(last));
                t.parentNode?.replaceChild(frag, t);
            }
        }
    };

    /** 反标注：删除某个人名的所有高亮 span（还原为纯文本） */
    const unmarkOneName = (name: string) => {
        for (const doc of getFocusDocs()) {
            doc.querySelectorAll(`.osite-char`).forEach((el) => {
                if ((el as HTMLElement).dataset.char !== name) return;
                el.replaceWith(doc.createTextNode(el.textContent || ""));
            });
            doc.body.normalize();
        }
    };

    // 录入确认弹层（选中/长按文字触发，名字可改、类型可选再确认）——带坐标，弹在划词位置旁
    const [enrollDraft, setEnrollDraftState] = useState<{ text: string; top: number; left: number; para?: string; cfi?: string; tx?: string; ty?: string } | null>(null);
    const askDraftRef = useRef<HTMLInputElement>(null); // 划词面板「直接问」输入框：点按钮时读它当前值
    const setEnrollDraft = (v: { text: string; top: number; left: number; para?: string; cfi?: string; tx?: string; ty?: string } | null) => setEnrollDraftState(v);
    const [enrollKind, setEnrollKind] = useState<CharKind>("person");

    /** 选区（iframe 内）→ 视口坐标 + 八方位展开（anchorFlip）：选区 rect + frame 偏移交给通用规则。 */
    const enrollPosFromSelection = (doc: Document): { top: number; left: number; tx: string; ty: string } => {
        const fallback = { top: 120, left: Math.max(10, (window.innerWidth - 300) / 2), tx: "0", ty: "0" };
        try {
            const sel = doc.getSelection?.();
            const range = sel && sel.rangeCount > 0 ? sel.getRangeAt(0) : null;
            const frame = doc.defaultView?.frameElement as HTMLElement | null;
            if (!range || !frame) return fallback;
            const fr = frame.getBoundingClientRect();
            const sr = range.getBoundingClientRect();
            return anchorFlip({
                top: fr.top + sr.top, left: fr.left + sr.left,
                right: fr.left + sr.right, bottom: fr.top + sr.bottom,
                width: sr.width, height: sr.height,
            });
        } catch { return fallback; }
    };

    /** 划词统一入口：2~60 字的选区都弹面板（短词可录注解，任意选区都能"直接问/输入问题"）。
     *  带上所在段落 para 作 AI 上下文。selectionContext 见 askQuestion 区 */
    const tryEnrollFromSelection = (doc: Document) => {
        const ctx = selectionContext(doc);
        if (!ctx) return;
        const { sel, para, cfi } = ctx;
        if (sel.length < 2 || sel.length > 60) return;
        setEnrollDraft({ text: sel, para, cfi, ...enrollPosFromSelection(doc) });
    };

    // 类型 → 色系样本（与服务端 KIND_PALETTES 首色一致，录入时所见即所得）
    const KIND_OPTIONS: { key: CharKind; label: string; swatch: string }[] = [
        { key: "person", label: "人物", swatch: "rgba(240,120,74,0.6)" },
        { key: "place", label: "地点", swatch: "rgba(46,160,90,0.6)" },
        { key: "org", label: "组织", swatch: "rgba(33,150,243,0.6)" },
        { key: "term", label: "术语", swatch: "rgba(156,39,176,0.55)" },
        { key: "other", label: "其他", swatch: "rgba(96,125,139,0.6)" },
    ];
    const KIND_LABEL: Record<CharKind, string> = { person: "人物", place: "地点", org: "组织", term: "术语", other: "其他" };

    const enrollChar = async (raw: string, kind: CharKind) => {
        const name = raw.trim();
        // 记住录入框位置：词条卡就地接棒（划词在哪，卡就在哪）
        const at = enrollDraft ? { top: enrollDraft.top, left: enrollDraft.left } : { top: 120, left: 120 };
        setEnrollDraft(null);
        if (name.length < 2 || name.length > 12) return;
        try {
            const res = await fetch("/api/book-characters", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ bookPath: filePath, action: "add", name, kind }),
            });
            const data = await res.json();
            if (data.success && data.character) {
                charListRef.current = [...charListRef.current, data.character];
                markOneName(name, data.character.color);
                // 新录入：强制弹出 + 钉住（鼠标不在上面也不消失），手动 ✕/点空白才关
                setCharPopup({ char: data.character, ...at, pinned: true });
            }
        } catch { /* noop */ }
    };

    const removeChar = async (name: string) => {
        setCharPopup(null);
        try {
            await fetch("/api/book-characters", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ bookPath: filePath, action: "remove", name }),
            });
            charListRef.current = charListRef.current.filter((c) => c.name !== name);
            unmarkOneName(name);
        } catch { /* noop */ }
    };

    // AI 人物解读（DeepSeek）：单人按需，结果写回缓存后此人永不再耗 token
    const [aiBusy, setAiBusy] = useState(false);
    const aiDescribe = async (name: string) => {
        if (aiBusy) return;
        setAiBusy(true);
        // 点了 AI 解读 = 钉住浮窗：解读要几秒，鼠标移开也不能消失，结果必须能看到
        cancelHoverClose();
        {
            const p = charPopupRef.current;
            if (p && !p.pinned) setCharPopup({ ...p, pinned: true });
        }
        try {
            const res = await fetch("/api/book-characters", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ bookPath: filePath, action: "ai", name }),
            });
            const data = await res.json();
            if (!data.success) {
                alert("AI 解读失败：" + (data.error || `HTTP ${res.status}`));
            } else if (Array.isArray(data.characters)) {
                charListRef.current = data.characters;
                const c = (data.characters as BookChar[]).find((x) => x.name === name);
                if (c) {
                    const p = charPopupRef.current;
                    setCharPopup(p ? { char: c, top: p.top, left: p.left, pinned: true } : { char: c, top: 100, left: 120, pinned: true });
                }
                if (!data.applied) alert("AI 没生成有效解读（可能书中信息不足）。服务端日志已记录，可反馈站长。");
            }
        } catch { alert("网络错误，AI 解读没有完成，请重试。"); }
        finally { setAiBusy(false); }
    };

    // ── Notes 笔记：荧光笔高亮 + 图片，可拖浮窗 ──
    interface Note { id: number; kind: "highlight" | "image"; cfi: string; text: string; color: string; src: string; createdAt: string }
    const [notesOpen, setNotesOpen] = useState(false);
    const [notes, setNotes] = useState<Note[]>([]);
    const notesRef = useRef<Note[]>([]);
    const [notesPos, setNotesPos] = useState({ x: 0, y: 0 });     // 浮窗拖动位置（相对初始）
    const [zoomImg, setZoomImg] = useState<string | null>(null);   // 图片放大查看
    const [returnCfi, setReturnCfi] = useState<string | null>(null); // 跳转前的位置（供"跳回"）
    const notesLoadedRef = useRef(false);

    const loadNotes = async () => {
        try {
            const r = await fetch(`/api/book-notes?bookPath=${encodeURIComponent(filePath)}`);
            const d = await r.json();
            if (d.success) { notesRef.current = d.notes || []; setNotes(d.notes || []); paintHighlights(); }
        } catch { /* noop */ }
    };

    /** 荧光笔高亮持久化重绘：用 Custom Highlight API 按 cfi 把每条 highlight 画回正文 */
    const HL_NOTE = "osite-note-hl";
    const paintHighlights = () => {
        const docs = getFocusDocs();
        for (const doc of docs) {
            const win = doc.defaultView as (Window & { CSS?: { highlights?: Map<string, unknown> }; Highlight?: new (...r: Range[]) => unknown }) | null;
            if (!win?.CSS?.highlights || !win.Highlight) continue;
            // 每种颜色一个 highlight 名（::highlight 不支持每实例配色）
            const byColor = new Map<string, Range[]>();
            for (const n of notesRef.current) {
                if (n.kind !== "highlight" || !n.cfi) continue;
                try {
                    const range = renditionRef.current && (renditionRef.current as unknown as { getRange?: (c: string) => Range | null }).getRange?.(n.cfi);
                    if (range && range.startContainer.ownerDocument === doc) {
                        const key = n.color || "#ffd54a";
                        if (!byColor.has(key)) byColor.set(key, []);
                        byColor.get(key)!.push(range);
                    }
                } catch { /* 该 cfi 不在此 doc */ }
            }
            // 注册样式 + highlight
            if (!doc.getElementById("osite-note-hl-style")) {
                const st = doc.createElement("style");
                st.id = "osite-note-hl-style";
                st.textContent = HL_COLORS.map((c, i) =>
                    `::highlight(${HL_NOTE}-${i}) { background: ${c.bg}; color: inherit; }`
                ).join("\n");
                doc.head.appendChild(st);
            }
            HL_COLORS.forEach((c, i) => {
                const ranges = byColor.get(c.bg) || [];
                if (ranges.length) win.CSS!.highlights!.set(`${HL_NOTE}-${i}`, new win.Highlight!(...ranges));
                else win.CSS!.highlights!.delete(`${HL_NOTE}-${i}`);
            });
        }
    };

    /** 加高亮标注：当前主题下的荧光笔色，存库并即时重绘 */
    const addHighlight = async (cfi: string, text: string) => {
        const color = HL_COLORS[0].bg; // 默认第一色（黄），后续可扩展选色
        try {
            const r = await fetch("/api/book-notes", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ bookPath: filePath, note: { kind: "highlight", cfi, text: text.slice(0, 4000), color } }),
            });
            const d = await r.json();
            if (d.success && d.note) {
                notesRef.current = [d.note, ...notesRef.current];
                setNotes([...notesRef.current]);
                paintHighlights();
            } else if (r.status === 401) {
                alert("登录后才能记笔记");
            }
        } catch { /* noop */ }
    };

    const addImageNote = async (src: string, cfi: string) => {
        try {
            const r = await fetch("/api/book-notes", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ bookPath: filePath, note: { kind: "image", src, cfi } }),
            });
            const d = await r.json();
            if (d.success && d.note) { notesRef.current = [d.note, ...notesRef.current]; setNotes([...notesRef.current]); }
            else if (!d.success) alert(d.error || "图片记录失败");
        } catch { /* noop */ }
    };

    const deleteNote = async (id: number) => {
        try {
            await fetch("/api/book-notes", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
            notesRef.current = notesRef.current.filter((n) => n.id !== id);
            setNotes([...notesRef.current]);
            paintHighlights();
        } catch { /* noop */ }
    };

    /** 跳到笔记的 cfi；先记下当前位置供"跳回" */
    const jumpToNote = (cfi: string) => {
        if (!cfi) return;
        try {
            const here = (renditionRef.current?.currentLocation() as unknown as { start?: { cfi?: string } })?.start?.cfi;
            if (here) setReturnCfi(here);
            void renditionRef.current?.display(cfi);
        } catch { /* noop */ }
    };
    const jumpBack = () => {
        if (!returnCfi) return;
        const cfi = returnCfi;
        setReturnCfi(null);
        void renditionRef.current?.display(cfi);
    };

    // ── 温度感知：翻页后取「最近几页」文本问 AI 要温度值，映射到光标颜色 ──
    /** 取"当前章节内、当前页往前最多三页"的文本。
     *  海绵 squeeze：新章节从第 1 页起，窗口最远只能回溯到本章第一页——
     *  绝不跨回上一章（上一章是完全不同的情节）。读得越深，窗口越展开，到三页封顶。 */
    const recentPagesText = (): string => {
        try {
            const rend = renditionRef.current as unknown as {
                currentLocation?: () => { start?: { href?: string; index?: number; displayed?: { page: number; total: number } } };
                getContents?: () => Array<{ document?: Document; sectionIndex?: number; href?: string }>;
            };
            const start = rend?.currentLocation?.()?.start;
            const page = start?.displayed?.page || 1;      // 本章当前页（1 起）
            const total = start?.displayed?.total || 1;    // 本章总页数
            // 定位"当前这一章"的挂载文档（按 spine index / href 匹配，退化取最后一个）
            const contents = rend?.getContents?.() || [];
            const cur = contents.find((c) => c.sectionIndex === start?.index || c.href === start?.href)
                || contents[contents.length - 1];
            const chapter = (cur?.document?.body?.textContent || "").replace(/\s+/g, " ").trim();
            if (!chapter) return "";
            const perPage = chapter.length / Math.max(1, total);   // 每页约多少字
            const endChar = Math.min(chapter.length, Math.round(page * perPage)); // 读到本页末的位置
            const winPages = Math.min(3, page);            // ← squeeze：章首=1 页，往后展开到 3 页封顶
            const startChar = Math.max(0, Math.round(endChar - winPages * perPage)); // 下限=本章开头，不跨章
            return chapter.slice(startChar, endChar).slice(-1800);
        } catch { return ""; }
    };

    const measureMood = () => {
        if (!moodOnRef.current) return;
        if (moodTimerRef.current) clearTimeout(moodTimerRef.current);
        // 翻页会连续触发，防抖 700ms 只测最终停留页
        moodTimerRef.current = setTimeout(async () => {
            const text = recentPagesText();
            if (text.length < 20) return;
            const applyTemp = (t: number, word: string, tag: string) => {
                const temp = Math.max(1, Math.min(100, t)); // range 1-100
                moodWordRef.current = word || "";
                moodTagRef.current = tag || "";
                paintMoodWord();              // 立即把关键词写到光标左侧
                easeMoodTo(temp);             // 10 秒缓动升/降温：光标条 + 朗读进度色一起慢慢变
                maybeSwitchMusic(tag || "", temp); // 情绪→氛围音乐（内部判定该不该切）
            };
            // 客户端缓存命中：翻回看过的窗口，零请求直接回读
            const hit = moodCacheRef.current.get(text);
            if (hit !== undefined) { if (moodOnRef.current) applyTemp(hit.temp, hit.word, hit.tag); return; }
            try {
                const r = await fetch("/api/book-mood", {
                    method: "POST", headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ bookPath: filePath, text }),
                });
                const d = await r.json();
                if (d.success && typeof d.temp === "number") {
                    moodCacheRef.current.set(text, { temp: d.temp, word: d.word || "", tag: d.tag || "" });
                    if (moodOnRef.current) applyTemp(d.temp, d.word || "", d.tag || "");
                }
            } catch { /* noop */ }
        }, 700);
    };

    // ── 氛围音乐引擎 ──
    /** 桶的能量级（tension/dark/epic 高，calm/sad/lonely 低）——用于判断情绪跨度是否"大到不得不切" */
    const bucketEnergy: Record<string, number> = { calm: 0, warm: 0, lonely: 1, sad: 1, romance: 1, wonder: 1, mystery: 2, tension: 3, dark: 3, epic: 3 };
    const ensureAudio = () => {
        if (audioCtxRef.current) return;
        // iOS 17+：声明"媒体播放"会话——否则 WebAudio 默认会话与蓝牙耳机(HFP)路由打架，
        // 出现"耳机无声、扬声器有声"的经典怪象
        try { (navigator as unknown as { audioSession?: { type: string } }).audioSession!.type = "playback"; } catch { /* 不支持则忽略 */ }
        const Ctx = (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
        const ctx = new Ctx();
        audioCtxRef.current = ctx;
        // iOS 来电/Siri/切应用会把 ctx 置为 interrupted/suspended：恢复时自动 resume
        ctx.onstatechange = () => {
            if (musicOnRef.current && audioCtxRef.current === ctx && ctx.state !== "running") void ctx.resume();
        };
        const mk = () => {
            const el = new Audio(); el.loop = true; el.preload = "auto";
            const src = ctx.createMediaElementSource(el);
            const gain = ctx.createGain(); gain.gain.value = 0;
            src.connect(gain); gain.connect(ctx.destination);
            return { el, gain };
        };
        audioARef.current = mk(); audioBRef.current = mk();
    };
    /** 彻底销毁音频栈：下次 ensureAudio 会在【当前音频路由】(耳机/扬声器)下重建——路由类怪病的自愈键 */
    const teardownAudio = () => {
        for (const d of [audioARef.current, audioBRef.current]) { try { d?.el.pause(); d?.el.removeAttribute("src"); } catch { /* noop */ } }
        try { void audioCtxRef.current?.close(); } catch { /* noop */ }
        audioCtxRef.current = null; audioARef.current = null; audioBRef.current = null;
        audioUnlockedRef.current = false; activeDeckRef.current = "A";
        curBucketRef.current = ""; setNowPlaying("");
    };
    /** crossfade：把新曲放进空闲声道，旧声道渐弱、新声道渐强（~3.5s） */
    const crossfadeTo = (url: string, title: string) => {
        ensureAudio();
        const ctx = audioCtxRef.current!; if (ctx.state === "suspended") void ctx.resume();
        const cur = activeDeckRef.current === "A" ? audioARef.current! : audioBRef.current!;
        const nxt = activeDeckRef.current === "A" ? audioBRef.current! : audioARef.current!;
        const now = ctx.currentTime, FADE = 3.5;
        nxt.el.src = url; try { nxt.el.load(); } catch { /* noop */ } nxt.el.currentTime = 0;
        void nxt.el.play().catch(() => {
            // 播放被拦（解锁失效等）：清状态让下次翻页/点喇叭重试，别让"显示在播却无声"
            curBucketRef.current = ""; setNowPlaying("");
        });
        nxt.gain.gain.cancelScheduledValues(now); nxt.gain.gain.setValueAtTime(0.0001, now);
        nxt.gain.gain.linearRampToValueAtTime(musicOnRef.current ? MUSIC_VOL : 0, now + FADE);
        cur.gain.gain.cancelScheduledValues(now); cur.gain.gain.setValueAtTime(cur.gain.gain.value, now);
        cur.gain.gain.linearRampToValueAtTime(0, now + FADE);
        setTimeout(() => { try { cur.el.pause(); } catch { /* noop */ } }, FADE * 1000 + 200);
        activeDeckRef.current = activeDeckRef.current === "A" ? "B" : "A";
        setNowPlaying(title);
    };
    /** 挑一首并切过去。去重两条：①20 分钟内播过的绝不重播 ②该情境上次播的也排除（不形成"情境专属曲"） */
    const musicBusyRef = useRef(false); // 切歌互斥锁：fetch+crossfade 期间绝不重入（高频连切是卡死元凶）
    const fetchAndPlay = async (tag: string, temp: number) => {
        if (musicBusyRef.current) return;
        musicBusyRef.current = true;
        try {
            const now = Date.now();
            recentTracksRef.current = recentTracksRef.current.filter((x) => now - x.t < REPEAT_WINDOW_MS); // 清过期
            const exSet = new Set(recentTracksRef.current.map((x) => x.id));
            const lastOfBucket = lastByBucketRef.current[tag];
            if (lastOfBucket) exSet.add(lastOfBucket);
            const r = await fetch(`/api/reader/music/pick?tag=${encodeURIComponent(tag)}&temp=${Math.round(temp)}&exclude=${[...exSet].join(",")}`);
            const d = await r.json();
            if (!d.success || d.empty || !d.url) { musicBusyRef.current = false; return; }
            recentTracksRef.current.push({ id: d.id, t: now });
            lastByBucketRef.current[tag] = d.id;
            // 关键：记「请求的情绪」而非实际借到的桶——否则借邻桶后每页都被判"情绪变了"，高频连切
            curBucketRef.current = tag || d.bucket;
            curTrackStartRef.current = now;
            curPageAtSwitchRef.current = pageCounterRef.current;
            crossfadeTo(d.url, d.title || "");
        } catch { /* noop */ }
        finally { setTimeout(() => { musicBusyRef.current = false; }, 5000); } // 覆盖整个 crossfade 期
    };
    /** 是否该切曲——宗旨：实在不行才切。
     *  ①还没在放 → 起一首
     *  ②情绪能量突变(≥2，平静→杀机) 且当前曲至少露脸 45 秒 → 不得不切
     *  ③普通情绪漂移：至少翻过 5 页 且 播满 150 秒 才允许换
     *  其余一律不动（同情绪绝不切；FLAC 大文件，频繁切还会堵死网络）。 */
    const maybeSwitchMusic = (tag: string, temp: number) => {
        if (!musicOnRef.current || musicBusyRef.current) return;
        if (!curBucketRef.current) { void fetchAndPlay(tag, temp); return; }
        if (!tag || tag === curBucketRef.current) return;                         // 情绪没变 → 绝不切
        const jump = Math.abs((bucketEnergy[tag] ?? 1) - (bucketEnergy[curBucketRef.current] ?? 1));
        const pagesSince = pageCounterRef.current - curPageAtSwitchRef.current;
        const secsSince = (Date.now() - curTrackStartRef.current) / 1000;
        if (jump >= 2 && secsSince >= 45) { void fetchAndPlay(tag, temp); return; }
        if (pagesSince >= 5 && secsSince >= 150) void fetchAndPlay(tag, temp);
    };
    // 极短静音 WAV：在用户点击的同步栈里给两个声道各播一次 → 解锁 iOS/Safari 自动播放，
    // 之后任意时刻换 src 播放（fetch 选曲后）都不再被自动播放策略拦截
    const SILENCE = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA=";
    const audioUnlockedRef = useRef(false);
    const unlockAudio = () => {
        ensureAudio();
        const ctx = audioCtxRef.current!;
        if (ctx.state === "suspended") void ctx.resume(); // 手势内 resume 才有效
        if (audioUnlockedRef.current) return;
        audioUnlockedRef.current = true;
        for (const d of [audioARef.current, audioBRef.current]) {
            if (!d) continue;
            try { d.el.src = SILENCE; void d.el.play().then(() => d.el.pause()).catch(() => { audioUnlockedRef.current = false; }); } catch { /* noop */ }
        }
    };
    const startMusic = () => {
        musicOnRef.current = true; setMusicOn(true);
        unlockAudio(); // 关键：此函数必须在用户点击的同步栈内被调用
        // 有当前曲就把音量拉起来；没有就按当前情绪起一首
        const deck = activeDeckRef.current === "A" ? audioARef.current : audioBRef.current;
        if (curBucketRef.current && deck && deck.el.src && deck.el.src !== SILENCE) {
            const ctx = audioCtxRef.current!;
            deck.gain.gain.linearRampToValueAtTime(MUSIC_VOL, ctx.currentTime + 1.5);
            void deck.el.play().catch(() => {});
        } else {
            void fetchAndPlay(moodTagRef.current || "", moodTempRef.current);
        }
    };
    const stopMusic = (fade = true) => {
        musicOnRef.current = false; setMusicOn(false);
        const ctx = audioCtxRef.current; if (!ctx) return;
        for (const d of [audioARef.current, audioBRef.current]) {
            if (!d) continue;
            if (fade) { d.gain.gain.cancelScheduledValues(ctx.currentTime); d.gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.8); setTimeout(() => { try { d.el.pause(); } catch {} }, 900); }
            else { try { d.el.pause(); } catch {} d.gain.gain.value = 0; }
        }
    };

    const toggleMood = () => {
        const on = !moodOnRef.current;
        moodOnRef.current = on;
        setMoodOn(on);
        if (on) {
            if (!focusOnRef.current) setFocusMode(true); // 温度体现在聚焦光标上，没开先开
            measureMood();
            startMusic();                 // 联动：温度开 → 氛围音乐一起开（首次出声由这次点击手势解锁）
        } else {
            // 关闭：停掉正在跑的渐变，光标与朗读色恢复常规色 + 停音乐
            if (moodRafRef.current) { cancelAnimationFrame(moodRafRef.current); moodRafRef.current = null; }
            syncReadColor();
            stopMusic();
            setNowPlaying("");
            const el = focusParasRef.current[focusIdxRef.current];
            if (el) setTimeout(() => glideTo(el), 20);
        }
    };
    /** 温度按钮上的小喇叭：静音/取消静音音乐，但保留温度变色。
     *  重开时整套重建音频栈——在当前输出路由（耳机/扬声器）下新建 AudioContext，
     *  专治"戴耳机没声"这类 iOS 路由怪病：没声就点喇叭关再开。 */
    const toggleMusicMute = (e: React.MouseEvent) => {
        e.stopPropagation();               // 不触发温度按钮本身的开关
        if (musicOnRef.current) { stopMusic(); }
        else { teardownAudio(); startMusic(); }
    };

    // ── 关系图（连线机制）：选 2-5 个词条 → AI 出 mermaid 关系图 + 文字说明 ──
    const [relOpen, setRelOpen] = useState(false);
    const [relSel, setRelSel] = useState<string[]>([]);
    const [relBusy, setRelBusy] = useState(false);
    const [relResult, setRelResult] = useState<{ mermaid: string; explain: string } | null>(null);
    const [relSvg, setRelSvg] = useState("");
    const [relChars, setRelChars] = useState<BookChar[]>([]); // 打开时快照当前词条表

    const toggleRelSel = (name: string) => {
        setRelSel((s) => s.includes(name) ? s.filter((x) => x !== name) : [...s, name]); // 不设上限
    };

    const runRelations = async () => {
        if (relSel.length < 2 || relBusy) return;
        setRelBusy(true);
        setRelResult(null);
        setRelSvg("");
        try {
            const res = await fetch("/api/book-relations", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ bookPath: filePath, names: relSel }),
            });
            const data = await res.json();
            if (!data.success) { alert("生成失败：" + (data.error || `HTTP ${res.status}`)); return; }
            setRelResult({ mermaid: data.mermaid, explain: data.explain });
            // 渲染 mermaid（动态 import，只在用到时加载这个大库）
            try {
                const mermaid = (await import("mermaid")).default;
                mermaid.initialize({
                    startOnLoad: false,
                    theme: settingsRef.current.theme === "dark" ? "dark" : "default",
                    securityLevel: "loose",
                    flowchart: { nodeSpacing: 60, rankSpacing: 80, curve: "basis", padding: 20 },
                    themeVariables: { fontSize: "18px" }, // 节点/边文字放大，看得清
                });
                let { svg } = await mermaid.render("osite-rel-" + Date.now(), data.mermaid);
                // 去掉 mermaid 内联的 max-width，让 svg 交给容器等比撑满（否则被限死在小尺寸）
                svg = svg.replace(/style="[^"]*max-width:[^;"]*;?[^"]*"/i, 'style="width:100%;height:100%"')
                         .replace(/<svg /, '<svg preserveAspectRatio="xMidYMid meet" ');
                setRelSvg(svg);
            } catch { setRelSvg(""); /* 渲染失败仍显示文字说明 */ }
        } catch {
            alert("网络错误");
        } finally {
            setRelBusy(false);
        }
    };

    // ── 疑问助手：问 LLM 阅读细节，防剧透（只喂已读部分原文）──
    const [askOpen, setAskOpen] = useState(false);
    const [askInput, setAskInput] = useState("");
    const [askBusy, setAskBusy] = useState(false);
    const [askSteps, setAskSteps] = useState<string[]>([]); // SSE 实时步骤：模型每次工具调用的播报
    const [askHistory, setAskHistory] = useState<Array<{ role: "user" | "assistant"; text: string }>>([]);

    /** 用 epubjs 提取【已读部分】原文：当前章节之前的全部 + 当前章节 cfi 之前。防剧透的核心 */
    const getReadText = async (): Promise<string> => {
        const book = bookRef.current;
        const rend = renditionRef.current;
        if (!book || !rend) return "";
        const loc = rend.currentLocation() as unknown as { end?: { cfi?: string; href?: string } };
        const endCfi = loc?.end?.cfi;
        const endHref = loc?.end?.href;
        if (!endCfi || !endHref) return "";
        let out = "";
        // spineItems 是 epubjs 运行时属性，类型声明没导出
        const spineItems = (book.spine as unknown as { spineItems: Array<{ href: string; document?: Document }> }).spineItems || [];
        for (const item of spineItems) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const it = item as any;
            const wasLoaded = !!it.document; // 渲染中的章节（scrolled 模式可能多个）不碰
            try {
                await it.load(book.load.bind(book));
                const doc = (item as unknown as { document?: Document }).document;
                if (!doc?.body) continue;
                if (item.href === endHref) {
                    // 当前章节：截到 endCfi 之前（getRange 与 item.load 共享同一缓存文档，节点可匹配）
                    try {
                        const range = await book.getRange(endCfi);
                        out += textBeforeNode(doc.body, range.startContainer, range.startOffset);
                    } catch {
                        out += doc.body.textContent || ""; // cfi 解析失败：给整章（章节内剧透风险低）
                    }
                    break;
                }
                out += doc.body.textContent || "";
                // 只释放本次临时加载的章节；渲染中已加载的不动（unload 会拆掉在读画面）
                if (!wasLoaded) { try { it.unload(); } catch { /* noop */ } }
            } catch { /* 单章失败跳过 */ }
        }
        return out;
    };
    /** 遍历 root 的文本节点，累加 textContent，直到 endNode（含 endOffset 之前的字符） */
    const textBeforeNode = (root: Node, endNode: Node, endOffset: number): string => {
        const doc = root.ownerDocument;
        if (!doc) return "";
        const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let text = "";
        let node = walker.nextNode() as Text | null;
        while (node) {
            if (node === endNode) { text += (node.textContent || "").slice(0, endOffset); return text; }
            text += node.textContent || "";
            node = walker.nextNode() as Text | null;
        }
        return text; // 没命中 endNode：返回全部（fallback）
    };

    // ── 朗读：Edge TTS 逐段朗读，跟着聚焦光标走——读完一段自动 moveFocus(1)（顺带翻页/滚动）。
    //    进度 = CSS Custom Highlight API 按【字符】建 Range + rAF 每帧推进：
    //    精确到读到哪个字，第二行开始变色时第一行早已读完，绝无"两行同时进行" ──
    // ── 底部状态栏：本章页码 / 全书进度 / 时钟 ──
    const [pageInfo, setPageInfo] = useState({ chapterPage: 0, chapterTotal: 0, bookPct: 0, bookPage: 0, bookTotal: 0 });
    const [clock, setClock] = useState("");
    useEffect(() => {
        const fmt = () => new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
        setClock(fmt());
        const t = setInterval(() => setClock(fmt()), 30_000);
        return () => clearInterval(t);
    }, []);

    const [readingOn, setReadingOn] = useState(false);
    const readingRef = useRef(false);
    const audioRef = useRef<HTMLAudioElement | null>(null); // 单实例复用：iOS 连播不被拦
    const readElRef = useRef<HTMLElement | null>(null);
    // 分段音频：一个段落被引号切成 旁白/对话 相间片段，各配音色
    interface SegAudio { url: string; chars: number }
    const prefetchRef = useRef<{ idx: number; segs: SegAudio[] } | null>(null);
    const rafRef = useRef(0);

    const HL_NAME = "osite-read";
    type HLWin = Window & { CSS?: { highlights?: Map<string, unknown> }; Highlight?: new (...r: Range[]) => unknown };

    /** 段落文本节点扁平化：[{node, start, end}] 累计字符偏移，供"字符 → Range"定位 */
    const flattenText = (el: HTMLElement): { node: Text; start: number; end: number }[] => {
        const doc = el.ownerDocument;
        const walker = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        const out: { node: Text; start: number; end: number }[] = [];
        let acc = 0;
        let n = walker.nextNode() as Text | null;
        while (n) {
            const len = n.textContent?.length || 0;
            if (len > 0) { out.push({ node: n, start: acc, end: acc + len }); acc += len; }
            n = walker.nextNode() as Text | null;
        }
        return out;
    };

    /** 把"已读到第 charIdx 个字符"画成高亮（iframe 自己的 highlights 注册表） */
    const paintProgress = (el: HTMLElement, nodes: { node: Text; start: number; end: number }[], charIdx: number) => {
        const win = el.ownerDocument.defaultView as HLWin | null;
        if (!win?.CSS?.highlights || !win.Highlight) return;
        if (charIdx <= 0) { win.CSS.highlights.delete(HL_NAME); return; }
        const range = el.ownerDocument.createRange();
        range.setStart(el, 0);
        const hit = nodes.find((t) => charIdx > t.start && charIdx <= t.end) || nodes[nodes.length - 1];
        if (!hit) return;
        range.setEnd(hit.node, Math.min(charIdx - hit.start, hit.node.textContent?.length || 0));
        win.CSS.highlights.set(HL_NAME, new win.Highlight(range));
    };

    const clearReadPaint = () => {
        cancelAnimationFrame(rafRef.current);
        const el = readElRef.current;
        if (el) {
            const win = el.ownerDocument.defaultView as HLWin | null;
            win?.CSS?.highlights?.delete(HL_NAME);
        }
        readElRef.current = null;
    };

    /** ::highlight 样式注册进章节 iframe（幂等）。朗读进度色走 CSS 变量 --osite-read-color，
     *  温度感知开启时同步成温度色，否则默认朱橙 */
    const ensureHLStyle = (doc: Document) => {
        if (!doc.getElementById("osite-read-style")) {
            const st = doc.createElement("style");
            st.id = "osite-read-style";
            st.textContent = `::highlight(${HL_NAME}) { color: var(--osite-read-color, #E85D2F); }`;
            doc.head.appendChild(st);
        }
        doc.documentElement.style.setProperty("--osite-read-color", moodOnRef.current ? tempColor(moodTempRef.current) : "#E85D2F");
    };
    /** 温度变化时刷新所有已挂载章节的朗读进度色变量 */
    const syncReadColor = () => {
        for (const doc of getFocusDocs()) {
            doc.documentElement.style.setProperty("--osite-read-color", moodOnRef.current ? tempColor(moodTempRef.current) : "#E85D2F");
        }
    };
    /** 把某个温度色一次性刷到所有光标条（含关键词标签）+ 朗读进度色变量（只写样式、不读布局） */
    const paintMood = (temp: number) => {
        const col = tempColor(temp);
        for (const doc of getFocusDocs()) {
            (doc.querySelectorAll(`.${GLIDE_ID}-bar`) as NodeListOf<HTMLElement>).forEach((b) => { b.style.backgroundColor = col; });
            (doc.querySelectorAll(`.${GLIDE_ID}-word`) as NodeListOf<HTMLElement>).forEach((w) => { w.style.color = col; });
            doc.documentElement.style.setProperty("--osite-read-color", col);
        }
    };
    /** 关键词变了：把新词写到所有已存在的光标条左侧（不重排位置，只改文字） */
    const paintMoodWord = () => {
        const word = moodOnRef.current ? moodWordRef.current : "";
        const col = tempColor(moodTempRef.current);
        for (const doc of getFocusDocs()) {
            (doc.querySelectorAll(`.${GLIDE_ID}-bar`) as NodeListOf<HTMLElement>).forEach((b) => {
                let w = b.querySelector(`.${GLIDE_ID}-word`) as HTMLElement | null;
                if (word) {
                    if (!w) { w = doc.createElement("span"); w.className = `${GLIDE_ID}-word`; b.appendChild(w); }
                    w.textContent = word; w.style.color = col;
                } else if (w) { w.remove(); }
            });
        }
    };
    /** 温度渐变：当前温度 → 目标温度，用 10 秒缓动逐帧插值，绝不瞬切。
     *  光标条和朗读进度色共用同一插值，一起缓慢升温/降温。 */
    const easeMoodTo = (target: number) => {
        if (moodRafRef.current) { cancelAnimationFrame(moodRafRef.current); moodRafRef.current = null; }
        const from = moodTempRef.current;
        if (Math.abs(target - from) < 0.5) { moodTempRef.current = target; setMoodTemp(Math.round(target)); paintMood(target); return; }
        const DUR = 10000; // 10 秒
        const t0 = performance.now();
        let lastDot = 0;
        const step = (now: number) => {
            if (!moodOnRef.current) { moodRafRef.current = null; return; } // 中途关掉温度：停
            const p = Math.min(1, (now - t0) / DUR);
            const e = p * (2 - p);                 // easeOutQuad：先快后慢，收尾格外柔
            const cur = from + (target - from) * e;
            moodTempRef.current = cur;
            paintMood(cur);
            if (now - lastDot > 300) { setMoodTemp(Math.round(cur)); lastDot = now; } // 按钮小圆点低频跟随
            if (p < 1) { moodRafRef.current = requestAnimationFrame(step); }
            else { moodRafRef.current = null; moodTempRef.current = target; setMoodTemp(Math.round(target)); }
        };
        moodRafRef.current = requestAnimationFrame(step);
    };

    const fetchTTS = async (text: string, voice?: string): Promise<string | null> => {
        try {
            const res = await fetch("/api/tts", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ text, voice: voice || settingsRef.current.ttsVoice, rate: settingsRef.current.ttsRate }),
            });
            if (!res.ok) return null;
            return URL.createObjectURL(await res.blob());
        } catch { return null; }
    };

    /** 按中文引号把段落切成 旁白/对话 相间片段（d=true 为对话） */
    const splitDialog = (text: string): { t: string; d: boolean }[] => {
        const OPEN: Record<string, string> = { "「": "」", "『": "』", "“": "”", "＂": "＂" };
        const segs: { t: string; d: boolean }[] = [];
        let buf = ""; let close = "";
        for (const ch of text) {
            if (!close && OPEN[ch] !== undefined) {
                if (buf.trim()) segs.push({ t: buf, d: false });
                buf = ch; close = OPEN[ch];
            } else if (close && ch === close) {
                buf += ch; segs.push({ t: buf, d: true }); buf = ""; close = "";
            } else buf += ch;
        }
        if (buf.trim()) segs.push({ t: buf, d: !!close }); // 未闭合的引号按对话处理
        return segs.filter((s) => s.t.trim().length > 0);
    };

    // ── 说话人归因（不接 LLM）：扫对话前后旁白里的人名（人物表匹配）→ 按性别配男/女声，
    //    同一个人整本书恒用同一音色（speakerVoiceRef 持久映射）——同人连说自然一致 ──
    const MALE_POOL = ["zh-CN-YunxiNeural", "zh-CN-YunjianNeural", "zh-CN-YunyangNeural"];
    const FEMALE_POOL = ["zh-CN-XiaoyiNeural", "zh-CN-XiaoxiaoNeural"];
    const speakerVoiceRef = useRef<Map<string, string>>(new Map()); // 人名 → 恒定音色
    const lastDialogVoiceRef = useRef("");                          // 上一句对话的音色（无线索时沿用/交替基准）
    /** 给说话人分配恒定音色：按性别进对应池，优先没被别人占用的 */
    const voiceForSpeaker = (name: string, gender: string | undefined, narration: string): string => {
        const m = speakerVoiceRef.current;
        const hit = m.get(name);
        if (hit) return hit;
        const pool = (gender === "f" ? FEMALE_POOL : MALE_POOL).filter((v) => v !== narration);
        const used = new Set(m.values());
        const v = pool.find((p) => !used.has(p)) || pool[m.size % pool.length] || MALE_POOL[0];
        m.set(name, v);
        return v;
    };
    /** 在一段旁白文字里找人物表的人名（last=取最后出现的，用于前置旁白"草薙摇头："） */
    const findPersonIn = (s: string, last: boolean): BookChar | null => {
        const persons = charListRef.current.filter((c) => (c.kind || "person") === "person" && c.name.trim().length >= 2);
        let best: { c: BookChar; pos: number } | null = null;
        for (const c of persons) {
            const pos = last ? s.lastIndexOf(c.name) : s.indexOf(c.name);
            if (pos >= 0 && (!best || (last ? pos > best.pos : pos < best.pos))) best = { c, pos };
        }
        return best?.c || null;
    };

    /** 段落 → 多音色分段音频：旁白固定用户音色；对话先归因说话人（前旁白末名 > 后旁白首名）→
     *  性别定男/女声、同人恒同色；无线索时：与上句无旁白隔断=同人沿用，有隔断=换人交替。
     *  失败退化为整段旁白单音频，绝不中断朗读。 */
    const fetchSegs = async (text: string): Promise<SegAudio[] | null> => {
        const narration = settingsRef.current.ttsVoice;
        const parts = splitDialog(text);
        if (parts.length <= 1 && !(parts[0]?.d)) {
            const url = await fetchTTS(text);
            return url ? [{ url, chars: text.length }] : null;
        }
        const anonPool = MALE_POOL.filter((v) => v !== narration);
        const voices: string[] = parts.map(() => narration);
        for (let i = 0; i < parts.length; i++) {
            if (!parts[i].d) continue;
            // ① 归因：前一旁白(尾部 30 字)最后出现的人名 > 后一旁白(头部 30 字)最先出现的人名
            const prev = i > 0 && !parts[i - 1].d ? parts[i - 1].t.slice(-30) : "";
            const next = i + 1 < parts.length && !parts[i + 1].d ? parts[i + 1].t.slice(0, 30) : "";
            const sp = (prev && findPersonIn(prev, true)) || (next && findPersonIn(next, false)) || null;
            let v: string;
            if (sp) {
                v = voiceForSpeaker(sp.name, sp.gender, narration);
            } else if (i > 0 && parts[i - 1].d && lastDialogVoiceRef.current) {
                v = lastDialogVoiceRef.current;               // 与上句对话相连（无旁白隔断）→ 同一人连说，音色不变
            } else if (lastDialogVoiceRef.current) {
                const idx = anonPool.indexOf(lastDialogVoiceRef.current); // 有隔断且无人名 → 大概率换人，交替
                v = anonPool[(idx + 1 + anonPool.length) % anonPool.length] || anonPool[0];
            } else {
                v = anonPool[0];
            }
            voices[i] = v;
            lastDialogVoiceRef.current = v;
        }
        const jobs = parts.map((p, i) => fetchTTS(p.t, voices[i]).then((url) => (url ? { url, chars: p.t.length } : null)));
        const got = await Promise.all(jobs);
        if (got.every(Boolean)) return got as SegAudio[];
        got.forEach((s) => { if (s) URL.revokeObjectURL(s.url); });
        const url = await fetchTTS(text);
        return url ? [{ url, chars: text.length }] : null;
    };

    /** 朗读当前聚焦段；结束后推进聚焦并链式读下一段 */
    const playCurrent = async (retry = 0) => {
        if (!readingRef.current) return;
        const idx = focusIdxRef.current;
        const el = focusParasRef.current[idx];
        if (!el || !el.isConnected) {
            // 跨章后段落清单可能尚未重建，稍等重试
            if (retry < 6) setTimeout(() => void playCurrent(retry + 1), 500);
            else stopReading();
            return;
        }
        const text = (el.textContent || "").trim();
        if (!text) { moveFocus(1); setTimeout(() => void playCurrent(), 300); return; }

        // 取分段音频（旁白/对话多音色）：命中预取直接用，否则现拉
        let segs: SegAudio[] | null = null;
        if (prefetchRef.current?.idx === idx) { segs = prefetchRef.current.segs; prefetchRef.current = null; }
        else segs = await fetchSegs(text);
        if (!readingRef.current) { segs?.forEach((s) => URL.revokeObjectURL(s.url)); return; }
        if (!segs || !segs.length) { stopReading(); alert("朗读服务不可用"); return; }
        const segList = segs;

        clearReadPaint();
        readElRef.current = el;
        ensureHLStyle(el.ownerDocument);
        const nodes = flattenText(el);
        const totalChars = nodes.length ? nodes[nodes.length - 1].end : 0;
        const sumChars = segList.reduce((s, x) => s + x.chars, 0) || 1;

        const audio = audioRef.current || (audioRef.current = new Audio());
        let segIdx = 0;
        let base = 0; // 已播完片段的累计字数（卡拉OK跨片段连续）
        const playSeg = async () => {
            const seg = segList[segIdx];
            audio.src = seg.url;
            audio.onended = () => {
                URL.revokeObjectURL(seg.url);
                if (!readingRef.current) return;
                base += seg.chars; segIdx++;
                if (segIdx < segList.length) { void playSeg(); return; }
                // 整段读完 → 等价按一次「↓」：moveFocus 自带翻页/跨章守卫，
                // 不再自作聪明地段中手动 rendition.next()（旧翻页毛病的根源）
                moveFocus(1);
                void playCurrent();
            };
            audio.onerror = () => { segList.slice(segIdx).forEach((s) => URL.revokeObjectURL(s.url)); stopReading(); };
            try { await audio.play(); } catch { stopReading(); }
        };
        // rAF 每帧推进卡拉OK：总进度 = 已播片段字数 + 当前片段内进度，跨片段无缝
        const tick = () => {
            if (!readingRef.current || readElRef.current !== el) return;
            const seg = segList[segIdx];
            if (seg && audio.duration > 0) {
                const inSeg = Math.min(1, audio.currentTime / audio.duration) * seg.chars;
                const charIdx = Math.round(((base + inSeg) / sumChars) * totalChars);
                paintProgress(el, nodes, charIdx);
            }
            rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
        void playSeg();

        // 预取下一段（消联播间隙；多音色分段一并预取）
        const nextEl = focusParasRef.current[idx + 1];
        const nextText = (nextEl?.textContent || "").trim();
        if (nextText) {
            void fetchSegs(nextText).then((ss) => {
                if (ss) {
                    prefetchRef.current?.segs.forEach((s) => URL.revokeObjectURL(s.url));
                    prefetchRef.current = { idx: idx + 1, segs: ss };
                }
            });
        }
    };

    const stopReading = () => {
        readingRef.current = false;
        setReadingOn(false);
        const a = audioRef.current;
        if (a) { a.pause(); a.onended = null; a.onerror = null; a.removeAttribute("src"); }
        if (prefetchRef.current) { prefetchRef.current.segs.forEach((s) => URL.revokeObjectURL(s.url)); prefetchRef.current = null; }
        clearReadPaint();
    };

    const toggleReading = () => {
        if (readingRef.current) { stopReading(); return; }
        readingRef.current = true;
        setReadingOn(true);
        if (!focusOnRef.current) setFocusMode(true); // 朗读跟随聚焦光标，没开先开
        setTimeout(() => void playCurrent(), focusOnRef.current ? 50 : 450);
    };

    // ── 自动阅读：聚焦块按测得的阅读速率自动向下推进（读完一段自动翻页）──
    // phase：idle 未开 / calibrating 首页校准中 / running 自动推进 / paused 暂停
    const [autoPhase, setAutoPhase] = useState<"idle" | "calibrating" | "running" | "paused">("idle");
    const autoPhaseRef = useRef<"idle" | "calibrating" | "running" | "paused">("idle");
    const setAuto = (p: "idle" | "calibrating" | "running" | "paused") => { autoPhaseRef.current = p; setAutoPhase(p); };
    const autoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const autoCharsPerSecRef = useRef(0);           // 测得的阅读速率（字符/秒）
    const calibStartRef = useRef(0);                // 校准起始时间戳
    const calibCharsRef = useRef(0);                // 校准页起始已读字符累计
    const calibStartPageRef = useRef({ ch: 0, total: 0 }); // 校准起始所在页

    // 数段落字数（滚动模式没有"页"，用当前屏范围内段落）
    const charsOnCurrentPage = (): number => {
        const paras = focusParasRef.current;
        let sum = 0;
        if (settingsRef.current.flow === "scrolled") {
            for (const p of paras) if (elVisibleInPage(p)) sum += (p.textContent || "").trim().length;
        } else {
            const container = viewerRef.current?.querySelector(".epub-container") as HTMLElement | null;
            if (!container) return 0;
            const x0 = container.scrollLeft, x1 = x0 + container.clientWidth;
            for (const p of paras) {
                const rects = Array.from(p.getClientRects());
                if (rects.some((r) => r.width > 0 && r.right > x0 + 1 && r.left < x1 - 1)) {
                    sum += (p.textContent || "").trim().length;
                }
            }
        }
        return sum;
    };

    const clearAutoTimer = () => { if (autoTimerRef.current) { clearTimeout(autoTimerRef.current); autoTimerRef.current = null; } };

    /** 排程下一段：按当前聚焦段字数 / 速率 算停留时长，到点 moveFocus(1) */
    const scheduleAutoStep = () => {
        clearAutoTimer();
        if (autoPhaseRef.current !== "running") return;
        const el = focusParasRef.current[focusIdxRef.current];
        const chars = Math.max(1, (el?.textContent || "").trim().length);
        const cps = autoCharsPerSecRef.current || 6; // 兜底 6 字/秒
        const ms = Math.max(700, Math.min(20000, (chars / cps) * 1000)); // 单段 0.7~20s
        autoTimerRef.current = setTimeout(() => {
            if (autoPhaseRef.current !== "running") return;
            // 已到全书末尾则停
            const atEnd = focusIdxRef.current >= focusParasRef.current.length - 1 &&
                pageInfo.bookTotal > 0 && pageInfo.bookPage >= pageInfo.bookTotal;
            if (atEnd) { stopAutoRead(); return; }
            moveFocus(1);
            // moveFocus 可能触发翻页/跨章重排，稍等段落稳定再排下一段
            setTimeout(() => scheduleAutoStep(), 260);
        }, ms);
    };

    const stopAutoRead = () => {
        clearAutoTimer();
        setAuto("idle");
    };

    const toggleAutoRead = () => {
        if (autoPhaseRef.current === "running" || autoPhaseRef.current === "paused") { stopAutoRead(); return; }
        if (autoPhaseRef.current === "calibrating") { stopAutoRead(); return; }
        // 开始校准：确保聚焦已开、光标在当前页首段
        if (!focusOnRef.current) setFocusMode(true);
        setAuto("calibrating");
        setTimeout(() => {
            calibStartRef.current = Date.now();
            calibStartPageRef.current = { ch: pageInfo.chapterPage, total: pageInfo.chapterTotal };
            calibCharsRef.current = charsOnCurrentPage();
        }, focusOnRef.current ? 60 : 500);
    };

    // 校准监听：处于 calibrating 时，一旦翻到下一页（chapterPage 变大 / 跨章），
    // 用「这一页字数 ÷ 实际停留秒数」算出速率，随即进入 running
    useEffect(() => {
        if (autoPhaseRef.current !== "calibrating") return;
        const movedPage = pageInfo.chapterPage > calibStartPageRef.current.ch ||
            pageInfo.chapterPage < calibStartPageRef.current.ch; // 跨章后页码重置也算
        if (!movedPage) return;
        const secs = Math.max(1, (Date.now() - calibStartRef.current) / 1000);
        const chars = Math.max(20, calibCharsRef.current); // 至少按 20 字算，防超快误测
        autoCharsPerSecRef.current = Math.max(2, Math.min(30, chars / secs)); // 夹 2~30 字/秒
        setAuto("running");
        setTimeout(() => scheduleAutoStep(), 200);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pageInfo.chapterPage, pageInfo.bookPage]);

    // 发问核心：question 传入则用它，否则取输入框；askBusy 中忽略
    const askQuestion = async (question: string) => {
        const q = question.trim();
        if (!q || askBusy) return;
        setAskOpen(true); // 确保疑问助手面板打开，答案显示在那里
        setAskHistory((h) => [...h, { role: "user", text: q }]);
        setAskBusy(true);
        setAskSteps([]);
        try {
            const readText = await getReadText();
            const res = await fetch("/api/book-ask", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    bookPath: filePath, bookTitle: title || "本书",
                    question: q, readText,
                    history: askHistory.slice(-6),
                }),
            });
            // SSE 流：status 事件实时播报模型每一步（搜索/展开/收口），done/error 收尾
            if ((res.headers.get("content-type") || "").includes("text/event-stream") && res.body) {
                const reader = res.body.getReader();
                const dec = new TextDecoder();
                let buf = "";
                let finished = false;
                for (;;) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    buf += dec.decode(value, { stream: true });
                    const parts = buf.split("\n\n");
                    buf = parts.pop() || "";
                    for (const p of parts) {
                        if (!p.startsWith("data: ")) continue;
                        try {
                            const d = JSON.parse(p.slice(6));
                            if (d.ev === "status") setAskSteps((s) => [...s, String(d.text || "")]);
                            else if (d.ev === "done") { finished = true; setAskHistory((h) => [...h, { role: "assistant", text: String(d.answer || "") }]); }
                            else if (d.ev === "error") { finished = true; setAskHistory((h) => [...h, { role: "assistant", text: `出错：${d.error}` }]); }
                        } catch { /* 半包丢弃 */ }
                    }
                }
                if (!finished) setAskHistory((h) => [...h, { role: "assistant", text: "连接中断，请重试。" }]);
            } else {
                // 非流式回退（401 未登录等直接回 JSON）
                const data = await res.json();
                const ans = data.success ? data.answer : `出错：${data.error || `HTTP ${res.status}`}`;
                setAskHistory((h) => [...h, { role: "assistant", text: ans }]);
            }
        } catch {
            setAskHistory((h) => [...h, { role: "assistant", text: "网络错误，请重试。" }]);
        } finally {
            setAskBusy(false);
            setAskSteps([]);
        }
    };
    const sendAsk = async () => {
        const q = askInput.trim();
        if (!q) return;
        setAskInput("");
        await askQuestion(q);
    };

    // ── 划词直接问：选中文字所在段落做上下文，问 AI 该词/该句在语境里的意思 ──
    /** 取一个 iframe 内 selection 的选中文本 + 所在段落文本（上下文） */
    const selectionContext = (doc: Document): { sel: string; para: string; cfi: string } | null => {
        try {
            const s = doc.getSelection?.();
            const text = s?.toString().trim() || "";
            if (!text) return null;
            const range = s && s.rangeCount > 0 ? s.getRangeAt(0) : null;
            const node = range?.startContainer || null;
            const el = node ? (node.nodeType === 1 ? (node as HTMLElement) : node.parentElement) : null;
            const para = (el?.closest?.(PARA_SELECTOR) as HTMLElement | null)?.textContent?.trim() || "";
            // 选区起点 cfi（供荧光笔标注跳转回原位）
            let cfi = "";
            try {
                const contents = (renditionRef.current as unknown as { getContents?: () => Array<{ document?: Document; cfiFromRange?: (r: Range) => string }> })?.getContents?.() || [];
                const holder = contents.find((c) => c.document === doc);
                if (range && holder?.cfiFromRange) cfi = holder.cfiFromRange(range);
            } catch { /* noop */ }
            return { sel: text, para, cfi };
        } catch { return null; }
    };

    const saveCharDesc = async (name: string, desc: string) => {
        try {
            await fetch("/api/book-characters", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ bookPath: filePath, action: "desc", name, desc }),
            });
            const c = charListRef.current.find((x) => x.name === name);
            if (c) c.desc = desc;
            const p = charPopupRef.current;
            if (p && p.char.name === name) setCharPopup({ ...p, char: { ...p.char, desc } });
        } catch { /* noop */ }
    };

    const toggleChars = (on: boolean) => {
        setCharOn(on);
        charOnRef.current = on;
        try { localStorage.setItem("reader-chars-on", on ? "1" : "0"); } catch { /* noop */ }
        for (const doc of getFocusDocs()) doc.body.classList.toggle("osite-chars-off", !on);
        if (!on) setCharPopup(null);
    };

    // ── 仿真滑动（epub.js 官方无翻页动画；html2canvas 快照当前页，
    //    新页在底层即时就位，旧页快照横滑出场——微信读书滑动翻页的思路）──
    const [slide, setSlide] = useState<{ dir: "next" | "prev"; shot: string } | null>(null);
    const flipBusyRef = useRef(false);

    /** 把当前可见页快照成图（同源 iframe，html2canvas 直接画） */
    const captureView = async (): Promise<string | null> => {
        try {
            const container = viewerRef.current?.querySelector(".epub-container") as HTMLElement | null;
            const contents = (renditionRef.current as unknown as { getContents?: () => Array<{ document?: Document }> })?.getContents?.()?.[0];
            const body = contents?.document?.body;
            if (!container || !body) return null;
            const html2canvas = (await import("html2canvas")).default;
            const theme = settingsRef.current.theme;
            const canvas = await html2canvas(body, {
                x: container.scrollLeft,
                y: container.scrollTop,
                width: container.clientWidth,
                height: container.clientHeight,
                scale: 1, // 滑动一晃而过，1x 足够，快照更快
                backgroundColor: theme === "default" ? "#ffffff" : THEME_COLORS[theme].bg,
                logging: false,
            });
            return canvas.toDataURL("image/png");
        } catch { return null; }
    };

    const onSlideEnd = () => { setSlide(null); flipBusyRef.current = false; };

    /** 全部翻页入口统一走这两个（按钮/键盘/滑动/聚焦跨章），仿真滑动先快照再翻 */
    const goNext = async () => {
        if (settingsRef.current.flow === "slide" && !flipBusyRef.current) {
            flipBusyRef.current = true;
            const shot = await captureView();
            if (shot) setSlide({ dir: "next", shot });
            else flipBusyRef.current = false; // 快照失败：退化为直接翻
        }
        void renditionRef.current?.next();
    };
    const goPrev = async () => {
        if (settingsRef.current.flow === "slide" && !flipBusyRef.current) {
            flipBusyRef.current = true;
            const shot = await captureView();
            if (shot) setSlide({ dir: "prev", shot });
            else flipBusyRef.current = false;
        }
        void renditionRef.current?.prev();
    };

    /** ↑↓ 的唯一入口：未开聚焦时按一下即开；章节边界自动翻章接上 */
    const moveFocus = (delta: 1 | -1) => {
        pushLog(`▶ moveFocus(${delta}) focusOn=${focusOnRef.current} idx=${focusIdxRef.current}/${focusParasRef.current.length}`);
        lastMoveDirRef.current = delta;
        if (charPopupRef.current) setCharPopup(null); // 推进聚焦时浮窗自动消失
        if (!focusOnRef.current) { setFocusMode(true); return; }
        // 跨页段落语义：聚焦段还有一半藏在【前进方向的下一页/上一页】时，
        // ↑↓ 只翻页去看它的另一半，光标不动；段落完整看过才移向邻段
        if (settingsRef.current.flow !== "scrolled") {
            const cur = focusParasRef.current[focusIdxRef.current];
            const container = viewerRef.current?.querySelector(".epub-container") as HTMLElement | null;
            if (cur && cur.isConnected && container) {
                const x0 = container.scrollLeft;
                const x1 = x0 + container.clientWidth;
                const rects = Array.from(cur.getClientRects()).filter((r) => r.width > 0 && r.height > 0);
                const visibleHere = rects.some((r) => r.right > x0 + 1 && r.left < x1 - 1);
                const extendsNext = rects.some((r) => r.left >= x1 - 1);
                const extendsPrev = rects.some((r) => r.right <= x0 + 1);
                if (visibleHere && (delta === 1 ? extendsNext : extendsPrev)) {
                    // 跨页段落：只翻页看它的另一半，光标不动。
                    // 游标重画由 relocated 事件驱动（epubjs 翻页完成的瞬间）——
                    // 不再等固定 200ms，光标"已经在那边等着"
                    internalNavRef.current = true; // 别让翻页跟焦重定位
                    pendingGlideElRef.current = cur;
                    void (delta === 1 ? goNext() : goPrev());
                    setTimeout(() => { internalNavRef.current = false; pendingGlideElRef.current = null; }, 600); // 兜底解旗
                    return;
                }
            }
        }
        const next = focusIdxRef.current + delta;
        if (next < 0) { pendingFocusRef.current = "last"; goPrev(); return; }
        if (next > focusParasRef.current.length - 1) { pendingFocusRef.current = "first"; goNext(); return; }
        void applyFocus(next);
    };

    /** 创建 rendition（初始加载 / flow 切换 / 回退默认时共用） */
    const createRendition = async (book: Book, s: ReaderSettings, target?: string) => {
        pushLog(`📖 createRendition flow=${s.flow} target=${target ? "有" : "无"}`);
        const el = viewerRef.current;
        if (!el) return;
        const rendition = book.renderTo(el, {
            width: "100%",
            height: "100%",
            // 上下滚动 = continuous 管理器：全书竖着连续排，跨章无缝，没有"页"的概念；
            // 左右翻页 / 仿真翻页 = 传统分页（仿真只是翻页动画不同，排版一致）
            ...(s.flow === "scrolled"
                ? { manager: "continuous", flow: "scrolled" }
                : { flow: "paginated", spread: "auto" }),
        });
        renditionRef.current = rendition;
        // iframe 内部有焦点时的键盘翻页 + 点击正文收起设置面板
        // 必须走 goNext/goPrev（统一翻页入口）：直呼 rendition.next() 会绕过仿真翻页动画
        rendition.on("keyup", (e: KeyboardEvent) => {
            if (e.key === "ArrowRight") goNext();
            if (e.key === "ArrowLeft") goPrev();
        });
        rendition.on("click", () => setPanelOpen(false));
        // 思源宋体是网络字体：往每个章节 iframe 注入 Google Fonts 样式表
        // （系统没装 Source Han Serif 时兜底；离线/被墙时静默失败，落回 Georgia）
        (rendition.hooks.content as { register: (fn: (contents: { addStylesheet: (url: string) => Promise<void>; document: Document }) => void) => void }).register((contents) => {
            pushLog(`🔧 iframe content hook 执行 docReady=${!!contents.document}`);
            // iOS 关键：iframe 默认 touch-action=auto，浏览器会把 tap 当滚动手势起点，
            // 导致 pointerup 不触发（iPad 点不动聚焦/人名浮窗的隐藏祸根）。
            // manipulation 允许 tap 和滚动，禁双指缩放，pointer 事件稳发
            try {
                const sty = contents.document.createElement("style");
                sty.textContent = "html, body { touch-action: manipulation; } .osite-char { touch-action: manipulation; }";
                contents.document.head.appendChild(sty);
            } catch { /* noop */ }
            // 思源宋体自托管（@fontsource 按 unicode-range 分包，浏览器只取用到的子集；
            // 之前走 Google Fonts 经常加载不出来，落回系统 serif 变成宋体/明朝体的观感）
            contents.addStylesheet("/fonts/noto-serif-sc/400.css").catch?.(() => { /* noop */ });
            contents.addStylesheet("/fonts/noto-serif-sc/600.css").catch?.(() => { /* noop */ });
            // 聚焦模式键盘：↑↓ 移动段落光标（节流防 repeat 打断动画，见外层 onKeyDown 注释）
            let iframeLastKeyMove = 0;
            contents.document.addEventListener("keydown", (e: KeyboardEvent) => {
                if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                    e.preventDefault();
                    if (e.repeat && Date.now() - iframeLastKeyMove < 320) return;
                    iframeLastKeyMove = Date.now();
                    moveFocus(e.key === "ArrowDown" ? 1 : -1);
                } else if (e.key === "Escape" && focusOnRef.current) {
                    setFocusMode(false);
                }
            });
            // 聚焦模式滚轮：翻页类下滚轮移动段落光标（下滚=下一段，上滚=上一段），节流一格一段；
            // 滚动流(scrolled)不劫持——那本来就靠自然滚动，聚焦点随可见区跟随
            let iframeWheelAcc = 0, iframeWheelTs = 0;
            contents.document.addEventListener("wheel", (e: WheelEvent) => {
                if (!focusOnRef.current || settingsRef.current.flow === "scrolled") return;
                e.preventDefault();
                const now = Date.now();
                if (now - iframeWheelTs > 260) iframeWheelAcc = 0;
                iframeWheelAcc += e.deltaY; iframeWheelTs = now;
                if (Math.abs(iframeWheelAcc) >= 40) { const dir = iframeWheelAcc > 0 ? 1 : -1; iframeWheelAcc = 0; moveFocus(dir); }
            }, { passive: false });
            // 点按统一入口（Pointer Events：iOS Safari 13+ 全支持，鼠标/触屏/触控笔统一，
            // 在 click 之前触发，epubjs 不拦截——之前的 click/touchend 三套监听在 iOS
            // 上对 span/p/div 等非交互元素经常不触发，是人名浮窗/聚焦推进失效的祸根）
            const handleActivate = (target: HTMLElement | null, clientX: number) => {
                pushLog(`handleActivate target=${describeEl(target)} x=${Math.round(clientX)} focusOn=${focusOnRef.current}`);
                const charSpan = target?.closest?.(".osite-char") as HTMLElement | null;
                if (charSpan && charOnRef.current) {
                    const c = charListRef.current.find((x) => x.name === charSpan.dataset.char);
                    if (c) { setCharPopup({ char: c, ...popupPosFor(charSpan) }); return; }
                }
                // 没命中人名：关浮窗（不阻断后续——推进时 moveFocus 也会关）
                if (charPopupRef.current) setCharPopup(null);
                if (target?.closest?.("a")) return; // 书内链接放行
                // 边缘翻页热区只认真正的空白：点按落在文字上（哪怕贴着栏边，
                // 比如"圆山饭店"在栏左缘）绝不翻页——选字/聚焦优先
                if (settingsRef.current.flow !== "scrolled" && !target?.closest?.(PARA_SELECTOR)) {
                    const container = viewerRef.current?.querySelector(".epub-container") as HTMLElement | null;
                    if (container) {
                        const xOnScreen = clientX - container.scrollLeft;
                        const w = container.clientWidth;
                        if (xOnScreen < w * 0.15) { void goPrev(); return; }
                        if (xOnScreen > w * 0.85) { void goNext(); return; }
                    }
                }
                if (!focusOnRef.current) return;
                const para = target?.closest?.(PARA_SELECTOR) as HTMLElement | null;
                if (para) {
                    const idx = focusParasRef.current.indexOf(para);
                    if (idx >= 0) { void applyFocus(idx, false); return; } // 点的段落就在眼前，只滑光标不跳页
                }
                // 触屏点空白处 = 聚焦下一段（无键盘时 ↓ 的平替）
                if (window.matchMedia?.("(pointer: coarse)").matches) {
                    moveFocus(1);
                }
            };

            let pdownX = 0;
            let pdownY = 0;
            let lastTapAt = 0; // touchend 与 pointerup 在 iOS 上可能双发，去重
            const isCoarse = window.matchMedia?.("(pointer: coarse)").matches ?? false;

            const onUp = (clientX: number, clientY: number, target: EventTarget | null) => {
                const dx = clientX - pdownX;
                const dy = clientY - pdownY;
                // 关键守卫：有文字选区 = 用户在划选，不是翻页手势。
                // （划选本身就是横向拖动，dx 常 >60px——曾被误判成 goPrev 翻回前页，
                //   聚焦跟焦又落到那页首段 = "聚焦自动跳回前几页"的根因）
                if ((contents.document.getSelection?.()?.toString().trim() || "").length > 0) {
                    setTimeout(() => tryEnrollFromSelection(contents.document), 60);
                    return;
                }
                // iPad 长按选词：选区可能在抬手 60ms 后才定稿，兜底再查一次
                setTimeout(() => tryEnrollFromSelection(contents.document), 60);
                // 横滑翻页（翻页类模式；上下滚动模式保持原生惯性滚动不拦截）
                if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
                    if (settingsRef.current.flow === "scrolled") return;
                    if (dx < 0) void goNext(); else void goPrev();
                    return;
                }
                // 轻点（位移 < 12px）：人物浮窗 / 边缘翻页 / 聚焦推进
                if (Math.abs(dx) < 12 && Math.abs(dy) < 12) {
                    handleActivate(target as HTMLElement | null, clientX);
                    return;
                }
                // 触屏纵向大位移且聚焦开着：推进聚焦（iPad 在段落间空隙上下划）
                if (isCoarse && Math.abs(dy) > 30 && focusOnRef.current && Math.abs(dy) > Math.abs(dx) * 1.5) {
                    moveFocus(dy < 0 ? 1 : -1);
                }
            };

            contents.document.addEventListener("pointerdown", (e: PointerEvent) => {
                pushLog(`iframe pointerdown (${e.clientX},${e.clientY}) pt=${e.pointerType} tg=${describeEl(e.target)}`);
                pdownX = e.clientX; pdownY = e.clientY;
            }, { passive: true });
            contents.document.addEventListener("pointerup", (e: PointerEvent) => {
                pushLog(`iframe pointerup (${e.clientX},${e.clientY}) skip=${Date.now() - lastTapAt < 500}`);
                if (Date.now() - lastTapAt < 500) return; // touchend 已处理
                onUp(e.clientX, e.clientY, e.target);
            }, { passive: true });
            // iOS 兜底：pointerup 在手势被识别为滚动后不触发，touchend 一定发。
            // 用捕获阶段抢在 epubjs 自己的 touch 监听之前
            contents.document.addEventListener("touchstart", (e: TouchEvent) => {
                pushLog(`iframe touchstart (${e.changedTouches[0].clientX},${e.changedTouches[0].clientY}) tg=${describeEl(e.target)}`);
                pdownX = e.changedTouches[0].clientX; pdownY = e.changedTouches[0].clientY;
            }, { capture: true, passive: true });
            contents.document.addEventListener("touchend", (e: TouchEvent) => {
                pushLog(`iframe touchend (${e.changedTouches[0].clientX},${e.changedTouches[0].clientY}) tg=${describeEl(e.target)}`);
                lastTapAt = Date.now();
                const t = e.changedTouches[0];
                onUp(t.clientX, t.clientY, e.target);
            }, { capture: true, passive: true });
            // 选词录入：selectionchange 是 iOS 长按选词唯一可靠的信号（mouseup/touchend
            // 在 iOS iframe 孤岛不触发）。debounce 400ms，选区稳定后弹录入框
            let selTimer: ReturnType<typeof setTimeout> | null = null;
            contents.document.addEventListener("selectionchange", () => {
                if (selTimer) clearTimeout(selTimer);
                selTimer = setTimeout(() => tryEnrollFromSelection(contents.document), 400);
            });
            // 图片可拖到 Notes 按钮：dragstart 把 img 的 src（转 dataURL）+ 当前 cfi 放进 dataTransfer。
            // 父文档的 Notes 按钮 onDrop 接住即存
            contents.document.querySelectorAll("img").forEach((img) => {
                const image = img as HTMLImageElement;
                image.setAttribute("draggable", "true");
                image.addEventListener("dragstart", (ev) => {
                    const dt = (ev as DragEvent).dataTransfer;
                    if (!dt) return;
                    let src = image.currentSrc || image.src;
                    // 同源图转 dataURL（跨 iframe/回调后 blob: 可能失效）
                    try {
                        const canvas = contents.document.createElement("canvas");
                        canvas.width = image.naturalWidth || image.width;
                        canvas.height = image.naturalHeight || image.height;
                        const ctx = canvas.getContext("2d");
                        if (ctx && canvas.width && canvas.height) {
                            ctx.drawImage(image, 0, 0);
                            src = canvas.toDataURL("image/png");
                        }
                    } catch { /* 跨域 canvas 污染：退回原 src */ }
                    const cfi = (renditionRef.current?.currentLocation() as unknown as { start?: { cfi?: string } })?.start?.cfi || "";
                    dt.setData("application/x-osite-note-image", JSON.stringify({ src, cfi }));
                    dt.effectAllowed = "copy";
                });
            });
            // 悬停显示注解（仅电脑端；触屏无 hover 保持点按）：
            // 移进人名 → 弹窗；移开 → 300ms 后消失（缓冲期内移进浮窗则保持，浮窗自己的
            // onMouseEnter/Leave 见渲染处——不然没法点 AI 解读/编辑描述）
            if (!isCoarse) {
                contents.document.addEventListener("mouseover", (e: MouseEvent) => {
                    const span = (e.target as HTMLElement | null)?.closest?.(".osite-char") as HTMLElement | null;
                    if (!span || !charOnRef.current) return;
                    if (hoverCloseRef.current) { clearTimeout(hoverCloseRef.current); hoverCloseRef.current = null; }
                    const c = charListRef.current.find((x) => x.name === span.dataset.char);
                    // 钉住的浮窗（新录入/AI 解读中）不被扫过的其他人名顶掉
                    if (c && charPopupRef.current?.char.name !== c.name && !charPopupRef.current?.pinned) {
                        setCharPopup({ char: c, ...popupPosFor(span) });
                    }
                });
                contents.document.addEventListener("mouseout", (e: MouseEvent) => {
                    const span = (e.target as HTMLElement | null)?.closest?.(".osite-char");
                    if (!span) return;
                    scheduleHoverClose();
                });
            }
        });
        // 换章/重建渲染完成：聚焦模式续上。优先级：
        // 设置切换记下的聚焦段 cfi（精确找回同一段）> 跨章落点 first/last > 当前阅读位置
        rendition.on("rendered", () => {
            markAllDocs(); // 新章节挂载：先打人名标注（聚焦逻辑随后）
            setTimeout(() => paintHighlights(), 60); // 重绘该页的荧光笔标注
            if (!focusOnRef.current) return;
            const cfi = pendingFocusCfiRef.current;
            const target = pendingFocusRef.current;
            pendingFocusRef.current = null;
            pendingFocusCfiRef.current = null;
            setTimeout(() => {
                void (async () => {
                    const prevEl = focusParasRef.current[focusIdxRef.current] || null;
                    const docs = getFocusDocs();
                    if (!docs.length) return;
                    for (const doc of docs) {
                        ensureFocusStyle(doc);
                        doc.body.classList.add("osite-focusmode");
                    }
                    focusParasRef.current = collectParas();
                    // 1) 设置切换：按记下的 cfi 精确找回同一段
                    if (cfi) {
                        const idx = await idxFromCfi(cfi);
                        if (idx >= 0) { await applyFocus(idx, false); return; }
                    }
                    // 2) 跨章移动：落章首/章尾
                    if (target === "first" || target === "last") { await setupFocus(target); return; }
                    // 3) 无明确落点（continuous 滚动挂载了新章节 / 同章重渲染）：
                    //    老聚焦段还活着就原地不动——否则会被拽回视口顶部（"自己退回去"的元凶）
                    if (prevEl && prevEl.isConnected) {
                        const idx = focusParasRef.current.indexOf(prevEl);
                        if (idx >= 0) { await applyFocus(idx, false); return; }
                    }
                    await setupFocus("location");
                })();
            }, 80);
        });
        // 每次翻页/跳转：记录进度（重建 rendition 后也要重挂，所以放在这里）。
        // 聚焦模式下翻页 = 想看新页 → 焦点自动落到新页第一段（applyFocus 自己发的跳转除外）
        rendition.on("relocated", (location: { start?: { cfi?: string; displayed?: { page: number; total: number }; percentage?: number }; end?: unknown }) => {
            const cfi = location?.start?.cfi;
            if (cfi) scheduleProgressSave(cfi);
            if (moodOnRef.current) { pageCounterRef.current += 1; measureMood(); } // 翻页计数(音乐节流用) + 重测故事温度
            // 底部状态栏数据：本章页码（displayed）+ 全书百分比/页（locations 就绪后）
            try {
                const disp = location?.start?.displayed;
                const book = bookRef.current;
                let bookPct = 0;
                let bookPage = 0;
                let bookTotal = 0;
                if (locationsReadyRef.current && book && cfi) {
                    bookPct = Math.round((book.locations.percentageFromCfi(cfi) || 0) * 100);
                    const locIdx = book.locations.locationFromCfi(cfi) as unknown as number;
                    bookTotal = book.locations.length();
                    bookPage = Math.max(1, Number(locIdx) + 1);
                }
                setPageInfo({
                    chapterPage: disp?.page || 0,
                    chapterTotal: disp?.total || 0,
                    bookPct, bookPage, bookTotal,
                });
            } catch { /* 状态栏失败不影响阅读 */ }
            // 跨页段落翻页（moveFocus 挂起的）：翻页刚完成，立即在新页重画游标——零等待
            if (pendingGlideElRef.current) {
                const el = pendingGlideElRef.current;
                pendingGlideElRef.current = null;
                internalNavRef.current = false;
                requestAnimationFrame(() => {
                    if (el.isConnected && focusParasRef.current[focusIdxRef.current] === el) glideTo(el);
                });
            }
            if (focusOnRef.current && !internalNavRef.current && settingsRef.current.flow !== "scrolled") {
                setTimeout(() => {
                    // 守卫：聚焦段在本页还有可见片段就绝不重定位（重复/晚到的 relocated
                    // 曾把焦点重置回页首段 = "自己退回去" bug），只重画游标条对齐新片段
                    if (focusedElVisible()) {
                        const el = focusParasRef.current[focusIdxRef.current];
                        if (el) glideTo(el);
                        return;
                    }
                    focusParasRef.current = collectParas();
                    void idxFromLocation().then((i) => applyFocus(i, false));
                }, 120);
            }
        });
        applyAppearance(rendition, s);
        await (target ? rendition.display(target) : rendition.display());
    };

    /** 重建 rendition：destroy 前记下 cfi，重建后 display 回原位；聚焦段的 cfi 一并记下精确找回 */
    const rebuildRendition = async (s: ReaderSettings) => {
        const book = bookRef.current;
        if (!book || !viewerRef.current) return;
        let cfi: string | undefined;
        try {
            cfi = (renditionRef.current?.currentLocation() as unknown as { start?: { cfi?: string } })?.start?.cfi;
        } catch { /* location 未就绪时从头显示 */ }
        // 聚焦模式：记下当前聚焦段的 cfi（rendered 后按它找回同一段）
        if (focusOnRef.current) {
            try {
                const el = focusParasRef.current[focusIdxRef.current];
                const contents = (renditionRef.current as unknown as { getContents?: () => Array<{ document?: Document; cfiFromNode?: (n: Node) => string }> })?.getContents?.() || [];
                const holder = el ? contents.find((c) => c.document === el.ownerDocument) : undefined;
                pendingFocusCfiRef.current = el && holder?.cfiFromNode ? holder.cfiFromNode(el) : null;
            } catch { pendingFocusCfiRef.current = null; }
        }
        try {
            renditionRef.current?.destroy();
        } catch { /* epubjs 销毁偶发内部报错，忽略 */ }
        renditionRef.current = null;
        // 等两帧：页边距/翻页方式改的是外层容器宽度（React 渲染 + 布局），
        // 必须等容器实际变宽/变窄后再建 rendition，否则分页按旧宽度算
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        await createRendition(book, s, cfi);
    };

    /** 回退到"书籍默认"需要重建：残留在当前章节里的深层 stylesheet 无法撤销。
     *  页边距改变 = 容器宽度变了，分页排版必须重算，也走重建（cfi 回原位）。 */
    const needsRebuild = (prev: ReaderSettings, next: ReaderSettings) =>
        next.flow !== prev.flow ||
        next.margin !== prev.margin ||
        (prev.theme !== "default" && next.theme === "default") ||
        (prev.font !== "default" && next.font === "default") ||
        (prev.lineHeight !== 0 && next.lineHeight === 0) ||
        (prev.bold && !next.bold);

    /** 即时应用一份新设置（不落库）。聚焦模式下不管走哪条路，聚焦段都保持不变：
     *  重建路径靠 pendingFocusCfi 找回；轻量路径（改字号/行距）排版会回流，延时重画聚光条 */
    const applySettingsChange = (next: ReaderSettings) => {
        const prev = settingsRef.current;
        settingsRef.current = next;
        setSettings(next);
        if (needsRebuild(prev, next)) {
            void rebuildRendition(next);
        } else if (renditionRef.current) {
            applyAppearance(renditionRef.current, next);
            if (focusOnRef.current) {
                setTimeout(() => {
                    const el = focusParasRef.current[focusIdxRef.current];
                    if (el) glideTo(el); // 回流后聚光条位置对齐新排版
                }, 400);
            }
        }
    };

    const persist = (scope: "user" | "book", s: ReaderSettings) =>
        fetch("/api/reader-settings", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ scope, bookPath: filePath, settings: s }),
        }).catch(() => { /* 保存失败不打断阅读 */ });

    /** 防抖 500ms 落库到当前层（开"仅本书" = book 层，否则 user 层） */
    const scheduleSave = (s: ReaderSettings) => {
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        saveTimerRef.current = setTimeout(() => {
            const scope = bookOnlyRef.current ? "book" : "user";
            if (scope === "book") bookSchemeRef.current = s;
            else userSchemeRef.current = s;
            void persist(scope, s);
        }, 500);
    };

    /** UI 改设置入口：即时应用 + 防抖保存。
     *  无变化判定必须覆盖全部字段——历史 bug：漏了 margin/lineHeight 导致那两排按钮点了没反应 */
    const updateSettings = (patch: Partial<ReaderSettings>) => {
        const next = normalize({ ...settingsRef.current, ...patch });
        const prev = settingsRef.current;
        if ((Object.keys(next) as (keyof ReaderSettings)[]).every((k) => next[k] === prev[k])) {
            return;
        }
        applySettingsChange(next);
        scheduleSave(next);
    };

    /** "仅本书生效"开关：开 = 当前设置存为该书覆盖；关 = 删除该书覆盖并回落用户级 */
    const toggleBookOnly = (on: boolean) => {
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current); // 防止旧防抖存错层
        setBookOnly(on);
        bookOnlyRef.current = on;
        if (on) {
            bookSchemeRef.current = settingsRef.current;
            void persist("book", settingsRef.current);
        } else {
            bookSchemeRef.current = null;
            void fetch("/api/reader-settings", {
                method: "DELETE",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ scope: "book", bookPath: filePath }),
            }).catch(() => {});
            applySettingsChange(normalize({ ...DEFAULT_SETTINGS, ...(userSchemeRef.current || {}) }));
        }
    };

    /** 恢复默认：删除当前层方案，回落到下一层 */
    const resetCurrentLayer = () => {
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        const scope = bookOnlyRef.current ? "book" : "user";
        void fetch("/api/reader-settings", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ scope, bookPath: filePath }),
        }).catch(() => {});
        if (scope === "book") {
            bookSchemeRef.current = null;
            setBookOnly(false);
            bookOnlyRef.current = false;
        } else {
            userSchemeRef.current = null;
        }
        applySettingsChange(
            normalize({ ...DEFAULT_SETTINGS, ...(userSchemeRef.current || {}), ...(bookSchemeRef.current || {}) })
        );
    };

    useEffect(() => {
        if (!filePath) {
            setStatus("error");
            setErrorMsg("缺少 path 参数");
            return;
        }
        let book: Book | null = null;
        let cancelled = false;

        (async () => {
            try {
                // 动态 import：epubjs 依赖 window/DOM，只能在浏览器端加载
                const ePub = (await import("epubjs")).default;
                // 设置与文件并行取。先自己 fetch 成 ArrayBuffer 再喂给 epubjs——
                // 直接给带 querystring 的 URL 会让 epubjs 的扩展名嗅探失灵
                const [schemes, res, savedProgress] = await Promise.all([
                    fetch(`/api/reader-settings?bookPath=${encodeURIComponent(filePath)}`)
                        .then((r) => (r.ok ? r.json() : null))
                        .catch(() => null),
                    fetch(`/api/books/file?path=${encodeURIComponent(filePath)}`),
                    fetch(`/api/reader-progress?bookPath=${encodeURIComponent(filePath)}`)
                        .then((r) => (r.ok ? r.json() : null))
                        .catch(() => null),
                ]);
                if (!res.ok) throw new Error(`文件加载失败 (HTTP ${res.status})`);
                const buf = await res.arrayBuffer();
                if (cancelled || !viewerRef.current) return;

                // 三层合并：单本书 > 用户级 > 书籍默认
                userSchemeRef.current = schemes?.userScheme ?? null;
                bookSchemeRef.current = schemes?.bookScheme ?? null;
                const merged = normalize({
                    ...DEFAULT_SETTINGS,
                    ...(userSchemeRef.current || {}),
                    ...(bookSchemeRef.current || {}),
                });
                // 背景主题跟随全站模式（夜间站进来必是深色阅读器，绝不闪白；日间站反之）——
                // 存档主题与站点模式冲突时以站点为准，进入后用户再切则反向联动全站
                const siteDark = document.documentElement.classList.contains("dark");
                if (siteDark && merged.theme !== "dark") merged.theme = "dark";
                else if (!siteDark && merged.theme === "dark") merged.theme = "default";
                settingsRef.current = merged;
                setSettings(merged);
                settingsLoadedRef.current = true; // 此后阅读器切背景才反向同步全站
                const hasBookScheme = !!schemes?.bookScheme;
                setBookOnly(hasBookScheme);
                bookOnlyRef.current = hasBookScheme;

                book = ePub(buf);
                bookRef.current = book;
                // 有存档就从上次位置续读；聚焦模式开着的话，存档 cfi 同时交给
                // rendered 处理器按它精确聚焦回上次那一段（检查点恢复）
                if (focusOnRef.current && savedProgress?.cfi) {
                    pendingFocusCfiRef.current = savedProgress.cfi;
                }
                await createRendition(book, merged, savedProgress?.cfi || undefined);
                if (cancelled) return;

                book.loaded.metadata.then((meta) => {
                    if (!cancelled && meta?.title) { setTitle(meta.title); titleRef.current = meta.title; }
                });
                // 后台生成 locations（全书均分定位点）：percent 才有全书口径。
                // 大书要几秒，不阻塞首屏；生成完后续 relocated 上报的 percent 就准了
                book.ready.then(() => book?.locations.generate(600)).then(() => {
                    if (!cancelled) {
                        locationsReadyRef.current = true;
                        // locations 生成完：立即补一次全书进度（不等下次翻页）
                        try {
                            const rend = renditionRef.current;
                            const loc = rend?.currentLocation() as unknown as { start?: { cfi?: string; displayed?: { page: number; total: number } } };
                            const cfi = loc?.start?.cfi;
                            if (cfi && book) {
                                const locIdx = book.locations.locationFromCfi(cfi) as unknown as number;
                                setPageInfo({
                                    chapterPage: loc?.start?.displayed?.page || 0,
                                    chapterTotal: loc?.start?.displayed?.total || 0,
                                    bookPct: Math.round((book.locations.percentageFromCfi(cfi) || 0) * 100),
                                    bookPage: Math.max(1, Number(locIdx) + 1),
                                    bookTotal: book.locations.length(),
                                });
                            }
                        } catch { /* noop */ }
                    }
                }).catch(() => { /* locations 失败只影响百分比，不影响 cfi 续读 */ });
                setStatus("ready");
                if (!notesLoadedRef.current) { notesLoadedRef.current = true; void loadNotes(); }
            } catch (err) {
                console.error("EPUB 渲染失败:", err);
                if (!cancelled) {
                    setStatus("error");
                    setErrorMsg(err instanceof Error ? err.message : "EPUB 渲染失败");
                }
            }
        })();

        // 聚焦模式偏好恢复（设备级偏好，localStorage）
        try {
            if (localStorage.getItem("reader-focus-mode") === "1") {
                setFocusOn(true);
                focusOnRef.current = true;
            }
            if (localStorage.getItem("reader-chars-on") === "0") {
                setCharOn(false);
                charOnRef.current = false;
            }
        } catch { /* noop */ }

        // 人物索引（服务端缓存，首次提取可能要几秒；到货后给已挂载章节补标注）
        fetch(`/api/book-characters?path=${encodeURIComponent(filePath)}`)
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => {
                if (!cancelled && d?.success && Array.isArray(d.characters)) {
                    charListRef.current = d.characters;
                    markAllDocs();
                }
            })
            .catch(() => { /* 人物识别失败不影响阅读 */ });

        // 切后台/关页：兜底存档（返回书架按钮之外的离开路径）
        const onPageHide = () => saveCheckpoint();
        window.addEventListener("pagehide", onPageHide);

        // 外层页面的键盘翻页 + 聚焦光标
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "ArrowRight") goNext();
            if (e.key === "ArrowLeft") goPrev();
        };
        // 键盘 ↑↓ 节流：按住时 keydown 高频 repeat，每次 moveFocus 会重置 transform 目标 +
        // 强制 layout 读取，transition 持续被打断 → 帧率低。节流到略大于 transition 时长，
        // 一次动画跑完再接受下一次，电脑端就和 iPad 单次 touch 一样流畅
        let lastKeyMove = 0;
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                if (e.repeat && Date.now() - lastKeyMove < 320) return;
                lastKeyMove = Date.now();
                moveFocus(e.key === "ArrowDown" ? 1 : -1);
            } else if (e.key === "Escape" && focusOnRef.current) {
                setFocusMode(false);
            }
        };
        window.addEventListener("keyup", onKey);
        window.addEventListener("keydown", onKeyDown);

        return () => {
            saveCheckpoint(); // 路由离开（返回书架等）先存档，再拆播放器
            stopReading(); // 停朗读，防止离开页面后声音还在
            stopMusic(false); // 停氛围音乐（立即），关闭 AudioContext
            try { void audioCtxRef.current?.close(); audioCtxRef.current = null; } catch { /* noop */ }
            cancelled = true;
            window.removeEventListener("keyup", onKey);
            window.removeEventListener("keydown", onKeyDown);
            window.removeEventListener("pagehide", onPageHide);
            if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
            if (progressTimerRef.current) clearTimeout(progressTimerRef.current);
            renditionRef.current = null;
            bookRef.current = null;
            try {
                book?.destroy();
            } catch {
                // epubjs 销毁时偶发内部报错，忽略
            }
        };
        // createRendition 等回调依赖 ref，effect 只跟随文件路径
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [filePath]);

    // 设置面板点外部关闭
    useEffect(() => {
        if (!panelOpen) return;
        const onDown = (e: MouseEvent) => {
            if (panelWrapRef.current && !panelWrapRef.current.contains(e.target as Node)) setPanelOpen(false);
        };
        document.addEventListener("mousedown", onDown);
        return () => document.removeEventListener("mousedown", onDown);
    }, [panelOpen]);

    // 沉浸阅读：进阅读器收起全站顶栏/页脚/底部 tab（CSS 见 globals 的 body.reader-immersive）
    useEffect(() => {
        document.body.classList.add("reader-immersive");
        return () => document.body.classList.remove("reader-immersive");
    }, []);

    // 阅读器外围容器背景跟随主题（不只是 iframe 内容）
    const outerBg = settings.theme === "default" ? "#ffffff" : THEME_COLORS[settings.theme].bg;
    // 状态栏文字色：随画布深浅取"比背景差一档"的灰——浅底用中灰，黑底用浅白灰
    const statusBarFg = ((): string => {
        switch (settings.theme) {
            case "dark": return "rgba(230, 230, 232, 0.55)";  // 黑底 → 稍白的灰
            case "sepia": return "rgba(58, 52, 40, 0.45)";    // 纸黄底 → 深棕灰
            case "green": return "rgba(34, 50, 42, 0.48)";    // 淡绿底 → 深绿灰
            default: return "rgba(0, 0, 0, 0.38)";            // 白底 → 中灰
        }
    })();

    // 根高度铺满滑入层（fixed 全屏，尺寸稳定）；绝不用 100dvh——iPhone 地址栏收展时
    // dvh 反复变化 → epubjs 跟着 resize 重排 → 页面抖动/抽搐
    return (
        <div className="flex h-full flex-col overflow-hidden">
            {/* 顶栏：返回 + 书名 + 工具组。手机(<sm)：工具组折叠成「⋯」，展开为第二行横滑；iPad/桌面单行全量 */}
            <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-line/60 bg-bg-card px-4 py-2.5 sm:flex-nowrap sm:px-6">
                <Link
                    href="/bookshelf"
                    onClick={exitToShelf}
                    className="flex shrink-0 items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-[13px] text-text-2 transition-colors hover:bg-bg-hover hover:text-text-1"
                >
                    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                    </svg>
                    <span className="hidden sm:inline">返回书架</span>
                </Link>
                <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-text-1 sm:text-[15px]">
                    {title || (status === "loading" ? "加载中..." : "EPUB 阅读器")}
                </span>
                {/* 手机：工具开关（⋯ / ✕） */}
                <button
                    onClick={() => setMobileToolsOpen((v) => !v)}
                    aria-label="工具"
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-[16px] transition-colors sm:hidden ${
                        mobileToolsOpen ? "border-primary text-primary" : "border-line text-text-2"
                    }`}
                >
                    {mobileToolsOpen ? "✕" : "⋯"}
                </button>
                <div
                    ref={panelWrapRef}
                    className={`relative items-center gap-3 scrollbar-hide *:shrink-0 max-sm:basis-full max-sm:overflow-x-auto max-sm:pt-2 sm:ml-auto sm:flex sm:shrink-0 ${
                        mobileToolsOpen ? "flex" : "hidden"
                    }`}
                >
                    <span className="hidden text-[12px] text-text-3 lg:block">← → 翻页 · ↑ ↓ 聚焦段落 · Esc 退出聚焦</span>
                    <button
                        onClick={toggleReading}
                        aria-pressed={readingOn}
                        title="朗读：从聚焦段落开始逐段朗读（晓晓），自动推进翻页，文字变色显示进度"
                        className={`flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] transition-colors ${
                            readingOn
                                ? "border-primary bg-primary/10 text-primary"
                                : "border-line text-text-2 hover:bg-bg-hover hover:text-text-1"
                        }`}
                    >
                        {readingOn ? (
                            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
                        ) : (
                            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M11 5 6 9H3v6h3l5 4V5zM15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />
                            </svg>
                        )}
                        {readingOn ? "停止" : "朗读"}
                    </button>
                    <button
                        onClick={toggleAutoRead}
                        aria-pressed={autoPhase !== "idle"}
                        title="自动阅读：先测你读一页的速度，之后聚焦块按你的速率自动向下推进翻页"
                        className={`flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] transition-colors ${
                            autoPhase !== "idle"
                                ? "border-primary bg-primary/10 text-primary"
                                : "border-line text-text-2 hover:bg-bg-hover hover:text-text-1"
                        }`}
                    >
                        {autoPhase === "idle" ? (
                            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M13 5H3M17 12H3M13 19H3M17 5l4 3.5L17 12" />
                            </svg>
                        ) : (
                            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
                        )}
                        {autoPhase === "idle" ? "自动" : autoPhase === "calibrating" ? "测速中" : "停止"}
                    </button>
                    <button
                        onClick={toggleMood}
                        aria-pressed={moodOn}
                        title="温度感知：AI 读最近三页，按情节紧张度给光标上色 + 联动氛围音乐（冷蓝→炽红）"
                        className={`flex h-8 items-center gap-1.5 rounded-full border pl-3 text-[13px] transition-colors ${
                            moodOn ? "border-primary text-primary pr-1.5" : "border-line text-text-2 hover:bg-bg-hover hover:text-text-1 pr-3"
                        }`}
                        style={moodOn ? { borderColor: tempColor(moodTemp), color: tempColor(moodTemp) } : undefined}
                    >
                        {moodOn ? (
                            <span className="h-3 w-3 rounded-full transition-colors" style={{ background: tempColor(moodTemp) }} />
                        ) : (
                            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M14 14.76V5a2 2 0 1 0-4 0v9.76a4 4 0 1 0 4 0z" />
                            </svg>
                        )}
                        温度
                        {/* 温度开启后：内嵌小喇叭，静音/取消静音氛围音乐（保留变色） */}
                        {moodOn && (
                            <span
                                onClick={toggleMusicMute}
                                role="button"
                                title={musicOn ? "氛围音乐：开（点击静音）" : "氛围音乐：静音（点击开启）"}
                                className="ml-0.5 flex h-6 w-6 items-center justify-center rounded-full transition-colors hover:bg-primary/10"
                            >
                                {musicOn ? (
                                    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M11 5L6 9H2v6h4l5 4V5z" />
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.5 8.5a5 5 0 0 1 0 7M18.5 6a8 8 0 0 1 0 12" />
                                    </svg>
                                ) : (
                                    <svg className="h-3.5 w-3.5 opacity-60" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M11 5L6 9H2v6h4l5 4V5z" />
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M22 9l-6 6M16 9l6 6" />
                                    </svg>
                                )}
                            </span>
                        )}
                    </button>
                    <button
                        onClick={() => setNotesOpen((v) => !v)}
                        onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add("ring-2", "ring-primary"); }}
                        onDragLeave={(e) => e.currentTarget.classList.remove("ring-2", "ring-primary")}
                        onDrop={(e) => {
                            e.preventDefault();
                            e.currentTarget.classList.remove("ring-2", "ring-primary");
                            const raw = e.dataTransfer.getData("application/x-osite-note-image");
                            if (raw) { try { const { src, cfi } = JSON.parse(raw); if (src) void addImageNote(src, cfi); } catch { /* noop */ } }
                        }}
                        aria-pressed={notesOpen}
                        title="Notes：荧光笔标注和图片笔记；把正文图片拖到这里可收藏"
                        className={`flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] transition-colors ${
                            notesOpen
                                ? "border-primary bg-primary/10 text-primary"
                                : "border-line text-text-2 hover:bg-bg-hover hover:text-text-1"
                        }`}
                    >
                        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4h12l4 4v12H4zM16 4v4h4M8 13h8M8 17h5" />
                        </svg>
                        Notes{notes.length > 0 ? ` ${notes.length}` : ""}
                    </button>
                    <button
                        onClick={() => setAskOpen((v) => !v)}
                        aria-pressed={askOpen}
                        title="疑问助手：问 AI 阅读细节，只看已读部分，绝不剧透"
                        className={`flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] transition-colors ${
                            askOpen
                                ? "border-secondary bg-secondary/10 text-secondary"
                                : "border-line text-text-2 hover:bg-bg-hover hover:text-text-1"
                        }`}
                    >
                        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2}>
                            <circle cx="12" cy="12" r="9" />
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.8.4-1 .9-1 1.7v.5M12 17.5h.01" />
                        </svg>
                        疑问
                    </button>
                    <button
                        onClick={() => {
                            if (relOpen) { setRelOpen(false); return; }
                            // 每次打开都从零开始：清空上次的选择/图/说明
                            setRelChars([...charListRef.current]);
                            setRelSel([]);
                            setRelResult(null);
                            setRelSvg("");
                            setRelOpen(true);
                        }}
                        aria-pressed={relOpen}
                        title="关系图：选 2 个以上词条，AI 画出它们之间的关系图谱"
                        className={`flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] transition-colors ${
                            relOpen
                                ? "border-secondary bg-secondary/10 text-secondary"
                                : "border-line text-text-2 hover:bg-bg-hover hover:text-text-1"
                        }`}
                    >
                        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                            <circle cx="6" cy="6" r="2.5" /><circle cx="18" cy="7" r="2.5" /><circle cx="12" cy="18" r="2.5" />
                            <path strokeLinecap="round" d="M8 7l8 0.5M7.5 8l4 8M16.5 9l-4 7" />
                        </svg>
                        关系图
                    </button>
                    <button
                        onClick={() => toggleChars(!charOn)}
                        aria-pressed={charOn}
                        title="信息注解：人名/地名/术语按类型色系上色，点击看解释；选中文字可录入新词条"
                        className={`flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] transition-colors ${
                            charOn
                                ? "border-primary bg-primary/10 text-primary"
                                : "border-line text-text-2 hover:bg-bg-hover hover:text-text-1"
                        }`}
                    >
                        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
                        </svg>
                        注解
                    </button>
                    <button
                        onClick={() => setFocusMode(!focusOn)}
                        aria-pressed={focusOn}
                        title="聚焦模式：聚光灯打在单个段落上，↑↓ 逐段移动（ADHD 友好）"
                        className={`flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] transition-colors ${
                            focusOn
                                ? "border-primary bg-primary/10 text-primary"
                                : "border-line text-text-2 hover:bg-bg-hover hover:text-text-1"
                        }`}
                    >
                        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                            <circle cx="12" cy="12" r="3.2" />
                            <path strokeLinecap="round" d="M12 2v3M12 19v3M2 12h3M19 12h3" />
                        </svg>
                        聚焦
                    </button>
                    <button
                        onClick={() => setPanelOpen((v) => !v)}
                        aria-label="设置"
                        className={`flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] transition-colors ${
                            panelOpen
                                ? "border-primary text-primary"
                                : "border-line text-text-2 hover:bg-bg-hover hover:text-text-1"
                        }`}
                    >
                        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M19.14 12.94c.04-.31.06-.63.06-.94 0-.31-.02-.63-.06-.94l2.03-1.58a.49.49 0 00.12-.61l-1.92-3.32a.49.49 0 00-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 00-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.49.49 0 00-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58a.49.49 0 00-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z" />
                        </svg>
                        设置
                    </button>

                    {/* 设置浮层 */}
                    {panelOpen && (
                        // 手机上工具行是 overflow-x-auto（会裁剪 absolute 子元素）→ 面板改 fixed 悬浮；sm+ 恢复 absolute 挂在按钮下
                        <div className="fixed inset-x-3 top-24 z-30 mt-0 w-auto rounded-xl border border-line bg-bg-nav p-4 shadow-2xl sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:w-[300px]">
                            {/* 字号 */}
                            <div className="flex items-center justify-between">
                                <span className="text-[12px] text-text-3">字号</span>
                                <div className="flex items-center gap-1.5">
                                    <button
                                        onClick={() => updateSettings({ fontSize: settings.fontSize - 10 })}
                                        disabled={settings.fontSize <= 80}
                                        aria-label="减小字号"
                                        className="flex h-7 w-9 items-center justify-center rounded-full border border-line text-[12px] text-text-2 transition-colors hover:text-text-1 disabled:cursor-not-allowed disabled:opacity-40"
                                    >
                                        A-
                                    </button>
                                    <span className="w-12 text-center text-[12px] text-text-2">
                                        {settings.fontSize === 100 ? "默认" : `${settings.fontSize}%`}
                                    </span>
                                    <button
                                        onClick={() => updateSettings({ fontSize: settings.fontSize + 10 })}
                                        disabled={settings.fontSize >= 160}
                                        aria-label="增大字号"
                                        className="flex h-7 w-9 items-center justify-center rounded-full border border-line text-[13px] text-text-2 transition-colors hover:text-text-1 disabled:cursor-not-allowed disabled:opacity-40"
                                    >
                                        A+
                                    </button>
                                </div>
                            </div>

                            {/* 背景 */}
                            <div className="mt-3 flex items-center justify-between">
                                <span className="text-[12px] text-text-3">背景</span>
                                <div className="flex items-center gap-1.5">
                                    {THEME_OPTIONS.map((o) => (
                                        <Pill
                                            key={o.key}
                                            active={settings.theme === o.key}
                                            onClick={() => updateSettings({ theme: o.key })}
                                            style={
                                                o.key === "default"
                                                    ? undefined
                                                    : {
                                                          backgroundColor: THEME_COLORS[o.key].bg,
                                                          color: THEME_COLORS[o.key].fg,
                                                      }
                                            }
                                        >
                                            {o.label}
                                        </Pill>
                                    ))}
                                </div>
                            </div>

                            {/* 字体（6 款，两行排开） */}
                            <div className="mt-3 flex items-start justify-between">
                                <span className="pt-1 text-[12px] text-text-3">字体</span>
                                <div className="flex max-w-[210px] flex-wrap items-center justify-end gap-1.5">
                                    {FONT_OPTIONS.map((o) => (
                                        <Pill
                                            key={o.key}
                                            active={settings.font === o.key}
                                            onClick={() => updateSettings({ font: o.key })}
                                            style={o.key === "default" ? undefined : { fontFamily: FONT_STACKS[o.key] }}
                                        >
                                            {o.label}
                                        </Pill>
                                    ))}
                                </div>
                            </div>

                            {/* 字重 */}
                            <div className="mt-3 flex items-center justify-between">
                                <span className="text-[12px] text-text-3">字重</span>
                                <div className="flex items-center gap-1.5">
                                    <Pill active={!settings.bold} onClick={() => updateSettings({ bold: false })}>默认</Pill>
                                    <Pill active={settings.bold} onClick={() => updateSettings({ bold: true })} style={{ fontWeight: 700 }}>加粗</Pill>
                                </div>
                            </div>

                            {/* 行距 */}
                            <div className="mt-3 flex items-center justify-between">
                                <span className="text-[12px] text-text-3">行距</span>
                                <div className="flex items-center gap-1.5">
                                    {LINE_HEIGHT_OPTIONS.map((o) => (
                                        <Pill
                                            key={o.key}
                                            active={settings.lineHeight === o.key}
                                            onClick={() => updateSettings({ lineHeight: o.key })}
                                        >
                                            {o.label}
                                        </Pill>
                                    ))}
                                </div>
                            </div>

                            {/* 页边距 */}
                            <div className="mt-3 flex items-center justify-between">
                                <span className="text-[12px] text-text-3">页边距</span>
                                <div className="flex items-center gap-1.5">
                                    {MARGIN_OPTIONS.map((o) => (
                                        <Pill
                                            key={o.key}
                                            active={settings.margin === o.key}
                                            onClick={() => updateSettings({ margin: o.key })}
                                        >
                                            {o.label}
                                        </Pill>
                                    ))}
                                </div>
                            </div>

                            {/* 翻页方式 */}
                            <div className="mt-3 flex items-center justify-between">
                                <span className="text-[12px] text-text-3">翻页</span>
                                <div className="flex items-center gap-1.5">
                                    {FLOW_OPTIONS.map((o) => (
                                        <Pill
                                            key={o.key}
                                            active={settings.flow === o.key}
                                            onClick={() => updateSettings({ flow: o.key })}
                                        >
                                            {o.label}
                                        </Pill>
                                    ))}
                                </div>
                            </div>

                            {/* 朗读：音色 + 语速（改动即存，全局跟账号走；正在朗读时下一段生效） */}
                            <div className="mt-3 flex items-start justify-between border-t border-line pt-3">
                                <span className="pt-1 text-[12px] text-text-3">朗读音色</span>
                                <div className="flex max-w-[210px] flex-wrap items-center justify-end gap-1.5">
                                    {TTS_VOICE_OPTIONS.map((o) => (
                                        <Pill
                                            key={o.key}
                                            active={settings.ttsVoice === o.key}
                                            onClick={() => updateSettings({ ttsVoice: o.key })}
                                        >
                                            {o.label}
                                        </Pill>
                                    ))}
                                </div>
                            </div>
                            <div className="mt-3 flex items-center justify-between">
                                <span className="text-[12px] text-text-3">朗读语速</span>
                                <div className="flex items-center gap-1.5">
                                    {TTS_RATE_OPTIONS.map((o) => (
                                        <Pill
                                            key={o.key}
                                            active={settings.ttsRate === o.key}
                                            onClick={() => updateSettings({ ttsRate: o.key })}
                                        >
                                            {o.label}
                                        </Pill>
                                    ))}
                                </div>
                            </div>

                            {/* 仅本书生效 + 恢复默认 */}
                            <div className="mt-4 flex items-center justify-between border-t border-line pt-3">
                                <label className="flex cursor-pointer items-center gap-2">
                                    <button
                                        role="switch"
                                        aria-checked={bookOnly}
                                        onClick={() => toggleBookOnly(!bookOnly)}
                                        className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
                                            bookOnly ? "bg-primary" : "bg-bg-hover"
                                        }`}
                                    >
                                        <span
                                            className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
                                                bookOnly ? "translate-x-4" : "translate-x-0"
                                            }`}
                                        />
                                    </button>
                                    <span className="text-[12px] text-text-2">仅本书生效</span>
                                </label>
                                <button
                                    onClick={resetCurrentLayer}
                                    className="text-[12px] text-text-3 transition-colors hover:text-primary"
                                >
                                    恢复默认
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Debug 面板：?debug=1 开启。记录所有触控事件，用户复制日志反馈定位 iOS 失效 */}
            {debugOn && (
                <div className="fixed right-2 top-20 z-[200] flex w-[280px] max-w-[80vw] flex-col gap-1 rounded-lg border border-line bg-bg-card/95 p-2 shadow-2xl" style={{ maxHeight: "60vh" }}>
                    <div className="flex items-center justify-between">
                        <span className="text-[11px] font-bold text-primary">触控 Debug 日志</span>
                        <button
                            className="cursor-pointer rounded bg-primary px-2 py-0.5 text-[11px] text-white"
                            onClick={() => {
                                const text = debugLog.current.slice().reverse().map((l) => `${l.t} ${l.msg}`).join("\n");
                                void navigator.clipboard?.writeText(text).then(() => pushLog("已复制到剪贴板")).catch(() => {});
                            }}
                        >复制</button>
                    </div>
                    <div className="overflow-auto rounded bg-black/85 p-1.5 font-mono text-[10px] leading-tight text-green-400" style={{ maxHeight: "40vh" }}>
                        {debugLog.current.length === 0 ? <div className="text-gray-500">点阅读区试试…</div> : debugLog.current.map((l, i) => (
                            <div key={i} className="whitespace-pre-wrap break-all">{l.t} {l.msg}</div>
                        ))}
                    </div>
                </div>
            )}

            {/* 阅读区：全屏铺满，书页本体居中收在书本比例的列宽里。
                外层空白（iframe 之外的边距区）也响应点按推进聚焦——iPad 点"空白"
                大多落在这里而不是 iframe 里，iframe 内部的监听接不到。
                用 onPointerUp（iOS Safari 13+ 全支持，鼠标/触屏统一，不依赖不可靠的 click） */}
            <div
                ref={outerAreaRef}
                className="relative min-h-0 flex-1 transition-colors"
                style={{ backgroundColor: outerBg }}
                onPointerUp={(e) => {
                    pushLog(`外层 onPointerUp tg=${describeEl(e.target)} focusOn=${focusOnRef.current}`);
                    if ((e.target as HTMLElement).closest("button, a, input, textarea, [data-noadvance]")) return;
                    if (charPopupRef.current) { setCharPopup(null); return; } // 点边距区关浮窗
                    if (focusOnRef.current) moveFocus(1);
                }}
            >
                {/* 聚焦覆盖层（仅触屏设备）：iOS 上 iframe 是事件孤岛——父文档收不到
                    iframe 区域的触摸，iframe 内监听也不工作。聚焦时盖一层父文档透明 div
                    接管点击 → 推进聚焦。电脑端 pointer:fine 不渲染，鼠标选词/点人名不受影响。
                    弹窗出现时让出（pointer-events none）以便操作弹窗。 */}
                {isCoarseDevice && (
                    <div
                        ref={focusOverlayRef}
                        data-noadvance
                        className="absolute inset-0"
                        style={{ zIndex: 40, pointerEvents: (isCoarseDevice && status === "ready" && (focusOn || !!charPopup) && !enrollDraft && !askOpen && !relOpen && !notesOpen && !zoomImg) ? "auto" : "none" }}
                    />
                )}
                {status === "loading" && (
                    <div className="absolute inset-0 z-10 flex items-center justify-center gap-3 bg-bg text-[14px] text-text-3">
                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                        正在解析 EPUB...
                    </div>
                )}
                {status === "error" && (
                    <div className="absolute inset-0 z-10 flex items-center justify-center bg-bg text-[14px] text-text-3">
                        {errorMsg}
                    </div>
                )}
                <div className="relative mx-auto h-full py-3 sm:py-5" style={{ maxWidth: marginWidth(settings.margin, settings.flow) }}>
                    <div ref={viewerRef} className="h-full w-full" />
                    {/* 仿真滑动：旧页快照横滑出场，新页在下层即时就位（微信读书滑动式） */}
                    {slide && (
                        <div
                            onAnimationEnd={onSlideEnd}
                            className="pointer-events-none absolute inset-x-0 inset-y-3 z-20 sm:inset-y-5"
                            style={{
                                backgroundImage: `url(${slide.shot})`,
                                backgroundSize: "100% 100%",
                                backgroundColor: outerBg,
                                boxShadow: slide.dir === "next"
                                    ? "12px 0 28px rgba(0,0,0,0.22)"
                                    : "-12px 0 28px rgba(0,0,0,0.22)",
                                animation: `${slide.dir === "next" ? "pageSlideOutLeft" : "pageSlideOutRight"} 0.32s cubic-bezier(0.3, 0.1, 0.2, 1) both`,
                            }}
                        />
                    )}
                </div>

                {/* 自动阅读：校准提示条 */}
                {autoPhase === "calibrating" && (
                    <div data-noadvance className="pointer-events-none absolute left-1/2 top-4 z-40 -translate-x-1/2 rounded-full border border-primary/40 bg-bg-card px-4 py-2 text-[13px] text-text-1 shadow-xl" style={{ animation: "pageEnter 0.22s cubic-bezier(0.22,1,0.36,1) both" }}>
                        <span className="mr-1.5 inline-block h-2 w-2 animate-pulse rounded-full bg-primary align-middle" />
                        请正常阅读本页，读完翻页即可——正在测算你的阅读速度
                    </div>
                )}
                {autoPhase === "running" && (
                    <div data-noadvance className="pointer-events-none absolute left-1/2 top-4 z-40 -translate-x-1/2 rounded-full bg-primary/90 px-3.5 py-1.5 text-[12px] text-white shadow-lg" style={{ animation: "pageEnter 0.22s cubic-bezier(0.22,1,0.36,1) both" }}>
                        自动阅读中 · {Math.round(autoCharsPerSecRef.current * 60)} 字/分
                    </div>
                )}

                {/* 关系图（连线机制）：未生成时面板窄小（只选择区）；出图后绘图区渐入、面板放大铺满 */}
                {relOpen && (() => {
                    const hasGraph = !!(relSvg || relResult); // 有结果/正在生成 → 展开大面板
                    return (
                    <div
                        data-noadvance
                        className={`absolute z-[68] flex flex-col overflow-hidden rounded-xl border border-line bg-bg-card shadow-2xl transition-all duration-300 ease-out ${
                            hasGraph || relBusy
                                ? "inset-x-3 top-3 bottom-3 sm:inset-x-6"          // 出图：铺满
                                : "left-1/2 top-4 w-[92%] max-w-[420px] -translate-x-1/2" // 未出图：居中窄卡
                        }`}
                        style={{ animation: "pageEnter 0.22s cubic-bezier(0.22,1,0.36,1) both" }}
                    >
                        <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
                            <svg className="h-4 w-4 text-secondary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                                <circle cx="6" cy="6" r="2.5" /><circle cx="18" cy="7" r="2.5" /><circle cx="12" cy="18" r="2.5" /><path strokeLinecap="round" d="M8 7l8 0.5M7.5 8l4 8M16.5 9l-4 7" />
                            </svg>
                            <span className="text-[14px] font-semibold text-text-1">关系图</span>
                            <span className="hidden text-[11px] text-text-3 sm:inline">选 2 个以上 · AI 画出关系</span>
                            <button className="ml-auto cursor-pointer text-text-3 hover:text-text-1" onClick={() => setRelOpen(false)} aria-label="关闭">✕</button>
                        </div>
                        <div className={`flex min-h-0 flex-1 gap-3 p-3 ${hasGraph || relBusy ? "flex-col md:flex-row" : "flex-col"}`}>
                            {/* 绘图 + 说明：仅在有图/生成中时出现，渐变淡入，占据主区 */}
                            {(hasGraph || relBusy) && (
                                <div className="flex min-h-0 flex-1 animate-fadeIn flex-col gap-3 md:order-1">
                                    <div className="flex min-h-[220px] flex-1 items-center justify-center overflow-auto rounded-lg border border-line bg-bg-input p-4">
                                        {relBusy ? (
                                            <div className="flex items-center gap-2 text-[13px] text-text-3"><div className="h-4 w-4 animate-spin rounded-full border-2 border-secondary border-t-transparent" />AI 正在梳理关系…</div>
                                        ) : relSvg ? (
                                            // 图占满容器：宽高都撑满，svg 等比放大到边界
                                            <div className="osite-mermaid flex h-full w-full items-center justify-center [&_svg]:h-full [&_svg]:max-h-full [&_svg]:w-full [&_svg]:max-w-full" dangerouslySetInnerHTML={{ __html: relSvg }} />
                                        ) : (
                                            <div className="text-[12px] text-text-3">图渲染失败，见下方文字说明</div>
                                        )}
                                    </div>
                                    {relResult?.explain && (
                                        <div className="max-h-[32%] shrink-0 overflow-auto rounded-lg border border-line bg-bg-input p-3 text-[13px] leading-relaxed text-text-1">
                                            {relResult.explain}
                                        </div>
                                    )}
                                </div>
                            )}
                            {/* 标签选择区：出图后收成右侧窄栏，未出图时占满窄卡 */}
                            <div className={`flex shrink-0 flex-col gap-2 md:order-2 ${hasGraph || relBusy ? "md:w-[220px]" : ""}`}>
                                <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-line p-2" style={{ maxHeight: hasGraph || relBusy ? undefined : "46vh" }}>
                                    {relChars.length === 0 ? (
                                        <p className="p-2 text-[12px] text-text-3">还没有词条。先在正文点开或录入一些人名/地名/术语。</p>
                                    ) : (
                                        <div className="flex flex-wrap gap-1.5">
                                            {relChars.map((c) => (
                                                // 胶囊：本体点选，右侧 ✕ 删词条（同时清正文高亮）
                                                <span
                                                    key={c.name}
                                                    className={`flex items-center gap-1 rounded-full border pl-2.5 pr-1 py-1 text-[12px] transition-colors ${
                                                        relSel.includes(c.name) ? "border-secondary bg-secondary/15 text-secondary" : "border-line text-text-2"
                                                    }`}
                                                >
                                                    <button className="flex cursor-pointer items-center gap-1" onClick={() => toggleRelSel(c.name)}>
                                                        <span className="h-2.5 w-2.5 rounded-full" style={{ background: c.color }} />
                                                        {c.name}
                                                    </button>
                                                    <button
                                                        className="ml-0.5 flex h-4 w-4 cursor-pointer items-center justify-center rounded-full text-text-4 hover:bg-bg-hover hover:text-primary"
                                                        title="删除这个词条"
                                                        onClick={() => {
                                                            void removeChar(c.name);
                                                            setRelChars((cs) => cs.filter((x) => x.name !== c.name));
                                                            setRelSel((s) => s.filter((x) => x !== c.name));
                                                        }}
                                                    >
                                                        ✕
                                                    </button>
                                                </span>
                                            ))}
                                        </div>
                                    )}
                                </div>
                                <div className="flex items-center justify-between">
                                    <span className="text-[11px] text-text-3">已选 {relSel.length}</span>
                                    <button
                                        className="cursor-pointer rounded-lg bg-secondary px-4 py-1.5 text-[13px] text-white transition-opacity disabled:opacity-50"
                                        disabled={relSel.length < 2 || relBusy}
                                        onClick={() => void runRelations()}
                                    >
                                        {relBusy ? "生成中…" : "生成关系图"}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                    );
                })()}

                {/* 疑问助手：问 AI 阅读细节，只看已读部分原文（防剧透）。多轮对话 */}
                {askOpen && (
                    <style>{`
                        .ask-md p { margin: 0.4em 0; }
                        .ask-md p:first-child { margin-top: 0; }
                        .ask-md p:last-child { margin-bottom: 0; }
                        .ask-md ul, .ask-md ol { margin: 0.4em 0; padding-left: 1.4em; }
                        .ask-md li { margin: 0.15em 0; }
                        .ask-md strong { font-weight: 700; }
                        .ask-md h1, .ask-md h2, .ask-md h3, .ask-md h4 { font-size: 1em; font-weight: 700; margin: 0.6em 0 0.3em; }
                        .ask-md blockquote { border-left: 3px solid var(--color-primary); margin: 0.4em 0; padding: 0.1em 0.7em; color: var(--color-text-2); }
                        .ask-md code { background: var(--color-bg-hover); padding: 0.1em 0.35em; border-radius: 4px; font-size: 0.92em; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
                        .ask-md pre { background: #0D1117; color: #C9D1D9; padding: 0.7em 0.9em; border-radius: 8px; overflow-x: auto; margin: 0.5em 0; }
                        .ask-md pre code { background: transparent; padding: 0; color: inherit; }
                        .ask-md table { border-collapse: collapse; margin: 0.5em 0; font-size: 0.95em; }
                        .ask-md th, .ask-md td { border: 1px solid var(--color-line); padding: 0.25em 0.55em; }
                        .ask-md a { color: var(--color-primary); }
                        .ask-md hr { border: none; border-top: 1px solid var(--color-line); margin: 0.6em 0; }
                        /* 「正在工作」打字气泡：三点波浪跳动 */
                        .ask-typing { display: inline-flex; align-items: center; gap: 4px; }
                        .ask-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--color-secondary); animation: askBounce 1.2s infinite ease-in-out; }
                        .ask-dot:nth-child(2) { animation-delay: 0.16s; }
                        .ask-dot:nth-child(3) { animation-delay: 0.32s; }
                        @keyframes askBounce { 0%, 70%, 100% { transform: translateY(0); opacity: 0.35; } 35% { transform: translateY(-5px); opacity: 1; } }
                    `}</style>
                )}
                {askOpen && (
                    <div data-noadvance className="fixed bottom-4 right-4 z-[70] flex max-h-[72vh] w-[380px] max-w-[94vw] flex-col rounded-xl border border-line bg-bg-card shadow-2xl" style={{ animation: "pageEnter 0.22s cubic-bezier(0.22,1,0.36,1) both" }}>
                        <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
                            <svg className="h-4 w-4 text-secondary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2}>
                                <circle cx="12" cy="12" r="9" />
                                <path strokeLinecap="round" strokeLinejoin="round" d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.8.4-1 .9-1 1.7v.5M12 17.5h.01" />
                            </svg>
                            <span className="text-[14px] font-semibold text-text-1">疑问助手</span>
                            <span className="text-[11px] text-text-3">只看已读部分 · 不剧透</span>
                            <button className="ml-auto cursor-pointer text-text-3 hover:text-text-1" onClick={() => setAskOpen(false)} aria-label="关闭">✕</button>
                        </div>
                        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
                            {askHistory.length === 0 ? (
                                <p className="text-[13px] leading-relaxed text-text-3">读到哪问到哪。比如「这个角色是谁」「刚才那段什么意思」「这个词指什么」。AI 只能根据你已经读到的部分回答，不会剧透后面。</p>
                            ) : askHistory.map((m, i) => (
                                <div key={i} className={`mb-3 ${m.role === "user" ? "text-right" : ""}`}>
                                    {m.role === "user" ? (
                                        <div className="inline-block max-w-[85%] whitespace-pre-wrap rounded-lg bg-primary px-3 py-2 text-left text-[13px] leading-relaxed text-white">{m.text}</div>
                                    ) : (
                                        /* AI 回答按 Markdown 渲染（marked 与 md 阅读器同源）；样式见下方 ask-md */
                                        <div
                                            className="ask-md inline-block max-w-[85%] rounded-lg bg-bg-input px-3 py-2 text-left text-[13px] leading-relaxed text-text-1"
                                            dangerouslySetInnerHTML={{ __html: marked.parse(m.text, { async: false }) as string }}
                                        />
                                    )}
                                </div>
                            ))}
                            {askBusy && (
                                <div className="mb-3">
                                    <div className="inline-flex max-w-[85%] flex-col gap-1.5 rounded-lg bg-bg-input px-3 py-2.5">
                                        {/* 已完成的步骤：打勾留痕，用户看得见模型干了什么 */}
                                        {askSteps.slice(0, -1).map((s, i) => (
                                            <div key={i} className="flex items-start gap-2 text-[11px] text-text-3">
                                                <span className="shrink-0 text-[#3FB950]">✓</span>
                                                <span>{s}</span>
                                            </div>
                                        ))}
                                        {/* 当前步骤：跳动点 + 正在做的事 */}
                                        <div className="flex items-center gap-2">
                                            <span className="ask-typing"><span className="ask-dot" /><span className="ask-dot" /><span className="ask-dot" /></span>
                                            <span className="text-[11px] text-text-3">{askSteps.length ? askSteps[askSteps.length - 1] : "正在翻书查证…"}</span>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                        <div className="border-t border-line p-3">
                            <textarea
                                className="max-h-24 min-h-[44px] w-full resize-none rounded-lg border border-line bg-bg-input px-3 py-2 text-[13px] leading-relaxed text-text-1 outline-none placeholder:text-text-3 focus:border-secondary"
                                placeholder="问点关于已读内容的…"
                                value={askInput}
                                onChange={(e) => setAskInput(e.target.value)}
                                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void sendAsk(); } }}
                            />
                            <div className="mt-2 flex items-center justify-between">
                                <span className="text-[11px] text-text-4">Enter 发送 · Shift+Enter 换行</span>
                                <button
                                    className="cursor-pointer rounded-lg bg-secondary px-4 py-1.5 text-[13px] text-white transition-opacity disabled:opacity-50"
                                    disabled={!askInput.trim() || askBusy}
                                    onClick={() => void sendAsk()}
                                >{askBusy ? "发送中…" : "发送"}</button>
                            </div>
                        </div>
                    </div>
                )}

                {/* 人物卡：弹在注解旁边（fixed 定位用 charPopup.top/left）；点空白自动关闭由覆盖层接管 */}
                {charPopup && (
                    <div
                        data-noadvance
                        className="fixed z-[60] flex max-h-[70vh] w-[340px] max-w-[92vw] flex-col rounded-xl border border-line bg-bg-card p-4 shadow-2xl"
                        style={{
                            top: charPopup.top,
                            left: charPopup.left,
                            // 八方位翻转：anchorFlip 按 3×3 分区给出 tx/ty（四角对角、边缘朝屏内、正中居中）
                            transform: `translate(${charPopup.tx ?? "0"}, ${charPopup.ty ?? "0"})`,
                            animation: "anchorPop 0.18s ease both", // 只淡入，不覆盖翻转 transform
                        }}
                        onMouseEnter={cancelHoverClose}
                        onMouseLeave={scheduleHoverClose}
                    >
                        <div className="flex items-center gap-2.5">
                            <span className="h-4 w-4 shrink-0 rounded-full" style={{ background: charPopup.char.color }} />
                            <span className="text-[15px] font-semibold text-text-1">{charPopup.char.name}</span>
                            <span className="rounded-[4px] bg-bg-input px-1.5 py-px text-[11px] text-text-2">{KIND_LABEL[charPopup.char.kind || "person"]}</span>
                            <span className="text-[12px] text-text-3">
                                {charPopup.char.count > 0 ? `出现 ${charPopup.char.count} 次` : "手动录入"}
                            </span>
                            <button
                                className="ml-auto cursor-pointer rounded-full border border-primary/50 px-2 py-0.5 text-[12px] text-primary transition-opacity disabled:opacity-50"
                                onClick={() => void aiDescribe(charPopup.char.name)}
                                disabled={aiBusy}
                                title="AI 根据出场片段生成人物小传（结果缓存，只花一次 token）"
                            >
                                {aiBusy ? "解读中…" : "AI 解读"}
                            </button>
                            <button
                                className="cursor-pointer text-[12px] text-text-4 transition-colors hover:text-primary"
                                onClick={() => removeChar(charPopup.char.name)}
                                title="识别错了？从人物表删除并清除高亮"
                            >
                                删除
                            </button>
                            <button
                                className="cursor-pointer text-text-3 transition-colors hover:text-text-1"
                                onClick={() => setCharPopup(null)}
                                aria-label="关闭"
                            >
                                ✕
                            </button>
                        </div>
                        {/* 描述：可直接编辑（改完失焦即存）；空白时占位提示 LLM 接口 */}
                        <textarea
                            ref={charDescRef}
                            className="mt-2.5 w-full resize-none overflow-hidden rounded-lg border border-line bg-bg-input px-2.5 py-2 text-[13px] leading-relaxed text-text-1 outline-none placeholder:text-text-3 focus:border-primary"
                            placeholder="TA 是谁？在这里写备注——或等接入 AI 后自动生成人物小传。"
                            defaultValue={charPopup.char.desc}
                            onBlur={(e) => { if (e.target.value !== charPopup.char.desc) void saveCharDesc(charPopup.char.name, e.target.value.trim()); }}
                        />
                        {!charPopup.char.desc && charPopup.char.contexts?.length > 0 && (
                            <p className="mt-1.5 line-clamp-3 text-[12px] leading-relaxed text-text-3">
                                首次出场：…{charPopup.char.contexts[0]}…
                            </p>
                        )}
                    </div>
                )}

                {/* Notes 浮窗：可拖动，列出全部笔记（荧光笔标注 + 图片）。手动关，不点空白消失 */}
                {notesOpen && (
                    <div
                        data-noadvance
                        className="fixed z-[66] flex max-h-[72vh] w-[340px] max-w-[92vw] flex-col rounded-xl border border-line bg-bg-card shadow-2xl"
                        // x/y = 浮窗左上角坐标；未拖动过(0,0)时落在右上默认位
                        style={{
                            left: notesPos.x || undefined,
                            top: notesPos.y || undefined,
                            right: notesPos.x ? undefined : 16,
                            ...(notesPos.y ? {} : { top: 76 }),
                            animation: "pageEnter 0.2s cubic-bezier(0.22,1,0.36,1) both",
                        }}
                    >
                        {/* 拖动把手：pointer 拖动整窗，方向自然跟手（left/top + dx/dy） */}
                        <div
                            className="flex cursor-move items-center gap-2 border-b border-line px-3 py-2 select-none"
                            onPointerDown={(e) => {
                                const rect = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
                                const sx = e.clientX, sy = e.clientY;
                                const base = { x: rect.left, y: rect.top };
                                (e.target as HTMLElement).setPointerCapture(e.pointerId);
                                const move = (ev: PointerEvent) => setNotesPos({
                                    x: Math.max(4, Math.min(base.x + (ev.clientX - sx), window.innerWidth - 60)),
                                    y: Math.max(4, Math.min(base.y + (ev.clientY - sy), window.innerHeight - 60)),
                                });
                                const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
                                window.addEventListener("pointermove", move);
                                window.addEventListener("pointerup", up);
                            }}
                        >
                            <svg className="h-4 w-4 text-secondary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 4h12l4 4v12H4zM16 4v4h4M8 13h8M8 17h5" /></svg>
                            <span className="text-[14px] font-semibold text-text-1">Notes</span>
                            <span className="text-[11px] text-text-3">{notes.length} 条 · 可拖动</span>
                            <button className="ml-auto cursor-pointer text-text-3 hover:text-text-1" onClick={() => setNotesOpen(false)} aria-label="关闭">✕</button>
                        </div>
                        <div className="min-h-0 flex-1 overflow-y-auto p-2">
                            {notes.length === 0 ? (
                                <p className="p-3 text-center text-[12px] leading-relaxed text-text-3">还没有笔记。<br />划词后点「标注」高亮存笔记，或把正文图片拖到 Notes 按钮上收藏。</p>
                            ) : notes.map((n) => (
                                <div key={n.id} className="group mb-2 rounded-lg border border-line bg-bg-input p-2">
                                    {n.kind === "image" ? (
                                        // eslint-disable-next-line @next/next/no-img-element
                                        <img src={n.src} alt="笔记图片" className="max-h-40 w-full cursor-zoom-in rounded object-contain" onClick={() => setZoomImg(n.src)} />
                                    ) : (
                                        <div className="flex items-start gap-1.5">
                                            <span className="mt-1 h-3 w-3 shrink-0 rounded-sm" style={{ background: n.color || HL_COLORS[0].bg }} />
                                            <p className="text-[13px] leading-relaxed text-text-1">{n.text}</p>
                                        </div>
                                    )}
                                    <div className="mt-1.5 flex items-center gap-2 text-[11px] text-text-3">
                                        <button className="cursor-pointer text-secondary hover:underline" onClick={() => jumpToNote(n.cfi)} disabled={!n.cfi}>跳转</button>
                                        <span className="opacity-40">·</span>
                                        <button className="cursor-pointer text-text-4 hover:text-primary" onClick={() => void deleteNote(n.id)}>删除</button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* 跳回浮标：跳转笔记后出现，点它回到跳转前的阅读位置 */}
                {returnCfi && (
                    <button
                        data-noadvance
                        onClick={jumpBack}
                        className="fixed bottom-16 left-1/2 z-[67] flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-[13px] text-white shadow-lg transition-transform hover:scale-105"
                        style={{ animation: "pageEnter 0.2s cubic-bezier(0.22,1,0.36,1) both" }}
                    >
                        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 14l-4-4 4-4M5 10h11a4 4 0 0 1 0 8h-1" /></svg>
                        跳回原处
                    </button>
                )}

                {/* 图片放大查看：点空白关闭 */}
                {zoomImg && (
                    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/80 p-6" onClick={() => setZoomImg(null)}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={zoomImg} alt="放大" className="max-h-full max-w-full rounded object-contain" onClick={(e) => e.stopPropagation()} />
                        <button className="absolute right-5 top-5 text-white/80 hover:text-white" onClick={() => setZoomImg(null)} aria-label="关闭">✕</button>
                    </div>
                )}

                {/* 划词面板：跟随划词位置弹出。上半＝录入注解（原有，不改）；下半＝问 AI（新增） */}
                {enrollDraft !== null && (() => {
                    const sel = enrollDraft.text;
                    const isShortWord = sel.trim().length >= 2 && sel.trim().length <= 12 && !/\s/.test(sel);
                    // 划词直接问：把「选中内容 + 所在段落」拼成问题，走疑问助手（防剧透，只看已读）
                    const askAboutSelection = (custom?: string) => {
                        const para = enrollDraft.para || "";
                        const base = custom?.trim()
                            ? `在这句话「${sel}」的语境下，${custom.trim()}`
                            : `解释一下「${sel}」在这里是什么意思。`;
                        const q = para && para !== sel ? `${base}\n\n（所在段落：${para.slice(0, 300)}）` : base;
                        setEnrollDraft(null);
                        void askQuestion(q);
                    };
                    return (
                    <div data-noadvance className="fixed z-[65] w-[300px] max-w-[92vw] rounded-xl border border-line bg-bg-card p-4 shadow-2xl" style={{ top: enrollDraft.top, left: enrollDraft.left, transform: `translate(${enrollDraft.tx ?? "0"}, ${enrollDraft.ty ?? "0"})`, animation: "anchorPop 0.18s ease both" }}>
                        {/* ── 录入区（仅 2-12 字无空格的短词才提供，长句/短语不显示录入）── */}
                        {isShortWord && (
                            <>
                                <p className="text-[13px] font-medium text-text-1">录入为词条</p>
                                <input
                                    className="mt-2 w-full rounded-lg border border-line bg-bg-input px-2.5 py-1.5 text-[14px] text-text-1 outline-none focus:border-primary"
                                    value={enrollDraft.text}
                                    maxLength={12}
                                    onChange={(e) => setEnrollDraft({ ...enrollDraft, text: e.target.value })}
                                    autoFocus
                                />
                                <div className="mt-2.5 flex flex-wrap gap-1.5">
                                    {KIND_OPTIONS.map((k) => (
                                        <button
                                            key={k.key}
                                            onClick={() => setEnrollKind(k.key)}
                                            className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] transition-colors ${
                                                enrollKind === k.key ? "border-primary text-primary" : "border-line text-text-2 hover:text-text-1"
                                            }`}
                                        >
                                            <span className="h-2.5 w-2.5 rounded-full" style={{ background: k.swatch }} />
                                            {k.label}
                                        </button>
                                    ))}
                                </div>
                                <div className="mt-3 flex justify-end gap-2">
                                    <button className="cursor-pointer rounded-lg px-3 py-1 text-[13px] text-text-3 hover:text-text-1" onClick={() => setEnrollDraft(null)}>取消</button>
                                    <button
                                        className="rounded-lg bg-primary px-4 py-1 text-[13px] text-white transition-opacity disabled:opacity-50"
                                        disabled={enrollDraft.text.trim().length < 2}
                                        onClick={() => void enrollChar(enrollDraft.text, enrollKind)}
                                    >
                                        录入
                                    </button>
                                </div>
                            </>
                        )}

                        {/* ── 标注 + 问 AI 区（任意选区都有）── */}
                        <div className={isShortWord ? "mt-3 border-t border-line/60 pt-3" : ""}>
                            {!isShortWord && (
                                <p className="mb-2 line-clamp-2 text-[12px] text-text-3">选中：「{sel}」</p>
                            )}
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => { void addHighlight(enrollDraft.cfi || "", sel); setEnrollDraft(null); }}
                                    className="flex shrink-0 items-center gap-1.5 rounded-lg border border-primary/50 bg-primary/10 px-2.5 py-1.5 text-[13px] text-primary transition-colors hover:bg-primary/20"
                                    title="荧光笔标注：高亮这段并存入 Notes"
                                >
                                    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.5 4.5l4 4-9.5 9.5H6v-4z M13.5 6.5l4 4" />
                                    </svg>
                                    标注
                                </button>
                                <button
                                    onClick={() => askAboutSelection(askDraftRef.current?.value || undefined)}
                                    className="flex shrink-0 items-center gap-1.5 rounded-lg bg-secondary px-2.5 py-1.5 text-[13px] text-white transition-opacity hover:opacity-90"
                                    title="直接问 AI：输入框有问题就问你的问题，没有就解释这段在此处的意思（只看已读部分，不剧透）"
                                >
                                    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2}>
                                        <circle cx="12" cy="12" r="9" />
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.8.4-1 .9-1 1.7v.5M12 17.5h.01" />
                                    </svg>
                                    直接问
                                </button>
                            </div>
                            <input
                                ref={askDraftRef}
                                className="mt-2 w-full rounded-lg border border-line bg-bg-input px-2.5 py-1.5 text-[13px] text-text-1 outline-none placeholder:text-text-3 focus:border-secondary"
                                placeholder="输入问题，点「直接问」或回车…"
                                onKeyDown={(e) => { if (e.key === "Enter") { const v = (e.target as HTMLInputElement).value; if (v.trim()) askAboutSelection(v); } }}
                            />
                        </div>
                    </div>
                    );
                })()}

                {status === "ready" && settings.flow !== "scrolled" && (
                    <>
                        <button
                            onClick={goPrev}
                            aria-label="上一页"
                            className="absolute left-2 top-1/2 z-50 hidden h-10 w-10 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border border-line bg-bg-card/90 text-text-2 shadow-sm transition-all hover:scale-105 hover:text-primary sm:flex"
                        >
                            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                            </svg>
                        </button>
                        <button
                            onClick={goNext}
                            aria-label="下一页"
                            className="absolute right-2 top-1/2 z-50 hidden h-10 w-10 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border border-line bg-bg-card/90 text-text-2 shadow-sm transition-all hover:scale-105 hover:text-primary sm:flex"
                        >
                            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                            </svg>
                        </button>
                    </>
                )}
            </div>

            {/* ── 底部状态栏：无背景无边框，直接躺在阅读画布上——
                文字用比画布深/浅一档的灰（浅底→灰，黑底→浅白），存在感极低 ── */}
            {status === "ready" && (
                <div
                    className="flex shrink-0 items-center justify-between gap-4 px-4 py-1.5 text-[12px] tabular-nums sm:px-6"
                    style={{ backgroundColor: outerBg, color: statusBarFg }}
                >
                    {/* 左：本章进度（第几页/共几页 + 还剩几页）——滚动模式没有"页"概念不显示 */}
                    <div className="flex items-center gap-3">
                        {settings.flow !== "scrolled" && pageInfo.chapterTotal > 0 && (
                            <>
                                <span title="本章页码">
                                    本章 {pageInfo.chapterPage}<span className="mx-px opacity-60">/</span>{pageInfo.chapterTotal}
                                </span>
                                <span className="hidden sm:inline">还剩 {Math.max(0, pageInfo.chapterTotal - pageInfo.chapterPage)} 页</span>
                            </>
                        )}
                    </div>
                    {/* 中：全书进度（百分比 + 页码分式 + 还剩） */}
                    <div className="flex items-center gap-3">
                        {pageInfo.bookTotal > 0 ? (
                            <>
                                <span>{pageInfo.bookPct}%</span>
                                <span title="全书位置（按标准页折算）">
                                    全书 {pageInfo.bookPage}<span className="mx-px opacity-60">/</span>{pageInfo.bookTotal}
                                </span>
                                <span className="hidden md:inline">还剩 {Math.max(0, pageInfo.bookTotal - pageInfo.bookPage)} 页</span>
                            </>
                        ) : (
                            <span className="opacity-60">计算全书进度…</span>
                        )}
                    </div>
                    {/* 右侧空白区：正在播放的氛围曲名（有乐才显示，长名滚动） */}
                    <div className="flex min-w-0 items-center justify-end gap-2">
                        {musicOn && nowPlaying && (
                            <span className="flex min-w-0 max-w-[240px] items-center gap-1.5" title={nowPlaying} style={{ color: tempColor(moodTemp) }}>
                                {/* 跳动的音符条 */}
                                <span className="flex h-3 items-end gap-[2px]">
                                    <span className="np-bar" style={{ animationDelay: "0s" }} />
                                    <span className="np-bar" style={{ animationDelay: "0.25s" }} />
                                    <span className="np-bar" style={{ animationDelay: "0.5s" }} />
                                </span>
                                <span className="truncate text-[11px]">{nowPlaying}</span>
                            </span>
                        )}
                        {/* 时钟 */}
                        <span>{clock}</span>
                    </div>
                </div>
            )}
            {/* 音符条动画 + 隐藏的音频承载（Web Audio 用 new Audio()，无需 DOM，此处仅样式） */}
            <style>{`
                .np-bar { width: 2px; background: currentColor; border-radius: 1px; animation: npEq 0.9s ease-in-out infinite; height: 40%; }
                @keyframes npEq { 0%,100% { height: 30%; } 50% { height: 100%; } }
            `}</style>
        </div>
    );
}

export default function EpubReaderPage() {
    // useSearchParams 必须包在 Suspense 内（Next 15 CSR bailout 要求）
    return (
        <Suspense
            fallback={
                <div className="flex items-center gap-3 rounded-xl border border-line bg-bg-nav px-4 py-6 text-[14px] text-text-3">
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                    加载阅读器...
                </div>
            }
        >
            <EpubReader />
        </Suspense>
    );
}
