# 书架模块设计文档

> NAS Media App — 六格式电子书阅读器技术设计
> 日期：2026-03-29

---

## 1. 概述

在现有 NAS 媒体中心新增「书架」模块，支持 doc / docx / tex / epub / txt / pdf 六种电子书格式的在线阅读。

核心设计决策：

- **后端解析**：所有文件在服务端完成解析/编译，前端只接收处理后的数据
- **混合渲染管线**：Pretext 管 txt/epub/doc/docx 的动态分页，pdf.js 管 PDF 原生渲染，HTML 管 TeX 编译产物
- **统一 Reader Shell**：一个阅读器壳组件提供一致的工具栏/目录/进度/主题，通过 RendererAdapter 接口对接不同渲染内核
- **渐进式开发**：先做 Pretext 管线覆盖四种格式，再加 PDF 和 TeX

---

## 2. 格式到渲染管线映射

| 格式 | 后端解析器 | 前端渲染管线 | 分页方式 | 交互模型 |
|------|-----------|-------------|---------|---------|
| `.txt` | 读取文件，按空行分段 | PretextPipeline | Pretext 动态分页 | 上下翻页 |
| `.epub` | fflate 解压 + OPF/XHTML 解析 | PretextPipeline | Pretext 动态分页 | 上下翻页 + 章节导航 |
| `.doc` | LibreOffice headless 转 txt | PretextPipeline | Pretext 动态分页 | 上下翻页 |
| `.docx` | mammoth.js 提取文本 | PretextPipeline | Pretext 动态分页 | 上下翻页 |
| `.pdf` | 不解析，仅提取元数据 | PdfPipeline (pdf.js) | 原始固定页面 | 页码跳转 + 缩放 |
| `.tex` | latex2html 或 pandoc 编译 | HtmlPipeline | HTML 长页面滚动 | 连续滚动 + 锚点跳转 |

---

## 3. 依赖

### npm 包

```bash
npm install @chenglou/pretext fflate pdfjs-dist mammoth
```

| 包 | 用途 | 运行环境 |
|---|------|---------|
| `@chenglou/pretext` | 文本测量与分页引擎 | 前端（Canvas API） |
| `fflate` | ZIP 解压（EPUB） | 后端 |
| `pdfjs-dist` | PDF 原生渲染 | 前端 |
| `mammoth` | docx 提取文本/HTML | 后端 |

### 系统级依赖

| 工具 | 用途 | 安装方式 |
|------|------|---------|
| `libreoffice` | `.doc` 转 txt | `apt install libreoffice` |
| `latex2html` | TeX 编译为 HTML | `apt install latex2html` |
| `pandoc` | TeX 编译备选方案 | `apt install pandoc` |
| `texlive` | LaTeX 编译环境 | `apt install texlive` |

系统依赖均为可选——缺少时对应格式回退到纯文本模式。

---

## 4. 数据库设计

### media 表（复用）

`type = 'book'`，`metadata` JSON 字段存储书籍信息：

```typescript
interface BookMetadata {
  format: 'txt' | 'epub' | 'doc' | 'docx' | 'pdf' | 'tex';
  author?: string;
  pageCount?: number;
  wordCount?: number;
  isbn?: string;
  publisher?: string;
  language?: string;
  coverPath?: string;
  pdfPageCount?: number;                        // PDF 专用
  texCompileStatus?: 'pending' | 'success' | 'failed';  // TeX 专用
}
```

### reading_progress 表（新建）

```sql
CREATE TABLE IF NOT EXISTS reading_progress (
  id TEXT PRIMARY KEY,
  media_id TEXT NOT NULL,

  -- 通用字段
  percentage REAL NOT NULL DEFAULT 0,
  last_read DATETIME DEFAULT CURRENT_TIMESTAMP,

  -- Pretext 管线专用（txt/epub/doc/docx）
  chapter_index INTEGER,
  cursor_json TEXT,
  page_index INTEGER,
  total_pages INTEGER,

  -- PDF 管线专用
  pdf_page INTEGER,
  pdf_total_pages INTEGER,
  pdf_zoom REAL,

  -- HTML 管线专用（TeX）
  html_scroll_position REAL,
  html_anchor TEXT,

  FOREIGN KEY (media_id) REFERENCES media(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_reading_progress_media ON reading_progress(media_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_reading_progress_unique ON reading_progress(media_id);
```

设计要点：

- 一条 media 记录对应一条 reading_progress（UNIQUE 约束）
- 三种管线各有独立字段，互不干扰
- `percentage` 是统一的进度表示，首页进度条统一用此值

---

## 5. 类型定义

在 `types/index.ts` 追加：

```typescript
export type BookFormat = 'txt' | 'epub' | 'doc' | 'docx' | 'pdf' | 'tex';

export interface BookMetadata {
  format: BookFormat;
  author?: string;
  pageCount?: number;
  wordCount?: number;
  isbn?: string;
  publisher?: string;
  language?: string;
  coverPath?: string;
  pdfPageCount?: number;
  texCompileStatus?: 'pending' | 'success' | 'failed';
}

export interface ReadingProgress {
  id: string;
  mediaId: string;
  percentage: number;
  lastRead: string;
  chapterIndex?: number;
  cursorJson?: string;
  pageIndex?: number;
  totalPages?: number;
  pdfPage?: number;
  pdfTotalPages?: number;
  pdfZoom?: number;
  htmlScrollPosition?: number;
  htmlAnchor?: string;
}

export interface ChapterManifest {
  index: number;
  title: string;
}

export interface ParsedBook {
  title: string;
  author?: string;
  coverPath?: string;
  format: BookFormat;
  chapters: ChapterManifest[];
}

export interface ChapterContent {
  index: number;
  title: string;
  text: string;
  html?: string;
}
```

---

## 6. 后端解析管线

### 6.1 统一输出

所有解析器输出 `ParsedBook`。章节内容按需获取，返回 `ChapterContent`。

### 6.2 TxtParser

```
读取文件 → 按 \n\n 分段 → 每段为一"章"
```

- 大文件（>5MB）流式读取，分段送入 Pretext
- 首段较短（<50 字）视为书名
- 无封面，前端生成默认封面

### 6.3 EpubParser

```
fflate.unzipSync(buffer)
  → META-INF/container.xml → 定位 OPF
  → OPF 解析 → dc:title, dc:creator, manifest, spine
  → 按 spine 顺序读取 XHTML → 去标签提取纯文本
  → 封面图解压到 cache/books/{id}/cover.jpg
```

- 解析结果缓存到 `cache/books/{id}/parsed.json`
- 章节按 spine item 划分
- XHTML 解析用正则去标签（避免引入 XML 解析器依赖）

### 6.4 DocxParser

```
mammoth.extractRawText({ buffer })
  → 按段落分割 → 每 50 段一组分章
```

- mammoth 原生支持 Node.js
- 元数据（标题、作者）从 ZIP 内 `docProps/core.xml` 提取

### 6.5 DocParser

```
libreoffice --headless --convert-to txt "file.doc" --outdir /tmp/nas-books/
  → 读取生成的 txt → 走 TxtParser 逻辑
```

- `.doc` 是旧版二进制格式，mammoth 不支持
- 转换结果缓存到 `cache/books/{id}/`，只执行一次
- LibreOffice 不可用时回退：文件名当标题，提示"不支持此格式"

### 6.6 PdfParser

```
不做文本提取，仅读取元数据：
  → 页数（从文件尾部快速读取）
  → 首页渲染为封面（pdf2pic 或 graphicsmagick）
```

- PDF 原始文件通过 `/api/books/file` 流式传输给前端 pdf.js
- 大 PDF（>100MB）支持 HTTP Range 请求分块加载
- 封面用 `gm convert file.pdf[0] cover.jpg` 提取首页

### 6.7 TexParser

```
latex2html -dir /tmp/nas-books/{id} file.tex
  或
pandoc file.tex -o file.html --mathjax
  → 生成的 HTML 存入 cache/books/{id}/compiled.html
  → 从源码提取 \section{} 作为章节目录
```

- 优先 `latex2html`（保留更多原始排版），回退 `pandoc`
- 首次打开异步编译，`texCompileStatus` 记录状态
- 编译耗时较长时通过 SSE 推送进度
- 编译失败回退到纯文本模式（源码当 txt 看）

### 6.8 解析缓存

```
cache/books/
├── {mediaId}/
│   ├── parsed.json          # ParsedBook 序列化
│   ├── cover.jpg            # 封面图
│   ├── chapter-{n}.txt      # 单章纯文本
│   ├── converted.txt        # doc 转换产物
│   └── compiled.html        # TeX 编译产物
```

- 首次访问时解析并缓存，后续读缓存
- 缓存 key = mediaId，文件不变则 id 不变
- 不设过期，扫描器检测文件变化时清除缓存

### 6.9 内存管理策略

核心原则：**按需加载，用完即释放，磁盘缓存替代内存常驻。**

#### 后端：解析器懒加载

```typescript
// 不在文件顶部 import，而是在路由处理函数中动态 import
export async function GET(request: Request) {
  const format = getBookFormat(id);

  // 只加载当前格式需要的解析器
  const parser = await loadParser(format);
  const result = parser.parse(buffer);

  // 解析完成后 parser 局部变量即被 GC 回收
  return Response.json({ data: result });
}

async function loadParser(format: string) {
  switch (format) {
    case 'epub': return (await import('@/lib/epub-parser')).parseEpub;
    case 'docx': return (await import('@/lib/doc-parser')).parseDocx;
    case 'doc':  return (await import('@/lib/doc-parser')).parseDoc;
    case 'txt':  return (await import('@/lib/txt-parser')).parseTxt;
    case 'pdf':  return (await import('@/lib/pdf-parser')).parsePdfMeta;
    case 'tex':  return (await import('@/lib/tex-parser')).parseTex;
  }
}
```

- 每个解析器是独立文件，通过 `dynamic import()` 按需加载
- mammoth（docx）约 2MB、pdf.js 约 3MB，未用到的格式不会加载到内存
- 解析器的解析结果序列化写入磁盘缓存（`cache/books/{id}/parsed.json`），不常驻内存
- API 调用结束后，解析器和解析产物随函数作用域被 GC 回收

#### 后端：大文件流式处理

```typescript
// TXT：流式读取，不整个加载到内存
function parseTxt(filePath: string) {
  const stream = fs.createReadStream(filePath, { encoding: 'utf-8' });
  // 按段落边界切割，逐段输出
}

// PDF：流式传输，不缓存整个文件
app/api/books/file/route.ts:
  → fs.createReadStream(filePath, { start, end })  // Range 请求
  → stream.pipe(response)
  → 不缓存文件内容，流结束后立即释放
```

#### 前端：渲染器按需创建与销毁

```typescript
// Reader Shell 组件
function Reader({ bookId, format }) {
  const [adapter, setAdapter] = useState<RendererAdapter | null>(null);

  useEffect(() => {
    let currentAdapter: RendererAdapter | null = null;

    // 根据格式创建对应渲染器
    switch (format) {
      case 'txt': case 'epub': case 'doc': case 'docx':
        currentAdapter = new PretextPipeline();
        break;
      case 'pdf':
        currentAdapter = new PdfPipeline();
        break;
      case 'tex':
        currentAdapter = new HtmlPipeline();
        break;
    }

    currentAdapter.init(containerRef.current!);
    setAdapter(currentAdapter);

    // ★ 关键：组件卸载时彻底销毁渲染器
    return () => {
      currentAdapter?.destroy();  // 释放 canvas、pdfDoc、HTML DOM 等
      currentAdapter = null;
      setAdapter(null);
    };
  }, [bookId, format]);

  // 组件卸载 = 离开阅读页 = 全部释放
}
```

各渲染器的 `destroy()` 实现：

| 渲染器 | destroy() 做什么 |
|--------|-----------------|
| PretextPipeline | `clearCache()` 清除 Pretext 内部缓存；释放 prepared 对象引用 |
| PdfPipeline | `pdfDoc.destroy()` 释放 pdf.js 文档对象；移除 canvas；销毁 worker |
| HtmlPipeline | `innerHTML = ''` 清空 DOM；移除注入的 KaTeX CSS `<link>` |

#### 前端：Pretext 缓存生命周期

```typescript
// Pretext 全局缓存默认会累积，需要主动管理
import { clearCache } from '@chenglou/pretext';

// 章节切换时：清除上一章的缓存
useEffect(() => {
  return () => {
    clearCache();  // 组件卸载或章节切换时清除
  };
}, [chapterIndex]);
```

#### 总结

| 场景 | 策略 |
|------|------|
| 用户浏览书架，未打开书 | 无解析器加载，无内存占用 |
| 打开一本 EPUB | 动态 import epub-parser → 解析 → 写磁盘缓存 → 返回数据 → 解析器 GC |
| 阅读中 | 仅当前章节文本 + Pretext prepared 对象在内存（通常 <1MB） |
| 切换章节 | 释放上一章 prepared，加载新章节 |
| 关闭阅读页 | `destroy()` 释放全部资源，内存归零 |
| 同时打开多本书 | 不可能——同一时间只有一个 Reader 组件实例 |

---

## 7. API 端点

### 7.1 书籍内容

```
GET /api/books/content?id={mediaId}&chapter={index}
```

响应：

```json
{
  "success": true,
  "data": {
    "bookId": "uuid",
    "title": "三体",
    "author": "刘慈欣",
    "format": "epub",
    "chapters": [
      { "index": 0, "title": "第一章 疯狂年代" },
      { "index": 1, "title": "第二章 寂寞的旅程" }
    ],
    "currentChapter": {
      "index": 0,
      "title": "第一章 疯狂年代",
      "text": "汪淼觉得，这些天来..."
    }
  }
}
```

PDF 格式特殊响应：

```json
{
  "success": true,
  "data": {
    "bookId": "uuid",
    "format": "pdf",
    "totalPages": 320,
    "title": "论文标题",
    "chapters": []
  }
}
```

TeX 格式（编译中）：

```json
{
  "success": true,
  "data": {
    "bookId": "uuid",
    "format": "tex",
    "texCompileStatus": "pending",
    "title": "论文标题"
  }
}
```

### 7.2 文件流

```
GET /api/books/file?id={mediaId}
```

- PDF：流式传输原始文件，支持 Range 请求
- TeX（编译后）：返回编译后的 HTML
- 其他格式：不需要此接口

### 7.3 TeX 编译触发

```
POST /api/books/compile?id={mediaId}
```

触发异步编译，响应：

```json
{ "success": true, "data": { "status": "compiling" } }
```

可通过 SSE 推送编译进度。

### 7.4 阅读进度

```
GET  /api/books/progress?mediaId={id}
POST /api/books/progress
```

POST body：

```json
{
  "mediaId": "uuid",
  "percentage": 0.35,
  "chapterIndex": 2,
  "cursorJson": "{\"segmentIndex\":45,\"graphemeIndex\":0}",
  "pageIndex": 3,
  "totalPages": 87
}
```

### 7.5 封面图

```
GET /api/books/cover?id={mediaId}
```

返回缓存的封面图。无封面时返回 SVG 默认封面（书名+渐变背景）。

---

## 8. 前端阅读器架构

### 8.1 RendererAdapter 接口

```typescript
interface RendererAdapter {
  render(): React.ReactNode;
  goNext(): void;
  goPrev(): void;
  goToPage(page: number): void;
  canGoNext: boolean;
  canGoPrev: boolean;
  currentPage: number;
  totalPages: number;
  percentage: number;
  chapters?: ChapterManifest[];
  goToChapter(index: number): void;
  currentChapter?: number;
  init(container: HTMLElement): Promise<void>;
  destroy(): void;
  onResize(): void;
}
```

### 8.2 PretextPipeline（txt / epub / doc / docx）

初始化流程：

1. `fetch /api/books/content?id=xx&chapter=0`
2. `prepareWithSegments(text, font)`
3. 测量容器宽高
4. `paginate(prepared, width, height, lineHeight)`
5. 设置 `pages[]`，`currentPage = 0`
6. 如有 reading_progress 恢复到对应页

分页核心：

```typescript
function paginate(prepared, pageWidth, pageHeight, lineH) {
  const linesPerPage = Math.floor(pageHeight / lineH);
  const pages = [];
  let cursor = { segmentIndex: 0, graphemeIndex: 0 };
  let currentPage = [];

  while (true) {
    const line = layoutNextLine(prepared, cursor, pageWidth);
    if (line === null) {
      if (currentPage.length > 0) pages.push(currentPage);
      break;
    }
    currentPage.push(line);
    cursor = line.end;
    if (currentPage.length >= linesPerPage) {
      pages.push(currentPage);
      currentPage = [];
    }
  }
  return pages;
}
```

渲染：逐行输出 `<div>`，字号/行高由 CSS 控制。

交互：

- `goNext/goPrev`：页码加减
- `onResize`：重新 paginate（纯算术 <1ms）
- 字号变化：重新 `prepare` + `paginate`
- 切换章节：fetch 新 chapter → 重新 prepare
- 每章独立 prepare/paginate，章节间是离散跳转

### 8.3 PdfPipeline（pdf）

初始化流程：

1. `fetch /api/books/content?id=xx` → `{ format: 'pdf', totalPages }`
2. 加载 pdf.js worker
3. `fetch /api/books/file?id=xx` 作为 ArrayBuffer
4. `pdfjsLib.getDocument(data)` → pdfDoc
5. 如有 reading_progress 恢复 pdf_page

渲染：每页一个 `<canvas>`，`page.render({ canvasContext, viewport })`。

交互：

- `goNext/goPrev`：页码加减
- 缩放：重新渲染当前页 canvas
- `onResize`：根据容器宽度自动计算 scale
- 不支持章节概念（`chapters = undefined`）
- 大文件用 Range 请求分块加载

### 8.4 HtmlPipeline（TeX）

初始化流程：

1. `fetch /api/books/content?id=xx` → `{ format: 'tex', compileStatus }`
2. `fetch /api/books/file?id=xx` → 编译后的 HTML 字符串
3. `dangerouslySetInnerHTML` 渲染
4. 注入 KaTeX CSS
5. 恢复 html_scroll_position

渲染：单 `<div>` 承载完整 HTML，CSS 控制排版。

交互：

- 连续滚动模式（非翻页）
- `goNext/goPrev` → `scrollBy(containerHeight)`
- `goToPage` → `scrollTo(anchor)`
- `chapters` → 从 HTML 中提取 `<h1><h2>` 生成锚点目录
- `percentage` → `scrollTop / scrollHeight`
- `onResize` → 纯 CSS 响应式

### 8.5 Reader Shell 组件

```
app/read/page.tsx                    ← 页面入口，"use client"
│
├── components/Reader.tsx             ← Shell 壳组件
│   ├── ReaderToolbar.tsx             ← 顶部工具栏
│   ├── ReaderToc.tsx                 ← 章节目录侧边栏
│   ├── ReaderProgressBar.tsx         ← 底部进度条
│   ├── ReaderSettings.tsx            ← 字号/主题设置面板
│   ├── PretextRenderer.tsx           ← Pretext 渲染器
│   ├── PdfRenderer.tsx               ← PDF 渲染器
│   └── HtmlRenderer.tsx              ← HTML 渲染器
│
├── lib/reader/
│   ├── adapter.ts                    ← RendererAdapter 接口
│   ├── pretext-pipeline.ts           ← Pretext 分页逻辑
│   ├── pdf-pipeline.ts               ← pdf.js 封装
│   ├── html-pipeline.ts              ← HTML 滚动逻辑
│   └── themes.ts                     ← 主题配色定义
```

---

## 9. 阅读器交互

### 工具栏

- 鼠标移入显示，3 秒无操作自动隐藏
- 内容：返回按钮 | 书名-作者 | 目录按钮 | 设置按钮

### 操作映射

| 操作 | Pretext 管线 | PDF 管线 | HTML 管线 |
|------|-------------|---------|----------|
| `→` / `Space` / 左滑 / 点击右侧 | 下一页 | 下一页 | scrollDown |
| `←` / 右滑 / 点击左侧 | 上一页 | 上一页 | scrollUp |
| `Home` | 本章首页 | 第 1 页 | 回顶部 |
| `End` | 本章末页 | 最后一页 | 到底部 |
| 滚轮 | 无效 | 无效 | 连续滚动 |
| `Esc` | 返回书架 | 返回书架 | 返回书架 |

### 设置面板

根据当前管线动态显示：

- **Pretext 管线**：字号（14px~28px）、行距（1.4x~2.4x）
- **PDF 管线**：缩放（50%~200%）
- **HTML 管线**：无额外选项
- **所有管线**：主题切换（亮色/暗色/护眼色）

### 主题配色

```typescript
const themes = {
  light:  { bg: '#ffffff',  text: '#1a1a1a',  toolbar: '#f5f5f5', accent: '#fb7299' },
  dark:   { bg: '#1a1a1a',  text: '#e0e0e0',  toolbar: '#252525', accent: '#fb7299' },
  sepia:  { bg: '#f4ecd8',  text: '#5b4636',  toolbar: '#ede4cc', accent: '#8b6914' },
};
```

- 存 `localStorage`，跨格式统一
- 与 NAS App 系统 dark mode 联动

### 进度保存

翻页/滚动停止后 debounce 2 秒自动保存。三种管线都计算 `percentage`，加上各自专用字段，POST 到 `/api/books/progress`。

---

## 10. 首页集成

修改 `app/page.tsx`：

- `LatestData` 新增 `book?: MediaItem[]`
- `sections` 数组添加 `{ key: "book", title: "书架" }`
- 书籍卡片使用 `aspect-[2/3]` 封面比例
- 路由跳转到 `/read?id=${item.id}`
- 卡片右上角显示格式标签（TXT / EPUB / PDF 等）
- 有阅读进度时卡片底部显示进度条

无封面的书籍（txt/doc/docx）用 `BookCover` 组件生成 SVG 默认封面。

---

## 11. Admin 后台集成

修改 `app/admin/page.tsx`，新增目录类型 `book`。扫描时传入 `type = 'book'`，扫描器按扩展名自动分类处理六种格式。

---

## 12. 后端文件结构

```
lib/
├── db.ts                           # 修改：新增 reading_progress 表
├── scanner.ts                      # 修改：新增 BOOK_EXTS + book 扫描分支
├── epub-parser.ts                  # 新增：EPUB 解析器
├── doc-parser.ts                   # 新增：doc/docx 解析器
└── tex-parser.ts                   # 新增：TeX 编译器

app/api/books/
├── content/route.ts                # 新增：书籍内容/章节接口
├── file/route.ts                   # 新增：文件流传输（PDF/TeX）
├── compile/route.ts                # 新增：TeX 异步编译触发
├── progress/route.ts               # 新增：阅读进度 CRUD
└── cover/route.ts                  # 新增：封面图服务

cache/books/                        # 新增：解析缓存目录
```

---

## 13. 前端文件结构

```
app/
├── page.tsx                        # 修改：新增 book 分区
├── read/page.tsx                   # 新增：阅读器页面入口

components/
├── Reader.tsx                      # 新增：Shell 壳组件
├── ReaderToolbar.tsx               # 新增：工具栏
├── ReaderToc.tsx                   # 新增：章节目录
├── ReaderProgressBar.tsx           # 新增：进度条
├── ReaderSettings.tsx              # 新增：设置面板
├── PretextRenderer.tsx             # 新增：Pretext 渲染器
├── PdfRenderer.tsx                 # 新增：PDF 渲染器
├── HtmlRenderer.tsx                # 新增：HTML 渲染器
└── BookCover.tsx                   # 新增：默认封面 SVG 生成

lib/reader/
├── adapter.ts                      # 新增：RendererAdapter 接口
├── pretext-pipeline.ts             # 新增：Pretext 分页逻辑
├── pdf-pipeline.ts                 # 新增：pdf.js 封装
├── html-pipeline.ts                # 新增：HTML 滚动逻辑
└── themes.ts                       # 新增：主题配色

types/index.ts                      # 修改：新增书籍相关类型
```

---

## 14. 实施里程碑

### Phase 1：基础设施 + Pretext 管线

覆盖 txt / epub / docx 三种格式（doc 暂跳过，需 LibreOffice）。

1. 数据库：reading_progress 表
2. 类型定义
3. EpubParser（fflate）
4. DocxParser（mammoth.js）
5. TxtParser
6. API：content / progress / cover
7. PretextPipeline + PretextRenderer
8. Reader Shell + Toolbar + ProgressBar
9. 首页书架分区

### Phase 2：PDF 管线

10. PdfParser（元数据提取 + 封面）
11. API：file（流式传输 + Range）
12. PdfPipeline + PdfRenderer
13. PDF 缩放/页码跳转

### Phase 3：TeX 管线 + doc 格式

14. TexParser（latex2html / pandoc）
15. API：compile（异步编译 + SSE）
16. HtmlPipeline + HtmlRenderer
17. DocParser（LibreOffice headless）

### Phase 4：打磨

18. 阅读进度恢复优化
19. 主题联动（系统 dark mode）
20. 移动端手势优化
21. 大文件性能优化（流式分段）
