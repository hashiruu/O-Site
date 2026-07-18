import fs from "fs";
import path from "path";
import Link from "next/link";
import { marked } from "marked";
import { isPathUnder } from "@/lib/path-guard";
import { ReaderImmersive } from "@/components/ReaderImmersive";

// /reader/md?path=<绝对路径>
// 服务端读 Markdown（白名单校验与 /api/books/file 一致）→ marked 渲染 → 排版容器。
export const dynamic = "force-dynamic";

const ALLOWED_ROOTS = ["/home/steven/mydrive/book", "/home/steven/mydrive/PAPERS"];

function BackBar({ title }: { title: string }) {
    // 沉浸模式下全站顶栏已收起，这条就是页面唯一的导航条，贴顶
    return (
        <div className="sticky top-0 z-10 border-b border-line bg-bg-nav backdrop-blur">
            <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
                <Link
                    href="/bookshelf"
                    className="flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-[13px] text-text-2 transition-colors hover:bg-bg-hover hover:text-text-1"
                >
                    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                    </svg>
                    返回书架
                </Link>
                <span className="min-w-0 truncate text-[14px] font-medium text-text-1">{title}</span>
            </div>
        </div>
    );
}

export default async function MdReaderPage({
    searchParams,
}: {
    searchParams: Promise<{ path?: string }>;
}) {
    const { path: raw } = await searchParams;

    let error: string | null = null;
    let html = "";
    let title = "Markdown";

    if (!raw) {
        error = "缺少 path 参数";
    } else {
        const resolved = path.resolve(raw);
        if (!ALLOWED_ROOTS.some((root) => isPathUnder(resolved, root))) {
            error = "无权访问此路径";
        } else if (path.extname(resolved).toLowerCase() !== ".md" || path.basename(resolved).startsWith(".")) {
            error = "仅支持 .md 文件";
        } else {
            try {
                const source = fs.readFileSync(resolved, "utf-8");
                html = await marked.parse(source);
                title = path.basename(resolved, ".md");
            } catch {
                error = "文件不存在或无法读取";
            }
        }
    }

    return (
        <div className="min-h-screen bg-bg text-text-1">
            <ReaderImmersive />
            <BackBar title={title} />
            {/* Markdown 排版：token 化配色 + 代码块深底（浅色主题下也用深底，代码可读性优先） */}
            <style>{`
                .md-body { line-height: 1.75; font-size: 16px; color: var(--color-text-1); }
                .md-body h1, .md-body h2, .md-body h3, .md-body h4 { font-weight: 700; margin: 1.6em 0 0.6em; line-height: 1.3; }
                .md-body h1 { font-size: 1.9em; } .md-body h2 { font-size: 1.5em; border-bottom: 1px solid var(--color-line); padding-bottom: .3em; }
                .md-body h3 { font-size: 1.2em; } .md-body p { margin: 0.9em 0; }
                .md-body a { color: var(--color-primary); text-decoration: none; }
                .md-body a:hover { text-decoration: underline; }
                .md-body ul, .md-body ol { padding-left: 1.6em; margin: 0.9em 0; }
                .md-body li { margin: 0.3em 0; }
                .md-body blockquote { border-left: 3px solid var(--color-primary); margin: 1em 0; padding: 0.2em 1em; color: var(--color-text-2); background: var(--color-bg-input); border-radius: 0 8px 8px 0; }
                .md-body code { background: var(--color-bg-input); padding: 0.15em 0.4em; border-radius: 4px; font-size: 0.9em; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
                .md-body pre { background: #0D1117; color: #C9D1D9; padding: 1em 1.2em; border-radius: 10px; overflow-x: auto; margin: 1.1em 0; border: 1px solid #30363D; }
                .md-body pre code { background: transparent; padding: 0; color: inherit; font-size: 13px; line-height: 1.6; }
                .md-body table { border-collapse: collapse; margin: 1.1em 0; width: 100%; font-size: 0.92em; }
                .md-body th, .md-body td { border: 1px solid var(--color-line); padding: 0.5em 0.8em; text-align: left; }
                .md-body th { background: var(--color-bg-input); }
                .md-body img { max-width: 100%; border-radius: 8px; }
                .md-body hr { border: none; border-top: 1px solid var(--color-line); margin: 2em 0; }
            `}</style>
            <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
                {error ? (
                    <div className="rounded-xl border border-line bg-bg-card px-4 py-10 text-center text-[14px] text-text-2">
                        {error}
                    </div>
                ) : (
                    <article className="md-body" dangerouslySetInnerHTML={{ __html: html }} />
                )}
            </div>
        </div>
    );
}
