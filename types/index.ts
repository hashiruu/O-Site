// 媒体类型
export type MediaType = "movie" | "series" | "anime" | "private";

// 媒体分类标签
export const MEDIA_TYPE_LABELS: Record<MediaType, string> = {
    movie: "电影",
    series: "电视剧",
    anime: "动漫",
    private: "私密空间",
};

export const MEDIA_TYPE_ICONS: Record<MediaType, string> = {
    movie: "🎬",
    series: "📺",
    anime: "🎌",
    private: "🔒",
};

// 媒体库
export interface Media {
    id: string;
    title: string;
    type: MediaType;
    path: string;
    poster?: string;
    backdrop?: string;
    overview?: string;
    year?: number;
    rating?: number;
    duration: number; // 时长(秒)
    metadata?: string; // JSON: tmdbId, genres, cast 等
    createdAt: string;
    updatedAt: string;
}

// 剧集（电视剧/动漫系列）
export interface Episode {
    id: string;
    mediaId: string;
    season: number;
    episode: number;
    title: string;
    path: string;
    duration: number;
}

// 观看进度
export interface WatchProgress {
    id: string;
    mediaId: string;
    episodeId?: string;
    position: number; // 播放位置(秒)
    duration: number; // 总时长
    completed: boolean;
    lastWatched: string;
}

// 播放列表
export interface Playlist {
    id: string;
    name: string;
    cover?: string;
    createdAt: string;
}

// 播放列表-媒体关联
export interface PlaylistMedia {
    playlistId: string;
    mediaId: string;
    sortOrder: number;
}

// 字幕
export interface Subtitle {
    id: string;
    mediaId: string;
    language: string;
    label: string;
    path: string;
    isDefault: boolean;
}

// 私密空间配置
export interface PrivateSpaceConfig {
    passwordHash: string;
}

// API 响应
export interface ApiResponse<T> {
    success: boolean;
    data?: T;
    error?: string;
}

// 媒体库统计
export interface MediaStats {
    movie: number;
    series: number;
    anime: number;
    private: number;
    total: number;
}
