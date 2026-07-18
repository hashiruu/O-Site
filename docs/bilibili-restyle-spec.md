# Bilibili 风格改版规范（bilibili-restyle-spec）

> 本文档是 B 站化改版的**唯一事实来源**。所有数值均为 2026-07-03 用无头浏览器对 bilibili.com
> 真实页面 `getComputedStyle` 实测所得，不是凭印象抄的。执行改版的代理照本文档做即可，
> 无需再去量 B 站。若本文档与个人记忆冲突，以本文档为准。

---

## 0. 范围与铁律

- **规则 0 · 一次只有一个设计语言。** 整站换成 B 站语言，Apple TV/杂志元素（巨幅 Hero、
  Ken Burns、glass-panel、衬线标题、罗马体序号、胶片噪点）要么删除要么改造，不并存。
- **规则 1 · 粉蓝分工。** 粉 `--color-primary` = 状态（选中、进行中、hover 高亮、进度条）；
  蓝 `--color-secondary` = 动作（链接、次级按钮、标签）。同一区域只允许一个为主。
- **规则 2 · 彩色面积 ≤10%。** 大面积永远是白/灰阶。B 站的干净感来自灰阶体系，不是粉色。
- **规则 3 · 亮色为默认，暗色保留。** ThemeProvider 机制不动，`.dark` 块重写（见 §1.3）。
- **规则 4 · 卡片比例分流。** movie/series/anime 用竖版海报卡（TMDB 2:3 直接用），
  travel/录播用 16:9 卡。实测 B 站番剧区竖卡为 3:4（160×214），我们用 2:3 不裁切。
- **规则 5 · hover 不缩放。** 卡片 hover 只有"标题变粉 + 封面轻微变亮（brightness 1.05 以内）"，
  本体不 scale、不加大阴影。现有 `group-hover:scale-[1.05]` 全部移除。
- **规则 6 · 圆角阶梯 6 / 8 / 999。** 封面 6px、banner 和弹窗 8px、按钮和搜索框全圆胶囊。
  `rounded-3xl`、`rounded-xl` 在卡片场景全部退役。

**不抄的部分**：B 站的信息密度（直播/广告/热搜塞满首页）、顶栏十几个业务入口、
换一批藏三级菜单。我们的频道 tab 只放自己的 5-6 个分类；货架级"换一批 ↻"交互保留。

---

## 1. 设计 Token（实测值）

### 1.1 实测原始数据（bilibili.com，1920×1080，2026-07-03）

| 项目 | 实测值 |
|---|---|
| 页面底色 body | `rgb(241,242,243)` = **#F1F2F3**（不是纯白！） |
| 顶栏/卡片底 | `#FFFFFF` |
| 主文字 | `rgb(24,25,28)` = **#18191C** |
| 次级文字（频道 tab、工具栏图标） | `rgb(97,102,109)` = **#61666D** |
| Meta 文字（UP 主、播放量、日期） | `rgb(148,153,160)` = **#9499A0** |
| 分割线/搜索框描边 | `rgb(227,229,231)` = **#E3E5E7** |
| 品牌粉（新版实测） | `rgb(255,102,153)` = **#FF6699** |
| 品牌蓝（实测） | `rgb(0,181,229)` = **#00B5E5** |
| 字体栈 | `-apple-system, BlinkMacSystemFont, "Helvetica Neue", Helvetica, Arial, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` |

> 注：网上流传的 `#FB7299` 是 B 站旧版粉。当前线上实测为 **#FF6699**，用实测值。

### 1.2 粘贴即用：`app/globals.css` 的 `@theme` 替换块

现有变量名**一个不改**（组件层已全部引用这套名字），只换值。新增 `--color-secondary`。

```css
@theme {
  /* ── 强调色 ── */
  --color-bili-pink: #FF6699;      /* 品牌粉：状态/选中/进度条/hover */
  --color-bili-blue: #00B5E5;      /* 品牌蓝：链接/次级动作 */
  --color-brand-cyan: #00B5E5;
  --color-accent-glow: rgba(255, 102, 153, 0.20);
  --color-primary: #FF6699;
  --color-primary-hover: #FF85AD;
  --color-secondary: #00B5E5;

  /* ── 亮色（默认）：B 站白 ── */
  --color-bg: #F1F2F3;             /* 页面底：浅灰，不是白 */
  --color-bg-card: #FFFFFF;        /* 卡片/顶栏/面板：纯白 */
  --color-bg-elevated: #FFFFFF;
  --color-bg-nav: rgba(255, 255, 255, 0.92);
  --color-bg-input: #F1F2F3;       /* 搜索框灰底（与页面底同值，白色容器内成立） */
  --color-bg-hover: #E3E5E7;
  --color-bg-tag: #F1F2F3;
  --color-bg-mask: rgba(0, 0, 0, 0.4);

  --color-text-1: #18191C;
  --color-text-2: #61666D;
  --color-text-3: #9499A0;
  --color-text-4: #C9CCD0;

  --color-line: #E3E5E7;
  --color-line-light: #F1F2F3;

  --color-shadow-card: 0 0 0 rgba(0,0,0,0);   /* 卡片无阴影，靠留白分隔 */

  /* 字体族：单一无衬线家族，靠字重分层 */
  --font-display: -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
  --font-body: -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
}
```

### 1.3 `.dark` 替换块（B 站官方暗色偏平庸，此为优化版）

```css
.dark {
  --color-bili-pink: #FC8BAB;      /* 暗底上原粉发脏，提亮一档 */
  --color-bili-blue: #3DC5F0;
  --color-brand-cyan: #3DC5F0;
  --color-accent-glow: rgba(252, 139, 171, 0.25);
  --color-primary: #FC8BAB;
  --color-primary-hover: #FFA5C0;
  --color-secondary: #3DC5F0;

  --color-bg: #101014;
  --color-bg-card: #17171C;
  --color-bg-elevated: #1E1E24;
  --color-bg-nav: rgba(16, 16, 20, 0.92);
  --color-bg-input: #1E1E24;
  --color-bg-hover: #26262E;
  --color-bg-tag: #1E1E24;
  --color-bg-mask: rgba(0, 0, 0, 0.65);

  --color-text-1: #E6E6E8;
  --color-text-2: #A2A7AE;
  --color-text-3: #6E7379;
  --color-text-4: #3A3D42;

  --color-line: #26262E;
  --color-line-light: #1E1E24;

  --color-shadow-card: 0 0 0 rgba(0,0,0,0);
}
```

### 1.4 globals.css 其余部分的处置清单

| 现有内容 | 处置 |
|---|---|
| Google Fonts `@import`（Noto Serif SC / Cormorant Garamond） | **删除**（省一次外网请求；字体栈全走系统字体） |
| `body::before` 胶片噪点 + `.dark body::before` | **删除** |
| `.font-display` 工具类 | 保留类名但已无衬线语义（token 已改指无衬线），调用处后续可渐进清理 |
| `.section-index` 罗马体序号 | **删除**，调用处（page.tsx 货架序号、Hero）随首页重构一起移除 |
| `.gold-rule` | **删除** |
| `.glass-panel` | 改为：白底 + `1px solid var(--color-line)` + `0 4px 16px rgba(0,0,0,0.08)`，去掉 backdrop-filter（保留类名，调用处不用改） |
| `.animate-kenburns` / `.animate-heroinfo` / `.scroll-hero` | **删除**，随 Hero 退役 |
| `.animate-fadeIn` / `.stagger-*` / `.scroll-reveal` | 保留（入场动画不违和，B 站也有轻淡入） |
| 滚动条样式 | 保留 |
| 响应式 html font-size 缩放（1280/1600/1920/2560） | **保留**（大屏适配是自家刚需） |
| 剧院模式覆盖 | 保留 |
| `.custom-dplayer-theme` 播放器加固 | 保留；`--color-primary` 换值后 hover 色自动变粉 |
| `@media (prefers-reduced-motion)` | 保留 |

新增工具类（供卡片用）：

```css
/* 封面底部渐隐 meta 条（实测 B 站 stats 条） */
.card-stats-mask {
  background: linear-gradient(to top, rgba(0, 0, 0, 0.8), transparent);
  padding: 16px 8px 6px;
}
```

---

## 2. 排版阶梯（全站只允许这些档位）

| 档位 | 用途 | 实测依据 |
|---|---|---|
| 12px | 时长角标内文字、tag | banner/角标 |
| 13px | meta 行（UP 位/年份/播放量）、卡片 stats | 实测 13px `#9499A0` |
| 14px | 频道 tab、搜索框、工具栏按钮、普通按钮 | 实测 14px |
| 15px / lh 22px | **卡片标题**（两行 clamp，weight 400） | 实测 15px/22px clamp:2 |
| 16px | 正文段落（简介等） | body 默认 |
| 20px | 区块标题（"继续观看"等 section 头） | — |
| 22px / lh 34px | **watch 页视频标题**（weight 500） | 实测 22px/34px w500 |

字重只用 400 / 500 / 600 三档。**禁止**出现衬线、italic、`tracking-[0.35em]` 式大字距。

---

## 3. 全局框架

### 3.1 顶栏（改造 `components/Header.tsx`）

- 高 **64px**，`bg-card` 白底，底部 `1px solid var(--color-line)`；
  滚动 >0 后追加 `box-shadow: 0 2px 8px rgba(0,0,0,0.06)`。
- 布局三段：左 = Logo + 主入口；中 = 搜索框；右 = 主题切换/设置/管理入口。
- **搜索框（B 站辨识度最高元素，按实测精确复刻）**：
  容器宽 ~500px（B 站实测 703px 含左右留白，我们内容少可收窄）、高 **40px**、
  圆角 **8px**、底 `--color-bg-input`、描边 `1px solid var(--color-line)`；
  聚焦态：底变白、描边不变粉（B 站聚焦也是灰描边 + 白底 + 下拉面板）。
  下拉面板：白底、圆角 8px、阴影 `0 4px 16px rgba(0,0,0,0.08)`，内放搜索历史（见 §6）。

### 3.2 频道 tab 行（新增，替代 Sidebar 的主导航职能）

- 顶栏下一行，高 ~48px，页面底色上直接放（B 站频道区实测文字 14px `#61666D`）。
- 内容：`首页 · 电影 · 剧集 · 动漫 · 旅行 · 直播 · 体育`（对应现有 `/category/[type]`、
  `/live`、`/sports` 路由），激活项文字 `--color-primary` + 字重 500（不加下划线粗条）。
- Sidebar：收窄为纯图标栏或删除，二级功能（收藏/播放列表/设置/管理）挪到顶栏右侧下拉。
  推荐：**删除 Sidebar**，B 站没有侧栏，保留会串味。

---

## 4. 首页（重构 `app/page.tsx`）

### 4.1 结构（自上而下）

1. **顶部 banner**（HeroCarousel 改造）：高 **160-220px**（B 站 banner 很矮），圆角 8px，
   保留交叉淡入轮播逻辑，**删除** Ken Burns、大段 overview、罗马体分类标。
   文案只留：标题（20px w500）+ 一行 meta（13px）。
2. **继续观看条**（数据接口已由内容代理完成：`/api/media/continue-watching`）：
   区块标题 20px + 横排卡片。卡片 = 16:9 封面（圆角 6px）+ 底部**粉色进度条**（高 3px，
   `--color-primary`，非全宽时右侧余量为 `--color-line`）+ 封面右下角集数角标
   （黑 60% 胶囊、白字 12px，如 `S1E3` / `看到 12:34`）。点击直跳
   `/watch?filePath=<续播path>`。无数据时整个区块不渲染。
3. **推荐 feed 网格**：
   - `grid`，列宽实测 **312px × 5 列、gap 20px**（1920 下）。我们用响应式：
     `grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5`，gap **20px** 固定。
   - 第一屏左上角放 **2×2 大推荐位轮播**（B 站标志性布局，实测 644×521 占 2 列 2 行）：
     `col-span-2 row-span-2`，内容用带 backdrop 的条目轮播，圆角 8px。
   - 其余格子放普通卡（§5）。数据源：现有 `/api/media/latest?random=1` 混合流。
   - 区块之间不再用"货架 + 横向滚动"，全部纵向网格 feed。
4. **分类区块**（电影/剧集/动漫/旅行）：竖版卡横排一行（放得下几张放几张），
   区块标题右侧保留"换一批 ↻"（14px，`--color-text-3`，hover 变粉）。

### 4.2 退役清单（page.tsx）

- `HeroCarousel` 巨幅版（aspect-[21/9]、min-h-320、Ken Burns、指示点样式改小圆点灰粉）。
- `Shelf` 横向滚动货架 + 左右翻页箭头 + `snap-x`。
- `section-index` 大序号、`stagger-*` 可留。

---

## 5. 卡片规范（新建 `components/MediaCard.tsx`，两个 variant）

### 5.1 横版卡 `variant="landscape"`（travel/录播/继续观看/feed 混排）

```
┌────────────────────┐
│   封面 16:9 r6     │ ← 右下角时长/集数角标：rgba(0,0,0,0.6) 胶囊、白字 12px
│  [底部渐隐 stats]  │ ← .card-stats-mask：白字 13px，放 年份/评分/进度
└────────────────────┘
  标题 15px/22px 两行 clamp，#text-1，hover → primary
  meta 13px #text-3（类型 · 年份）           ← 与标题间距 4px
```

- 封面与文字块间距 **10px**（实测 `margin-top: 10px`）。
- 卡片本体无边框、无阴影、无底色（直接坐在页面灰底上）。
- hover：标题变 `--color-primary`，封面 `filter: brightness(1.05)`，**不 scale**。

### 5.2 竖版卡 `variant="portrait"`（movie/series/anime）

- 封面 TMDB poster 原比例 2:3，圆角 6px；宽度由网格决定（分类区一行 6-7 张）。
- 右上角可选评分角标（粉底白字 12px 胶囊，仅 rating ≥7 时显示，避免满屏角标）。
- 文字块同 5.1：标题 15px 两行 + meta 13px。

### 5.3 通用

- 图片一律 `loading="lazy"` + 现有 FALLBACK_IMG 机制 + **缩略图走 photo-thumb/thumbnail
  接口**（媒体缓存铁律：网格列表禁止拉原图）。
- 骨架屏：灰块 `--color-bg-hover` + 轻呼吸动画（B 站 skeleton 同款思路）。

---

## 6. watch 页（`app/watch/page.tsx` 三栏化）

实测 B 站视频页（1920 下）：播放器区 **1354px**，右栏 **411px**，页面底 `#F1F2F3`。

### 6.1 布局

```
标题区（播放器上方）：22px/34px w500 #text-1，下一行 meta 13px #text-3
┌───────────────────────────────┬──────────────┐
│ 播放器（DPlayer，占满左栏）    │ 右栏 380px    │
│                               │ ┌──────────┐ │
│                               │ │弹幕列表   │ │ ← 白底面板 r8，可折叠
│                               │ ├──────────┤ │
│                               │ │选集网格   │ │ ← P1 P2 P3…小方块
│                               │ │/相关列表  │ │
│                               │ └──────────┘ │
├───────────────────────────────┤              │
│ 操作栏：点赞·收藏·播放列表     │              │
│ 简介折叠区                     │              │
└───────────────────────────────┴──────────────┘
```

- 右栏固定 **380px**（B 站 411px 含边距；剧院模式下右栏隐藏——现有 theater-mode 机制保留）。
- **操作栏**：图标+文字 14px `#61666D`，hover 变粉；收藏按钮直接接现有 favorites API，
  已收藏态填充粉色。
- **选集网格**：`/api/media/related` 已返回整季集数；渲染为小方块（约 48×36，圆角 6px，
  灰底 `--color-bg-tag`，文字 13px），当前集 = 粉色描边 + 粉字；已看完的集（可选）灰字。
- **弹幕列表**：右栏上半，白底面板，表头"弹幕列表 (N)"+ 折叠箭头；行样式 12px，
  时间列 `#9499A0` + 内容列 `#61666D`。数据源：现有 danmaku 表按 media_id 查询。
- DPlayer 主题：初始化处 `theme: '#FF6699'`（进度条/音量条自动变粉）。
  `.custom-dplayer-theme` hover 色随 token 自动生效，无需改。

### 6.2 与功能任务的合并提示

watch 页布局改造 = 与任务 #2（连播）#3（快捷键）#4（倍速）同一文件，**必须一次做完**，
避免 1700 行文件被反复重排。执行顺序：先布局三栏化 → 再挂功能。

---

## 7. search 页（`app/search/page.tsx`）

- 顶部 tab：`全部 · 电影 · 剧集 · 动漫 · 旅行`，14px，激活 = `--color-primary` + 底部 2px 粉条。
- 结果列表 = 横向卡：左 16:9 封面（宽 ~200px，圆角 6px）+ 右侧标题（15px 两行）+
  meta（13px `#9499A0`）+ overview 一行截断（13px `#61666D`）。
- 搜索历史：顶栏搜索框聚焦时下拉面板展示（localStorage 最近 10 条，胶囊 tag 样式：
  灰底 `--color-bg-tag`、12px、hover 变粉描边）。
- 与任务 #5（防抖 + AbortController 竞态守卫）同文件一次做完。

---

## 8. 执行顺序与验收

| 步骤 | 内容 | 涉及文件 | 前置 |
|---|---|---|---|
| S1 | token 换血 + globals 清理（§1.2-1.4） | `app/globals.css` | 内容代理交付后 |
| S2 | 顶栏 + 频道 tab + Sidebar 退役（§3） | `components/Header.tsx`、`Sidebar.tsx`、`app/layout.tsx` | S1 |
| S3 | MediaCard 组件（§5） | `components/MediaCard.tsx`（新建） | S1 |
| S4 | 首页重构（§4） | `app/page.tsx` | S2+S3；**必须等内容代理的 continue-watching 交付** |
| S5 | watch 三栏化 + 功能任务 #2#3#4（§6） | `app/watch/page.tsx` | S1；**必须等内容代理交付 watch 页改动** |
| S6 | search 页 + 任务 #5（§7） | `app/search/page.tsx` | S2 |
| S7 | detail / favorites / history 跟进换肤 | 对应 page.tsx | S3 |

**冲突红线**：S4、S5 动 `app/page.tsx` 和 `app/watch/page.tsx`，与内容优化代理的工作文件
重叠，必须等它报完工再动。S1-S3、S6 与内容/安全代理无文件交集，可先行。

**验收标准**（每步统一）：
1. 并排开真 bilibili.com 对比，自问"这个元素放进 B 站页面违和吗"。
2. 亮/暗两个模式都过一遍（ThemeProvider 切换）。
3. `npm run build` 通过；watch 页改动后实际播一条视频 + 一条 HLS 转码流。

---

## 附录 A · 实测参考截图

- `~/.claude/skills/dev-browser/tmp/bili-home.png` — 首页整体
- `~/.claude/skills/dev-browser/tmp/bili-cards.png` — feed 卡片区
- `~/.claude/skills/dev-browser/tmp/bili-video.png` — 视频页三栏
- `~/.claude/skills/dev-browser/tmp/bili-search.png` — 搜索结果页

## 附录 B · 实测与常见资料的差异（防止后来者"纠正"回错误值）

1. 主粉是 **#FF6699**（实测），不是旧版 `#FB7299`。
2. 页面底是 **#F1F2F3 灰**，白色只用于顶栏/卡片/面板。全白会显得"没做完"。
3. 卡片标题 weight 是 **400** 不是 500；层级靠颜色（#18191C vs #9499A0）拉开。
4. 搜索框圆角实测 **8px**（外容器），不是全圆胶囊；高 40px。
5. 番剧竖卡实测 **3:4**；我们的 TMDB 海报是 2:3，直接用 2:3，不裁。
