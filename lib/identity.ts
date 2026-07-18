// 用户身份解析 + 私人数据的用户维度迁移。
// 身份优先级：Google 会话邮箱 > 设备信任 cookie（视为站长本人的设备）> "guest"。
// 存量数据（加列前的历史）一次性归属站长（PRIVILEGED_EMAILS 第一个邮箱）。
// 私密口令的"账户级记忆"存 private_grants：账户输对一次口令即永久记忆，跨设备生效。
import type { NextRequest } from "next/server";
import { getDb } from "./db";
import { TRUST_COOKIE, verifyTrustToken } from "./deviceTrust";
import { auth } from "@/auth";

export const OWNER = (process.env.PRIVILEGED_EMAILS || "")
    .split(",")[0]?.trim().toLowerCase() || "local";

let migrated = false;

/** 私人数据表加 user_id 维度（幂等；不动 lib/db.ts，避免与其他并行改动冲突） */
export function ensureUserSchema(): void {
    if (migrated) return;
    const db = getDb();
    const addUserCol = (table: string) => {
        const cols = (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
        if (!cols.includes("user_id")) {
            db.exec(`ALTER TABLE ${table} ADD COLUMN user_id TEXT NOT NULL DEFAULT 'legacy'`);
            // 加列时存在的行都是历史数据 → 归站长
            db.prepare(`UPDATE ${table} SET user_id = ? WHERE user_id = 'legacy'`).run(OWNER);
        }
    };
    addUserCol("watch_progress");
    addUserCol("playlists");
    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_progress_user_last ON watch_progress(user_id, last_watched);
        CREATE TABLE IF NOT EXISTS private_grants (
            user_id TEXT PRIMARY KEY,
            granted_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    `);
    migrated = true;
}

/** 全站铁律：未登录不落任何个人数据、不提供个人化功能。
 *  已登录（Google 会话邮箱）返回归属键，否则返回 null——
 *  个人数据 API 一律用这个严格版：null 时写操作返回 401 LOGIN_REQUIRED，读操作返回空。 */
export async function resolveUserKeyOrNull(req: NextRequest): Promise<string | null> {
    ensureUserSchema();
    try {
        const session = await auth();
        const email = session?.user?.email?.toLowerCase();
        if (email) return email;
    } catch { /* auth 未配置 → 视为未登录 */ }
    void req; // 信任 cookie 已废弃，不再算登录态
    return null;
}

/** @deprecated 旧宽松版（guest 也给键，导致所有未登录者共享 'guest' 数据）。
 *  个人数据路由请改用 resolveUserKeyOrNull。 */
export async function resolveUserKey(req: NextRequest): Promise<string> {
    ensureUserSchema();
    try {
        const session = await auth();
        const email = session?.user?.email?.toLowerCase();
        if (email) return email;
    } catch { /* auth 未配置时走下面的路径 */ }
    if (verifyTrustToken(req.cookies.get(TRUST_COOKIE)?.value)) return OWNER;
    return "guest";
}

/** 账户级私密授权：该账户是否输过一次正确口令 */
export function hasPrivateGrant(userKey: string): boolean {
    ensureUserSchema();
    return !!getDb().prepare("SELECT 1 FROM private_grants WHERE user_id = ?").get(userKey);
}

/** 记录账户级私密授权（输对口令时调用） */
export function recordPrivateGrant(userKey: string): void {
    ensureUserSchema();
    getDb().prepare("INSERT OR IGNORE INTO private_grants (user_id) VALUES (?)").run(userKey);
}
