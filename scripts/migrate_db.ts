// DB migration script for SQLite
import { getDb } from "../lib/db";

const db = getDb();

try {
    db.exec(`
        PRAGMA foreign_keys=off;
        
        CREATE TABLE IF NOT EXISTS media_new (
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

        INSERT INTO media_new SELECT * FROM media;
        DROP TABLE media;
        ALTER TABLE media_new RENAME TO media;

        CREATE INDEX IF NOT EXISTS idx_media_type ON media(type);
        CREATE INDEX IF NOT EXISTS idx_media_year ON media(year);

        PRAGMA foreign_keys=on;
    `);
    console.log("Migration successful: removed strict CHECK constraint on media type.");
} catch (e) {
    console.error("Migration failed:", e);
}
