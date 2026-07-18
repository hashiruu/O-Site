import { getDb } from "../lib/db";

const db = getDb();
try {
    const rows = db.prepare("SELECT type, COUNT(*) as count FROM media GROUP BY type").all();
    console.log("Media Types in DB:");
    console.log(JSON.stringify(rows, null, 2));

    const settings = db.prepare("SELECT key, value FROM settings WHERE key LIKE 'media_dir_%'").all();
    console.log("Configured Directories:");
    console.log(JSON.stringify(settings, null, 2));
} catch (e) {
    console.error(e);
}
