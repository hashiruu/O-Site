"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { PageHeader } from "../../components/PageHeader";

function FolderIcon() {
    return (
        <svg className="w-10 h-10 text-bili-pink mb-2" viewBox="0 0 24 24" fill="currentColor">
            <path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
        </svg>
    );
}

function VideoFileIcon() {
    return (
        <svg className="w-10 h-10 text-blue-400 mb-2" viewBox="0 0 24 24" fill="currentColor">
            <path d="M18 4l2 4h-3l-2-4h-2l2 4h-3l-2-4H8l2 4H7L5 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V4h-4z" />
        </svg>
    );
}

function GenericFileIcon() {
    return (
        <svg className="w-10 h-10 text-gray-400 mb-2" viewBox="0 0 24 24" fill="currentColor">
            <path d="M6 2c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6H6zm7 7V3.5L18.5 9H13z" />
        </svg>
    );
}

function BackIcon() {
    return (
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
            <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" />
        </svg>
    );
}

interface FileItem {
    name: string;
    path: string;
    isDirectory: boolean;
    size: number;
    modifiedAt: string;
    type: "video" | "audio" | "subtitle" | "image" | "other" | "directory";
}

function formatSize(bytes: number): string {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

function BrowseContent() {
    const searchParams = useSearchParams();
    const router = useRouter();
    const currentPath = searchParams.get("path") || "/";

    const [items, setItems] = useState<FileItem[]>([]);
    const [parent, setParent] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const fetchFiles = async () => {
            setLoading(true);
            setError(null);
            try {
                const res = await fetch(`/api/files?path=${encodeURIComponent(currentPath)}`);
                const data = await res.json();
                if (data.success) {
                    setItems(data.data.items || []);
                    setParent(data.data.parent);
                } else {
                    setError(data.error || "获取文件列表失败");
                }
            } catch (err) {
                setError("网络错误");
            } finally {
                setLoading(false);
            }
        };
        fetchFiles();
    }, [currentPath]);

    const handleItemClick = (item: FileItem) => {
        if (item.isDirectory) {
            router.push(`/browse?path=${encodeURIComponent(item.path)}`);
        } else if (item.type === "video") {
            router.push(`/watch?filePath=${encodeURIComponent(item.path)}`);
        } else {
            alert(`目前暂不支持直接预览 ${item.type} 格式文件。`);
        }
    };

    return (
        <div className="w-full h-full text-text-1">
            <div className="max-w-[1920px] mx-auto px-4 sm:px-6 lg:px-10 py-6">

                {/* 顶部导航与路径 */}
                <div className="flex items-center gap-4 mb-8">
                    {parent && (
                        <button
                            onClick={() => router.push(`/browse?path=${encodeURIComponent(parent)}`)}
                            className="flex items-center justify-center w-10 h-10 rounded-md bg-bg-tag hover:bg-bg-hover text-text-2 transition-colors cursor-pointer shrink-0"
                            title="返回上一级"
                        >
                            <BackIcon />
                        </button>
                    )}
                    <div>
                        <h1 className="font-display text-[30px] leading-tight tracking-tight text-text-1 sm:text-[38px]">
                            文件浏览
                        </h1>
                        <p className="text-[13px] text-text-3 mt-1 truncate max-w-2xl">
                            当前位置: {currentPath === "/" ? "根目录 (全部磁盘)" : currentPath}
                        </p>
                    </div>
                </div>

                {/* 错误提示 */}
                {error && (
                    <div className="bg-red-500/10 border border-red-500/20 text-red-500 px-4 py-3 rounded-lg flex items-center gap-2">
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <span>{error}</span>
                    </div>
                )}

                {/* 加载状态 */}
                {loading && !error && (
                    <div className="flex flex-col items-center justify-center py-20 text-text-3">
                        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-bili-pink mb-4"></div>
                        <p>加载中...</p>
                    </div>
                )}

                {/* 文件网格 */}
                {!loading && !error && items.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-20 text-text-3">
                        <FolderIcon />
                        <p className="mt-2 text-[15px]">此目录为空</p>
                    </div>
                )}

                {!loading && !error && items.length > 0 && (
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-x-4 gap-y-6 sm:gap-x-5 sm:gap-y-8">
                        {items.map((item) => (
                            <div
                                key={item.path}
                                onClick={() => handleItemClick(item)}
                                className="group cursor-pointer flex flex-col"
                            >
                                {/* B站风格的卡片封面占位 (16:9比例) */}
                                <div className="relative w-full aspect-video rounded-sm sm:rounded-md overflow-hidden bg-bg-input border border-transparent group-hover:border-line transition-colors flex flex-col items-center justify-center">
                                    {item.isDirectory ? <FolderIcon /> : (
                                        item.type === 'video' ?
                                            // eslint-disable-next-line @next/next/no-img-element
                                            <img
                                                src={`/api/media/thumbnail?filePath=${encodeURIComponent(item.path)}`}
                                                alt={item.name}
                                                className="w-full h-full object-cover relative z-10 transition-transform duration-300 group-hover:brightness-105"
                                                loading="lazy"
                                                onError={(e) => { (e.target as HTMLImageElement).src = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjM2YzZjQ2IiBzdHJva2Utd2lkdGg9IjIiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCI+PHJlY3QgeD0iMyIgeT0iMyIgd2lkdGg9IjE4IiBoZWlnaHQ9IjE4IiByeD0iMiIgcnk9IjIiPjwvcmVjdD48Y2lyY2xlIGN4PSI4LjUiIGN5PSI4LjUiIHI9IjEuNSI+PC9jaXJjbGU+PHBvbHlsaW5lIHBvaW50cz0iMjEgMTUgMTYgMTAgNSAyMSI+PC9wb2x5bGluZT48L3N2Zz4='; }}
                                            />
                                            : <GenericFileIcon />
                                    )}

                                    {/* 悬停微互动遮罩 */}
                                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/5 transition-colors pointer-events-none z-20" />
                                </div>

                                {/* 标题与信息 */}
                                <div className="mt-2.5 sm:mt-3 px-1 text-center">
                                    <h3 className="text-[14px] font-medium text-text-1 truncate leading-tight group-hover:text-primary transition-colors" title={item.name}>
                                        {item.name}
                                    </h3>
                                    {!item.isDirectory && (
                                        <div className="mt-1 flex items-center justify-center text-[12px] text-text-4">
                                            <span>{formatSize(item.size)}</span>
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

export default function BrowsePage() {
    return (
        <Suspense fallback={<div className="p-10 text-center text-text-3">加载中...</div>}>
            <BrowseContent />
        </Suspense>
    );
}
