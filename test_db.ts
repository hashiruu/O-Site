import { getDb } from "./lib/db";

try {
    const db = getDb();
    console.log("DB connection successful");
    const rows = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    console.log("Tables:", rows);
} catch (e) {
    console.error("DB connection error:", e);
}
