import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

// 数据库路径
const DB_DIR = path.join(process.cwd(), "data");
const DB_PATH = process.env.DATABASE_PATH || path.join(DB_DIR, "nas-media.db");

// 确保 data 目录存在
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

// 单例数据库连接（通过 globalThis 持久化，防止 Next.js HMR 重建模块时泄漏连接）
const globalForDb = globalThis as typeof globalThis & { __nasDb?: Database.Database };

export function getDb(): Database.Database {
  if (!globalForDb.__nasDb) {
    globalForDb.__nasDb = new Database(DB_PATH);
    globalForDb.__nasDb.pragma("journal_mode = WAL");
    globalForDb.__nasDb.pragma("foreign_keys = ON");
    initializeDatabase(globalForDb.__nasDb);
  }
  return globalForDb.__nasDb;
}

function initializeDatabase(db: Database.Database) {
  db.exec(`
    -- 媒体表
    CREATE TABLE IF NOT EXISTS media (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      type TEXT NOT NULL,
      path TEXT NOT NULL UNIQUE,
      poster TEXT,
      backdrop TEXT,
      overview TEXT,
      year INTEGER,
      rating REAL,
      duration INTEGER NOT NULL DEFAULT 0,
      metadata TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // --- 数据库热迁移：为旧版数据库补充 'travel' 到 CHECK 约束 ---
  // SQLite 不支持直接修改 CHECK，我们需要检查当前表结构
  try {
    const tableInfo = db.prepare("PRAGMA table_info(media)").all() as any[];
    const typeCol = tableInfo.find(c => c.name === 'type');
    // 注意：table_info 不在所有版本中都返回完整的 CHECK 约束字符串，
    // 最稳妥的方法是尝试插入一个 'travel' 类型，如果失败则说明需要迁移。
    try {
      db.prepare("INSERT INTO media (id, title, type, path) VALUES ('check_test_2', 'test', 'custom_test_type', 'check_test_path_custom')").run();
      db.prepare("DELETE FROM media WHERE id = 'check_test_2'").run();
    } catch (e: any) {
      if (e.message.includes("CHECK constraint failed")) {
        console.log("检测到旧版数据库约束，正在迁移以移除 type 字段的枚举白名单硬限制...");
        // foreign_keys=ON 时 rename+drop 旧表会破坏 episodes 外键引用，迁移期间先关（报告第四章）
        db.pragma("foreign_keys = OFF");
        try {
          db.transaction(() => {
            db.exec(`
              ALTER TABLE media RENAME TO media_old;
              CREATE TABLE media (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                type TEXT NOT NULL,
                path TEXT NOT NULL UNIQUE,
                poster TEXT, backdrop TEXT, overview TEXT, year INTEGER, rating REAL,
                duration INTEGER NOT NULL DEFAULT 0,
                metadata TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
              );
              INSERT INTO media (id, title, type, path, poster, backdrop, overview, year, rating, duration, metadata, created_at, updated_at)
              SELECT id, title, type, path, poster, backdrop, overview, year, rating, duration, metadata, created_at, updated_at FROM media_old;
              DROP TABLE media_old;
            `);
          })();
        } finally {
          db.pragma("foreign_keys = ON");
        }
        console.log("数据库约束移除迁移成功。");
      }
    }
  } catch (err) {
    console.error("Migration check failed:", err);
  }

  // 接下来的其它表...
  db.exec(`
    -- 剧集表
    CREATE TABLE IF NOT EXISTS episodes (
      id TEXT PRIMARY KEY,
      media_id TEXT NOT NULL,
      season INTEGER NOT NULL,
      episode INTEGER NOT NULL,
      title TEXT NOT NULL,
      path TEXT NOT NULL UNIQUE,
      duration INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (media_id) REFERENCES media(id) ON DELETE CASCADE
    );

    -- 观看进度表
    CREATE TABLE IF NOT EXISTS watch_progress (
      id TEXT PRIMARY KEY,
      media_id TEXT NOT NULL,
      episode_id TEXT,
      position INTEGER NOT NULL DEFAULT 0,
      duration INTEGER NOT NULL DEFAULT 0,
      completed INTEGER NOT NULL DEFAULT 0,
      last_watched DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (media_id) REFERENCES media(id) ON DELETE CASCADE,
      FOREIGN KEY (episode_id) REFERENCES episodes(id) ON DELETE CASCADE
    );

    -- 播放列表表
    CREATE TABLE IF NOT EXISTS playlists (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      cover TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- 播放列表-媒体关联表
    CREATE TABLE IF NOT EXISTS playlist_media (
      playlist_id TEXT NOT NULL,
      media_id TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (playlist_id, media_id),
      FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE,
      FOREIGN KEY (media_id) REFERENCES media(id) ON DELETE CASCADE
    );

    -- 字幕表
    CREATE TABLE IF NOT EXISTS subtitles (
      id TEXT PRIMARY KEY,
      media_id TEXT NOT NULL,
      language TEXT NOT NULL,
      path TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(media_id, language)
    );

    -- 弹幕表
    CREATE TABLE IF NOT EXISTS danmaku (
        id TEXT PRIMARY KEY,
        media_id TEXT NOT NULL,
        time REAL NOT NULL,
        text TEXT NOT NULL,
        color TEXT NOT NULL,
        type INTEGER NOT NULL,
        author TEXT,
        created_at TEXT NOT NULL
    );

    -- 转码任务表
    CREATE TABLE IF NOT EXISTS transcode_jobs (
      id TEXT PRIMARY KEY,
      source_path TEXT NOT NULL,
      output_path TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      progress REAL DEFAULT 0,
      video_codec TEXT,
      audio_codec TEXT,
      selected_audio INTEGER,
      selected_subtitle INTEGER,
      error TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      completed_at DATETIME
    );

    -- 系统配置表（用于私密空间密码等）
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    -- What You Missed：热点补课清单条目（/missed，采集自 tmdb/openlibrary/steam 或手动添加）
    -- released = 内容自身的发布日期（YYYY-MM-DD），列表按它从新到旧排；无发布日期的按入库时间落位
    CREATE TABLE IF NOT EXISTS missed_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      cover TEXT,
      year INTEGER,
      released TEXT,
      source TEXT NOT NULL,
      source_id TEXT NOT NULL,
      extra TEXT,
      added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(source, source_id)
    );

    -- What You Missed：用户标记（看过了没/看了多少），与条目分表以便采集 upsert 不覆盖用户状态
    CREATE TABLE IF NOT EXISTS missed_status (
      item_id INTEGER PRIMARY KEY REFERENCES missed_items(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'unseen',
      progress INTEGER NOT NULL DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 迁移：missed_items.released（内容发布日期）——旧库补列，幂等
  const missedCols = db.prepare("PRAGMA table_info(missed_items)").all() as { name: string }[];
  if (!missedCols.some((c) => c.name === "released")) {
    db.exec("ALTER TABLE missed_items ADD COLUMN released TEXT");
  }

  // 私密空间密码：不植入任何默认值。
  // 历史遗留曾用 INSERT OR REPLACE 每次启动覆盖用户密码、并植入一个写错（65 字符）的 hash，
  // 导致私密空间被锁死、只能靠硬编码后门进入。这里改为：仅在已存值不是合法 sha256（64 位 hex）
  // 时一次性清除，让用户重新走 setup；用户自己设的有效密码永不被动。
  const existingPw = db.prepare("SELECT value FROM settings WHERE key = 'private_password'").get() as { value: string } | undefined;
  if (existingPw && !/^[0-9a-f]{64}$/.test(existingPw.value)) {
    db.prepare("DELETE FROM settings WHERE key = 'private_password'").run();
    console.log("[db] 清除无效的私密空间密码 hash（历史脏数据），请重新设置密码。");
  }

  db.exec(`

    -- 索引（media.path / episodes.path 由 UNIQUE 约束自带隐式索引，无需重复建）
    CREATE INDEX IF NOT EXISTS idx_media_type ON media(type);
    CREATE INDEX IF NOT EXISTS idx_media_year ON media(year);
    CREATE INDEX IF NOT EXISTS idx_media_type_created ON media(type, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_episodes_media ON episodes(media_id);
    CREATE INDEX IF NOT EXISTS idx_episodes_media_order ON episodes(media_id, season, episode);
    CREATE INDEX IF NOT EXISTS idx_progress_media ON watch_progress(media_id);
    CREATE INDEX IF NOT EXISTS idx_progress_media_episode ON watch_progress(media_id, episode_id);
    CREATE INDEX IF NOT EXISTS idx_progress_last ON watch_progress(last_watched);
    CREATE INDEX IF NOT EXISTS idx_transcode_status_created ON transcode_jobs(status, created_at);
    CREATE INDEX IF NOT EXISTS idx_danmaku_media_time ON danmaku (media_id, time);
    CREATE INDEX IF NOT EXISTS idx_missed_items_kind ON missed_items(kind);
  `);
}

// 获取媒体库统计
export function getMediaStats() {
  const db = getDb();
  const rows = db
    .prepare("SELECT type, COUNT(*) as count FROM media GROUP BY type")
    .all() as { type: string; count: number }[];

  const stats = { movie: 0, series: 0, anime: 0, travel: 0, private: 0, total: 0 };
  for (const row of rows) {
    if (row.type in stats) {
      stats[row.type as keyof typeof stats] = row.count;
      stats.total += row.count;
    }
  }
  return stats;
}

// 私密空间密码相关
export function getPrivatePassword(): string | null {
  const db = getDb();
  const row = db
    .prepare("SELECT value FROM settings WHERE key = 'private_password'")
    .get() as { value: string } | undefined;
  return row?.value || null;
}

export function setPrivatePassword(passwordHash: string) {
  const db = getDb();
  db.prepare(
    "INSERT OR REPLACE INTO settings (key, value) VALUES ('private_password', ?)"
  ).run(passwordHash);
}

export function isPrivatePasswordSet(): boolean {
  return getPrivatePassword() !== null;
}
