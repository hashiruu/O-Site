# Sports Schedule Dashboard — Design Spec

**Date:** 2026-06-26
**Status:** Approved
**Project:** nas-app

## Context

nas-app 的 Live TV 板块当前把世界杯赛程（`MatchDashboard`）内嵌在 `/live` 里，赛程数据来自盗播聚合站 `api.vixnuvew.uk` —— 直播一停，赛程也跟着瞎。本设计把赛程抽成 Channels 分组下独立的 `/sports` 页面，赛程数据改接稳定可靠的 **ESPN 隐藏 API**（已验证实时返回 2026 FIFA World Cup），直播链路维持现有 timstreams + Playwright 那套不动。

两条链路彻底分离：**赛程源（ESPN，数据）** 与 **直播源（timstreams，流）** 各走各的。

## 核心决策（已与用户确认）

| 项 | 决策 |
|---|---|
| 赛程数据源 | ESPN 隐藏 API（免费、无需 key、JSON、已验证） |
| 直播源 | 维持现状（timstreams embed + Playwright 抓 m3u8 + 手动输入框） |
| 路由 | `/sports`，sidebar Channels 分组下，label「体育」 |
| 点击行为 | 队名自动匹配直播源（ESPN 队名 → timstreams slug → 抓流 → 就地播放） |
| 动画内容 | 世界杯赛制规则 + Dashboard 用法说明 + 当前赛程进展 |
| 淘汰标记 | 对角线红色斩杀条（毛笔飞白风，SVG），右上→左下 |
| 时区 | 美东，24 小时制 |

## 数据源

ESPN 隐藏 API（免费、无需 key、JSON）：
- scoreboard: `https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard` —— 实时赛程 + 比分 + 状态
- league meta: 含 season（2026）、当前阶段（Group Stage 等）

服务端代理 `/api/sports/schedule`：
- GET → fetch ESPN → 转换字段 → 返回统一 JSON（events[]：队名/队徽/时间/比分/状态/阶段）
- 内存缓存 60s（避免频繁打 ESPN）
- 美东 24h 时间转换（`Intl.DateTimeFormat`，`timeZone: America/New_York`，`hour12: false`）

## 页面结构

### 1. 常驻全景条（顶部，三合一「一目了然」）
- **赛制阶段时间轴**：小组赛 → 32强 → 16强 → 8强 → 4强 → 决赛，当前阶段高亮 + 脉冲动画
- **进度条**：第 X 轮 / 已完成 Y 场
- **LIVE 计数**（红色脉冲）
- **用法微图例**：美东 24h · 点击卡片看直播 · 数据 ESPN · ❓ 重看引导

### 2. 首访引导动画（一次性）
- 全屏步进动画：① 赛制结构（48 队 / 12 组 / 前二 + 8 最佳第三出线的晋级规则）→ ② 用法（点卡片 / 时区 / 状态含义）→ ③ 当前进展
- `localStorage` 记已看；角标「❓」可重看；可跳过

### 3. 赛程卡片网格
- 按美东日期分组（今天 / 明天 / 后天 …）
- 卡片字段：队徽 + 队名 + 时间或比分 + 状态
- 四态：
  - 🔴 **LIVE**：红色边框 + LIVE 脉冲角标
  - 🕐 **未开始**：显示开赛时间（美东 24h）
  - ⚪ **已结束**：半透明 + 终场比分
  - 🩸 **已淘汰**：盖对角线斩杀条（见下）

### 淘汰斩杀条（`KillStamp`）
- SVG 实现：朱砂红 `#8e1414` 对角多边形 + 飞白线性渐变（竖向断续透明带）+ `feTurbulence`/`feDisplacementMap` 置换撕裂边缘
- 对角线方向：右上 → 左下（劈斩笔势）
- 淘汰判定：小组赛结束后积分垫底出局的队 / 淘汰赛负方（读 ESPN competition 状态与晋级字段）

## 点击 → 直播

点卡片流程：
1. 取该场 ESPN 队名
2. 调现有 `/api/stream-refresh`，用队名 fuzzy 匹配 timstreams slug（查 vixnuvew `api/streams` 的 events，按 name 字段模糊匹配）
3. 抓到 m3u8 → **就地弹出播放器**（hls.js，复用 LiveStage 的 HLS 能力）
4. 匹配失败 → 提示手动粘贴 timstreams 链接（复用 `/live` 的输入框范式）

默认就地播放；播放器可一键展开到 `/live` 全功能页。

## 技术实现

- 动画：纯 CSS `@keyframes` + SVG（项目无动画库，**不引入**新依赖）
- 全部用项目语义 CSS token（`bg-bg-nav`、`text-text-1/2/3`、`border-line`、`primary` 等），斩杀条红色用固定色值

### 组件拆分
| 组件 | 职责 |
|---|---|
| `app/sports/page.tsx` | 主页面（编排） |
| `components/sports/ScheduleDashboard.tsx` | 拉数据 + 分组 + 编排 |
| `components/sports/StageTimeline.tsx` | 顶部全景条（赛制时间轴 + 进度 + LIVE + 图例） |
| `components/sports/MatchCard.tsx` | 单场卡片（四态） |
| `components/sports/KillStamp.tsx` | 淘汰斩杀条 SVG |
| `components/sports/OnboardingTour.tsx` | 首访引导动画 |
| `app/api/sports/schedule/route.ts` | ESPN 代理 + 缓存 + 时区转换 |

## 文件清单

**新建**
- `app/sports/page.tsx`
- `components/sports/{ScheduleDashboard,StageTimeline,MatchCard,KillStamp,OnboardingTour}.tsx`
- `app/api/sports/schedule/route.ts`

**改动**
- `components/Sidebar.tsx` —— icons 字典加 trophy 图标，Channels 分组加 `/sports` NavItem
- `app/live/page.tsx` —— 移除 `MatchDashboard` 嵌入与相关 props

**移除**
- `components/live/MatchDashboard.tsx` —— 功能整体迁移到 `components/sports/`

## 不做（YAGNI）

- 积分榜详细页、阵容/事件流
- 淘汰赛对阵树画图（全景条的阶段时间轴足够示意）
- 多赛事扩展（先世界杯；`/sports` 路由预留后续扩展位）
- 真 HDR / 码率切换（直播链路不变）
- 装动画库（CSS/SVG 够用）

## 验证

1. `nas restart`，访问 `/sports`
2. 全景条显示赛制阶段、当前阶段（小组赛）脉冲、进度
3. 卡片网格按美东日期分组，四态正确（LIVE/未开始/已结束/已淘汰）
4. 已淘汰卡片盖毛笔飞白斩杀条
5. 点 LIVE/未开始卡片 → 队名匹配 → 抓流播放；匹配失败提示手动粘贴
6. 首访引导动画出现，跳过后 localStorage 记录，❓ 可重看
7. sidebar Channels 下出现「体育」入口并高亮
8. `/live` 不再有赛程 dashboard
9. `npx tsc --noEmit` 0 错；`npx jest` 绿
