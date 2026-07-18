"use client";

// ── 笔记（iPad 备忘录式 × Markdown） ──
// 左列：搜索 + 时间分组列表（含书籍笔记 ref，只读、点击跳阅读器）；
// 右侧：Markdown 编辑器——顶部工具栏（B/I/标题/列表/引用/代码/链接）+ 编辑⇄预览切换，
// 首行即标题，800ms 防抖自动保存。轻量自写渲染（标题/粗斜/列表/引用/代码块/链接/分隔线），
// 不引重库。手机单栏滑换；每用户私有，存服务器。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMe } from "../../components/useMe";
import { LoginGate } from "../../components/LoginGate";
import { useLang } from "../../lib/i18n";

interface Note { id: string; title: string; content: string; created_at: string; updated_at: string }
interface BookRef { bookPath: string; bookTitle: string; count: number; latest: string; preview: string }

const relTime = (iso: string) => {
    const d = new Date(iso.replace(" ", "T") + (iso.includes("Z") || iso.includes("+") ? "" : "Z"));
    const now = Date.now(), diff = now - d.getTime();
    const day = 86400_000;
    if (diff < day && new Date(now).getDate() === d.getDate()) {
        return d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
    }
    if (diff < 2 * day) return "昨天";
    if (diff < 7 * day) return d.toLocaleDateString("zh-CN", { weekday: "long" });
    return d.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
};

const groupOf = (iso: string): string => {
    const d = new Date(iso.replace(" ", "T") + (iso.includes("Z") || iso.includes("+") ? "" : "Z"));
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    if (d.getTime() >= startOfDay) return "今天";
    if (d.getTime() >= startOfDay - 86400_000) return "昨天";
    if (d.getTime() >= startOfDay - 6 * 86400_000) return "过去 7 天";
    if (d.getTime() >= startOfDay - 29 * 86400_000) return "过去 30 天";
    return "更早";
};

// ── 轻量 Markdown 渲染（安全：先整体 HTML 转义，再按行重建结构）──
const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const inline = (t: string) =>
    t
        .replace(/`([^`]+)`/g, '<code class="rounded bg-bg-hover px-1 py-0.5 text-[0.9em]">$1</code>')
        .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
        .replace(/\*([^*]+)\*/g, "<em>$1</em>")
        .replace(/~~([^~]+)~~/g, "<del>$1</del>")
        .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+|\/[^)\s]*)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" class="text-secondary underline underline-offset-2">$1</a>');

function mdToHtml(src: string): string {
    const lines = esc(src).split("\n");
    const out: string[] = [];
    let inCode = false, listMode: "" | "ul" | "ol" = "";
    const closeList = () => { if (listMode) { out.push(listMode === "ul" ? "</ul>" : "</ol>"); listMode = ""; } };
    for (const raw of lines) {
        if (raw.trim().startsWith("```")) {
            closeList();
            if (!inCode) { out.push('<pre class="my-2 overflow-x-auto rounded-lg bg-bg-hover/80 p-3 text-[13px] leading-relaxed"><code>'); inCode = true; }
            else { out.push("</code></pre>"); inCode = false; }
            continue;
        }
        if (inCode) { out.push(`${raw}\n`); continue; }
        const h = raw.match(/^(#{1,4})\s+(.*)$/);
        if (h) {
            closeList();
            const lv = h[1].length;
            const cls = ["text-[1.5em] font-bold mt-4 mb-2", "text-[1.3em] font-bold mt-3.5 mb-1.5", "text-[1.15em] font-semibold mt-3 mb-1", "text-[1.05em] font-semibold mt-2.5 mb-1"][lv - 1];
            out.push(`<h${lv + 1} class="${cls}">${inline(h[2])}</h${lv + 1}>`);
            continue;
        }
        if (/^\s*([-*_]){3,}\s*$/.test(raw)) { closeList(); out.push('<hr class="my-3 border-line" />'); continue; }
        const ul = raw.match(/^\s*[-*]\s+(.*)$/);
        const ol = raw.match(/^\s*\d+\.\s+(.*)$/);
        if (ul || ol) {
            const want = ul ? "ul" : "ol";
            if (listMode !== want) { closeList(); out.push(want === "ul" ? '<ul class="my-1.5 list-disc pl-5 space-y-0.5">' : '<ol class="my-1.5 list-decimal pl-5 space-y-0.5">'); listMode = want; }
            out.push(`<li>${inline((ul || ol)![1])}</li>`);
            continue;
        }
        closeList();
        const bq = raw.match(/^\s*&gt;\s?(.*)$/);
        if (bq) { out.push(`<blockquote class="my-1.5 border-l-2 border-primary/50 pl-3 text-text-2">${inline(bq[1])}</blockquote>`); continue; }
        if (!raw.trim()) { out.push('<div class="h-2.5"></div>'); continue; }
        out.push(`<p class="my-0.5 leading-relaxed">${inline(raw)}</p>`);
    }
    if (inCode) out.push("</code></pre>");
    closeList();
    return out.join("");
}

const readerHref = (p: string) => {
    if (/\.epub$/i.test(p)) return `/reader/epub?path=${encodeURIComponent(p)}`;
    if (/\.pdf$/i.test(p)) return `/reader/pdf?path=${encodeURIComponent(p)}`;
    if (/\.md$/i.test(p)) return `/reader/md?path=${encodeURIComponent(p)}`;
    return `/reader/epub?path=${encodeURIComponent(p)}`;
};

export default function NotesPage() {
    const me = useMe();
    const [notes, setNotes] = useState<Note[]>([]);
    const [bookRefs, setBookRefs] = useState<BookRef[]>([]);
    const [curId, setCurId] = useState<string | null>(null);
    const [draft, setDraft] = useState("");
    const [q, setQ] = useState("");
    const [mobileEditing, setMobileEditing] = useState(false);
    const [saving, setSaving] = useState<"idle" | "saving" | "saved">("idle");
    const [preview, setPreview] = useState(false);
    const taRef = useRef<HTMLTextAreaElement>(null);
    const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const { t } = useLang();
    const draftRef = useRef(draft);
    draftRef.current = draft;
    // 预览 HTML：必须在任何条件 return 之前（hooks 顺序铁律）
    const previewHtml = useMemo(() => mdToHtml(draft), [draft]);

    const load = useCallback(async () => {
        try {
            const r = await fetch("/api/notes");
            const d = await r.json();
            if (d.success) { setNotes(d.data.notes || []); setBookRefs(d.data.bookRefs || []); }
        } catch { /* noop */ }
    }, []);
    useEffect(() => { if (me.loggedIn) void load(); }, [me.loggedIn, load]);

    const cur = notes.find((n) => n.id === curId) || null;

    // 选中笔记 → 装载草稿(首行=标题)
    const open = (n: Note) => {
        flushSave();
        setCurId(n.id);
        setDraft(n.title ? `${n.title}\n${n.content}` : n.content);
        setMobileEditing(true);
        setSaving("idle");
    };

    const splitDraft = (text: string) => {
        const i = text.indexOf("\n");
        return i === -1 ? { title: text.trim(), content: "" } : { title: text.slice(0, i).trim(), content: text.slice(i + 1) };
    };

    const doSave = useCallback(async (id: string, text: string) => {
        const { title, content } = splitDraft(text);
        setSaving("saving");
        try {
            await fetch("/api/notes", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id, title, content }),
            });
            setSaving("saved");
            setNotes((list) => {
                const next = list.map((n) => (n.id === id ? { ...n, title, content, updated_at: new Date().toISOString() } : n));
                return [...next].sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
            });
        } catch { setSaving("idle"); }
    }, []);

    const flushSave = () => {
        if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; }
        if (curId) void doSave(curId, draftRef.current);
    };

    const onEdit = (text: string) => {
        setDraft(text);
        if (!curId) return;
        setSaving("saving");
        if (saveTimer.current) clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(() => void doSave(curId, text), 800);
    };

    const createNote = async () => {
        try {
            const r = await fetch("/api/notes", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ title: "", content: "" }),
            });
            const d = await r.json();
            if (d.success) {
                await load();
                setCurId(d.id);
                setDraft("");
                setMobileEditing(true);
            }
        } catch { /* noop */ }
    };

    // 工具栏：在光标处包裹/插入 Markdown 语法
    const applyMd = (action: string) => {
        const ta = taRef.current;
        if (!ta || !curId) return;
        const { selectionStart: s0, selectionEnd: s1, value } = ta;
        const sel = value.slice(s0, s1);
        let next = value, cs = s0, ce = s1;
        const wrap = (l: string, r = l) => {
            next = value.slice(0, s0) + l + (sel || "文字") + r + value.slice(s1);
            cs = s0 + l.length; ce = cs + (sel || "文字").length;
        };
        const linePrefix = (p: string) => {
            const ls = value.lastIndexOf("\n", s0 - 1) + 1;
            next = value.slice(0, ls) + p + value.slice(ls);
            cs = s0 + p.length; ce = s1 + p.length;
        };
        switch (action) {
            case "bold": wrap("**"); break;
            case "italic": wrap("*"); break;
            case "strike": wrap("~~"); break;
            case "code": sel.includes("\n") ? wrap("\n```\n", "\n```\n") : wrap("`"); break;
            case "h2": linePrefix("## "); break;
            case "h3": linePrefix("### "); break;
            case "ul": linePrefix("- "); break;
            case "ol": linePrefix("1. "); break;
            case "quote": linePrefix("> "); break;
            case "hr": {
                next = value.slice(0, s1) + "\n\n---\n\n" + value.slice(s1);
                cs = ce = s1 + 7;
                break;
            }
            case "link": {
                next = value.slice(0, s0) + `[${sel || "链接文字"}](https://)` + value.slice(s1);
                cs = s0 + (sel || "链接文字").length + 3; ce = cs + 8;
                break;
            }
        }
        onEdit(next);
        requestAnimationFrame(() => { ta.focus(); ta.setSelectionRange(cs, ce); });
    };

    const removeNote = async (id: string) => {
        setNotes((l) => l.filter((n) => n.id !== id));
        if (curId === id) { setCurId(null); setDraft(""); setMobileEditing(false); }
        try { await fetch("/api/notes", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) }); } catch { /* noop */ }
    };

    if (!me.loading && !me.loggedIn) return <LoginGate feature="笔记" />;
    // scope 守卫：boss/admin 或 scope 含 notes/'*' 才可用
    const notesAllowed = me.me == null ? true
        : me.me.role === "boss" || me.me.role === "admin" || me.me.permissions === "*"
        || (me.me.permissions || "").split(",").map((x) => x.trim()).includes("notes");
    if (me.me && !notesAllowed) {
        return (
            <div className="py-24 text-center text-text-3">
                <p className="text-[15px] font-medium text-text-2">笔记功能未对你开放</p>
                <p className="mt-1.5 text-[13px]">找管理员在用户管理里勾选「笔记」即可解锁。</p>
            </div>
        );
    }

    const ql = q.trim().toLowerCase();
    const filtered = ql
        ? notes.filter((n) => n.title.toLowerCase().includes(ql) || n.content.toLowerCase().includes(ql))
        : notes;
    const filteredRefs = ql
        ? bookRefs.filter((b) => b.bookTitle.toLowerCase().includes(ql) || b.preview.toLowerCase().includes(ql))
        : bookRefs;

    // 分组
    const groups: { label: string; items: Note[] }[] = [];
    for (const n of filtered) {
        const g = groupOf(n.updated_at);
        const found = groups.find((x) => x.label === g);
        if (found) found.items.push(n); else groups.push({ label: g, items: [n] });
    }

    return (
        <div className="flex h-[calc(100vh-10rem)] min-h-[480px] w-full overflow-hidden rounded-2xl border border-line bg-bg-card text-text-1">
            {/* ── 左列：列表(备忘录侧栏) ── */}
            <div className={`flex w-full flex-col border-r border-line bg-bg-input/40 md:w-[300px] lg:w-[340px] ${mobileEditing ? "max-md:hidden" : ""}`}>
                <div className="flex items-center justify-between gap-2 px-4 pb-2 pt-4">
                    <h1 className="font-display text-[20px] tracking-tight">{t("笔记")}</h1>
                    <button
                        onClick={() => void createNote()}
                        aria-label="新建笔记"
                        className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full text-primary transition-colors hover:bg-primary/10"
                    >
                        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" d="M12 5v14M5 12h14" /><path strokeLinecap="round" strokeLinejoin="round" d="M16.5 3.5l4 4L9 19l-5 1 1-5L16.5 3.5z" opacity="0" />
                        </svg>
                    </button>
                </div>
                <div className="px-3 pb-2">
                    <div className="relative">
                        <svg className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                            <circle cx="11" cy="11" r="7" /><path strokeLinecap="round" d="M21 21l-4.3-4.3" />
                        </svg>
                        <input
                            value={q}
                            onChange={(e) => setQ(e.target.value)}
                            placeholder={t("搜索")}
                            className="h-8.5 w-full rounded-lg border border-transparent bg-bg-hover/70 pl-9 pr-3 text-[13px] outline-none transition-colors placeholder:text-text-3 focus:border-primary/40 focus:bg-bg-card"
                        />
                    </div>
                </div>

                <div className="scrollbar-hide min-h-0 flex-1 overflow-y-auto px-3 pb-4">
                    {/* 书籍笔记 ref：一本书一条,只读,跳阅读器 */}
                    {filteredRefs.length > 0 && (
                        <div className="mb-1 mt-1">
                            <div className="px-2 pb-1 text-[11px] font-semibold tracking-wide text-text-3">{t("书籍笔记")}</div>
                            {filteredRefs.map((b) => (
                                <a
                                    key={b.bookPath}
                                    href={readerHref(b.bookPath)}
                                    className="block rounded-xl px-3 py-2.5 transition-colors hover:bg-bg-hover"
                                >
                                    <div className="flex items-center gap-1.5">
                                        <svg className="h-3.5 w-3.5 shrink-0 fill-secondary" viewBox="0 0 24 24"><path d="M18 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 4h5v8l-2.5-1.5L6 12V4z" /></svg>
                                        <span className="line-clamp-1 text-[13.5px] font-semibold">{b.bookTitle}</span>
                                    </div>
                                    <div className="mt-0.5 flex items-baseline gap-2 pl-5">
                                        <span className="shrink-0 text-[11px] text-text-3">{b.count} {t("条标注")}</span>
                                        {b.preview && <span className="line-clamp-1 text-[12px] text-text-3">{b.preview}</span>}
                                    </div>
                                </a>
                            ))}
                            <div className="mx-2 my-2 border-t border-line/60" />
                        </div>
                    )}

                    {/* 我的笔记：时间分组 */}
                    {groups.map((g) => (
                        <div key={g.label} className="mb-1">
                            <div className="px-2 pb-1 pt-2 text-[11px] font-semibold tracking-wide text-text-3">{t(g.label)}</div>
                            {g.items.map((n) => (
                                <div key={n.id} className="group/note relative">
                                    <button
                                        onClick={() => open(n)}
                                        className={`block w-full cursor-pointer rounded-xl px-3 py-2.5 text-left transition-colors ${
                                            curId === n.id ? "bg-primary/12" : "hover:bg-bg-hover"
                                        }`}
                                    >
                                        <div className="line-clamp-1 pr-6 text-[13.5px] font-semibold">{n.title || t("新笔记")}</div>
                                        <div className="mt-0.5 flex items-baseline gap-2">
                                            <span className="shrink-0 text-[11px] text-text-3">{relTime(n.updated_at)}</span>
                                            <span className="line-clamp-1 text-[12px] text-text-3">{n.content.replace(/\n+/g, " ").trim() || t("无附加文字")}</span>
                                        </div>
                                    </button>
                                    <button
                                        onClick={() => void removeNote(n.id)}
                                        aria-label="删除"
                                        className="absolute right-2 top-1/2 hidden h-6 w-6 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full text-text-3 hover:bg-bg-hover hover:text-red-500 group-hover/note:flex"
                                    >
                                        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d="M4 7h16M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2m1 0v12a2 2 0 01-2 2H8a2 2 0 01-2-2V7h12z" /></svg>
                                    </button>
                                </div>
                            ))}
                        </div>
                    ))}
                    {filtered.length === 0 && filteredRefs.length === 0 && (
                        <p className="px-2 py-10 text-center text-[12.5px] text-text-3">
                            {ql ? `没有找到「${q.trim()}」` : t("还没有笔记，点右上角 + 写一条")}
                        </p>
                    )}
                </div>
            </div>

            {/* ── 右侧：编辑区 ── */}
            <div className={`flex min-w-0 flex-1 flex-col ${mobileEditing ? "" : "max-md:hidden"}`}>
                {cur ? (
                    <>
                        <div className="flex items-center gap-1 border-b border-line/60 px-3 py-2">
                            <button
                                onClick={() => { flushSave(); setMobileEditing(false); }}
                                className="flex shrink-0 cursor-pointer items-center gap-1 pr-1 text-[13px] text-primary md:hidden"
                            >
                                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
                                {t("笔记")}
                            </button>
                            {/* Markdown 工具栏 */}
                            <div className="scrollbar-hide flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
                                {([
                                    ["bold", "B", "粗体", "font-bold"],
                                    ["italic", "I", "斜体", "italic"],
                                    ["strike", "S", "删除线", "line-through"],
                                    ["h2", "H2", "标题", ""],
                                    ["h3", "H3", "小标题", ""],
                                    ["ul", "•≡", "无序列表", ""],
                                    ["ol", "1.", "有序列表", ""],
                                    ["quote", "❝", "引用", ""],
                                    ["code", "</>", "代码", "font-mono"],
                                    ["link", "🔗", "链接", ""],
                                    ["hr", "—", "分隔线", ""],
                                ] as const).map(([act, label, tip, cls]) => (
                                    <button
                                        key={act}
                                        onClick={() => applyMd(act)}
                                        disabled={preview}
                                        title={tip}
                                        className={`h-7 min-w-7 shrink-0 cursor-pointer rounded-md px-1.5 text-[12px] text-text-2 transition-colors hover:bg-bg-hover hover:text-text-1 disabled:opacity-30 ${cls}`}
                                    >
                                        {label}
                                    </button>
                                ))}
                            </div>
                            <div className="flex shrink-0 items-center gap-2">
                                <button
                                    onClick={() => { flushSave(); setPreview((v) => !v); }}
                                    className={`h-7 cursor-pointer rounded-md px-2.5 text-[12px] transition-colors ${preview ? "bg-primary/12 font-semibold text-primary" : "text-text-2 hover:bg-bg-hover hover:text-text-1"}`}
                                >
                                    {preview ? t("编辑") : t("预览")}
                                </button>
                                <span className="text-[11px] text-text-3">
                                    {saving === "saving" ? t("保存中…") : saving === "saved" ? t("已保存") : relTime(cur.updated_at)}
                                </span>
                            </div>
                        </div>
                        {preview ? (
                            <div
                                className="min-h-0 flex-1 select-text overflow-y-auto px-5 py-4 text-[15px] text-text-1"
                                dangerouslySetInnerHTML={{ __html: previewHtml }}
                            />
                        ) : (
                            <textarea
                                ref={taRef}
                                value={draft}
                                onChange={(e) => onEdit(e.target.value)}
                                onBlur={flushSave}
                                placeholder={"标题\n开始书写…（支持 Markdown）"}
                                className="notes-editor min-h-0 flex-1 resize-none bg-transparent px-5 py-4 text-[15px] leading-relaxed outline-none placeholder:text-text-4"
                                spellCheck={false}
                            />
                        )}
                    </>
                ) : (
                    <div className="flex flex-1 flex-col items-center justify-center gap-3 text-text-3">
                        <svg className="h-12 w-12 opacity-40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 3.5l4 4L9 19l-5 1 1-5L16.5 3.5z" />
                        </svg>
                        <p className="text-[13.5px]">{t("选一条笔记，或点 + 新建")}</p>
                    </div>
                )}
            </div>
        </div>
    );
}
