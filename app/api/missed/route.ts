import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import type Database from "better-sqlite3";

export const dynamic = "force-dynamic";

// ── What You Missed：热点补课清单 ──
// GET  /api/missed            列出全部条目+用户状态；上次采集超 24h 自动采集
// GET  /api/missed?refresh=1  强制采集
// POST /api/missed            { itemId, status, progress } 更新标记（upsert missed_status）
//
// 时间模型：列表按内容发布日期（released）从新到旧排；采集窗口 = 当下往前推半年，
// 每次采集窗口随"今天"前移，INSERT OR IGNORE 增量入库、旧条目保留 → 首次回填半年，之后增量更新。
//
// 采集源（各自 try/catch，互不影响，失败写进 sources 报告，不静默）：
//   tmdb          discover movie/tv：近半年上映/开播 + 按热度排序，各取前 2 页（key 取 settings.tmdb_api_key）
//   apple_books   iTunes topebooks 畅销榜（免 key，Apple 官方），真实 releaseDate 过滤半年窗口
//   steam         featuredcategories 候选 + appdetails 逐个取真实发行日期（免 key），窗口过滤 + 剔硬件/DLC

const SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 15000;

interface SourceResult {
    source: string;
    ok: boolean;
    fetched: number;   // 该源本次拿到多少条
    inserted: number;  // 实际新入库多少条（已存在的 (source,source_id) 跳过）
    error?: string;
}

type InsertStmt = Database.Statement;

function makeInsert(db: Database.Database): InsertStmt {
    // INSERT OR IGNORE：已存在的 (source,source_id) 不重复插入，也绝不覆盖用户状态（状态在另一张表）
    return db.prepare(
        `INSERT OR IGNORE INTO missed_items (kind, title, cover, year, released, source, source_id, extra)
         VALUES (@kind, @title, @cover, @year, @released, @source, @sourceId, @extra)`
    );
}

// 采集窗口：过去半年（回填热点）+ 未来半年（即将上映/发售）。窗口随每次采集前移 → 增量更新
function windowStart(): string {
    const d = new Date();
    d.setMonth(d.getMonth() - 6);
    return d.toISOString().slice(0, 10);
}
function today(): string {
    return new Date().toISOString().slice(0, 10);
}
function windowEnd(): string {
    const d = new Date();
    d.setMonth(d.getMonth() + 6);
    return d.toISOString().slice(0, 10);
}

async function fetchJson(url: string): Promise<any> {
    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

// ── TMDB：近半年上映的电影 + 开播的剧集，按热度排序，各取前 2 页（约 40 条）──
async function collectTmdb(db: Database.Database): Promise<SourceResult> {
    const result: SourceResult = { source: "tmdb", ok: false, fetched: 0, inserted: 0 };
    try {
        const row = db.prepare("SELECT value FROM settings WHERE key = 'tmdb_api_key'").get() as { value: string } | undefined;
        const apiKey = row?.value;
        if (!apiKey) throw new Error("settings 表中未配置 tmdb_api_key");

        const gte = windowStart();
        const lte = today();
        const future = windowEnd();
        const insert = makeInsert(db);
        for (const media of ["movie", "tv"] as const) {
            const dateField = media === "movie" ? "primary_release_date" : "first_air_date";
            // 两段窗口：已上映（热度降序 + 票数门槛滤冷门）+ 即将上映（未上映没票数，热度即关注度）
            const spans = [
                { gte, lte, votes: media === "movie" ? 50 : 20, pages: 2 },
                { gte: lte, lte: future, votes: 0, pages: 1 },
            ];
            for (const span of spans) for (let page = 1; page <= span.pages; page++) {
                const data = await fetchJson(
                    `https://api.themoviedb.org/3/discover/${media}?api_key=${apiKey}&language=zh-CN` +
                    `&sort_by=popularity.desc&${dateField}.gte=${span.gte}&${dateField}.lte=${span.lte}` +
                    `&vote_count.gte=${span.votes}&page=${page}`
                );
                for (const it of data?.results || []) {
                    const title = media === "movie" ? (it.title || it.original_title) : (it.name || it.original_name);
                    if (!title || it.id == null) continue;
                    const date = media === "movie" ? it.release_date : it.first_air_date;
                    const released = date && /^\d{4}-\d{2}-\d{2}$/.test(String(date)) ? String(date) : null;
                    const info = insert.run({
                        kind: media === "movie" ? "movie" : "tv",
                        title,
                        cover: it.poster_path ? `https://image.tmdb.org/t/p/w342${it.poster_path}` : null,
                        year: released ? parseInt(released.slice(0, 4)) : null,
                        released,
                        source: "tmdb",
                        sourceId: `${media}-${it.id}`,
                        extra: JSON.stringify({ rating: it.vote_average ?? null, overview: it.overview || null }),
                    });
                    result.fetched++;
                    result.inserted += info.changes;
                }
            }
        }
        result.ok = true;
    } catch (e) {
        result.error = e instanceof Error ? e.message : String(e);
    }
    return result;
}

// ── Apple Books：电子书畅销榜中近半年出版的书（免 key，Apple 官方榜单）──
// iTunes RSS topebooks 前 50（榜单位次即热度），真实 releaseDate 过滤半年窗口。
// 注：曾用 Google Books（免 key 走共享匿名配额，随时 429/quota exceeded），不可靠已弃。
async function collectAppleBooks(db: Database.Database): Promise<SourceResult> {
    const result: SourceResult = { source: "apple_books", ok: false, fetched: 0, inserted: 0 };
    try {
        const data = await fetchJson("https://itunes.apple.com/us/rss/topebooks/limit=50/json");
        const entries: any[] = data?.feed?.entry || [];
        if (!entries.length) throw new Error("topebooks 榜单返回为空");

        const gte = windowStart();
        const lte = today();
        // 先收窗口内的候选（保持榜单位次），再批量 lookup 评分人数做名气门槛——
        // 榜单里混着大量无名类型小说，评分人数 < 100 的直接丢
        const MIN_RATINGS = 100;
        const candidates: { title: string; id: string; released: string; cover: string | null; author: string | null }[] = [];
        for (const e of entries) {
            const title = e?.["im:name"]?.label;
            const id = e?.id?.attributes?.["im:id"];
            const released = String(e?.["im:releaseDate"]?.label || "").slice(0, 10);
            if (!title || !id || !/^\d{4}-\d{2}-\d{2}$/.test(released)) continue;
            if (released < gte || released > lte) continue;
            const images = e?.["im:image"] || [];
            const rawCover = images[images.length - 1]?.label || null;
            // Apple artwork URL 尺寸可替换：榜单默认 170px，换成 400x600 做书封
            const cover = rawCover ? String(rawCover).replace(/\d+x\d+bb/, "400x600bb") : null;
            candidates.push({ title, id: String(id), released, cover, author: e?.["im:artist"]?.label || null });
        }
        const ratings = new Map<string, { count: number; avg: number | null }>();
        if (candidates.length) {
            const lookup = await fetchJson(`https://itunes.apple.com/lookup?id=${candidates.map((c) => c.id).join(",")}`);
            for (const r of lookup?.results || []) {
                if (r?.trackId != null) ratings.set(String(r.trackId), { count: r.userRatingCount || 0, avg: r.averageUserRating ?? null });
            }
        }
        const insert = makeInsert(db);
        for (const c of candidates) {
            const rate = ratings.get(c.id);
            if (!rate || rate.count < MIN_RATINGS) continue; // 名气门槛
            const r = insert.run({
                kind: "book",
                title: c.title,
                cover: c.cover,
                year: parseInt(c.released.slice(0, 4)),
                released: c.released,
                source: "apple_books",
                sourceId: c.id,
                extra: JSON.stringify({ author: c.author, rating: rate.avg, ratingCount: rate.count }),
            });
            result.fetched++;
            result.inserted += r.changes;
        }
        result.ok = true;
    } catch (e) {
        result.error = e instanceof Error ? e.message : String(e);
    }
    return result;
}

// ── Steam：近半年发行的热门游戏（免 key，Steam 官方两级接口）──
// 第一级 featuredcategories 拿候选（热门新品 + 热销榜），第二级 appdetails 逐个拿真实发行日期；
// 只收 type === 'game'（剔除 Steam Deck 等硬件/DLC）且发行日期落在半年窗口内的。
function parseSteamDate(raw: unknown): string | null {
    const s = String(raw || "").trim();
    if (!s || /coming soon|即将/i.test(s)) return null;
    const t = Date.parse(s); // "5 Jun, 2026" / "Jun 5, 2026" 均可解析
    if (Number.isNaN(t)) return null;
    return new Date(t).toISOString().slice(0, 10);
}

async function steamAppDetail(id: number | string): Promise<any | null> {
    const detail = await fetchJson(
        `https://store.steampowered.com/api/appdetails?appids=${id}&cc=us&l=english&filters=basic,release_date`
    );
    const app = detail?.[String(id)]?.data;
    return detail?.[String(id)]?.success && app ? app : null;
}

async function collectSteam(db: Database.Database): Promise<SourceResult> {
    const result: SourceResult = { source: "steam", ok: false, fetched: 0, inserted: 0 };
    // 名气/质量门槛：评论量 ≥1000 且好评率 ≥75%（≈ Metacritic 口碑线；Metacritic 无公开 API，
    // 用 Steam 玩家评论体量+好评率做等价信号——评论量本身就是知名度）
    const MIN_REVIEWS = 1000;
    const MIN_RATIO = 0.75;
    try {
        const gte = windowStart();
        const lte = today();
        const future = windowEnd();
        const insert = makeInsert(db);

        // A. 已发售的知名游戏：SteamSpy 近两周热玩榜（有真实玩家 = 有名气），质量线预过滤后查发行日期。
        // 注意不能按评论数排序截断——评论数百万的全是常青老游戏，近半年新名作（数万评论）会被截走，
        // 过质量线的全量（≤100 个）都查一遍日期，窗口过滤自然只留新作。
        // 候选池 = SteamSpy 过质量线的 + Steam 畅销榜前 50（热玩榜全是常青老游戏，
        // 近半年新大作大多只出现在畅销榜上）。SteamSpy 候选自带评论数据；畅销榜候选另查 appreviews 补门槛。
        const spyRatings = new Map<string, { rating: number; count: number }>();
        const candidateIds: string[] = [];
        try {
            const spy = await fetchJson("https://steamspy.com/api.php?request=top100in2weeks");
            for (const a of Object.values(spy || {}) as any[]) {
                const total = (a.positive || 0) + (a.negative || 0);
                if (!a.appid || total < MIN_REVIEWS || (a.positive || 0) / total < MIN_RATIO) continue;
                spyRatings.set(String(a.appid), { rating: Math.round(((a.positive || 0) / total) * 100), count: total });
                candidateIds.push(String(a.appid));
            }
        } catch { /* steamspy 挂了仍有畅销榜候选 */ }
        try {
            const sellers = await fetchJson(
                "https://store.steampowered.com/search/results/?query&start=0&count=50&filter=topsellers&category1=998&json=1&infinite=1"
            );
            const html: string = sellers?.results_html || "";
            for (const m of html.matchAll(/data-ds-appid="(\d+)"/g)) {
                if (!candidateIds.includes(m[1])) candidateIds.push(m[1]);
            }
        } catch { /* noop */ }

        for (const id of candidateIds) {
            try {
                const app = await steamAppDetail(id);
                if (!app || app.type !== "game") continue; // 硬件/DLC/软件剔除
                const released = parseSteamDate(app.release_date?.date);
                if (!released || released < gte || released > lte) continue; // 只收近半年发行的
                // 名气门槛：SteamSpy 候选已过线；畅销榜候选查 appreviews 评论量+好评率
                let rate = spyRatings.get(id) || null;
                if (!rate) {
                    const rev = await fetchJson(
                        `https://store.steampowered.com/appreviews/${id}?json=1&num_per_page=0&language=all&purchase_type=all`
                    );
                    const q = rev?.query_summary;
                    const total = (q?.total_positive || 0) + (q?.total_negative || 0);
                    if (total < MIN_REVIEWS || (q?.total_positive || 0) / total < MIN_RATIO) continue;
                    rate = { rating: Math.round(((q?.total_positive || 0) / total) * 100), count: total };
                }
                const info = insert.run({
                    kind: "game",
                    title: app.name,
                    cover: app.header_image || null,
                    year: parseInt(released.slice(0, 4)),
                    released,
                    source: "steam",
                    sourceId: id,
                    extra: JSON.stringify({ rating: rate.rating, ratingCount: rate.count }),
                });
                result.fetched++;
                result.inserted += info.changes;
            } catch { /* 单个 app 失败不影响其他 */ }
        }

        // B. 即将发售：Steam 愿望单热榜（popularwishlist = 玩家愿望单投出来的"未来大作"榜；
        // featuredcategories 的 coming_soon 精选位实测全是无名小品，弃用）。
        // search results 接口返回 { results_html }，从 HTML 里取 data-ds-appid，再 appdetails 验类型+日期。
        try {
            const search = await fetchJson(
                "https://store.steampowered.com/search/results/?query&start=0&count=40&filter=popularwishlist&infinite=1&json=1"
            );
            const html: string = search?.results_html || "";
            const ids = Array.from(new Set(Array.from(html.matchAll(/data-ds-appid="(\d+)"/g), (m) => m[1]))).slice(0, 25);
            for (const id of ids) {
                try {
                    const app = await steamAppDetail(id);
                    if (!app || app.type !== "game") continue;
                    const released = parseSteamDate(app.release_date?.date);
                    if (!released || released <= lte || released > future) continue; // 只收未来半年内有确切日期的
                    const info = insert.run({
                        kind: "game",
                        title: app.name,
                        cover: app.header_image || null,
                        year: parseInt(released.slice(0, 4)),
                        released,
                        source: "steam",
                        sourceId: String(id),
                        extra: JSON.stringify({ upcoming: true }),
                    });
                    result.fetched++;
                    result.inserted += info.changes;
                } catch { /* noop */ }
            }
        } catch { /* 愿望单榜失败不影响已发售部分 */ }

        result.ok = true;
    } catch (e) {
        result.error = e instanceof Error ? e.message : String(e);
    }
    return result;
}

async function collectAll(db: Database.Database): Promise<SourceResult[]> {
    // 三个源并行，各自兜底，互不影响
    const results = await Promise.all([collectTmdb(db), collectAppleBooks(db), collectSteam(db)]);
    const setSetting = db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)");
    setSetting.run("missed_last_sync", String(Date.now()));
    setSetting.run("missed_last_sync_report", JSON.stringify(results));
    return results;
}

// ── 观看记录自动关联 ──
// 热点条目（movie/tv）按标题匹配本地媒体库，从 watch_progress 推导"看过了没/看了多少"。
// 只在用户没有手动标记时生效（手动标记永远优先），返回 autoLinked 标注来源。
function normTitle(t: string): string {
    return t.toLowerCase().replace(/[\s:：·\-—_，,。.!！?？'"“”()（）[\]【】]/g, "");
}

function buildLocalIndex(db: Database.Database): Map<string, { id: string; type: string }> {
    const rows = db.prepare("SELECT id, title, type FROM media WHERE type IN ('movie','series','anime')").all() as
        { id: string; title: string; type: string }[];
    const idx = new Map<string, { id: string; type: string }>();
    for (const m of rows) {
        const k = normTitle(m.title || "");
        if (k && !idx.has(k)) idx.set(k, { id: m.id, type: m.type });
    }
    return idx;
}

function watchDerivedStatus(db: Database.Database, mediaId: string, type: string): { status: string; progress: number } | null {
    const rows = db.prepare("SELECT position, duration, completed FROM watch_progress WHERE media_id = ?").all(mediaId) as
        { position: number; duration: number; completed: number }[];
    if (rows.length === 0) return null;

    if (type === "movie") {
        let pct = 0, done = false;
        for (const r of rows) {
            if (r.completed) done = true;
            if (r.duration > 0) pct = Math.max(pct, (r.position / r.duration) * 100);
        }
        if (done || pct >= 90) return { status: "done", progress: 100 };
        return pct >= 2 ? { status: "partial", progress: Math.round(pct) } : null;
    }

    // 剧集/动漫：完成度 = 看完的集数 / 总集数（单集 completed 或进度 ≥90% 记看完）
    const total = (db.prepare("SELECT COUNT(*) AS c FROM episodes WHERE media_id = ?").get(mediaId) as { c: number }).c;
    const watched = rows.filter((r) => r.completed || (r.duration > 0 && r.position / r.duration >= 0.9)).length;
    if (total > 0 && watched > 0) {
        const pct = Math.min(100, Math.round((watched / total) * 100));
        return pct >= 100 ? { status: "done", progress: 100 } : { status: "partial", progress: pct };
    }
    // 有播放痕迹但一集都没看完 → 记 1% 起步的补课中
    const touched = rows.some((r) => r.duration > 0 && r.position / r.duration >= 0.02);
    return touched ? { status: "partial", progress: total > 0 ? Math.max(1, Math.round((1 / total) * 100)) : 1 } : null;
}

function listItems(db: Database.Database) {
    // 时间线排序：内容发布日期优先，没有发布日期的按入库日期落位；同日再按热度入库顺序
    const rows = db
        .prepare(
            `SELECT i.id, i.kind, i.title, i.cover, i.year, i.released, i.source, i.source_id, i.extra, i.added_at,
                    s.status AS manual_status,
                    s.progress AS manual_progress
             FROM missed_items i
             LEFT JOIN missed_status s ON s.item_id = i.id
             ORDER BY COALESCE(i.released, date(i.added_at)) DESC, i.id ASC`
        )
        .all() as any[];
    const localIndex = buildLocalIndex(db);
    return rows.map((r) => {
        let extra: Record<string, unknown> = {};
        try { extra = r.extra ? JSON.parse(r.extra) : {}; } catch { /* 脏数据不阻塞列表 */ }

        let status: string = r.manual_status ?? "none"; // 默认无状态：不替用户预设"想看"
        let progress: number = r.manual_progress ?? 0;
        let autoLinked = false;
        // 手动标记优先；仅 movie/tv 尝试关联本地观看记录
        if (!r.manual_status && (r.kind === "movie" || r.kind === "tv")) {
            const local = localIndex.get(normTitle(r.title || ""));
            if (local) {
                const derived = watchDerivedStatus(db, local.id, local.type);
                if (derived) {
                    status = derived.status;
                    progress = derived.progress;
                    autoLinked = true;
                }
            }
        }
        const { manual_status, manual_progress, ...rest } = r;
        return { ...rest, extra, status, progress, autoLinked };
    });
}

export async function GET(request: NextRequest) {
    try {
        // 补课清单是个人功能（标记你看没看过）：未登录不提供
        const { resolveUserKeyOrNull } = await import("@/lib/identity");
        if (!(await resolveUserKeyOrNull(request))) {
            return NextResponse.json({ success: false, error: "LOGIN_REQUIRED" }, { status: 401 });
        }
        const db = getDb();
        const refresh = request.nextUrl.searchParams.get("refresh") === "1";

        const lastRow = db.prepare("SELECT value FROM settings WHERE key = 'missed_last_sync'").get() as { value: string } | undefined;
        const lastSync = lastRow ? Number(lastRow.value) : 0;

        let sources: SourceResult[] | null = null;
        let synced = false;
        if (refresh || !lastSync || Date.now() - lastSync > SYNC_INTERVAL_MS) {
            sources = await collectAll(db);
            synced = true;
        } else {
            const reportRow = db.prepare("SELECT value FROM settings WHERE key = 'missed_last_sync_report'").get() as { value: string } | undefined;
            try { sources = reportRow ? JSON.parse(reportRow.value) : null; } catch { sources = null; }
        }

        return NextResponse.json({
            success: true,
            items: listItems(db),
            synced,                     // 本次请求是否触发了采集
            lastSync: synced ? Date.now() : lastSync,
            sources,                    // 各源结果（含失败原因，不静默）
        });
    } catch (error) {
        console.error("[missed] GET 失败:", error);
        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : String(error) },
            { status: 500 }
        );
    }
}

const VALID_STATUS = new Set(["none", "unseen", "done", "partial"]);

export async function POST(request: NextRequest) {
    try {
        // 未登录不落任何标记
        const { resolveUserKeyOrNull } = await import("@/lib/identity");
        if (!(await resolveUserKeyOrNull(request))) {
            return NextResponse.json({ success: false, error: "LOGIN_REQUIRED" }, { status: 401 });
        }
        const body = await request.json();
        const itemId = Number(body?.itemId);
        const status = String(body?.status || "");
        let progress = Number(body?.progress ?? 0);

        if (!Number.isInteger(itemId) || itemId <= 0) {
            return NextResponse.json({ success: false, error: "itemId 无效" }, { status: 400 });
        }
        if (!VALID_STATUS.has(status)) {
            return NextResponse.json({ success: false, error: "status 必须是 none/unseen/done/partial" }, { status: 400 });
        }
        if (!Number.isFinite(progress)) progress = 0;
        progress = Math.max(0, Math.min(100, Math.round(progress)));
        if (status === "done") progress = 100;
        if (status === "unseen" || status === "none") progress = 0;

        const db = getDb();
        const exists = db.prepare("SELECT id FROM missed_items WHERE id = ?").get(itemId);
        if (!exists) {
            return NextResponse.json({ success: false, error: "条目不存在" }, { status: 404 });
        }

        db.prepare(
            `INSERT INTO missed_status (item_id, status, progress, updated_at)
             VALUES (?, ?, ?, datetime('now'))
             ON CONFLICT(item_id) DO UPDATE SET
               status = excluded.status,
               progress = excluded.progress,
               updated_at = excluded.updated_at`
        ).run(itemId, status, progress);

        return NextResponse.json({ success: true, itemId, status, progress });
    } catch (error) {
        console.error("[missed] POST 失败:", error);
        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : String(error) },
            { status: 500 }
        );
    }
}
