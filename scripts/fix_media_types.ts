import { getDb } from "../lib/db";
import path from "path";

async function fixTypes() {
    console.log("Starting type fix-up script...");
    const db = getDb();

    // 1. 获取所有配置的目录及其类型
    const settings = db.prepare("SELECT value FROM settings WHERE key LIKE 'media_dir_%'").all() as { value: string }[];
    const dirConfigs = settings.map(s => JSON.parse(s.value));

    console.log(`Found ${dirConfigs.length} media directories.`);

    // 2. 遍历所有媒体记录，根据其物理路径所属的目录更新类型
    const mediaItems = db.prepare("SELECT id, path, type FROM media").all() as { id: string; path: string; type: string }[];

    let updatedCount = 0;

    const updateStmt = db.prepare("UPDATE media SET type = ? WHERE id = ?");

    for (const item of mediaItems) {
        const resolvedItemPath = path.resolve(item.path);

        // 查找该路径属于哪个配置目录
        const matchedDir = dirConfigs.find(config => {
            const resolvedConfigPath = path.resolve(config.path);
            return resolvedItemPath.startsWith(resolvedConfigPath);
        });

        if (matchedDir && matchedDir.type !== item.type) {
            console.log(`Fixing type for ${item.path}: ${item.type} -> ${matchedDir.type}`);
            updateStmt.run(matchedDir.type, item.id);
            updatedCount++;
        }
    }

    console.log(`Type fix-up complete. Updated ${updatedCount} items.`);
}

fixTypes().catch(console.error);
