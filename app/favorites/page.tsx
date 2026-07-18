"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMe } from "@/components/useMe";
import { LoginGate } from "@/components/LoginGate";
import { PageHeader } from "../../components/PageHeader";
import { useLang } from "@/lib/i18n";

// 提取与首页完全一致的媒体卡片接口
interface MediaItem {
    id: string;
    title: string;
    path: string;
    type: string;
}

function PlayIcon() { return <svg className="w-[12px] h-[12px]" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>; }

export default function FavoritesPage() {
    const { t } = useLang();
    const router = useRouter();
    const me = useMe();
    const [favorites, setFavorites] = useState<{ path: string, title: string, addedAt?: string }[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        // 从服务端共享列表读取收藏序列
        const loadFavorites = async () => {
            try {
                const res = await fetch('/api/favorites');
                const data = await res.json();
                if (data.success && Array.isArray(data.data)) {
                    // 最新添加的排在前头
                    setFavorites([...data.data].reverse());
                }
            } catch (e) {
                console.error("读取收藏夹错误", e);
            } finally {
                setLoading(false);
            }
        };

        loadFavorites();
    }, []);

    const handlePlay = (filePath: string) => {
        router.push(`/watch?filePath=${encodeURIComponent(filePath)}`);
    };

    const handleRemove = async (e: React.MouseEvent, path: string) => {
        e.stopPropagation();
        try {
            const res = await fetch('/api/favorites', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'remove', filePath: path })
            });
            const data = await res.json();
            if (data.success) {
                const updated = favorites.filter(f => f.path !== path);
                setFavorites(updated);
            }
        } catch (err) {
            console.error('移除收藏失败', err);
        }
    };

    // 铁律：未登录不提供个人化功能（后端同样 401，这里是入口挡板）
    if (!me.loggedIn) return me.loading ? null : <LoginGate feature="我的收藏" />;

    return (
        <div className="w-full text-text-1 pb-20">
            <PageHeader
                title={t("我的收藏")}
                description={`共 ${favorites.length} 项 · 在播放页标记的影片与剧集都会汇集于此。`}
            />
            <div className="w-full">

                {loading ? (
                    <div className="text-center py-20 text-text-3">正在拉取记忆数据...</div>
                ) : favorites.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-24 bg-bg-nav rounded-2xl border border-line border-dashed">
                        <svg className="w-20 h-20 text-text-4 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}><path d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 002-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>
                        <p className="text-text-2 mb-2 font-medium">这里空空如也，连一根毛都没有</p>
                        <button onClick={() => router.push('/')} className="mt-4 px-6 py-2 bg-bili-pink text-white rounded-lg hover:bg-bili-pink/90 transition-colors text-sm font-medium">去发现好视频</button>
                    </div>
                ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-x-4 gap-y-6 sm:gap-x-5 sm:gap-y-8">
                        {favorites.map((item) => (
                            <div key={item.path} onClick={() => handlePlay(item.path)} className="group cursor-pointer flex flex-col relative">
                                <div className="relative w-full aspect-video rounded-md overflow-hidden bg-bg-input">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img
                                        src={`/api/media/thumbnail?filePath=${encodeURIComponent(item.path)}`}
                                        alt={item.title}
                                        className="w-full h-full object-cover relative z-10 transition-transform duration-300 group-hover:brightness-105"
                                        loading="lazy"
                                        onError={(e) => { (e.target as HTMLImageElement).src = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjM2YzZjQ2IiBzdHJva2Utd2lkdGg9IjIiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCI+PHJlY3QgeD0iMyIgeT0iMyIgd2lkdGg9IjE4IiBoZWlnaHQ9IjE4IiByeD0iMiIgcnk9IjIiPjwvcmVjdD48Y2lyY2xlIGN4PSI4LjUiIGN5PSI4LjUiIHI9IjEuNSI+PC9jaXJjbGU+PHBvbHlsaW5lIHBvaW50cz0iMjEgMTUgMTYgMTAgNSAyMSI+PC9wb2x5bGluZT48L3N2Zz4='; }}
                                    />
                                    <div className="absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-black/60 to-transparent z-20 pointer-events-none" />
                                    <div className="absolute bottom-1.5 left-2 flex items-center text-white text-[12px] opacity-90 z-20">
                                        <PlayIcon />
                                    </div>

                                    {/* Unstar Hover Button */}
                                    <div
                                        onClick={(e) => handleRemove(e, item.path)}
                                        className="absolute top-2 right-2 bg-black/50 hover:bg-red-500/80 p-1.5 rounded-full z-30 opacity-0 group-hover:opacity-100 transition-all backdrop-blur-sm"
                                        title="取消收藏"
                                    >
                                        <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                                    </div>
                                </div>
                                <div className="mt-2.5 px-1">
                                    <h3 className="text-[14px] sm:text-[15px] font-medium text-text-1 line-clamp-2 leading-snug group-hover:text-primary transition-colors">{item.title}</h3>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
