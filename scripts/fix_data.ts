import { getDb } from "../lib/db";

const db = getDb();
try {
    const settings = db.prepare("SELECT key, value FROM settings WHERE key LIKE 'media_dir_%'").all() as any[];
    for (const row of settings) {
        const config = JSON.parse(row.value);
        if (config.path && config.type) {
            const res = db.prepare("UPDATE media SET type = ? WHERE path LIKE ?").run(config.type, `${config.path}%`);
            console.log(`Updated ${res.changes} items to type '${config.type}' tracking path: ${config.path}`);
        }
    }
    console.log("Historical records have been mapped and re-aligned with correct types successfully!");
} catch (e) {
    console.error("Error re-aligning dirty data:", e);
}
