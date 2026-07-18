# NAS Media Web App - 设计文档

> 创建日期: 2026-03-24
> 状态: 设计中

## 1. 项目概述

### 1.1 目标
构建一个基于 Web 的 NAS 媒体终端应用，支持 4K 视频播放，全浏览器兼容（手机/平板/电脑/电视）。

### 1.2 核心需求

| 需求 | 说明 |
|------|------|
| 视频播放 | 4K 视频、进度记忆、倍速播放 |
| 媒体库管理 | 自动扫描、分类（电影/剧集/音乐）、元数据抓取 |
| 文件浏览 | 类似文件管理器，按目录结构浏览 |
| 外挂字幕 | 支持 srt/ass 等字幕文件加载 |
| 收藏/播放列表 | 收藏喜欢的视频，创建播放列表 |
| 单用户 | 无需多用户/权限系统 |

### 1.3 约束条件

| 约束 | 说明 |
|------|------|
| 服务器 | 自建 Linux 服务器 |
| 硬件加速 | AMD 9950X 核显 (VAAPI) |
| 转码方案 | 服务端实时转码 |
| 存储 | 本地硬盘 |
| 后端方案 | Next.js API Routes（前后端一体） |
| 部署方式 | 直接部署（PM2），不使用 Docker |
| 版本管理 | Git |

---

## 2. 技术栈

```
┌─────────────────────────────────────────────────────────┐
│                    NAS Media Web App                     │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  框架        Next.js 15 (App Router)                    │
│  语言        TypeScript 5.x                             │
│  样式        Tailwind CSS 4.x + shadcn/ui              │
│  视频播放    Video.js 8.x + HLS.js                      │
│  状态管理    Zustand (轻量级)                            │
│  数据存储    SQLite (better-sqlite3) + 文件系统         │
│  转码        FFmpeg (AMD VAAPI 硬件加速)                │
│  元数据      TMDB API (电影/剧集信息)                    │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

### 2.1 技术选型理由

| 技术 | 为什么选它 |
|------|-----------|
| Next.js 15 | 前后端一体，API Routes 方便，SSR 性能好 |
| TypeScript | 类型安全，重构友好 |
| Tailwind + shadcn | 响应式快，组件美观可定制 |
| Video.js | 生态成熟，HLS/DASH 支持好 |
| Zustand | 比 Redux 简单，比 Context 性能好 |
| SQLite | 轻量级，单用户足够，无需额外服务 |
| FFmpeg VAAPI | AMD 硬件加速，转码效率高 |

---

## 3. 架构设计

### 3.1 整体架构

```
┌─────────────────────────────────────────────────────┐
│              Next.js 15 (App Router)                │
├─────────────────────────────────────────────────────┤
│  前端                                                │
│  ├─ Tailwind CSS + shadcn/ui (响应式UI)             │
│  ├─ Video.js / Plyr (视频播放器)                    │
│  └─ HLS.js (自适应流播放)                           │
├─────────────────────────────────────────────────────┤
│  后端 (Next.js API Routes)                          │
│  ├─ /api/media - 媒体库扫描/管理                    │
│  ├─ /api/stream - HLS 转码流                        │
│  ├─ /api/files - 文件浏览                           │
│  ├─ /api/subtitles - 字幕服务                       │
│  └─ /api/playlists - 播放列表                       │
├─────────────────────────────────────────────────────┤
│  转码服务                                            │
│  └─ FFmpeg (AMD VAAPI 硬件加速)                     │
├─────────────────────────────────────────────────────┤
│  数据存储                                            │
│  ├─ SQLite (媒体元数据、进度、播放列表)             │
│  └─ 本地文件系统 (视频文件、字幕)                   │
└─────────────────────────────────────────────────────┘
```

### 3.2 视频播放流程

```
用户请求播放
    │
    ▼
┌─────────────────┐
│ API: 检查格式   │
└────────┬────────┘
         │
    ┌────┴────┐
    │         │
    ▼         ▼
 兼容格式   不兼容格式
    │         │
    │         ▼
    │    ┌─────────────────┐
    │    │ FFmpeg 转码     │
    │    │ (VAAPI 加速)    │
    │    │ 输出 HLS 流     │
    │    └────────┬────────┘
    │             │
    ▼             ▼
┌─────────────────────┐
│ HLS.js 播放         │
│ 自适应码率          │
└─────────────────────┘
```

---

## 4. 项目结构

```
nas-app/
├── app/                          # Next.js App Router
│   ├── layout.tsx                # 根布局
│   ├── page.tsx                  # 首页（媒体库）
│   ├── browse/                   # 文件浏览
│   │   └── page.tsx
│   ├── watch/                    # 视频播放
│   │   └── [id]/page.tsx
│   ├── playlists/                # 播放列表
│   │   └── page.tsx
│   ├── api/                      # 后端 API
│   │   ├── media/                # 媒体库 API
│   │   │   ├── route.ts          # 扫描/列表
│   │   │   └── [id]/route.ts     # 单个媒体
│   │   ├── stream/               # 视频流 API
│   │   │   └── [id]/route.ts     # HLS 转码流
│   │   ├── files/                # 文件浏览 API
│   │   │   └── route.ts
│   │   ├── subtitles/            # 字幕 API
│   │   │   └── [id]/route.ts
│   │   └── playlists/            # 播放列表 API
│   │       └── route.ts
│   └── globals.css
│
├── components/                   # React 组件
│   ├── ui/                       # shadcn/ui 组件
│   ├── VideoPlayer.tsx           # 视频播放器
│   ├── MediaCard.tsx             # 媒体卡片
│   ├── FileBrowser.tsx           # 文件浏览器
│   ├── Sidebar.tsx               # 侧边栏导航
│   └── SubtitleSelector.tsx      # 字幕选择器
│
├── lib/                          # 核心库
│   ├── db.ts                     # SQLite 数据库
│   ├── ffmpeg.ts                 # FFmpeg 转码
│   ├── scanner.ts                # 媒体扫描器
│   ├── metadata.ts               # TMDB 元数据
│   └── subtitles.ts              # 字幕解析
│
├── hooks/                        # React Hooks
│   ├── useMedia.ts
│   ├── usePlayer.ts
│   └── usePlaylist.ts
│
├── store/                        # Zustand 状态
│   ├── mediaStore.ts
│   ├── playerStore.ts
│   └── playlistStore.ts
│
├── types/                        # TypeScript 类型
│   └── index.ts
│
├── public/                       # 静态资源
│   └── fonts/
│
├── .env.local                    # 环境变量
├── next.config.ts
├── tailwind.config.ts
├── tsconfig.json
└── package.json
```

---

## 5. 数据模型

### 5.1 核心类型定义

```typescript
// types/index.ts

// 媒体库
interface Media {
  id: string;              // UUID
  title: string;           // 标题
  type: 'movie' | 'series' | 'music';  // 类型
  path: string;            // 文件路径
  poster?: string;         // 海报图
  backdrop?: string;       // 背景图
  overview?: string;       // 简介
  year?: number;           // 年份
  rating?: number;         // 评分
  duration: number;        // 时长(秒)
  metadata?: {             // TMDB 元数据
    tmdbId?: number;
    genres?: string[];
    cast?: string[];
  };
  createdAt: Date;
  updatedAt: Date;
}

// 剧集（如果是系列）
interface Episode {
  id: string;
  mediaId: string;         // 关联的系列
  season: number;
  episode: number;
  title: string;
  path: string;
  duration: number;
}

// 观看进度
interface WatchProgress {
  id: string;
  mediaId: string;
  episodeId?: string;      // 剧集才有
  position: number;        // 播放位置(秒)
  duration: number;        // 总时长
  completed: boolean;      // 是否看完
  lastWatched: Date;
}

// 播放列表
interface Playlist {
  id: string;
  name: string;
  cover?: string;
  mediaIds: string[];      // 媒体 ID 列表
  createdAt: Date;
}

// 字幕
interface Subtitle {
  id: string;
  mediaId: string;
  language: string;        // zh, en, ja...
  label: string;           // 显示名称
  path: string;            // 字幕文件路径
  isDefault: boolean;
}
```

### 5.2 数据库 Schema (SQLite)

```sql
-- 媒体表
CREATE TABLE media (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('movie', 'series', 'music')),
  path TEXT NOT NULL UNIQUE,
  poster TEXT,
  backdrop TEXT,
  overview TEXT,
  year INTEGER,
  rating REAL,
  duration INTEGER NOT NULL,
  metadata TEXT,  -- JSON
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 剧集表
CREATE TABLE episodes (
  id TEXT PRIMARY KEY,
  media_id TEXT NOT NULL,
  season INTEGER NOT NULL,
  episode INTEGER NOT NULL,
  title TEXT NOT NULL,
  path TEXT NOT NULL UNIQUE,
  duration INTEGER NOT NULL,
  FOREIGN KEY (media_id) REFERENCES media(id)
);

-- 观看进度表
CREATE TABLE watch_progress (
  id TEXT PRIMARY KEY,
  media_id TEXT NOT NULL,
  episode_id TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  duration INTEGER NOT NULL,
  completed INTEGER NOT NULL DEFAULT 0,
  last_watched DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (media_id) REFERENCES media(id),
  FOREIGN KEY (episode_id) REFERENCES episodes(id)
);

-- 播放列表表
CREATE TABLE playlists (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  cover TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 播放列表-媒体关联表
CREATE TABLE playlist_media (
  playlist_id TEXT NOT NULL,
  media_id TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  PRIMARY KEY (playlist_id, media_id),
  FOREIGN KEY (playlist_id) REFERENCES playlists(id),
  FOREIGN KEY (media_id) REFERENCES media(id)
);

-- 字幕表
CREATE TABLE subtitles (
  id TEXT PRIMARY KEY,
  media_id TEXT NOT NULL,
  language TEXT NOT NULL,
  label TEXT NOT NULL,
  path TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (media_id) REFERENCES media(id)
);

-- 索引
CREATE INDEX idx_media_type ON media(type);
CREATE INDEX idx_media_year ON media(year);
CREATE INDEX idx_episodes_media ON episodes(media_id);
CREATE INDEX idx_progress_media ON watch_progress(media_id);
CREATE INDEX idx_progress_last ON watch_progress(last_watched);
```

---

## 6. API 设计

### 6.1 媒体库 API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/media | 获取媒体列表（支持分页、筛选） |
| POST | /api/media | 扫描媒体库 |
| GET | /api/media/[id] | 获取单个媒体详情 |
| PUT | /api/media/[id] | 更新媒体信息 |
| DELETE | /api/media/[id] | 删除媒体记录 |

### 6.2 视频流 API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/stream/[id] | 获取 HLS 播放列表 |
| GET | /api/stream/[id]/master.m3u8 | HLS 主播放列表 |
| GET | /api/stream/[id]/segment-[n].ts | HLS 视频片段 |

### 6.3 文件浏览 API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/files?path=xxx | 获取目录内容 |

### 6.4 字幕 API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/subtitles/[id] | 获取媒体字幕列表 |
| GET | /api/subtitles/[id]/[lang] | 获取字幕内容 (VTT格式) |

### 6.5 播放列表 API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/playlists | 获取播放列表 |
| POST | /api/playlists | 创建播放列表 |
| PUT | /api/playlists/[id] | 更新播放列表 |
| DELETE | /api/playlists/[id] | 删除播放列表 |

---

## 7. 前端页面设计

### 7.1 页面列表

| 页面 | 路径 | 说明 |
|------|------|------|
| 首页 | / | 媒体库概览，最近观看，推荐 |
| 文件浏览 | /browse | 按目录结构浏览文件 |
| 视频播放 | /watch/[id] | 视频播放页面 |
| 播放列表 | /playlists | 播放列表管理 |

### 7.2 响应式布局

```
┌─────────────────────────────────────────────────────────┐
│                      桌面端 (≥1024px)                    │
├──────────────┬──────────────────────────────────────────┤
│              │                                          │
│   侧边栏      │              主内容区                    │
│   (固定)      │                                          │
│              │                                          │
│   - 首页     │                                          │
│   - 媒体库   │                                          │
│   - 文件     │                                          │
│   - 播放列表 │                                          │
│              │                                          │
└──────────────┴──────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│                      移动端 (<768px)                     │
├─────────────────────────────────────────────────────────┤
│                                                         │
│                      主内容区                           │
│                                                         │
├─────────────────────────────────────────────────────────┤
│   底部导航栏                                            │
│   [首页] [媒体库] [文件] [我的]                          │
└─────────────────────────────────────────────────────────┘
```

---

## 8. 环境配置

### 8.1 环境变量

```bash
# .env.local

# 服务器配置
PORT=3000
HOST=localhost

# 媒体库路径
MEDIA_PATH=/path/to/your/media

# TMDB API (元数据)
TMDB_API_KEY=your_tmdb_api_key

# FFmpeg 路径 (可选，默认使用系统 PATH)
FFMPEG_PATH=/usr/bin/ffmpeg
FFPROBE_PATH=/usr/bin/ffprobe

# 数据库路径
DATABASE_PATH=./data/nas-media.db
```

### 8.2 系统依赖

```bash
# Ubuntu/Debian
sudo apt install ffmpeg

# 验证 VAAPI 支持
vainfo
```

---

## 9. 部署方案

### 9.1 开发环境

```bash
# 安装依赖
npm install

# 开发模式
npm run dev
```

### 9.2 生产环境

```bash
# 构建
npm run build

# 使用 PM2 运行
pm2 start npm --name "nas-media" -- start
pm2 save
pm2 startup
```

---

## 10. 开发计划

### Phase 1: 基础框架
- [ ] 项目初始化 (Next.js + TypeScript + Tailwind)
- [ ] 数据库设置 (SQLite + Schema)
- [ ] 基础 UI 框架 (shadcn/ui)

### Phase 2: 核心功能
- [ ] 文件浏览 API + 页面
- [ ] 媒体扫描器
- [ ] 视频播放器 (基础)
- [ ] HLS 转码流

### Phase 3: 增强功能
- [ ] TMDB 元数据集成
- [ ] 字幕支持
- [ ] 播放进度记忆
- [ ] 播放列表

### Phase 4: 优化
- [ ] 响应式布局优化
- [ ] 电视端遥控器支持
- [ ] 性能优化

---

## 11. 风险与备选方案

| 风险 | 备选方案 |
|------|---------|
| VAAPI 不兼容 | 降级为 CPU 软转码，或直连播放 |
| TMDB API 限制 | 本地缓存，或使用其他元数据源 |
| 4K 播放卡顿 | 降低转码码率，或提供多清晰度选项 |

---

## 变更记录

| 日期 | 版本 | 变更内容 |
|------|------|---------|
| 2026-03-24 | v0.1 | 初始设计文档 |
