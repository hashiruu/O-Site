import fs from "fs";
import path from "path";
import { getDb } from "./db";
import { v4 as uuidv4 } from "uuid";

// 支持的视频格式
const VIDEO_EXTS = new Set(['.mp4', '.mkv', '.avi', '.mov', '.webm', '.flv']);
const SUBTITLE_EXTS = new Set(['.srt', '.vtt', '.ass']);

interface ScanResult {
    added: number;
    updated: number;
    errors: string[];
}

// 核心扫描器：扫描并导入媒体记录 (SSE 兼容版)
export async function scanMediaDirectory(
    scanPath: string,
    scanType: string,
    scanName: string,
    onProgress?: (msg: string) => void
): Promise<ScanResult> {
    const db = getDb();
    const result: ScanResult = { added: 0, updated: 0, errors: [] };
    const currentPaths = new Set<string>();

    // 预载已有记录的路径映射：把"每个文件一次 SELECT"变成内存查表，大库重扫快一个量级
    const mediaByPath = new Map<string, string>();
    for (const r of db.prepare("SELECT id, path FROM media").all() as { id: string; path: string }[]) {
        mediaByPath.set(path.normalize(r.path), r.id);
    }
    const episodeByPath = new Map<string, string>();
    for (const r of db.prepare("SELECT id, path FROM episodes").all() as { id: string; path: string }[]) {
        episodeByPath.set(path.normalize(r.path), r.id);
    }

    // 从数据库获取所有媒体目录配置，用于判断路径归属和垃圾回收
    const allConfigRows = db.prepare("SELECT value FROM settings WHERE key LIKE 'media_dir_%'").all() as { value: string }[];
    const mappings = allConfigRows.map(r => {
        try { return JSON.parse(r.value); } catch { return null; }
    }).filter(Boolean) as { path: string; type: string; name: string }[];

    // 辅助函数：判断路径是否命中任一库配置前缀 (Windows 兼容)
    const hasMappedPrefix = (p: string) => {
        const normP = path.normalize(p).toLowerCase();
        return mappings.some(m => normP.startsWith(path.normalize(m.path).toLowerCase()));
    };

    // --- TMDB 抓取辅助 ---
    async function fetchTmdbInfo(query: string) {
        try {
            const tmdbRow = db.prepare("SELECT value FROM settings WHERE key = 'tmdb_api_key'").get() as { value: string } | undefined;
            const apiKey = tmdbRow?.value;
            if (!apiKey) return null;

            let cleanQuery = query.replace(/[\[\(].*?[\]\)]/g, "").trim();
            let year = "";
            const yearMatch = cleanQuery.match(/(19\d{2}|20\d{2})/);
            if (yearMatch) {
                year = yearMatch[1];
                cleanQuery = cleanQuery.substring(0, yearMatch.index).trim();
            }

            let tmdbUrl = `https://api.themoviedb.org/3/search/multi?api_key=${apiKey}&language=zh-CN&query=${encodeURIComponent(cleanQuery)}&page=1`;
            if (year) tmdbUrl += `&primary_release_year=${year}`;

            const res = await fetch(tmdbUrl);
            const data = await res.json();
            if (data.results && data.results.length > 0) {
                const match = data.results[0];
                return {
                    poster: match.poster_path ? `https://image.tmdb.org/t/p/w500${match.poster_path}` : null,
                    backdrop: match.backdrop_path ? `https://image.tmdb.org/t/p/w1280${match.backdrop_path}` : null,
                    overview: match.overview,
                    year: match.release_date ? parseInt(match.release_date.substring(0, 4)) : (match.first_air_date ? parseInt(match.first_air_date.substring(0, 4)) : null),
                    rating: match.vote_average || null
                };
            }
        } catch (e) {
            console.error("TMDB Fetch failed during scan:", e);
        }
        return null;
    }

    async function importMedia(filePath: string, fileName: string, type: string) {
        try {
            const normalizedPath = path.normalize(filePath);
            currentPaths.add(normalizedPath);

            const title = cleanTitle(fileName);

            if (!mediaByPath.has(normalizedPath)) {
                const mediaId = uuidv4();
                const isMediaClass = ["movie", "series", "anime"].includes(type);
                const tmdbData = isMediaClass ? await fetchTmdbInfo(title) : null;

                db.prepare(
                    `INSERT INTO media (id, title, type, path, duration, poster, backdrop, overview, year, rating, created_at, updated_at)
                     VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)`
                ).run(
                    mediaId, title, type, normalizedPath,
                    tmdbData?.poster || null, tmdbData?.backdrop || null, tmdbData?.overview || null, tmdbData?.year || null, tmdbData?.rating || null,
                    new Date().toISOString(), new Date().toISOString()
                );
                mediaByPath.set(normalizedPath, mediaId);
                result.added++;
            }
        } catch (e) {
            console.error(`[Scan] 导入媒体失败: ${filePath}`, e);
        }
    }

    async function importSeries(seriesDir: string, seriesName: string, type: string) {
        try {
            const normalizedSeriesDir = path.normalize(seriesDir);
            currentPaths.add(normalizedSeriesDir);

            let seriesId = mediaByPath.get(normalizedSeriesDir);
            if (!seriesId) {
                seriesId = uuidv4();
                const tmdbData = await fetchTmdbInfo(seriesName);
                db.prepare(`INSERT INTO media (id, title, type, path, duration, poster, backdrop, overview, year, rating, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)`).run(
                    seriesId, seriesName, type, normalizedSeriesDir,
                    tmdbData?.poster || null, tmdbData?.backdrop || null, tmdbData?.overview || null, tmdbData?.year || null, tmdbData?.rating || null,
                    new Date().toISOString(), new Date().toISOString()
                );
                mediaByPath.set(normalizedSeriesDir, seriesId);
                result.added++;
            }

            const videoFiles = findVideoFiles(seriesDir);
            for (const videoFile of videoFiles) {
                const normalizedVideoPath = path.normalize(videoFile.path);
                currentPaths.add(normalizedVideoPath);

                const parsed = parseEpisode(videoFile.name, videoFile.path);
                const existingEpId = episodeByPath.get(normalizedVideoPath);

                if (existingEpId) {
                    // 注意：episodes 表没有 updated_at 列。旧代码在这里 SET updated_at 导致
                    // UPDATE 抛错被外层 catch 吞掉，重扫时已有剧集的分集全部同步失败
                    db.prepare("UPDATE episodes SET media_id = ?, season = ?, episode = ? WHERE id = ?")
                        .run(seriesId, parsed.season, parsed.episode, existingEpId);
                    result.updated++;
                } else {
                    const epId = uuidv4();
                    db.prepare(`INSERT INTO episodes (id, media_id, season, episode, title, path, duration) VALUES (?, ?, ?, ?, ?, ?, 0)`).run(
                        epId, seriesId, parsed.season, parsed.episode, cleanTitle(videoFile.name), normalizedVideoPath
                    );
                    episodeByPath.set(normalizedVideoPath, epId);
                }
            }
            onProgress?.(`[剧集] 已同步: ${seriesName} (${videoFiles.length} 集)`);
        } catch (e) {
            console.error(`[Scan] 导入剧集失败: ${seriesDir}`, e);
        }
    }

    function findVideoFiles(dirPath: string): { name: string; path: string }[] {
        const videos: { name: string; path: string }[] = [];
        try {
            const entries = fs.readdirSync(dirPath, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(dirPath, entry.name);
                if (entry.name.startsWith(".") || entry.name === "danmaku") continue;
                if (entry.isFile() && VIDEO_EXTS.has(path.extname(entry.name).toLowerCase())) {
                    videos.push({ name: entry.name, path: fullPath });
                } else if (entry.isDirectory()) {
                    videos.push(...findVideoFiles(fullPath));
                }
            }
        } catch {}
        return videos;
    }

    async function scanDir(currentPath: string) {
        onProgress?.(`[目录] 正在扫描: ${currentPath}`);
        const entries = fs.readdirSync(currentPath, { withFileTypes: true });
        
        // 判断当前目录是否属于某个分类，默认使用传入的 scanType
        const mapping = mappings.find(m => path.normalize(currentPath).toLowerCase().startsWith(path.normalize(m.path).toLowerCase()));
        const type = mapping?.type || scanType;

        // 如果是剧集/动漫，第一级子目录视为系列 root
        if (type === 'series' || type === 'anime') {
            for (const entry of entries) {
                if (entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "danmaku") {
                    await importSeries(path.join(currentPath, entry.name), entry.name, type);
                }
            }
            return;
        }

        for (const entry of entries) {
            if (entry.name.startsWith(".") || entry.name === "danmaku") continue;
            const fullPath = path.join(currentPath, entry.name);
            if (entry.isDirectory()) {
                await scanDir(fullPath);
            } else if (entry.isFile() && VIDEO_EXTS.has(path.extname(entry.name).toLowerCase())) {
                await importMedia(fullPath, entry.name, type);
            }
        }
    }

    if (fs.existsSync(scanPath)) {
        await scanDir(scanPath);
    } else {
        onProgress?.(`[跳过] 目录不存在: ${scanPath}`);
    }

    onProgress?.("[清理] 正在执行垃圾回收...");
    // 批量 GC：episode 路径一次载入内存查表（旧实现每条 media 一次子查询），删除套事务
    db.transaction(() => {
        const epPathSet = new Set(
            (db.prepare("SELECT path FROM episodes").all() as { path: string }[]).map(r => path.normalize(r.path))
        );
        const allMedia = db.prepare("SELECT id, path FROM media").all() as { id: string; path: string }[];
        for (const row of allMedia) {
            const normPath = path.normalize(row.path);
            // 只删除：已是 episode 的重复条目，或路径不在任何配置目录下的孤儿记录
            // 注意：不在 currentPaths 但在其他配置目录下的记录要保留（它们由各自的扫描任务负责）
            if (epPathSet.has(normPath) || (!currentPaths.has(normPath) && !hasMappedPrefix(normPath))) {
                db.prepare("DELETE FROM media WHERE id = ?").run(row.id);
            }
        }

        const allEpisodes = db.prepare("SELECT id, path FROM episodes").all() as { id: string; path: string }[];
        for (const row of allEpisodes) {
            const normPath = path.normalize(row.path);
            if (!currentPaths.has(normPath) && !hasMappedPrefix(normPath)) {
                db.prepare("DELETE FROM episodes WHERE id = ?").run(row.id);
            }
        }
    })();

    onProgress?.(`[完成] 🎉 扫描任务结束！`);
    return result;
}

// 清理由文件名推断出的标题
export function cleanTitle(filename: string): string {
    let title = path.parse(filename).name;

    // 去掉开头的发布组声明：【喵萌奶茶屋】 或 [SubsPlease]
    title = title.replace(/^\s*(?:【[^】]*】|\[[^\]]*\])\s*/, "");

    // 其余括号只去壳保留内容（CJK 发布习惯把正片名/集数也包在括号里）
    title = title.replace(/[\[\]【】()（）]/g, " ");

    // 点号连接的压制标签（Avengers.2012.1080p.BluRay.x264 风格）
    title = title
        .replace(/\.(2160p|1080p|720p|480p|4K)/gi, "")
        .replace(/\.(BluRay|BDRip|HDRip|WEB-DL|WEBRip|HDTV|DVDRip)/gi, "")
        .replace(/\.(x264|x265|HEVC|AVC|AAC|DTS|FLAC)/gi, "");

    // 独立 token 形式的压制标签（去括号后残留）
    title = title
        .replace(/(^|\s)(2160p|1080p|720p|480p|4K)(?=\s|$)/gi, " ")
        .replace(/(^|\s)(BluRay|BDRip|HDRip|WEB-DL|WEBRip|HDTV|DVDRip)(?=\s|$)/gi, " ")
        .replace(/(^|\s)(x264|x265|HEVC|AVC|AAC|DTS|FLAC)(?=\s|$)/gi, " ");

    if (!title.includes(" ") && title.includes(".")) {
        title = title.replace(/\./g, " ");
    }
    return title.replace(/[★_]/g, " ").replace(/\s+/g, " ").trim() || filename;
}

const CN_NUM_MAP: Record<string, number> = {
    '一': 1, '二': 2, '三': 3, '四': 4, '五': 5,
    '六': 6, '七': 7, '八': 8, '九': 9, '十': 10,
};

function parseCnNumber(str: string): number | null {
    if (CN_NUM_MAP[str] !== undefined) return CN_NUM_MAP[str];
    const n = parseInt(str);
    return isNaN(n) ? null : n;
}

export function parseEpisode(filename: string, fullPath: string = ""): { season: number; episode: number } {
    let season = 1;
    let episode = 0;

    if (fullPath) {
        const pathParts = path.normalize(fullPath).split(path.sep);
        for (const part of pathParts.reverse()) {
            const sMatch = part.match(/[Ss](?:eason\s*)?(\d{1,2})/i);
            if (sMatch) { season = parseInt(sMatch[1]); break; }
            const cnSeasonMatch = part.match(/第([一二三四五六七八九十\d]{1,2})季/);
            if (cnSeasonMatch) {
                const parsed = parseCnNumber(cnSeasonMatch[1]);
                if (parsed) { season = parsed; break; }
            }
        }
    }

    const cleanName = filename.toLowerCase()
        .replace(/(2160|1080|720|480)p/g, "")
        .replace(/[hx]26[45]/g, "");

    const seMatch = cleanName.match(/s(\d{1,2})e(\d{1,4})/);
    if (seMatch) return { season: parseInt(seMatch[1]), episode: parseInt(seMatch[2]) };

    const xMatch = cleanName.match(/(?:^|[^a-z0-9])(\d{1,2})x(\d{1,4})(?:[^a-z0-9]|$)/);
    if (xMatch) return { season: parseInt(xMatch[1]), episode: parseInt(xMatch[2]) };

    const epMatch = cleanName.match(/(?:^|[^a-z])[e][p]?(\d{1,4})/);
    if (epMatch) return { season, episode: parseInt(epMatch[1]) };

    const cnMatch = filename.match(/第(\d{1,4})[集话]/);
    if (cnMatch) return { season, episode: parseInt(cnMatch[1]) };

    const biliPMatch = cleanName.match(/[_\s]p(\d{1,4})/);
    if (biliPMatch) return { season, episode: parseInt(biliPMatch[1]) };

    const looseNum = cleanName.match(/(?:^|\D)(\d{1,4})(?:\D|$)/);
    if (looseNum) {
        const n = parseInt(looseNum[1]);
        // 裸数字兜底跳过年份样式（"Interstellar 2014" 不是第 2014 集）；
        // 真上千集的番剧由上面的显式 E/第X集 模式命中，不受影响
        if (n < 1900 || n > 2099) return { season, episode: n };
    }

    return { season, episode: 0 };
}
