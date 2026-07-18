"use client";

// /admin/users — boss 用户管理后台。
// 列出所有用户 + 行为统计；点用户展开四类行为（观看/收藏/搜索/登录）；可改角色 + 播放授权。
import { useCallback, useEffect, useState } from "react";

type UserRow = {
    email: string; role: string; name: string | null; avatar: string | null;
    created_at: string; last_seen: string;
    watchCount: number; favCount: number; searchCount: number; lastLoginAt: string | null;
};
type Stats = { total: number; admins: number; regulars: number; banned: number };

// 内容范围可选类别（与 /api/admin/permissions 的 validTypes 一致）。
// 私密保险箱/旅行相册/剧场相册/日常 是 boss 专属，不可授权，故不出现在这里。
const SCOPE_OPTIONS: { key: string; label: string }[] = [
    { key: "movie", label: "电影" },
    { key: "series", label: "剧集" },
    { key: "anime", label: "动漫" },
    { key: "book", label: "书架" },
    { key: "live", label: "直播" },
    { key: "sports", label: "体育" },
    { key: "missed", label: "Missed 热点" },
    { key: "musical", label: "音乐剧" },
    { key: "notes", label: "笔记" },
];

const ROLE_LABEL: Record<string, string> = { boss: "boss", admin: "管理员", regular: "普通用户", banned: "已封禁" };
const ROLE_BADGE: Record<string, string> = {
    boss: "bg-primary text-white",
    admin: "bg-primary/15 text-primary",
    regular: "bg-bg-tag text-text-2",
    banned: "bg-bili-pink/15 text-bili-pink line-through",
};

export default function AdminUsersPage() {
    const [users, setUsers] = useState<UserRow[]>([]);
    const [stats, setStats] = useState<Stats | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [selected, setSelected] = useState<string | null>(null);

    const load = useCallback(() => {
        setLoading(true);
        fetch("/api/admin/users")
            .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
            .then((d) => { setUsers(d.data || []); setStats(d.stats || null); setError(null); })
            .catch((e) => setError(e === 403 ? "仅 boss 可访问此页面" : "加载失败"))
            .finally(() => setLoading(false));
    }, []);

    useEffect(() => { load(); }, [load]);

    const changeRole = async (email: string, role: string) => {
        const res = await fetch("/api/admin/users", {
            method: "PATCH", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, role }),
        });
        if (res.ok) load();
        else { const d = await res.json().catch(() => ({})); alert(d.error || "操作失败"); }
    };

    const setPermission = async (email: string, scope: string): Promise<boolean> => {
        const res = await fetch("/api/admin/permissions", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, scope }),
        });
        if (res.ok) return true;
        const d = await res.json().catch(() => ({} as any));
        alert(d.error || "操作失败");
        return false;
    };

    if (loading) return <div className="text-text-3 text-sm">加载用户列表...</div>;
    if (error) return <div className="text-bili-pink text-sm">{error}</div>;

    return (
        <div className="w-full max-w-[1280px] py-2">
            {/* 页头：与 /admin Dashboard 同款骨架 */}
            <div className="pb-6 flex flex-wrap items-end justify-between gap-4">
                <div>
                    <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.28em] text-text-3">
                        <span aria-hidden className="h-px w-5 bg-gradient-to-r from-primary to-secondary" />
                        Backstage · Users
                    </div>
                    <h1 className="font-display text-[30px] leading-tight tracking-tight text-text-1 sm:text-[38px]">用户管理</h1>
                </div>
                <a
                    href="/admin"
                    className="px-4 py-1.5 rounded-full border border-line text-text-3 text-xs font-medium whitespace-nowrap hover:bg-bg-hover hover:text-text-1 transition-all cursor-pointer"
                >
                    ← 返回后台
                </a>
            </div>

            {/* 指标行 */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                {([
                    { label: "总用户", value: stats?.total },
                    { label: "管理员", value: stats?.admins },
                    { label: "普通用户", value: stats?.regulars },
                    { label: "已封禁", value: stats?.banned, accent: (stats?.banned ?? 0) > 0 },
                ] as { label: string; value: number | undefined; accent?: boolean }[]).map((t) => (
                    <div key={t.label} className="rounded-xl bg-bg-card border border-line px-4 py-3.5 transition-colors" style={{ boxShadow: '0 1px 4px var(--color-shadow-card)' }}>
                        <div className="text-[11px] tracking-[0.2em] uppercase text-text-3">{t.label}</div>
                        <div className={`mt-1.5 font-display text-[26px] leading-none tabular-nums ${t.accent ? "text-bili-pink" : "text-text-1"}`}>
                            {t.value === undefined ? "—" : t.value}
                        </div>
                    </div>
                ))}
            </div>

            <div className="overflow-hidden rounded-xl border border-line bg-bg-nav">
                <table className="w-full text-[13px]">
                    <thead className="border-b border-line text-text-3 text-[11px] uppercase tracking-wider">
                        <tr>
                            <th className="px-4 py-2.5 text-left font-medium">用户</th>
                            <th className="px-3 py-2.5 text-left font-medium">角色</th>
                            <th className="px-3 py-2.5 text-center font-medium">观看</th>
                            <th className="px-3 py-2.5 text-center font-medium">收藏</th>
                            <th className="px-3 py-2.5 text-center font-medium">搜索</th>
                            <th className="px-3 py-2.5 text-left font-medium">最近登录</th>
                            <th className="px-3 py-2.5 text-right font-medium">操作</th>
                        </tr>
                    </thead>
                    <tbody>
                        {users.map((u) => (
                            <UserRowItem key={u.email} u={u}
                                expanded={selected === u.email}
                                onToggle={() => setSelected(selected === u.email ? null : u.email)}
                                onChangeRole={changeRole} onSetPermission={setPermission}
                            />
                        ))}
                    </tbody>
                </table>
                {users.length === 0 && <div className="py-10 text-center text-text-3 text-sm">暂无登录用户</div>}
            </div>
        </div>
    );
}

function UserRowItem({ u, expanded, onToggle, onChangeRole, onSetPermission }: {
    u: UserRow; expanded: boolean; onToggle: () => void;
    onChangeRole: (email: string, role: string) => void;
    onSetPermission: (email: string, scope: string) => Promise<boolean>;
}) {
    const [tab, setTab] = useState<"watch" | "favorites" | "search" | "logins">("watch");
    const [activity, setActivity] = useState<any[] | null>(null);
    const [actLoading, setActLoading] = useState(false);
    const [scopeOpen, setScopeOpen] = useState(false);

    useEffect(() => {
        if (!expanded) { setActivity(null); return; }
        setActLoading(true);
        fetch(`/api/admin/activity?email=${encodeURIComponent(u.email)}&type=${tab}&limit=30`)
            .then((r) => r.json())
            .then((d) => setActivity(d.data || []))
            .catch(() => setActivity([]))
            .finally(() => setActLoading(false));
    }, [expanded, tab, u.email]);

    return (
        <>
            <tr className="border-b border-line/40 hover:bg-bg-hover transition-colors">
                <td className="px-4 py-2.5">
                    <button onClick={onToggle} className="flex items-center gap-2.5 text-left cursor-pointer">
                        {u.avatar ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={u.avatar} alt="" referrerPolicy="no-referrer" className="h-7 w-7 rounded-full" />
                        ) : (
                            <div className="h-7 w-7 rounded-full bg-bg-tag text-text-2 flex items-center justify-center text-xs font-bold">
                                {(u.name || u.email)[0].toUpperCase()}
                            </div>
                        )}
                        <div className="min-w-0">
                            <div className="text-text-1 truncate max-w-[160px]">{u.name || u.email.split("@")[0]}</div>
                            <div className="text-text-3 text-[11px] truncate max-w-[160px]">{u.email}</div>
                        </div>
                        <svg className={`h-3 w-3 text-text-3 transition-transform ${expanded ? "rotate-90" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
                    </button>
                </td>
                <td className="px-3 py-2.5">
                    <span className={`text-[11px] font-semibold rounded px-1.5 py-0.5 ${ROLE_BADGE[u.role] || ""}`}>{ROLE_LABEL[u.role] || u.role}</span>
                </td>
                <td className="px-3 py-2.5 text-center tabular-nums text-text-2">{u.watchCount}</td>
                <td className="px-3 py-2.5 text-center tabular-nums text-text-2">{u.favCount}</td>
                <td className="px-3 py-2.5 text-center tabular-nums text-text-2">{u.searchCount}</td>
                <td className="px-3 py-2.5 text-text-3 text-[12px]">{u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—"}</td>
                <td className="px-3 py-2.5 text-right">
                    {u.role !== "boss" && (
                        <div className="flex justify-end gap-1">
                            {u.role !== "admin" && (
                                <button onClick={() => onChangeRole(u.email, "admin")} className="text-[11px] px-2 py-1 rounded border border-primary/40 text-primary hover:bg-primary/10 transition-colors cursor-pointer">升管理员</button>
                            )}
                            {u.role === "admin" && (
                                <button onClick={() => onChangeRole(u.email, "regular")} className="text-[11px] px-2 py-1 rounded border border-line text-text-3 hover:bg-bg-hover transition-colors cursor-pointer">降级</button>
                            )}
                            <button onClick={() => setScopeOpen((o) => !o)}
                                className={`text-[11px] px-2 py-1 rounded border transition-colors cursor-pointer ${scopeOpen ? "border-primary text-primary bg-primary/10" : "border-line text-text-3 hover:bg-bg-hover"}`}>内容范围</button>
                            {u.role !== "banned" ? (
                                <button onClick={() => onChangeRole(u.email, "banned")} className="text-[11px] px-2 py-1 rounded border border-bili-pink/40 text-bili-pink hover:bg-bili-pink/10 transition-colors cursor-pointer">封禁</button>
                            ) : (
                                <button onClick={() => onChangeRole(u.email, "regular")} className="text-[11px] px-2 py-1 rounded border border-line text-text-3 hover:bg-bg-hover transition-colors cursor-pointer">解封</button>
                            )}
                        </div>
                    )}
                </td>
            </tr>
            {scopeOpen && (
                <tr className="bg-bg">
                    <td colSpan={7} className="px-4 py-3">
                        <ScopeEditor email={u.email}
                            onSave={async (scope) => { if (await onSetPermission(u.email, scope)) setScopeOpen(false); }}
                            onCancel={() => setScopeOpen(false)}
                        />
                    </td>
                </tr>
            )}
            {expanded && (
                <tr className="bg-bg">
                    <td colSpan={7} className="px-4 py-3">
                        <div className="flex gap-1 mb-3 border-b border-line">
                            {(["watch", "favorites", "search", "logins"] as const).map((t) => (
                                <button key={t} onClick={() => setTab(t)}
                                    className={`px-3 py-1.5 text-[12px] border-b-2 -mb-px transition-colors cursor-pointer ${tab === t ? "border-primary text-primary" : "border-transparent text-text-3 hover:text-text-1"}`}>
                                    {{ watch: "观看记录", favorites: "收藏", search: "搜索", logins: "登录" }[t]}
                                </button>
                            ))}
                        </div>
                        {actLoading ? <div className="text-text-3 text-xs">加载中...</div> :
                         activity && activity.length === 0 ? <div className="text-text-3 text-xs">无记录</div> :
                         <ActivityList tab={tab} items={activity || []} />}
                    </td>
                </tr>
            )}
        </>
    );
}

// 内容范围编辑面板：勾选类别 chips + 全部开放 + 撤销授权。
// 打开时拉当前 scope 回显；保存把选中集合 POST 给 /api/admin/permissions。
function ScopeEditor({ email, onSave, onCancel }: {
    email: string;
    onSave: (scope: string) => Promise<void>;
    onCancel: () => void;
}) {
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [all, setAll] = useState(false);
    const [sel, setSel] = useState<Set<string>>(new Set());

    useEffect(() => {
        setLoading(true);
        fetch(`/api/admin/permissions?email=${encodeURIComponent(email)}`)
            .then((r) => r.json())
            .then((d) => {
                const scope: string | null = d?.data?.scope ?? null;
                if (scope?.trim() === "*") { setAll(true); setSel(new Set()); }
                else if (scope) { setAll(false); setSel(new Set(scope.split(",").map((s) => s.trim()).filter(Boolean))); }
                else { setAll(false); setSel(new Set()); }
            })
            .catch(() => { /* 读不到就当空白 */ })
            .finally(() => setLoading(false));
    }, [email]);

    const toggle = (k: string) => {
        setAll(false);
        setSel((prev) => {
            const next = new Set(prev);
            if (next.has(k)) next.delete(k); else next.add(k);
            return next;
        });
    };

    const submit = async (scope: string) => {
        setSaving(true);
        try { await onSave(scope); } finally { setSaving(false); }
    };

    if (loading) return <div className="text-text-3 text-xs">读取当前授权...</div>;

    const currentLabel = all ? "全部开放" : sel.size === 0 ? "无授权（空白网站）"
        : SCOPE_OPTIONS.filter((o) => sel.has(o.key)).map((o) => o.label).join("、");

    return (
        <div>
            <div className="mb-2 flex items-baseline gap-2">
                <span className="text-[12px] font-semibold text-text-1">内容范围</span>
                <span className="text-[11px] text-text-3">决定该用户能看到哪些栏目 · 当前：{currentLabel}</span>
            </div>
            <div className="flex flex-wrap gap-1.5 mb-3">
                <button onClick={() => { setAll((a) => !a); setSel(new Set()); }}
                    className={`text-[12px] px-2.5 py-1 rounded-full border transition-colors cursor-pointer ${all ? "border-primary bg-primary text-white" : "border-line text-text-2 hover:bg-bg-hover"}`}>
                    全部开放 *
                </button>
                <span className="w-px self-stretch bg-line mx-1" />
                {SCOPE_OPTIONS.map((o) => {
                    const active = all || sel.has(o.key);
                    return (
                        <button key={o.key} onClick={() => toggle(o.key)} disabled={all}
                            className={`text-[12px] px-2.5 py-1 rounded-full border transition-colors cursor-pointer disabled:cursor-default ${active ? "border-primary/60 bg-primary/12 text-primary" : "border-line text-text-2 hover:bg-bg-hover"} ${all ? "opacity-60" : ""}`}>
                            {o.label}
                        </button>
                    );
                })}
            </div>
            <div className="flex items-center gap-2">
                <button disabled={saving} onClick={() => submit(all ? "*" : [...sel].join(","))}
                    className="text-[12px] px-3 py-1.5 rounded bg-primary text-white hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-50">
                    {saving ? "保存中..." : "保存"}
                </button>
                <button disabled={saving} onClick={() => submit("")}
                    className="text-[12px] px-3 py-1.5 rounded border border-bili-pink/40 text-bili-pink hover:bg-bili-pink/10 transition-colors cursor-pointer disabled:opacity-50">
                    撤销授权
                </button>
                <button disabled={saving} onClick={onCancel}
                    className="text-[12px] px-3 py-1.5 rounded border border-line text-text-3 hover:bg-bg-hover transition-colors cursor-pointer disabled:opacity-50">
                    取消
                </button>
                <span className="text-[11px] text-text-4 ml-1">撤销后该用户回到空白网站；admin/boss 不受范围限制</span>
            </div>
        </div>
    );
}

function ActivityList({ tab, items }: { tab: string; items: any[] }) {
    if (tab === "watch") return (
        <ul className="space-y-1 max-h-72 overflow-y-auto custom-scrollbar">
            {items.map((w, i) => (
                <li key={i} className="flex items-center gap-2 text-[12px] py-1">
                    <span className="text-text-1 truncate flex-1">{w.title}{w.episode_title ? ` · ${w.episode_title}` : ""}</span>
                    <span className="text-text-3 shrink-0">{w.completed ? "已看完" : w.duration > 0 ? `${Math.round(w.position / w.duration * 100)}%` : ""}</span>
                    <span className="text-text-4 text-[11px] shrink-0">{new Date(w.last_watched).toLocaleDateString("zh-CN")}</span>
                </li>
            ))}
        </ul>
    );
    if (tab === "favorites") return (
        <ul className="space-y-1 max-h-72 overflow-y-auto custom-scrollbar">
            {items.map((f, i) => (
                <li key={i} className="text-[12px] text-text-1 truncate py-1">{f.title}</li>
            ))}
        </ul>
    );
    if (tab === "search") return (
        <ul className="space-y-1 max-h-72 overflow-y-auto custom-scrollbar">
            {items.map((s, i) => (
                <li key={i} className="flex items-center gap-2 text-[12px] py-1">
                    <span className="text-text-1">{s.query}</span>
                    <span className="text-text-4 text-[11px] ml-auto">{new Date(s.at).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
                </li>
            ))}
        </ul>
    );
    // logins
    return (
        <ul className="space-y-1 max-h-72 overflow-y-auto custom-scrollbar">
            {items.map((l, i) => (
                <li key={i} className="flex items-center gap-3 text-[12px] py-1">
                    <span className="text-text-2 tabular-nums">{l.ip || "—"}</span>
                    <span className="text-text-3 truncate flex-1">{l.ua || ""}</span>
                    <span className="text-text-4 text-[11px] shrink-0">{new Date(l.at).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
                </li>
            ))}
        </ul>
    );
}
