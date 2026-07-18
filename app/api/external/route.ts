import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getRole, canAdminSite } from "@/lib/roles";
import { MUSICALS } from "@/lib/musicals";

// 写入（随机添加 / 移除）仅管理员：外站条目是全站可见的公共书架，
// 只有 boss/admin 能往里加内容，避免普通用户随意污染各分区。

export const dynamic = "force-dynamic";

// ── 外站条目（第三态：未收录 / 已收录 / 外站） ──
// GET    /api/external?type=movie|series|anime|book         → 该分区的外站条目
// POST   /api/external { type, answers:{mood,era,taste} }   → 随机添加：按问卷口味从
//        TMDB discover（影视）/ 豆瓣榜单（书）拉高人气内容，与库内和已添加的去重，入库 10 条
// DELETE /api/external { id }                               → 移除一条
// 外站条目没有本地文件，点击走 fetch-out 跳合法第三方平台。

const FETCH_TIMEOUT_MS = 15000;

let ensured = false;
function ensureTable() {
    if (ensured) return;
    getDb().exec(`
        CREATE TABLE IF NOT EXISTS external_media (
            id TEXT PRIMARY KEY,
            type TEXT NOT NULL,
            title TEXT NOT NULL,
            poster TEXT,
            backdrop TEXT,
            overview TEXT,
            year INTEGER,
            rating REAL,
            tmdb_id INTEGER,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
    ensured = true;
}

// 问卷 → TMDB discover 参数映射（全部健康向，排除恐怖/惊悚/犯罪/战争）
const MOOD_GENRES: Record<string, string> = {
    relax: "35,10751",     // 轻松治愈：喜剧+家庭
    blood: "12,28",        // 热血冒险：冒险+动作
    brain: "18,9648",      // 烧脑深度：剧情+悬疑
    dream: "14,878",       // 奇幻脑洞：奇幻+科幻
};

const proxy = (u: string) => `/api/discover/img?u=${encodeURIComponent(u)}`;

// 舞台音乐剧按英文名去 TMDB search 借影视版/官摄版海报（Hamilton 2020、Phantom 2004…）
async function fetchPoster(en: string, apiKey: string): Promise<string | null> {
    try {
        const r = await fetch(
            `https://api.themoviedb.org/3/search/multi?api_key=${apiKey}&query=${encodeURIComponent(en)}&language=zh-CN&page=1`,
            { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }
        );
        if (!r.ok) return null;
        const j = await r.json();
        const hit = (j.results || []).find((x: { poster_path?: string | null; media_type?: string }) =>
            x.poster_path && (x.media_type === "movie" || x.media_type === "tv"));
        return hit ? proxy(`https://image.tmdb.org/t/p/w500${hit.poster_path}`) : null;
    } catch { return null; }
}

export async function GET(req: NextRequest) {
    ensureTable();
    const type = req.nextUrl.searchParams.get("type") || "";
    const rows = getDb().prepare(
        "SELECT * FROM external_media WHERE type = ? ORDER BY created_at DESC"
    ).all(type);
    return NextResponse.json({ success: true, data: rows });
}

export async function DELETE(req: NextRequest) {
    if (!canAdminSite(await getRole(req))) return NextResponse.json({ success: false, error: "ADMIN_ONLY" }, { status: 403 });
    ensureTable();
    const { id } = await req.json();
    getDb().prepare("DELETE FROM external_media WHERE id = ?").run(String(id || ""));
    return NextResponse.json({ success: true });
}

export async function POST(req: NextRequest) {
    if (!canAdminSite(await getRole(req))) return NextResponse.json({ success: false, error: "ADMIN_ONLY" }, { status: 403 });
    ensureTable();
    const db = getDb();
    const body = await req.json();
    const type = String(body.type || "");
    const answers = (body.answers || {}) as { mood?: string; era?: string; taste?: string; shelf?: string };
    if (!["movie", "series", "anime", "book", "musical"].includes(type)) {
        return NextResponse.json({ success: false, error: "BAD_TYPE" }, { status: 400 });
    }

    // 关键词添加：前端从 /api/external/search 点选的单条候选直接入库
    if (body.item && typeof body.item === "object") {
        const it = body.item as { key?: string; title?: string; poster?: string | null; overview?: string; year?: number | null; rating?: number | null; tmdbId?: number | null };
        const t = String(it.title || "").trim();
        if (!t) return NextResponse.json({ success: false, error: "BAD_ITEM" }, { status: 400 });
        const dup = db.prepare("SELECT 1 FROM external_media WHERE title = ?").get(t)
            || db.prepare("SELECT 1 FROM media WHERE title = ?").get(t);
        if (dup) return NextResponse.json({ success: false, error: "DUPLICATE", message: "已在库中或已添加过" });
        db.prepare(
            `INSERT OR IGNORE INTO external_media (id, type, title, poster, backdrop, overview, year, rating, tmdb_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(`ext-pick-${it.key || t}`, type, t, it.poster || null, null, it.overview || "", it.year ?? null, it.rating ?? null, it.tmdbId ?? null);
        return NextResponse.json({ success: true, added: 1, titles: [t] });
    }

    // 去重底册：库内标题 + 外站已有
    const localTitles = new Set(
        (db.prepare("SELECT title FROM media").all() as { title: string }[]).map((r) => r.title.trim())
    );
    const extRows = db.prepare("SELECT title, tmdb_id FROM external_media").all() as { title: string; tmdb_id: number | null }[];
    const extTitles = new Set(extRows.map((r) => r.title.trim()));
    const extTmdb = new Set(extRows.map((r) => r.tmdb_id).filter(Boolean));

    const insert = db.prepare(
        `INSERT OR IGNORE INTO external_media (id, type, title, poster, backdrop, overview, year, rating, tmdb_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const added: string[] = [];

    try {
        if (type === "book") {
            // 书：豆瓣榜单（口味 → collection），随机偏移页保证"每次不重样"
            const col = answers.shelf === "fiction" ? "book_fiction"
                : answers.shelf === "nonfiction" ? "book_nonfiction"
                : "book_bestseller";
            for (const start of [0, 20, 40]) {
                if (added.length >= 10) break;
                try {
                    const res = await fetch(
                        `https://m.douban.com/rexxar/api/v2/subject_collection/${col}/items?start=${start}&count=20`,
                        {
                            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
                            headers: {
                                Referer: `https://m.douban.com/subject_collection/${col}`,
                                "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
                            },
                        }
                    );
                    if (!res.ok) { if (col !== "book_bestseller") break; continue; }
                    const json = await res.json();
                    const items = (json?.subject_collection_items || []) as {
                        id?: string; title?: string; cover?: { url?: string }; rating?: { value?: number }; info?: string;
                    }[];
                    for (const it of items) {
                        const t = it.title?.trim();
                        if (!t || localTitles.has(t) || extTitles.has(t)) continue;
                        const id = `ext-book-${it.id || t}`;
                        insert.run(id, "book", t,
                            it.cover?.url ? proxy(it.cover.url) : null, null,
                            it.info || "", null, it.rating?.value ?? null, null);
                        extTitles.add(t); added.push(t);
                        if (added.length >= 10) break;
                    }
                } catch { /* 换下一页 */ }
            }
        } else if (type === "musical") {
            // 舞台音乐剧（stage musical）：从精选清单挑未收藏的，海报按英文名 TMDB search 借封面
            const keyRow = db.prepare("SELECT value FROM settings WHERE key = 'tmdb_api_key'").get() as { value: string } | undefined;
            const apiKey = keyRow?.value;
            const pool = MUSICALS.filter((m) => !extTitles.has(m.title) && !localTitles.has(m.title));
            for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
            const picks = pool.slice(0, 10);
            const posters = await Promise.all(picks.map((m) => apiKey ? fetchPoster(m.en, apiKey) : Promise.resolve(null)));
            picks.forEach((m, i) => {
                insert.run(`ext-musical-${m.id}`, "musical", m.title, posters[i], null, m.overview, m.year, null, null);
                extTitles.add(m.title); added.push(m.title);
            });
        } else {
            // 影视：TMDB discover（人气排序 + 口味/年代过滤），翻页凑满 10 个不重复
            const keyRow = db.prepare("SELECT value FROM settings WHERE key = 'tmdb_api_key'").get() as { value: string } | undefined;
            if (!keyRow?.value) return NextResponse.json({ success: false, error: "NO_TMDB_KEY" }, { status: 500 });
            const media = type === "movie" ? "movie" : "tv";
            const dateField = media === "movie" ? "primary_release_date" : "first_air_date";
            const genres = type === "anime" ? "16" : (MOOD_GENRES[answers.mood || ""] || "");
            const sort = answers.taste === "gem"
                ? "vote_average.desc&vote_count.gte=500"
                : "popularity.desc&vote_count.gte=200";
            const yearNow = new Date().getFullYear();
            const era = answers.era === "new" ? `&${dateField}.gte=${yearNow - 3}-01-01`
                : answers.era === "classic" ? `&${dateField}.lte=${yearNow - 10}-12-31`
                : "";
            const anime = type === "anime" ? `&with_origin_country=JP${answers.mood === "brain" ? "" : ""}` : "";

            for (let page = 1; page <= 4 && added.length < 10; page++) {
                const url =
                    `https://api.themoviedb.org/3/discover/${media}?api_key=${keyRow.value}` +
                    `&language=zh-CN&include_adult=false&sort_by=${sort}` +
                    (genres ? `&with_genres=${encodeURIComponent(genres)}` : "") +
                    `&without_genres=27,53,80,10752${era}${anime}&page=${page}`;
                const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
                if (!res.ok) break;
                const json = await res.json();
                const rows = (json.results || []) as {
                    id: number; title?: string; name?: string; overview?: string;
                    poster_path?: string | null; backdrop_path?: string | null;
                    release_date?: string; first_air_date?: string; vote_average?: number;
                }[];
                for (const r of rows) {
                    const t = (r.title || r.name || "").trim();
                    if (!t || localTitles.has(t) || extTitles.has(t) || extTmdb.has(r.id)) continue;
                    const y = (r.release_date || r.first_air_date || "").slice(0, 4);
                    insert.run(`ext-${media}-${r.id}`, type, t,
                        r.poster_path ? proxy(`https://image.tmdb.org/t/p/w500${r.poster_path}`) : null,
                        r.backdrop_path ? proxy(`https://image.tmdb.org/t/p/w1280${r.backdrop_path}`) : null,
                        r.overview || "", y ? Number(y) : null, r.vote_average ?? null, r.id);
                    extTitles.add(t); extTmdb.add(r.id); added.push(t);
                    if (added.length >= 10) break;
                }
            }
        }
        return NextResponse.json({ success: true, added: added.length, titles: added });
    } catch (e) {
        return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
    }
}
