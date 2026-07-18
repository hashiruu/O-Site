// 全站统一页头：渐变短线眉题 + font-display 大标题 + 灰副标题，右侧操作插槽。
// 纯展示组件（无交互、无 hooks），server/client 页面都能直接用。
export function PageHeader({ title, description, eyebrow, actions, className }: {
    title: React.ReactNode;
    description?: React.ReactNode;
    eyebrow?: React.ReactNode;
    actions?: React.ReactNode;
    className?: string;
}) {
    return (
        <div className={`mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-3 sm:mb-8${className ? ` ${className}` : ""}`}>
            <div className="min-w-0">
                {eyebrow != null && (
                    <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.28em] text-text-3">
                        <span aria-hidden className="h-px w-5 bg-gradient-to-r from-primary to-secondary" />
                        {eyebrow}
                    </div>
                )}
                <h1 className="font-display text-[30px] leading-tight tracking-tight text-text-1 sm:text-[38px]">{title}</h1>
                {description != null && (
                    <p className="mt-2 max-w-2xl text-[13.5px] leading-relaxed text-text-3 sm:text-[14.5px]">{description}</p>
                )}
            </div>
            {actions != null && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
    );
}
