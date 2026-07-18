import Link from "next/link";

// 404：品牌化空态（跟随日夜主题的插画），而非 Next 默认黑白页。
export default function NotFound() {
    return (
        <div className="animate-fadeIn mx-auto flex min-h-[52vh] w-full max-w-md flex-col items-center justify-center gap-6 py-10 text-center">
            {/* 插画：一本翻开却空白的书，像走丢的页面 */}
            <svg viewBox="0 0 240 160" className="w-56 max-w-full" fill="none" aria-hidden="true">
                <ellipse cx="120" cy="142" rx="80" ry="9" className="fill-[var(--color-bg-hover)]" />
                <path d="M120 40c-22-12-46-12-70-4v88c24-8 48-8 70 4 22-12 46-12 70-4V36c-24-8-48-8-70 4z"
                    className="fill-[var(--color-bg-card)] stroke-[var(--color-line)]" strokeWidth="2.5" />
                <path d="M120 40v88" className="stroke-[var(--color-line)]" strokeWidth="2.5" />
                <path d="M62 52c14-4 30-4 44 2M62 70c14-4 30-4 44 2M134 54c14-6 30-6 44-2M134 72c14-6 30-6 44-2"
                    className="stroke-[var(--color-line)]" strokeWidth="2" strokeLinecap="round" />
                <text x="120" y="98" textAnchor="middle" fontSize="34" fontWeight="800" className="fill-[var(--color-primary)]">404</text>
            </svg>
            <div>
                <h1 className="font-display text-[22px] text-text-1">这一页走丢了</h1>
                <p className="mt-2 text-[14px] leading-relaxed text-text-3">
                    你要找的内容不在这里——可能是链接过期、或者被搬去了别处。
                </p>
            </div>
            <div className="flex gap-3">
                <Link href="/" className="rounded-full bg-primary px-5 py-2 text-[14px] font-medium text-white transition-transform hover:scale-105">
                    回首页
                </Link>
                <Link href="/bookshelf" className="rounded-full border border-line px-5 py-2 text-[14px] text-text-2 transition-colors hover:border-primary hover:text-primary">
                    去书架
                </Link>
            </div>
        </div>
    );
}
