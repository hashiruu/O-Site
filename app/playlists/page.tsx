"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useMe } from "@/components/useMe";
import { LoginGate } from "@/components/LoginGate";
import { PageHeader } from "../../components/PageHeader";

interface PlaylistItem {
    path: string;
    title: string;
    sort_order: number;
    added_at: string;
}

interface Playlist {
    id: string;
    name: string;
    created_at: string;
    itemCount: number;
    firstItemPath: string | null;
    items?: PlaylistItem[];
}

export default function PlaylistsPage() {
    const router = useRouter();
    const me = useMe();
    const [playlists, setPlaylists] = useState<Playlist[]>([]);
    const [loading, setLoading] = useState(true);
    const [creating, setCreating] = useState(false);
    const [newName, setNewName] = useState("");
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [expandedItems, setExpandedItems] = useState<PlaylistItem[]>([]);

    // AbortController：手动 load()（创建/删除/移除后触发）与初始加载共用，abort 前一个，防旧响应覆盖（报告 #13）
    const fetchAcRef = useRef<AbortController | null>(null);
    const load = useCallback(() => {
        setLoading(true);
        fetchAcRef.current?.abort();
        const ac = new AbortController();
        fetchAcRef.current = ac;
        fetch("/api/playlists", { signal: ac.signal })
            .then(r => r.json())
            .then(d => { if (!ac.signal.aborted && d.success) setPlaylists(d.data); })
            .catch(err => { if ((err as Error).name !== 'AbortError') console.error(err); })
            .finally(() => { if (!ac.signal.aborted) setLoading(false); });
    }, []);

    useEffect(() => { load(); }, [load]);

    const handleCreate = async () => {
        const name = newName.trim();
        if (!name) return;
        const res = await fetch("/api/playlists", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "create", name }),
        });
        const data = await res.json();
        if (data.success) {
            setNewName("");
            setCreating(false);
            load();
        }
    };

    const handleDelete = async (id: string) => {
        if (!confirm("确定删除这个播放列表？")) return;
        await fetch("/api/playlists", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "delete", id }),
        });
        if (expandedId === id) setExpandedId(null);
        load();
    };

    const toggleExpand = async (id: string) => {
        if (expandedId === id) { setExpandedId(null); return; }
        const res = await fetch(`/api/playlists?id=${id}`);
        const data = await res.json();
        if (data.success) {
            setExpandedItems(data.data.items || []);
            setExpandedId(id);
        }
    };

    const handleRemoveItem = async (playlistId: string, filePath: string) => {
        await fetch("/api/playlists", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "remove", id: playlistId, filePath }),
        });
        setExpandedItems(items => items.filter(i => i.path !== filePath));
        load();
    };

    // 铁律：未登录不提供个人化功能（后端同样 401，这里是入口挡板）
    if (!me.loggedIn) return me.loading ? null : <LoginGate feature="播放列表" />;

    return (
        <div className="w-full pb-10">
            <PageHeader
                title="播放列表"
                description="把想连着看的视频放进同一个队列。"
                actions={!creating ? (
                    <button
                        onClick={() => setCreating(true)}
                        className="px-5 py-2.5 rounded-full bg-primary text-white text-sm font-medium hover:opacity-90 transition-opacity cursor-pointer"
                    >
                        + 新建列表
                    </button>
                ) : (
                    <div className="flex items-center gap-2">
                        <input
                            autoFocus
                            value={newName}
                            onChange={e => setNewName(e.target.value)}
                            onKeyDown={e => { if (e.key === "Enter") handleCreate(); if (e.key === "Escape") setCreating(false); }}
                            placeholder="列表名称"
                            className="px-4 py-2.5 rounded-full bg-bg-tag/60 border border-line/50 outline-none text-sm text-text-1 focus:border-primary/60 transition-colors w-48"
                        />
                        <button onClick={handleCreate} className="px-4 py-2.5 rounded-full bg-primary text-white text-sm cursor-pointer hover:opacity-90">创建</button>
                        <button onClick={() => { setCreating(false); setNewName(""); }} className="px-4 py-2.5 rounded-full bg-bg-tag/60 text-text-2 text-sm cursor-pointer hover:bg-bg-hover">取消</button>
                    </div>
                )}
            />

            {loading ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {[...Array(3)].map((_, i) => (
                        <div key={i} className="h-28 rounded-xl bg-bg-tag/40 animate-pulse" />
                    ))}
                </div>
            ) : playlists.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-text-3">
                    <svg className="w-16 h-16 mb-4 opacity-20" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 0 1 0 3.75H5.625a1.875 1.875 0 0 1 0-3.75Z" />
                    </svg>
                    <p className="text-lg font-medium">还没有播放列表</p>
                    <p className="text-sm mt-1 opacity-60">点右上角「新建列表」，或在播放页把视频加入列表</p>
                </div>
            ) : (
                <div className="space-y-4">
                    {playlists.map(pl => (
                        <div key={pl.id} className="rounded-xl border border-line/50 bg-bg-card/60 overflow-hidden transition-shadow hover:shadow-lg">
                            <div
                                className="flex items-center gap-4 p-4 cursor-pointer select-none"
                                onClick={() => toggleExpand(pl.id)}
                            >
                                <div className="w-20 h-12 rounded-lg bg-bg-tag/60 overflow-hidden shrink-0 flex items-center justify-center">
                                    {pl.firstItemPath ? (
                                        // eslint-disable-next-line @next/next/no-img-element
                                        <img
                                            src={`/api/media/thumbnail?filePath=${encodeURIComponent(pl.firstItemPath)}`}
                                            alt=""
                                            className="w-full h-full object-cover"
                                            loading="lazy"
                                        />
                                    ) : (
                                        <svg className="w-6 h-6 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 12h16.5m-16.5 3.75h16.5" />
                                        </svg>
                                    )}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="font-semibold text-text-1 truncate">{pl.name}</div>
                                    <div className="text-xs text-text-3 mt-0.5">{pl.itemCount} 个视频</div>
                                </div>
                                <button
                                    onClick={e => { e.stopPropagation(); handleDelete(pl.id); }}
                                    className="px-3 py-1.5 rounded-lg text-xs text-text-3 hover:text-red-400 hover:bg-red-400/10 transition-colors cursor-pointer"
                                >
                                    删除
                                </button>
                                <svg
                                    className={`w-4 h-4 text-text-3 transition-transform ${expandedId === pl.id ? "rotate-180" : ""}`}
                                    fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}
                                >
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                                </svg>
                            </div>

                            {expandedId === pl.id && (
                                <div className="border-t border-line/40">
                                    {expandedItems.length === 0 ? (
                                        <div className="p-6 text-center text-sm text-text-3">列表是空的，去播放页把视频加进来吧</div>
                                    ) : (
                                        expandedItems.map((item, idx) => (
                                            <div
                                                key={item.path}
                                                className="flex items-center gap-3 px-4 py-2.5 hover:bg-bg-hover/50 cursor-pointer group transition-colors"
                                                onClick={() => router.push(`/watch?filePath=${encodeURIComponent(item.path)}`)}
                                            >
                                                <span className="text-xs text-text-3 w-6 text-right shrink-0">{idx + 1}</span>
                                                <span className="flex-1 text-sm text-text-2 truncate group-hover:text-primary transition-colors">{item.title}</span>
                                                <button
                                                    onClick={e => { e.stopPropagation(); handleRemoveItem(pl.id, item.path); }}
                                                    className="opacity-0 group-hover:opacity-100 px-2 py-1 rounded text-xs text-text-3 hover:text-red-400 transition-all cursor-pointer"
                                                >
                                                    移除
                                                </button>
                                            </div>
                                        ))
                                    )}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
