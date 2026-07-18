// 设备信任令牌：私密空间/旅行相册的"新设备输一次口令，之后免输"。
// 口令验证成功 → 签发 HMAC 令牌种 HttpOnly cookie（1 年）；后续请求验签即放行。
// 密钥持久化在 settings 表（device_trust_secret），服务重启不失效已信任设备。
// 将来引入账号系统（如 Google 登录）时，此令牌可替换为 session，网关逻辑不变。
import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { getDb } from "./db";

export const TRUST_COOKIE = "nas_device_trust";
export const TRUST_MAX_AGE = 365 * 24 * 3600; // 秒

function getSecret(): Buffer {
    const db = getDb();
    const row = db.prepare("SELECT value FROM settings WHERE key = 'device_trust_secret'").get() as { value: string } | undefined;
    if (row && /^[0-9a-f]{64}$/.test(row.value)) return Buffer.from(row.value, "hex");
    const secret = randomBytes(32);
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('device_trust_secret', ?)").run(secret.toString("hex"));
    return secret;
}

const mac = (payload: string) => createHmac("sha256", getSecret()).update(payload).digest("hex");

/** 签发信任令牌：v1.<签发时间base36>.<hmac> */
export function issueTrustToken(): string {
    const payload = `v1.${Date.now().toString(36)}`;
    return `${payload}.${mac(payload)}`;
}

/** 验证令牌：格式 + HMAC + 未超过有效期 */
export function verifyTrustToken(token: string | undefined | null): boolean {
    if (!token) return false;
    const m = token.match(/^(v1\.[0-9a-z]+)\.([0-9a-f]{64})$/);
    if (!m) return false;
    const expect = Buffer.from(mac(m[1]), "hex");
    const got = Buffer.from(m[2], "hex");
    if (expect.length !== got.length || !timingSafeEqual(expect, got)) return false;
    const issuedAt = parseInt(m[1].slice(3), 36);
    return Number.isFinite(issuedAt) && Date.now() - issuedAt < TRUST_MAX_AGE * 1000;
}
