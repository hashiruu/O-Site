// 私密内容访问判定（旅行相册/私密保险箱）：仅 admin/boss 可见。
// 旧 deviceTrust/private_grants 机制废弃，全部走 Google 登录身份（见 lib/roles.ts）。
// 保留 isPrivilegedRequest 函数名是为了让现有调用点零改动升级到新三层模型。
import type { NextRequest } from "next/server";
import { getRole, canViewPrivate } from "./roles";

export async function isPrivilegedRequest(req: NextRequest): Promise<boolean> {
    return canViewPrivate(await getRole(req));
}

/** 请求是否来自 mcvale.net 外网通道（相对内网/tailnet 的公网入口） */
export function isExternalChannel(req?: NextRequest): boolean {
    if (!req) return false;
    const host = (req.headers.get("x-forwarded-host") || req.headers.get("host") || "")
        .split(":")[0].trim().toLowerCase();
    return host === "mcvale.net" || host.endsWith(".mcvale.net");
}

/**
 * 是否受省流量限制：mcvale.net 外网通道 + 非 boss/admin。
 * 受限用户的视频只能走 ffmpeg HLS 转码，输出锁 720p/30fps（省服务器上行流量）；
 * 内网/tailnet 与 boss/admin 不受限。
 */
export function isBandwidthLimited(req: NextRequest | undefined, access: { role: string }): boolean {
    return isExternalChannel(req) && access.role !== "boss" && access.role !== "admin";
}
