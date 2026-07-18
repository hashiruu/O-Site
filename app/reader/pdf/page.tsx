"use client";
// PDF 论文阅读器：pdf.js 渲染 canvas + 文本层，连续滚动懒加载。
// 智能层（论文版）：划词 → 术语注解录入 / AI解读 / 直接问 / 荧光笔标注；问答助手（agentic，读全文无剧透）；
// 笔记高亮（按页矩形）；关系图。进度按页号持久化（/api/reader-progress，cfi="pdf:<页>"）。
import { Suspense, useEffect, useRef, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { marked } from "marked";

interface PdfPage { getViewport: (o: { scale: number }) => PdfViewport; render: (o: { canvasContext: CanvasRenderingContext2D; viewport: PdfViewport }) => { promise: Promise<void>; cancel: () => void }; getTextContent: () => Promise<unknown>; }
interface PdfViewport { width: number; height: number; scale: number; }
interface PdfDoc { numPages: number; getPage: (n: number) => Promise<PdfPage>; destroy: () => void; }

type CharKind = "person" | "place" | "org" | "term" | "other";
interface BookChar { name: string; count: number; color: string; desc: string; contexts?: string[]; kind?: CharKind; }
interface NoteRect { x: number; y: number; w: number; h: number } // 相对页宽高的 0-1 归一
interface Note { id: number; kind: string; cfi: string; text: string; color: string; src: string; createdAt?: string }
interface TextBlock { page: number; top: number; bottom: number; left: number; right: number; text: string } // host 相对像素

// 21 档温度色谱（深靛蓝 平静 → 炽红 紧张/重点）
const MOOD_SPECTRUM: [number, number, number][] = [
    [40, 60, 140], [50, 90, 170], [55, 120, 195], [60, 150, 205], [65, 175, 195], [70, 190, 170], [80, 195, 140],
    [110, 195, 110], [150, 195, 90], [190, 195, 75], [215, 190, 65], [225, 175, 60], [230, 155, 58], [232, 135, 55],
    [234, 112, 52], [232, 92, 52], [226, 72, 55], [214, 55, 58], [195, 45, 58], [170, 40, 55], [140, 34, 50],
];
const tempColor = (t: number): string => {
    const v = Math.max(0, Math.min(100, t)); const n = MOOD_SPECTRUM.length - 1; const p = (v / 100) * n;
    const i = Math.min(n - 1, Math.floor(p)); const f = p - i; const a = MOOD_SPECTRUM[i], b = MOOD_SPECTRUM[i + 1];
    const c = a.map((x, k) => Math.round(x + (b[k] - x) * f)); return `rgb(${c[0]},${c[1]},${c[2]})`;
};

const KIND_OPTIONS: { key: CharKind; label: string; swatch: string }[] = [
    { key: "term", label: "术语", swatch: "rgba(156,39,176,0.55)" },
    { key: "person", label: "人物", swatch: "rgba(240,120,74,0.6)" },
    { key: "org", label: "机构", swatch: "rgba(33,150,243,0.6)" },
    { key: "place", label: "数据集", swatch: "rgba(46,160,90,0.6)" },
    { key: "other", label: "其他", swatch: "rgba(96,125,139,0.6)" },
];
const HL_COLORS = [
    { bg: "rgba(255,213,74,0.45)", label: "黄" },
    { bg: "rgba(120,220,150,0.42)", label: "绿" },
    { bg: "rgba(255,150,200,0.40)", label: "粉" },
    { bg: "rgba(130,190,255,0.42)", label: "蓝" },
];

function PdfReader() {
    const searchParams = useSearchParams();
    const router = useRouter();
    const filePath = searchParams.get("path") || "";

    const scrollRef = useRef<HTMLDivElement>(null);
    const docRef = useRef<PdfDoc | null>(null);
    const pdfjsRef = useRef<typeof import("pdfjs-dist") | null>(null);
    const pageElsRef = useRef<(HTMLDivElement | null)[]>([]);
    const renderedRef = useRef<Set<number>>(new Set());
    const renderTasksRef = useRef<Map<number, { cancel: () => void }>>(new Map());
    const baseViewportRef = useRef<{ w: number; h: number } | null>(null);
    const scaleRef = useRef(1);                 // 实际渲染 scale = fitScale * zoom
    const fitScaleRef = useRef(1);              // 两页并排铺满容器宽的基准 scale
    const [zoom, setZoom] = useState(1);        // 用户缩放倍数
    const zoomRef = useRef(1);
    const fullTextRef = useRef("");             // 全文（问答/温度底料）

    const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
    const [errorMsg, setErrorMsg] = useState("");
    const [numPages, setNumPages] = useState(0);
    const [curPage, setCurPage] = useState(1);
    const [title, setTitle] = useState("");
    const titleRef = useRef("");
    const [toolsOpen, setToolsOpen] = useState(false);
    const curPageRef = useRef(1);
    useEffect(() => { curPageRef.current = curPage; }, [curPage]);

    // ── 注解词条 ──
    const charListRef = useRef<BookChar[]>([]);
    const [charPopup, setCharPopup] = useState<{ char: BookChar; top: number; left: number } | null>(null);
    const [aiBusy, setAiBusy] = useState(false);

    // ── 划词面板 ──
    const [sel, setSel] = useState<{ text: string; page: number; rects: NoteRect[]; top: number; left: number } | null>(null);
    const askDraftRef = useRef<HTMLInputElement>(null);

    // ── 笔记 ──
    const notesRef = useRef<Note[]>([]);
    const [notesOpen, setNotesOpen] = useState(false);
    const [notes, setNotes] = useState<Note[]>([]);
    const notesLoadedRef = useRef(false);

    // ── 聚焦 / 温度 / 朗读 ──
    const [focusOn, setFocusOn] = useState(false);
    const focusOnRef = useRef(false);
    const focusRef = useRef<{ page: number; idx: number } | null>(null);      // 当前聚焦块
    const blocksByPageRef = useRef<Map<number, TextBlock[]>>(new Map());
    // 全屏聚焦阅读：放大渲染当前页 canvas + 高亮当前块，可 +/- 缩放
    const focusScrollRef = useRef<HTMLDivElement | null>(null);
    const focusCanvasRef = useRef<HTMLCanvasElement | null>(null);
    const focusStageRef = useRef<HTMLDivElement | null>(null);
    const focusRenderedPageRef = useRef<number>(-1); // 当前 overlay 已渲染的页（避免同页重复渲染）
    const [focusZoom, setFocusZoom] = useState(1.7);
    const focusZoomRef = useRef(1.7);
    const [focusInfo, setFocusInfo] = useState({ page: 1, idx: 0, total: 0 });
    const [moodOn, setMoodOn] = useState(false);
    const moodOnRef = useRef(false);
    const moodTempRef = useRef(50);
    const moodWordRef = useRef("");
    const [moodTemp, setMoodTemp] = useState(50);
    const moodCacheRef = useRef<Map<string, { temp: number; word: string }>>(new Map());
    const moodTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [ttsOn, setTtsOn] = useState(false);
    const ttsOnRef = useRef(false);
    const audioRef = useRef<HTMLAudioElement | null>(null);

    // ── 关系图 ──
    const [relOpen, setRelOpen] = useState(false);
    const [relSel, setRelSel] = useState<string[]>([]);
    const [relBusy, setRelBusy] = useState(false);
    const [relSvg, setRelSvg] = useState("");
    const [relExplain, setRelExplain] = useState("");

    // ── 问答助手 ──
    const [askOpen, setAskOpen] = useState(false);
    const [askInput, setAskInput] = useState("");
    const [askBusy, setAskBusy] = useState(false);
    const [askSteps, setAskSteps] = useState<string[]>([]);
    const [askHistory, setAskHistory] = useState<Array<{ role: "user" | "assistant"; text: string }>>([]);

    // ── 进度 ──
    const progressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const saveProgress = useCallback((page: number) => {
        if (progressTimerRef.current) clearTimeout(progressTimerRef.current);
        progressTimerRef.current = setTimeout(() => {
            const total = docRef.current?.numPages || 0;
            const percent = total ? Math.round((page / total) * 100) : 0;
            fetch("/api/reader-progress", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bookPath: filePath, cfi: `pdf:${page}`, percent, title: titleRef.current }) }).catch(() => {});
        }, 1200);
    }, [filePath]);
    const saveCheckpoint = () => {
        const total = docRef.current?.numPages || 0;
        if (!total) return;
        const percent = Math.round((curPageRef.current / total) * 100);
        const payload = JSON.stringify({ bookPath: filePath, cfi: `pdf:${curPageRef.current}`, percent, title: titleRef.current });
        try { if (navigator.sendBeacon) navigator.sendBeacon("/api/reader-progress", new Blob([payload], { type: "application/json" })); else void fetch("/api/reader-progress", { method: "POST", headers: { "Content-Type": "application/json" }, body: payload, keepalive: true }); } catch {}
    };
    /** 返回书架：整层向右滑出后再导航（撤回去的效果；书架有缓存，回去即开） */
    const exitToShelf = (e?: { preventDefault?: () => void }) => {
        e?.preventDefault?.();
        saveCheckpoint();
        const layer = document.querySelector(".reader-slide-in");
        if (layer) { layer.classList.add("reader-slide-out"); setTimeout(() => router.push("/bookshelf"), 320); }
        else router.push("/bookshelf");
    };

    // ── 笔记加载 / 重绘高亮 ──
    const loadNotes = useCallback(async () => {
        try {
            const r = await fetch(`/api/book-notes?bookPath=${encodeURIComponent(filePath)}`);
            const d = await r.json();
            if (d.success && Array.isArray(d.notes)) { notesRef.current = d.notes; setNotes(d.notes); requestAnimationFrame(() => paintHighlights()); }
        } catch {}
    }, [filePath]);

    /** 在已渲染的页上按存储的归一矩形画高亮层 */
    const paintHighlights = () => {
        for (let i = 0; i < pageElsRef.current.length; i++) {
            const host = pageElsRef.current[i];
            if (!host || !renderedRef.current.has(i)) continue;
            host.querySelectorAll(".pdf-hl").forEach((x) => x.remove());
            const W = host.clientWidth, H = host.clientHeight;
            for (const n of notesRef.current) {
                if (n.kind !== "highlight") continue;
                let data: { page?: number; rects?: NoteRect[] };
                try { data = JSON.parse(n.src || "{}"); } catch { continue; }
                if ((data.page ?? -1) !== i + 1 || !Array.isArray(data.rects)) continue;
                for (const rc of data.rects) {
                    const d = document.createElement("div");
                    d.className = "pdf-hl";
                    d.style.cssText = `position:absolute;left:${rc.x * W}px;top:${rc.y * H}px;width:${rc.w * W}px;height:${rc.h * H}px;background:${n.color || HL_COLORS[0].bg};border-radius:2px;pointer-events:none;z-index:1;mix-blend-mode:multiply;`;
                    host.appendChild(d);
                }
            }
        }
    };

    /** 渲染某一页 */
    const renderPage = useCallback(async (idx: number) => {
        const pdfjs = pdfjsRef.current, doc = docRef.current;
        const host = pageElsRef.current[idx];
        if (!pdfjs || !doc || !host || renderedRef.current.has(idx)) return;
        renderedRef.current.add(idx);
        try {
            const page = await doc.getPage(idx + 1);
            const scale = scaleRef.current;
            const viewport = page.getViewport({ scale });
            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            const canvas = document.createElement("canvas");
            canvas.className = "pdf-canvas";
            canvas.width = Math.floor(viewport.width * dpr); canvas.height = Math.floor(viewport.height * dpr);
            canvas.style.width = `${Math.floor(viewport.width)}px`; canvas.style.height = `${Math.floor(viewport.height)}px`;
            const ctx = canvas.getContext("2d")!; ctx.scale(dpr, dpr);
            const textLayer = document.createElement("div");
            textLayer.className = "textLayer";
            textLayer.style.setProperty("--scale-factor", String(scale));
            textLayer.style.width = `${Math.floor(viewport.width)}px`; textLayer.style.height = `${Math.floor(viewport.height)}px`;
            host.style.height = `${Math.floor(viewport.height)}px`;
            host.innerHTML = ""; host.appendChild(canvas); host.appendChild(textLayer);
            const task = page.render({ canvasContext: ctx, viewport });
            renderTasksRef.current.set(idx, task); await task.promise; renderTasksRef.current.delete(idx);
            const textContent = await page.getTextContent();
            const TL = (pdfjs as unknown as { TextLayer: new (o: { textContentSource: unknown; container: HTMLElement; viewport: PdfViewport }) => { render: () => Promise<void> } }).TextLayer;
            await new TL({ textContentSource: textContent, container: textLayer, viewport }).render();
            paintHighlights();
        } catch (e) { renderedRef.current.delete(idx); if (String(e).includes("cancel")) return; }
    }, []);

    const unrenderPage = (idx: number) => {
        const host = pageElsRef.current[idx];
        if (!host || !renderedRef.current.has(idx)) return;
        renderTasksRef.current.get(idx)?.cancel(); renderTasksRef.current.delete(idx); renderedRef.current.delete(idx);
        blocksByPageRef.current.delete(idx); // 块缓存随页卸载失效，重渲染后按新 span 重算
        const bv = baseViewportRef.current;
        host.innerHTML = ""; if (bv) host.style.height = `${Math.floor(bv.h * scaleRef.current)}px`;
    };

    // ── 加载 PDF ──
    // 沉浸阅读：收起全站顶栏/页脚/底部 tab（与 epub/md 一致，CSS 见 globals 的 body.reader-immersive）
    useEffect(() => {
        document.body.classList.add("reader-immersive");
        return () => document.body.classList.remove("reader-immersive");
    }, []);

    useEffect(() => {
        if (!filePath) { setStatus("error"); setErrorMsg("缺少 path 参数"); return; }
        let cancelled = false; let io: IntersectionObserver | null = null;
        (async () => {
            try {
                const pdfjs = await import("pdfjs-dist");
                pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
                pdfjsRef.current = pdfjs;
                const res = await fetch(`/api/books/file?path=${encodeURIComponent(filePath)}`);
                if (!res.ok) throw new Error(`文件加载失败 (HTTP ${res.status})`);
                const buf = await res.arrayBuffer();
                if (cancelled) return;
                const doc = await pdfjs.getDocument({ data: buf }).promise as unknown as PdfDoc;
                if (cancelled) { doc.destroy(); return; }
                docRef.current = doc; setNumPages(doc.numPages);
                pageElsRef.current = new Array(doc.numPages).fill(null);
                const base = decodeURIComponent(filePath.split("/").pop() || "PDF").replace(/\.pdf$/i, "");
                setTitle(base); titleRef.current = base;
                const p1 = await doc.getPage(1);
                const vp1 = p1.getViewport({ scale: 1 });
                baseViewportRef.current = { w: vp1.width, h: vp1.height };
                // 两页并排：每页 = (容器宽 - 内边距 - 页间距) / 2
                const contW = scrollRef.current?.clientWidth || 1000;
                const perPage = (contW - 40 - 14) / 2;
                fitScaleRef.current = Math.min(2.2, Math.max(0.35, perPage / vp1.width));
                scaleRef.current = fitScaleRef.current * zoomRef.current;
                setStatus("ready");

                requestAnimationFrame(() => {
                    if (cancelled) return;
                    const ph = Math.floor(vp1.height * scaleRef.current);
                    for (const el of pageElsRef.current) if (el) el.style.height = `${ph}px`;
                    io = new IntersectionObserver((entries) => {
                        for (const en of entries) {
                            const idx = Number((en.target as HTMLElement).dataset.idx);
                            if (en.isIntersecting) void renderPage(idx); else if (Math.abs(idx - (curPageRef.current - 1)) > 4) unrenderPage(idx);
                        }
                        const vis = entries.filter((e) => e.isIntersecting).map((e) => Number((e.target as HTMLElement).dataset.idx));
                        if (vis.length) { const pg = Math.min(...vis) + 1; setCurPage(pg); saveProgress(pg); }
                    }, { root: scrollRef.current, rootMargin: "800px 0px", threshold: 0.01 });
                    for (const el of pageElsRef.current) if (el) io.observe(el);
                    fetch(`/api/reader-progress?bookPath=${encodeURIComponent(filePath)}`).then((r) => (r.ok ? r.json() : null)).then((d) => {
                        const m = /^pdf:(\d+)$/.exec(d?.cfi || ""); const pg = m ? parseInt(m[1], 10) : 1;
                        if (pg > 1) pageElsRef.current[pg - 1]?.scrollIntoView();
                    }).catch(() => {});
                });

                // 全文（问答/温度）+ 注解 + 笔记
                fetch(`/api/books/text?path=${encodeURIComponent(filePath)}`).then((r) => r.json()).then((d) => { if (d.success) fullTextRef.current = d.text || ""; }).catch(() => {});
                fetch(`/api/book-characters?path=${encodeURIComponent(filePath)}`).then((r) => r.json()).then((d) => { if (!cancelled && d.success && Array.isArray(d.characters)) { charListRef.current = d.characters; } }).catch(() => {});
                if (!notesLoadedRef.current) { notesLoadedRef.current = true; void loadNotes(); }
            } catch (err) { if (!cancelled) { setStatus("error"); setErrorMsg(err instanceof Error ? err.message : "PDF 加载失败"); } }
        })();
        const onHide = () => saveCheckpoint();
        window.addEventListener("pagehide", onHide);
        return () => {
            cancelled = true; saveCheckpoint();
            window.removeEventListener("pagehide", onHide);
            io?.disconnect();
            if (progressTimerRef.current) clearTimeout(progressTimerRef.current);
            for (const t of renderTasksRef.current.values()) { try { t.cancel(); } catch {} }
            try { docRef.current?.destroy(); } catch {}
            docRef.current = null;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [filePath]);

    // ── 划词检测：selection 落在某页文本层 → 记录文字/页/归一矩形/弹窗位置 ──
    const onSelectMaybe = () => {
        const s = window.getSelection();
        if (!s || s.isCollapsed || !s.rangeCount) { return; }
        const text = s.toString().trim();
        if (text.length < 2 || text.length > 400) return;
        const range = s.getRangeAt(0);
        // 找选区所在页：从 startContainer 就近找带 data-idx 的祖先（比手动遍历稳）
        const anchorEl = (range.startContainer instanceof HTMLElement ? range.startContainer : range.startContainer.parentElement);
        const host = anchorEl?.closest("[data-idx]") as HTMLElement | null;
        if (!host) return;
        // 选区落在弹窗/面板里（不在某页里）就忽略
        if (anchorEl?.closest(".pdf-panel")) return;
        const page = Number(host.dataset.idx) + 1;
        const hostRect = host.getBoundingClientRect();
        const W = host.clientWidth, H = host.clientHeight;
        const clientRects = Array.from(range.getClientRects()).filter((r) => r.width > 1 && r.height > 1);
        if (!clientRects.length) return;
        const rects: NoteRect[] = clientRects.map((r) => ({ x: (r.left - hostRect.left) / W, y: (r.top - hostRect.top) / H, w: r.width / W, h: r.height / H }));
        const last = clientRects[clientRects.length - 1];
        const top = Math.min(last.bottom + 6, window.innerHeight - 240);
        const left = Math.max(8, Math.min(clientRects[0].left, window.innerWidth - 320));
        setSel({ text, page, rects, top, left });
    };
    useEffect(() => {
        // 挂 document：拖选可能在页外松手，挂容器会漏；selectionchange 兜底触屏
        const h = () => setTimeout(onSelectMaybe, 10);
        document.addEventListener("mouseup", h); document.addEventListener("touchend", h);
        return () => { document.removeEventListener("mouseup", h); document.removeEventListener("touchend", h); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ── 术语录入 ──
    const enrollChar = async (raw: string, kind: CharKind) => {
        const name = raw.trim(); setSel(null);
        if (name.length < 2 || name.length > 40) return;
        try {
            const r = await fetch("/api/book-characters", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bookPath: filePath, action: "add", name, kind }) });
            const d = await r.json();
            if (d.success && d.character) { charListRef.current = [...charListRef.current, d.character]; setCharPopup({ char: d.character, top: 120, left: 120 }); }
        } catch {}
    };
    const aiDescribe = async (name: string) => {
        if (aiBusy) return; setAiBusy(true);
        try {
            const r = await fetch("/api/book-characters", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bookPath: filePath, action: "ai", name }) });
            const d = await r.json();
            if (d.success && Array.isArray(d.characters)) { charListRef.current = d.characters; const c = d.characters.find((x: BookChar) => x.name === name); if (c) setCharPopup((p) => p ? { ...p, char: c } : { char: c, top: 120, left: 120 }); if (!d.applied) alert("AI 没生成有效解读（信息不足）。"); }
            else alert("AI 解读失败：" + (d.error || ""));
        } catch { alert("网络错误，请重试。"); } finally { setAiBusy(false); }
    };

    // ── 标注（荧光笔 + 存 Notes）──
    const addHighlight = async (color = HL_COLORS[0].bg) => {
        if (!sel) return; const { text, page, rects } = sel; setSel(null);
        try {
            const note = { kind: "highlight", cfi: `pdf:${page}`, text: text.slice(0, 4000), color, src: JSON.stringify({ page, rects }) };
            const r = await fetch("/api/book-notes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bookPath: filePath, note }) });
            const d = await r.json();
            if (d.success && d.note) { notesRef.current = [d.note, ...notesRef.current]; setNotes(notesRef.current.slice()); paintHighlights(); }
        } catch {}
    };
    const deleteNote = async (id: number) => {
        try { await fetch("/api/book-notes", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bookPath: filePath, id }) }); } catch {}
        notesRef.current = notesRef.current.filter((n) => n.id !== id); setNotes(notesRef.current.slice()); paintHighlights();
    };
    const jumpToNote = (n: Note) => {
        const m = /^pdf:(\d+)$/.exec(n.cfi || ""); const pg = m ? parseInt(m[1], 10) : 1;
        pageElsRef.current[pg - 1]?.scrollIntoView({ behavior: "smooth" }); setNotesOpen(false);
    };

    // ── 问答助手（论文模式，SSE 步骤流）──
    const askQuestion = async (question: string) => {
        const q = question.trim(); if (!q || askBusy) return;
        setAskOpen(true); setAskHistory((h) => [...h, { role: "user", text: q }]); setAskBusy(true); setAskSteps([]);
        try {
            const res = await fetch("/api/book-ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bookPath: filePath, bookTitle: title || "本论文", question: q, readText: fullTextRef.current, history: askHistory.slice(-6), mode: "paper" }) });
            if ((res.headers.get("content-type") || "").includes("text/event-stream") && res.body) {
                const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = ""; let finished = false;
                for (;;) {
                    const { done, value } = await reader.read(); if (done) break;
                    buf += dec.decode(value, { stream: true }); const parts = buf.split("\n\n"); buf = parts.pop() || "";
                    for (const p of parts) { if (!p.startsWith("data: ")) continue; try { const d = JSON.parse(p.slice(6)); if (d.ev === "status") setAskSteps((s) => [...s, String(d.text || "")]); else if (d.ev === "done") { finished = true; setAskHistory((h) => [...h, { role: "assistant", text: String(d.answer || "") }]); } else if (d.ev === "error") { finished = true; setAskHistory((h) => [...h, { role: "assistant", text: `出错：${d.error}` }]); } } catch {} }
                }
                if (!finished) setAskHistory((h) => [...h, { role: "assistant", text: "连接中断，请重试。" }]);
            } else { const d = await res.json(); setAskHistory((h) => [...h, { role: "assistant", text: d.success ? d.answer : `出错：${d.error || res.status}` }]); }
        } catch { setAskHistory((h) => [...h, { role: "assistant", text: "网络错误，请重试。" }]); }
        finally { setAskBusy(false); setAskSteps([]); }
    };
    const askAboutSelection = (custom?: string) => {
        if (!sel) return; const s = sel.text; setSel(null);
        const q = custom?.trim() ? `在论文里「${s}」的语境下，${custom.trim()}` : `解释一下论文里的「${s}」是什么意思、起什么作用。`;
        void askQuestion(q);
    };

    // ── 关系图：选 2+ 词条 → book-relations（已泛化吃 PDF）→ mermaid ──
    const toggleRelSel = (name: string) => setRelSel((s) => s.includes(name) ? s.filter((n) => n !== name) : [...s, name]);
    const runRelations = async () => {
        if (relSel.length < 2 || relBusy) return;
        setRelBusy(true); setRelSvg(""); setRelExplain("");
        try {
            const r = await fetch("/api/book-relations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bookPath: filePath, names: relSel }) });
            const d = await r.json();
            if (!d.success) { setRelExplain("出错：" + (d.error || "")); return; }
            const mermaid = (await import("mermaid")).default;
            mermaid.initialize({ startOnLoad: false, theme: "neutral", flowchart: { nodeSpacing: 60, rankSpacing: 80 }, themeVariables: { fontSize: "18px" } });
            const { svg } = await mermaid.render("relGraph" + Date.now(), d.mermaid);
            setRelSvg(svg.replace(/max-width:[^;"]+;?/g, "")); setRelExplain(d.explain || "");
        } catch (e) { setRelExplain("绘制失败：" + String(e).slice(0, 80)); }
        finally { setRelBusy(false); }
    };
    const openRel = () => { setRelOpen(true); setRelSvg(""); setRelExplain(""); setRelSel([]); };

    // ── P4：从文本层 span 几何反推「文本块」（PDF 无段落，靠行聚类 + 竖向间隙分块）──
    const computeBlocks = (idx: number): TextBlock[] => {
        const cached = blocksByPageRef.current.get(idx);
        if (cached) return cached;
        const host = pageElsRef.current[idx];
        if (!host || !renderedRef.current.has(idx)) return [];
        const spans = Array.from(host.querySelectorAll(".textLayer span")) as HTMLElement[];
        const items = spans.map((s) => ({ x: s.offsetLeft, y: s.offsetTop, w: s.offsetWidth, h: s.offsetHeight || 12, t: s.textContent || "" })).filter((i) => i.t.trim());
        if (!items.length) return [];
        items.sort((a, b) => a.y - b.y || a.x - b.x);
        // 行聚类
        const lines: { top: number; bottom: number; left: number; right: number; text: string }[] = [];
        for (const it of items) {
            const ln = lines[lines.length - 1];
            if (ln && Math.abs((ln.top + ln.bottom) / 2 - (it.y + it.h / 2)) < it.h * 0.7) {
                ln.top = Math.min(ln.top, it.y); ln.bottom = Math.max(ln.bottom, it.y + it.h);
                ln.left = Math.min(ln.left, it.x); ln.right = Math.max(ln.right, it.x + it.w); ln.text += it.t;
            } else lines.push({ top: it.y, bottom: it.y + it.h, left: it.x, right: it.x + it.w, text: it.t });
        }
        // 行 → 块（竖向间隙 > 1.4 行高即断块）
        const blocks: TextBlock[] = [];
        let cur: TextBlock | null = null;
        for (const ln of lines) {
            const lh = ln.bottom - ln.top;
            if (cur && ln.top - cur.bottom < lh * 1.4 && Math.abs(ln.left - cur.left) < lh * 8) {
                cur.bottom = ln.bottom; cur.left = Math.min(cur.left, ln.left); cur.right = Math.max(cur.right, ln.right); cur.text += " " + ln.text;
            } else { cur = { page: idx, top: ln.top, bottom: ln.bottom, left: ln.left, right: ln.right, text: ln.text }; blocks.push(cur); }
        }
        const real = blocks.filter((b) => b.text.trim().length >= 4);
        // 双栏阅读顺序：论文常是左右两栏。检测到双栏 → 左栏(自上而下) 然后 右栏；否则按 y 排。
        const pageW = (host.querySelector(".textLayer") as HTMLElement | null)?.clientWidth || host.clientWidth;
        const mid = pageW / 2;
        const left = real.filter((b) => (b.left + b.right) / 2 < mid);
        const right = real.filter((b) => (b.left + b.right) / 2 >= mid);
        const fullWidth = real.filter((b) => b.right - b.left > pageW * 0.62).length;
        const twoCol = left.length >= 2 && right.length >= 2 && fullWidth < real.length * 0.35;
        const ordered = twoCol
            ? [...left.sort((a, b) => a.top - b.top), ...right.sort((a, b) => a.top - b.top)]
            : real.sort((a, b) => a.top - b.top);
        blocksByPageRef.current.set(idx, ordered);
        return ordered;
    };

    /** 全屏 overlay：按 focusZoom 放大渲染当前页 canvas（同页仅渲一次）+ 高亮当前块 + 滚到块 */
    const renderFocusOverlay = async (forceCanvas = false) => {
        const f = focusRef.current, doc = docRef.current; if (!f || !doc) return;
        const scale = scaleRef.current * focusZoomRef.current;
        const ratio = scale / scaleRef.current;
        const canvas = focusCanvasRef.current, stage = focusStageRef.current; if (!canvas || !stage) return;
        // 页变了 / 缩放变了 → 重渲 canvas
        if (forceCanvas || focusRenderedPageRef.current !== f.page) {
            const page = await doc.getPage(f.page + 1);
            const vp = page.getViewport({ scale });
            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            canvas.width = Math.floor(vp.width * dpr); canvas.height = Math.floor(vp.height * dpr);
            canvas.style.width = `${Math.floor(vp.width)}px`; canvas.style.height = `${Math.floor(vp.height)}px`;
            stage.style.width = `${Math.floor(vp.width)}px`; stage.style.height = `${Math.floor(vp.height)}px`;
            const ctx = canvas.getContext("2d")!; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            await page.render({ canvasContext: ctx, viewport: vp }).promise;
            focusRenderedPageRef.current = f.page;
        }
        // 高亮当前块
        const blk = computeBlocks(f.page)[f.idx];
        stage.querySelectorAll(".foc-hl,.foc-bar").forEach((x) => x.remove());
        if (blk) {
            const col = moodOnRef.current ? tempColor(moodTempRef.current) : "#5b8def";
            const bg = moodOnRef.current ? tempColor(moodTempRef.current).replace("rgb(", "rgba(").replace(")", ",0.14)") : "rgba(91,141,239,0.14)";
            const hl = document.createElement("div");
            hl.className = "foc-hl";
            hl.style.cssText = `position:absolute;left:${blk.left * ratio - 8}px;top:${blk.top * ratio - 6}px;width:${(blk.right - blk.left) * ratio + 16}px;height:${(blk.bottom - blk.top) * ratio + 12}px;background:${bg};border-left:3px solid ${col};border-radius:6px;pointer-events:none;z-index:2;transition:all .25s ease;`;
            if (moodOnRef.current && moodWordRef.current) {
                const w = document.createElement("span");
                w.textContent = moodWordRef.current;
                w.style.cssText = `position:absolute;left:-24px;top:0;writing-mode:vertical-rl;font-size:13px;letter-spacing:2px;font-weight:700;white-space:nowrap;color:${col};`;
                hl.appendChild(w);
            }
            stage.appendChild(hl);
            const scroller = focusScrollRef.current;
            if (scroller) scroller.scrollTo({ top: Math.max(0, blk.top * ratio - scroller.clientHeight * 0.38), behavior: "smooth" });
        }
    };

    const focusBlock = async (page: number, idx: number) => {
        if (page < 0 || page >= numPages) return;
        await renderPage(page);
        const blocks = computeBlocks(page);
        if (!blocks.length) { if (page + 1 < numPages) return focusBlock(page + 1, 0); return; }
        const i = Math.max(0, Math.min(blocks.length - 1, idx));
        focusRef.current = { page, idx: i };
        setFocusInfo({ page: page + 1, idx: i, total: blocks.length });
        await renderFocusOverlay();
        if (moodOnRef.current) measureMood();
        if (ttsOnRef.current) void speakCurrent();
    };
    const moveFocus = async (dir: 1 | -1) => {
        const f = focusRef.current; if (!f) { await focusBlock(curPageRef.current - 1, 0); return; }
        const blocks = computeBlocks(f.page);
        const ni = f.idx + dir;
        if (ni >= blocks.length) { await focusBlock(f.page + 1, 0); return; }
        if (ni < 0) { const pb = computeBlocks(f.page - 1); await focusBlock(f.page - 1, Math.max(0, pb.length - 1)); return; }
        await focusBlock(f.page, ni);
    };
    const applyFocusZoom = (z: number) => { const nz = Math.max(1, Math.min(3.5, z)); focusZoomRef.current = nz; setFocusZoom(nz); void renderFocusOverlay(true); };
    const toggleFocus = () => {
        const on = !focusOnRef.current; focusOnRef.current = on; setFocusOn(on);
        if (on) { focusRenderedPageRef.current = -1; void focusBlock(curPageRef.current - 1, 0); }
        else { focusRef.current = null; try { audioRef.current?.pause(); } catch {} }
    };

    // ── 温度：最近块文本 → book-mood → 色 + 关键词 ──
    const recentBlocksText = (): string => {
        const f = focusRef.current; if (!f) return "";
        let text = ""; let p = f.page; let i = f.idx;
        for (let n = 0; n < 6 && p >= 0; n++) { const bs = computeBlocks(p); if (bs[i]) text = bs[i].text + " " + text; i--; if (i < 0) { p--; i = (computeBlocks(p).length - 1); } }
        return text.replace(/\s+/g, " ").trim().slice(-1500);
    };
    const measureMood = () => {
        if (!moodOnRef.current) return;
        if (moodTimerRef.current) clearTimeout(moodTimerRef.current);
        moodTimerRef.current = setTimeout(async () => {
            const text = recentBlocksText(); if (text.length < 20) return;
            const apply = (t: number, w: string) => { moodTempRef.current = Math.max(1, Math.min(100, t)); moodWordRef.current = w || ""; setMoodTemp(moodTempRef.current); void renderFocusOverlay(); };
            const hit = moodCacheRef.current.get(text); if (hit) { apply(hit.temp, hit.word); return; }
            try { const r = await fetch("/api/book-mood", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bookPath: filePath, text }) }); const d = await r.json(); if (d.success && typeof d.temp === "number") { moodCacheRef.current.set(text, { temp: d.temp, word: d.word || "" }); apply(d.temp, d.word || ""); } } catch {}
        }, 600);
    };
    const toggleMood = () => { const on = !moodOnRef.current; moodOnRef.current = on; setMoodOn(on); if (on && !focusOnRef.current) toggleFocus(); else { void renderFocusOverlay(); if (on) measureMood(); } };

    // ── 朗读：当前块 → /api/tts → 播完自动下一块 ──
    const speakCurrent = async () => {
        const f = focusRef.current; if (!f) return;
        const blk = computeBlocks(f.page)[f.idx]; if (!blk) return;
        try {
            const r = await fetch("/api/tts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: blk.text.slice(0, 600) }) });
            if (!r.ok) return; const url = URL.createObjectURL(await r.blob());
            if (!audioRef.current) audioRef.current = new Audio();
            const a = audioRef.current; a.src = url;
            a.onended = () => { if (ttsOnRef.current) void moveFocus(1); };
            void a.play();
        } catch {}
    };
    const toggleTts = () => {
        const on = !ttsOnRef.current; ttsOnRef.current = on; setTtsOn(on);
        if (on) { if (!focusOnRef.current) toggleFocus(); else void speakCurrent(); }
        else { try { audioRef.current?.pause(); } catch {} }
    };

    // 键盘 ↓↑ 移动聚焦
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => { if (!focusOnRef.current) return; if (e.key === "ArrowDown") { e.preventDefault(); void moveFocus(1); } else if (e.key === "ArrowUp") { e.preventDefault(); void moveFocus(-1); } };
        window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [numPages]);

    // 缩放：改 scale → 清渲染 → 重设占位尺寸 → 重渲当前页附近
    useEffect(() => {
        if (status !== "ready" || !baseViewportRef.current) return;
        zoomRef.current = zoom; scaleRef.current = fitScaleRef.current * zoom;
        blocksByPageRef.current.clear();
        for (const idx of Array.from(renderedRef.current)) { renderTasksRef.current.get(idx)?.cancel(); pageElsRef.current[idx]!.innerHTML = ""; }
        renderedRef.current.clear();
        const h = Math.floor(baseViewportRef.current.h * scaleRef.current);
        for (const el of pageElsRef.current) if (el) el.style.height = `${h}px`;
        const c = curPageRef.current - 1;
        for (let i = Math.max(0, c - 1); i <= Math.min(numPages - 1, c + 2); i++) void renderPage(i);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [zoom]);
    const pageW = baseViewportRef.current ? Math.floor(baseViewportRef.current.w * fitScaleRef.current * zoom) : 340;

    const shortWord = sel && sel.text.length >= 2 && sel.text.length <= 24 && !/\s{2,}/.test(sel.text);

    return (
        <div className="fixed inset-0 bg-[#33333a]">
            {/* 两页并排页流（沉浸全屏，无顶栏） */}
            <div ref={scrollRef} className="absolute inset-0 overflow-auto">
                {status === "loading" && <div className="flex h-full items-center justify-center text-[14px] text-white/60">正在加载 PDF…</div>}
                {status === "error" && <div className="flex h-full items-center justify-center px-6 text-center text-[14px] text-[#ff8a8a]">{errorMsg}</div>}
                {status === "ready" && (
                    <div className="mx-auto w-fit py-6" style={{ display: "grid", gridTemplateColumns: "repeat(2, max-content)", columnGap: 14, rowGap: 20, justifyContent: "center" }}>
                        {Array.from({ length: numPages }, (_, i) => (
                            <div key={i} data-idx={i} ref={(el) => { pageElsRef.current[i] = el; }} className="relative bg-white shadow-lg" style={{ width: pageW }} />
                        ))}
                    </div>
                )}
            </div>

            {/* 左上悬浮：返回 + 工具展开 */}
            <div className="pointer-events-none absolute left-3 z-[60] flex items-center gap-2" style={{ top: "max(0.75rem, env(safe-area-inset-top))" }}>
                <Link href="/bookshelf" onClick={exitToShelf} className="pointer-events-auto flex h-9 items-center gap-1.5 rounded-full bg-black/45 px-3 text-[13px] text-white/90 backdrop-blur transition-colors hover:bg-black/65">
                    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>返回
                </Link>
                <button onClick={() => setToolsOpen((v) => !v)} className="pointer-events-auto flex h-9 items-center gap-1.5 rounded-full bg-black/45 px-3 text-[13px] text-white/90 backdrop-blur transition-colors hover:bg-black/65">工具{toolsOpen ? " ▲" : " ▾"}</button>
                {toolsOpen && (
                    <div className="pointer-events-auto flex items-center gap-1.5 rounded-full bg-black/45 px-2 py-1 backdrop-blur">
                        {[
                            { label: "问答", on: askOpen, fn: () => setAskOpen((v) => !v) },
                            { label: "笔记" + (notes.length ? ` ${notes.length}` : ""), on: notesOpen, fn: () => setNotesOpen((v) => !v) },
                            { label: "关系图", on: false, fn: openRel },
                            { label: "聚焦", on: focusOn, fn: toggleFocus },
                            { label: "温度", on: moodOn, fn: toggleMood },
                            { label: "朗读", on: ttsOn, fn: toggleTts },
                        ].map((b) => (
                            <button key={b.label} onClick={b.fn} className={`h-7 rounded-full px-2.5 text-[12px] transition-colors ${b.on ? "bg-white/90 text-black" : "text-white/85 hover:bg-white/15"}`}>{b.label}</button>
                        ))}
                    </div>
                )}
            </div>

            {/* 底部悬浮：页码 + 缩放 */}
            {status === "ready" && (
                <div className="absolute bottom-3 left-1/2 z-[60] flex -translate-x-1/2 items-center gap-1 rounded-full bg-black/45 px-1.5 py-1 text-white/90 backdrop-blur">
                    <button onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.15).toFixed(2)))} className="h-7 w-7 rounded-full text-[16px] hover:bg-white/15">−</button>
                    <span className="w-11 text-center text-[12px] tabular-nums">{Math.round(zoom * 100)}%</span>
                    <button onClick={() => setZoom((z) => Math.min(3, +(z + 0.15).toFixed(2)))} className="h-7 w-7 rounded-full text-[16px] hover:bg-white/15">+</button>
                    <span className="mx-1 h-4 w-px bg-white/20" />
                    <span className="px-2 text-[12px] tabular-nums text-white/70">{curPage} / {numPages}</span>
                </div>
            )}

            {/* 划词面板 */}
            {sel && (
                <div className="pdf-panel fixed z-[65] w-[300px] max-w-[92vw] rounded-xl border border-line bg-bg-card p-3.5 shadow-2xl" style={{ top: Math.min(sel.top, window.innerHeight - 220), left: sel.left }}>
                    <p className="mb-2 line-clamp-2 text-[12px] text-text-3">选中：「{sel.text}」</p>
                    {shortWord && (
                        <div className="mb-2.5">
                            <p className="mb-1.5 text-[12px] font-medium text-text-1">录入为词条</p>
                            <div className="flex flex-wrap gap-1.5">
                                {KIND_OPTIONS.map((k) => (
                                    <button key={k.key} onClick={() => enrollChar(sel.text, k.key)} className="flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-[12px] text-text-2 transition-colors hover:border-primary hover:text-primary">
                                        <span className="h-2.5 w-2.5 rounded-full" style={{ background: k.swatch }} />{k.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
                    <div className={shortWord ? "border-t border-line/60 pt-2.5" : ""}>
                        <div className="flex items-center gap-2">
                            <div className="flex gap-1">
                                {HL_COLORS.map((c) => <button key={c.label} onClick={() => addHighlight(c.bg)} title={`标注·${c.label}`} className="h-6 w-6 rounded-md border border-line" style={{ background: c.bg }} />)}
                            </div>
                            <button onClick={() => askAboutSelection()} className="ml-auto flex items-center gap-1.5 rounded-lg bg-secondary px-3 py-1.5 text-[13px] text-white hover:opacity-90">直接问</button>
                        </div>
                        <input ref={askDraftRef} className="mt-2 w-full rounded-lg border border-line bg-bg-input px-2.5 py-1.5 text-[13px] text-text-1 outline-none placeholder:text-text-3 focus:border-secondary" placeholder="输入问题，点直接问或回车…" onKeyDown={(e) => { if (e.key === "Enter") { const v = (e.target as HTMLInputElement).value; if (v.trim()) askAboutSelection(v); } }} />
                    </div>
                    <button className="absolute right-2 top-2 text-text-3 hover:text-text-1" onClick={() => setSel(null)}>✕</button>
                </div>
            )}

            {/* 词条卡 */}
            {charPopup && (
                <div className="fixed z-[60] w-[340px] max-w-[92vw] rounded-xl border border-line bg-bg-card p-4 shadow-2xl" style={{ top: charPopup.top, left: charPopup.left }}>
                    <div className="flex items-center gap-2">
                        <span className="h-4 w-4 shrink-0 rounded-full" style={{ background: charPopup.char.color }} />
                        <span className="text-[15px] font-semibold text-text-1">{charPopup.char.name}</span>
                        <button className="ml-auto text-text-3 hover:text-text-1" onClick={() => setCharPopup(null)}>✕</button>
                    </div>
                    <p className="mt-2 text-[13px] leading-relaxed text-text-2">{charPopup.char.desc || "（还没有解读）"}</p>
                    <button disabled={aiBusy} onClick={() => aiDescribe(charPopup.char.name)} className="mt-3 rounded-lg bg-primary px-3 py-1.5 text-[13px] text-white transition-opacity disabled:opacity-50">{aiBusy ? "解读中…" : "AI 解读"}</button>
                </div>
            )}

            {/* 笔记浮窗 */}
            {notesOpen && (
                <div className="fixed bottom-4 left-4 z-[70] flex max-h-[72vh] w-[340px] max-w-[92vw] flex-col rounded-xl border border-line bg-bg-card shadow-2xl">
                    <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
                        <span className="text-[14px] font-semibold text-text-1">笔记</span>
                        <span className="text-[11px] text-text-3">{notes.length} 条</span>
                        <button className="ml-auto text-text-3 hover:text-text-1" onClick={() => setNotesOpen(false)}>✕</button>
                    </div>
                    <div className="min-h-0 flex-1 overflow-y-auto p-3">
                        {notes.length === 0 ? <p className="text-[13px] text-text-3">划词选颜色即可荧光笔标注，标注会存到这里。</p> :
                            notes.map((n) => (
                                <div key={n.id} className="mb-2 rounded-lg border border-line/60 bg-bg-input p-2.5">
                                    <div className="flex items-start gap-2">
                                        <span className="mt-1 h-3 w-3 shrink-0 rounded-sm" style={{ background: n.color || HL_COLORS[0].bg }} />
                                        <p className="flex-1 text-[12.5px] leading-relaxed text-text-1">{n.text}</p>
                                    </div>
                                    <div className="mt-1.5 flex items-center gap-2 text-[11px]">
                                        <button className="text-secondary hover:underline" onClick={() => jumpToNote(n)}>跳转 P{/^pdf:(\d+)$/.exec(n.cfi)?.[1] || "?"}</button>
                                        <button className="ml-auto text-text-3 hover:text-[#f44336]" onClick={() => deleteNote(n.id)}>删除</button>
                                    </div>
                                </div>
                            ))}
                    </div>
                </div>
            )}

            {/* 全屏聚焦阅读：放大当前页 + 高亮当前块，双栏顺序、可缩放 */}
            {focusOn && (
                <div className="fixed inset-0 z-[85] flex flex-col bg-[#0e0e12]">
                    <div className="flex items-center gap-3 border-b border-white/10 px-4 py-2.5">
                        <button onClick={toggleFocus} className="rounded-full border border-white/25 px-3 py-1.5 text-[13px] text-white/90 transition-colors hover:bg-white/10">退出聚焦</button>
                        <span className="text-[13px] tabular-nums text-white/55">P{focusInfo.page} · 第 {focusInfo.idx + 1}/{focusInfo.total} 块</span>
                        <div className="ml-auto flex items-center gap-1.5">
                            <button onClick={() => applyFocusZoom(focusZoom - 0.3)} className="h-8 w-8 rounded-full border border-white/25 text-[16px] text-white/90 hover:bg-white/10">−</button>
                            <span className="w-12 text-center text-[12px] tabular-nums text-white/55">{Math.round(focusZoom * 100)}%</span>
                            <button onClick={() => applyFocusZoom(focusZoom + 0.3)} className="h-8 w-8 rounded-full border border-white/25 text-[16px] text-white/90 hover:bg-white/10">+</button>
                            <button onClick={toggleMood} className="ml-2 h-8 rounded-full border px-3 text-[13px] transition-colors" style={moodOn ? { borderColor: tempColor(moodTemp), color: tempColor(moodTemp) } : { borderColor: "rgba(255,255,255,0.25)", color: "rgba(255,255,255,0.9)" }}>温度</button>
                            <button onClick={toggleTts} className="h-8 rounded-full border px-3 text-[13px] transition-colors" style={ttsOn ? { borderColor: "var(--color-secondary)", color: "var(--color-secondary)" } : { borderColor: "rgba(255,255,255,0.25)", color: "rgba(255,255,255,0.9)" }}>朗读</button>
                        </div>
                    </div>
                    <div ref={focusScrollRef} className="flex min-h-0 flex-1 justify-center overflow-auto py-6">
                        <div ref={focusStageRef} className="relative h-fit bg-white shadow-2xl">
                            <canvas ref={focusCanvasRef} className="block" />
                        </div>
                    </div>
                    <div className="flex items-center justify-center gap-3 border-t border-white/10 py-2.5">
                        <button onClick={() => void moveFocus(-1)} className="rounded-full border border-white/25 px-5 py-1.5 text-[13px] text-white/90 hover:bg-white/10">▲ 上一块</button>
                        <button onClick={() => void moveFocus(1)} className="rounded-full bg-primary px-6 py-1.5 text-[13px] text-white hover:bg-primary-hover">下一块 ▼</button>
                    </div>
                </div>
            )}

            {/* 关系图面板 */}
            {relOpen && (
                <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4" onClick={(e) => { if (e.target === e.currentTarget) setRelOpen(false); }}>
                    <div className="flex max-h-[86vh] w-[720px] max-w-[96vw] flex-col rounded-2xl border border-line bg-bg-card shadow-2xl">
                        <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
                            <span className="text-[14px] font-semibold text-text-1">关系图</span>
                            <span className="text-[11px] text-text-3">选 2+ 个词条，画出它们在论文里的关系</span>
                            <button className="ml-auto text-text-3 hover:text-text-1" onClick={() => setRelOpen(false)}>✕</button>
                        </div>
                        <div className="min-h-0 flex-1 overflow-y-auto p-4">
                            {/* 词条选择 */}
                            <div className="mb-3 flex flex-wrap gap-1.5">
                                {charListRef.current.length === 0 ? <span className="text-[12px] text-text-3">还没有词条——先在正文划词录入几个术语/方法。</span> :
                                    charListRef.current.map((c) => (
                                        <button key={c.name} onClick={() => toggleRelSel(c.name)} className={`rounded-full border px-2.5 py-1 text-[12px] transition-colors ${relSel.includes(c.name) ? "border-primary text-primary" : "border-line text-text-2 hover:text-text-1"}`} style={relSel.includes(c.name) ? { background: c.color } : undefined}>{c.name}</button>
                                    ))}
                            </div>
                            <button disabled={relSel.length < 2 || relBusy} onClick={runRelations} className="mb-3 rounded-lg bg-primary px-4 py-1.5 text-[13px] text-white transition-opacity disabled:opacity-50">{relBusy ? "绘制中…" : `画关系图（${relSel.length}）`}</button>
                            {relSvg && <div className="overflow-x-auto rounded-lg border border-line/60 bg-white p-3" dangerouslySetInnerHTML={{ __html: relSvg }} />}
                            {relExplain && <p className="mt-3 whitespace-pre-wrap text-[13px] leading-relaxed text-text-2">{relExplain}</p>}
                        </div>
                    </div>
                </div>
            )}

            {/* 问答助手 */}
            {askOpen && (
                <div className="fixed bottom-4 right-4 z-[70] flex max-h-[72vh] w-[380px] max-w-[94vw] flex-col rounded-xl border border-line bg-bg-card shadow-2xl">
                    <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
                        <span className="text-[14px] font-semibold text-text-1">论文问答</span>
                        <span className="text-[11px] text-text-3">读全文 · 按需检索</span>
                        <button className="ml-auto text-text-3 hover:text-text-1" onClick={() => setAskOpen(false)}>✕</button>
                    </div>
                    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
                        {askHistory.length === 0 ? <p className="text-[13px] leading-relaxed text-text-3">问这篇论文的任何事：方法、公式、符号、实验、创新点、局限。会检索原文作答。</p> :
                            askHistory.map((m, i) => (
                                <div key={i} className={`mb-3 ${m.role === "user" ? "text-right" : ""}`}>
                                    {m.role === "user" ? <div className="inline-block max-w-[85%] whitespace-pre-wrap rounded-lg bg-primary px-3 py-2 text-left text-[13px] leading-relaxed text-white">{m.text}</div>
                                        : <div className="ask-md inline-block max-w-[85%] rounded-lg bg-bg-input px-3 py-2 text-left text-[13px] leading-relaxed text-text-1" dangerouslySetInnerHTML={{ __html: marked.parse(m.text, { async: false }) as string }} />}
                                </div>
                            ))}
                        {askBusy && (
                            <div className="mb-3"><div className="inline-flex max-w-[85%] flex-col gap-1.5 rounded-lg bg-bg-input px-3 py-2.5">
                                {askSteps.slice(0, -1).map((s, i) => <div key={i} className="flex items-start gap-2 text-[11px] text-text-3"><span className="shrink-0 text-[#3FB950]">✓</span><span>{s}</span></div>)}
                                <div className="flex items-center gap-2"><span className="ask-typing"><span className="ask-dot" /><span className="ask-dot" /><span className="ask-dot" /></span><span className="text-[11px] text-text-3">{askSteps.length ? askSteps[askSteps.length - 1] : "思考中…"}</span></div>
                            </div></div>
                        )}
                    </div>
                    <div className="border-t border-line p-3">
                        <textarea className="max-h-24 min-h-[44px] w-full resize-none rounded-lg border border-line bg-bg-input px-3 py-2 text-[13px] leading-relaxed text-text-1 outline-none placeholder:text-text-3 focus:border-secondary" placeholder="问点关于这篇论文的…" value={askInput} onChange={(e) => setAskInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); const q = askInput.trim(); if (q) { setAskInput(""); void askQuestion(q); } } }} />
                        <div className="mt-2 flex items-center justify-between">
                            <span className="text-[11px] text-text-4">Enter 发送 · Shift+Enter 换行</span>
                            <button className="cursor-pointer rounded-lg bg-secondary px-4 py-1.5 text-[13px] text-white transition-opacity disabled:opacity-50" disabled={!askInput.trim() || askBusy} onClick={() => { const q = askInput.trim(); if (q) { setAskInput(""); void askQuestion(q); } }}>{askBusy ? "…" : "发送"}</button>
                        </div>
                    </div>
                </div>
            )}

            <style>{`
                .textLayer { position:absolute; inset:0; overflow:clip; opacity:1; line-height:1; text-align:initial; transform-origin:0 0; z-index:3; forced-color-adjust:none; }
                .textLayer :is(span,br) { color:transparent; position:absolute; white-space:pre; cursor:text; transform-origin:0 0; }
                .textLayer span.markedContent { top:0; height:0; }
                .textLayer ::selection { background: rgba(120,150,255,0.4); }
                .pdf-canvas { display:block; }
                .ask-md p { margin: 0.4em 0; } .ask-md p:first-child{margin-top:0} .ask-md p:last-child{margin-bottom:0}
                .ask-md ul,.ask-md ol{margin:0.4em 0;padding-left:1.4em}.ask-md li{margin:0.15em 0}.ask-md strong{font-weight:700}
                .ask-md h1,.ask-md h2,.ask-md h3,.ask-md h4{font-size:1em;font-weight:700;margin:0.6em 0 0.3em}
                .ask-md blockquote{border-left:3px solid var(--color-primary);margin:0.4em 0;padding:0.1em 0.7em;color:var(--color-text-2)}
                .ask-md code{background:var(--color-bg-hover);padding:0.1em 0.35em;border-radius:4px;font-size:0.92em;font-family:ui-monospace,Menlo,monospace}
                .ask-md table{border-collapse:collapse;margin:0.5em 0;font-size:0.95em}.ask-md th,.ask-md td{border:1px solid var(--color-line);padding:0.25em 0.55em}
                .ask-typing{display:inline-flex;align-items:center;gap:4px}
                .ask-dot{width:6px;height:6px;border-radius:50%;background:var(--color-secondary);animation:askBounce 1.2s infinite ease-in-out}
                .ask-dot:nth-child(2){animation-delay:.16s}.ask-dot:nth-child(3){animation-delay:.32s}
                @keyframes askBounce{0%,70%,100%{transform:translateY(0);opacity:.35}35%{transform:translateY(-5px);opacity:1}}
            `}</style>
        </div>
    );
}

export default function Page() {
    return <Suspense fallback={<div className="flex h-[100dvh] items-center justify-center text-[14px] text-text-3">加载中…</div>}><PdfReader /></Suspense>;
}
