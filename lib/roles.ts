// 三层权限身份系统：boss（env）/ admin（DB users.role）/ regular（默认）/ guest（未登录）。
// 所有建表就地完成（不动 lib/db.ts，避免与并行改动冲突）。
// 旧 deviceTrust/private_grants 机制废弃，全部走 Google 登录。
import type { NextRequest } from "next/server";
import { getDb } from "./db";

export type Role = "boss" | "admin" | "regular" | "guest";

const BOSS_EMAILS = (process.env.BOSS_EMAILS || "")
    .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

let ensured = false;
function ensureSchema(): void {
    if (ensured) return;
    getDb().exec(`
        CREATE TABLE IF NOT EXISTS users (
            email TEXT PRIMARY KEY,
            role TEXT NOT NULL DEFAULT 'regular',
            name TEXT, avatar TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            last_seen DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS user_permissions (
            user_id TEXT PRIMARY KEY,
            scope TEXT NOT NULL,
            granted_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS logins (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT NOT NULL,
            ip TEXT, ua TEXT,
            at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS search_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT NOT NULL,
            query TEXT NOT NULL,
            at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_logins_email ON logins(email, at);
        CREATE INDEX IF NOT EXISTS idx_search_email ON search_logs(email, at);
        CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
    `);
    ensured = true;
}

/** 纯 DB 查询（不调 auth，避免 session callback 内递归） */
export function getRoleByEmail(email: string | null | undefined): Role {
    if (!email) return "guest";
    ensureSchema();
    const e = email.toLowerCase();
    if (BOSS_EMAILS.includes(e)) return "boss";
    const row = getDb().prepare("SELECT role FROM users WHERE email = ?").get(e) as { role: string } | undefined;
    if (!row) return "regular"; // 登录但未入库（理论上 signIn event 已 upsert，兜底）
    return row.role === "banned" ? "guest" : (row.role as Role);
}

/** 当前请求的角色（调 auth 拿 session email → 走 getRoleByEmail） */
export async function getRole(req?: NextRequest): Promise<Role> {
    try {
        const { auth } = await import("@/auth");
        const session = await auth();
        return getRoleByEmail(session?.user?.email);
    } catch {
        return "guest"; // auth 未配置/异常
    }
}

export function canViewPrivate(role: Role): boolean {
    return role === "boss" || role === "admin";
}

export function canAdminSite(role: Role): boolean {
    return role === "boss" || role === "admin";
}

export function canManageUsers(role: Role): boolean {
    return role === "boss";
}

// ---------- 内容范围授权（boss 统一管理，覆盖全站各类别） ----------
// 默认普通用户/guest 是"空白网站"：scopes 为空集，看不到任何栏目内容。
// boss 通过 user_permissions.scope（逗号分隔类别 或 "*"）逐用户开栏目。
// 类别 = media.type（movie/series/anime/travel/private/theater相册/日常）+ 栏目（book/live/sports/missed）。

/** 仅 boss 可见的类别（重要资料！下的个人内容）：不参与授权分配，admin 也看不到 */
export const BOSS_ONLY_TYPES = ["private", "travel", "theater相册", "日常"];

export interface Access {
    role: Role;
    email?: string;
    /** null = 不限（boss/admin 或 scope="*"）；空 Set = 全拒（默认）。boss 专属类别不走 scopes，见 allows */
    scopes: Set<string> | null;
}

export function getScopesFor(role: Role, email?: string): Set<string> | null {
    if (role === "boss" || role === "admin") return null;
    if (!email) return new Set();
    const scope = getUserPermission(email);
    if (!scope || !scope.trim()) return new Set();
    if (scope.trim() === "*") return null;
    // boss 专属类别即使残留在 DB scope 里也剔除，杜绝旧数据越权
    return new Set(scope.split(",").map((s) => s.trim().toLowerCase()).filter((s) => s && !BOSS_ONLY_TYPES.includes(s)));
}

/** 一次拿到请求的完整访问上下文（role + email + 可见类别集合） */
export async function getAccess(req?: NextRequest): Promise<Access> {
    try {
        const { auth } = await import("@/auth");
        const session = await auth();
        const email = session?.user?.email ?? undefined;
        const role = getRoleByEmail(email);
        return { role, email, scopes: getScopesFor(role, email) };
    } catch {
        return { role: "guest", scopes: new Set() };
    }
}

/** 该访问上下文能否看某类别；boss 专属类别只认 boss；其余按 scope；category 未知（null）时非 admin/boss 拒绝 */
export function allows(access: Access, category: string | null | undefined): boolean {
    const cat = category?.toLowerCase();
    if (cat && BOSS_ONLY_TYPES.includes(cat)) return access.role === "boss";
    if (access.scopes === null) return true;
    if (!cat) return false;
    return access.scopes.has(cat);
}

const sq = (t: string) => `'${t.replace(/'/g, "''")}'`;

/** 生成 media.type 的 SQL 过滤片段：boss 全量；admin/"*" 排除 boss 专属类别；scope 用户按白名单 */
export function typeFilterSql(access: Access, column = "type"): string {
    if (access.role === "boss") return "1=1";
    if (access.scopes === null) return `${column} NOT IN (${BOSS_ONLY_TYPES.map(sq).join(",")})`;
    if (access.scopes.size === 0) return "1=0";
    const list = [...access.scopes].map(sq).join(",");
    return `${column} IN (${list})`;
}

/** Google 登录成功时调用：upsert 用户（保 role 不覆盖）+ 更新 last_seen + 写 logins 留痕 */
export function upsertUserOnLogin(email: string, name?: string | null, avatar?: string | null, ip?: string | null, ua?: string | null): void {
    ensureSchema();
    const e = email.toLowerCase();
    const role = BOSS_EMAILS.includes(e) ? "boss" : "regular";
    const db = getDb();
    db.prepare("INSERT OR IGNORE INTO users (email, role, name, avatar) VALUES (?, ?, ?, ?)").run(e, role, name || null, avatar || null);
    db.prepare("UPDATE users SET last_seen = CURRENT_TIMESTAMP, name = COALESCE(?, name), avatar = COALESCE(?, avatar) WHERE email = ?")
        .run(name || null, avatar || null, e);
    db.prepare("INSERT INTO logins (email, ip, ua) VALUES (?, ?, ?)").run(e, ip || null, ua || null);
}

/** 搜索留痕（boss 监督用） */
export function logSearch(email: string | null | undefined, query: string): void {
    if (!email || !query.trim()) return;
    ensureSchema();
    getDb().prepare("INSERT INTO search_logs (email, query) VALUES (?, ?)").run(email.toLowerCase(), query.slice(0, 200));
}

/** 取某用户的播放授权 scope（boss 后台展示用） */
export function getUserPermission(email: string): string | null {
    ensureSchema();
    const row = getDb().prepare("SELECT scope FROM user_permissions WHERE user_id = ?").get(email.toLowerCase()) as { scope: string } | undefined;
    return row?.scope || null;
}

/** 设置/删除某用户的播放授权 */
export function setUserPermission(email: string, scope: string | null): void {
    ensureSchema();
    const db = getDb();
    const e = email.toLowerCase();
    if (scope === null) {
        db.prepare("DELETE FROM user_permissions WHERE user_id = ?").run(e);
    } else {
        db.prepare("INSERT OR REPLACE INTO user_permissions (user_id, scope) VALUES (?, ?)").run(e, scope);
    }
}

// 模块加载即建表（getDb 内部 lazy 初始化，幂等）
try { ensureSchema(); } catch { /* DB 未就绪时由首次查询再建 */ }
