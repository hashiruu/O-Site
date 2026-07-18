"use client";

// 旅行相册详情页：顶部封面 banner + 视频卡片网格 + 照片瀑布流 + lightbox。
// 进入靠 query ?album=文件夹名，数据来自 /api/media/travel-album。
import { Suspense, useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Lightbox } from "@/components/travel/Lightbox";

function AlbumContent() {
    const sp = useSearchParams();
    const router = useRouter();
    const album = sp.get("album");

    const [data, setData] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

    // 瀑布流列数（响应式）：先加载的进各列顶部，后加载的往下追加，列间不重排
    const [colCount, setColCount] = useState(2);
    useEffect(() => {
        const calc = () => {
            const w = window.innerWidth;
            setColCount(w < 640 ? 2 : w < 768 ? 3 : w < 1024 ? 4 : 5);
        };
        calc();
        window.addEventListener("resize", calc);
        return () => window.removeEventListener("resize", calc);
    }, []);

    const load = useCallback(() => {
        if (!album) return;
        setLoading(true);
        fetch(`/api/media/travel-album?name=${encodeURIComponent(album)}`)
            .then((r) => r.json())
            .then((d) => { if (d.success) setData(d.data); else setError(d.error || "加载失败"); })
            .catch(() => setError("网络错误"))
            .finally(() => setLoading(false));
    }, [album]);

    useEffect(() => { load(); }, [load]);

    // 所有 hooks 必须在 early return 之前调用（Rules of Hooks）
    const photos = (data?.photos as any[]) ?? [];

    // 分块渲染：大相册一次性挂几百个节点会卡，滚近底部再补一批。
    // slice 保持全局 idx 顺序，lightbox 索引不受影响
    const PHOTO_CHUNK = 80;
    const [visiblePhotos, setVisiblePhotos] = useState(PHOTO_CHUNK);
    const photoSentinelRef = useRef<HTMLDivElement | null>(null);
    useEffect(() => { setVisiblePhotos(PHOTO_CHUNK); }, [album]);
    useEffect(() => {
        const el = photoSentinelRef.current;
        if (!el) return;
        const io = new IntersectionObserver((entries) => {
            if (entries[0].isIntersecting) setVisiblePhotos((c) => c + PHOTO_CHUNK);
        }, { rootMargin: "1000px" });
        io.observe(el);
        return () => io.disconnect();
    }, [loading, photos.length, visiblePhotos]);

    const columns = useMemo(() => {
        const arr: { photo: any; idx: number }[][] = Array.from({ length: colCount }, () => []);
        photos.slice(0, visiblePhotos).forEach((p: any, i: number) => arr[i % colCount].push({ photo: p, idx: i }));
        return arr;
    }, [photos, colCount, visiblePhotos]);

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] text-text-3">
                <div className="relative w-12 h-12">
                    <div className="absolute inset-0 rounded-full border-2 border-line" />
                    <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-bili-pink animate-spin" />
                </div>
                <p className="mt-5 text-sm">加载相册...</p>
            </div>
        );
    }

    if (error || !data) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[50vh] text-text-3">
                <p className="text-lg font-medium text-text-2">{error || "未找到该相册"}</p>
                <button onClick={() => router.back()} className="mt-6 px-6 py-2 rounded-md bg-bili-pink text-white font-medium text-sm">返回</button>
            </div>
        );
    }

    const { title, date, cover, videos = [] } = data;

    return (
        <div className="w-full text-text-1 pb-20">
            {/* ========== 顶部 banner ========== */}
            <section className="relative overflow-hidden">
                {cover && (
                    <div className="absolute inset-0 -z-10">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={cover} className="w-full h-full object-cover blur-3xl scale-110 opacity-20" alt="" />
                        <div className="absolute inset-0 bg-bg-main/80" />
                    </div>
                )}
                <div className="max-w-[1200px] mx-auto py-6 md:py-10">
                    <button
                        onClick={() => router.push("/category/travel")}
                        className="flex items-center gap-1.5 text-text-3 hover:text-text-1 text-sm mb-5 transition-colors"
                    >
                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" /></svg>
                        全部相册
                    </button>

                    <div className="flex flex-col sm:flex-row gap-5 sm:gap-7 items-center sm:items-end">
                        {/* 封面 */}
                        <div className="w-[60%] sm:w-[180px] md:w-[220px] shrink-0">
                            <div className="aspect-[2/3] w-full rounded-xl overflow-hidden bg-bg-input shadow-xl ring-1 ring-line/50">
                                {cover ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img src={cover} className="w-full h-full object-cover" alt={title} />
                                ) : (
                                    <div className="w-full h-full flex items-center justify-center text-text-4 text-xs">暂无素材</div>
                                )}
                            </div>
                        </div>

                        {/* 元数据 */}
                        <div className="flex-1 min-w-0 text-center sm:text-left">
                            <h1 className="text-2xl md:text-3xl lg:text-4xl font-bold text-text-1 leading-tight mb-3">{title}</h1>
                            <div className="flex items-center justify-center sm:justify-start flex-wrap gap-2 mb-1">
                                {date && <span className="px-2.5 py-0.5 rounded border text-xs font-medium border-bili-pink/40 text-bili-pink bg-bili-pink/5">{date}</span>}
                                {photos.length > 0 && <span className="px-2.5 py-0.5 rounded border text-xs font-medium border-line text-text-3">{photos.length} 张照片</span>}
                                {videos.length > 0 && <span className="px-2.5 py-0.5 rounded border text-xs font-medium border-line text-text-3">{videos.length} 个视频</span>}
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            <div className="max-w-[1200px] mx-auto"><div className="border-t border-line" /></div>

            {/* ========== 视频区 ========== */}
            {videos.length > 0 && (
                <section className="max-w-[1200px] mx-auto pt-6 md:pt-8">
                    <div className="flex items-baseline gap-3 mb-5">
                        <h2 className="text-lg md:text-xl font-bold text-text-1">视频</h2>
                        <span className="text-sm text-text-3">{videos.length} 个</span>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 md:gap-4">
                        {videos.map((v: any, i: number) => (
                            <div
                                key={v.path}
                                onClick={() => router.push(`/watch?filePath=${encodeURIComponent(v.path)}`)}
                                className="group cursor-pointer"
                            >
                                <div className="relative w-full aspect-video rounded-lg overflow-hidden bg-bg-input ring-1 ring-line/50">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img
                                        src={v.thumb}
                                        className="w-full h-full object-cover group-hover:brightness-105 transition-transform duration-300"
                                        alt={v.name}
                                        loading="lazy"
                                    />
                                    <div className="absolute inset-0 flex items-center justify-center">
                                        <div className="w-11 h-11 rounded-full bg-black/55 backdrop-blur-sm flex items-center justify-center group-hover:bg-bili-pink/90 transition-colors">
                                            <svg className="w-5 h-5 text-white translate-x-0.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
                                        </div>
                                    </div>
                                </div>
                                <p className="text-[12px] text-text-3 mt-1.5 truncate">{v.name}</p>
                            </div>
                        ))}
                    </div>
                </section>
            )}

            {/* ========== 照片瀑布流 ========== */}
            {photos.length > 0 && (
                <section className="max-w-[1200px] mx-auto pt-6 md:pt-8">
                    <div className="flex items-baseline gap-3 mb-5">
                        <h2 className="text-lg md:text-xl font-bold text-text-1">照片</h2>
                        <span className="text-sm text-text-3">{photos.length} 张 · 点击放大</span>
                    </div>
                    <div className="flex gap-3">
                        {columns.map((col, ci) => (
                            <div key={ci} className="flex-1 flex flex-col gap-3 min-w-0">
                                {col.map(({ photo: p, idx }: { photo: any; idx: number }) => (
                                    <div
                                        key={p.path}
                                        onClick={() => setLightboxIndex(idx)}
                                        className="cursor-pointer rounded-lg overflow-hidden bg-bg-input ring-1 ring-line/40 group relative"
                                        style={{ contentVisibility: "auto", containIntrinsicSize: "auto 260px" }}
                                    >
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        <img
                                            src={p.thumb || p.url}
                                            className="w-full h-auto object-cover group-hover:brightness-105 transition-transform duration-300"
                                            alt={p.name}
                                            loading="lazy"
                                        />
                                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors" />
                                    </div>
                                ))}
                            </div>
                        ))}
                    </div>
                    {visiblePhotos < photos.length && (
                        <div ref={photoSentinelRef} className="py-8 text-center text-text-3 text-sm">加载中…</div>
                    )}
                </section>
            )}

            {/* 空相册 */}
            {photos.length === 0 && videos.length === 0 && (
                <div className="max-w-[1200px] mx-auto py-20 text-center text-text-3">
                    <p>该相册暂无可显示的照片或视频</p>
                </div>
            )}

            {/* ========== Lightbox ========== */}
            {lightboxIndex !== null && (
                <Lightbox
                    photos={photos}
                    index={lightboxIndex}
                    onClose={() => setLightboxIndex(null)}
                    onIndex={setLightboxIndex}
                />
            )}
        </div>
    );
}

export default function TravelAlbumPage() {
    return (
        <Suspense fallback={<div className="flex items-center justify-center min-h-[50vh]"><div className="animate-spin rounded-full h-8 w-8 border-2 border-transparent border-t-bili-pink" /></div>}>
            <AlbumContent />
        </Suspense>
    );
}
