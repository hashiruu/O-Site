import { NextRequest, NextResponse } from "next/server";
import { scanMediaDirectory } from "@/lib/scanner";
import { getDb } from "@/lib/db";
import { revalidatePath } from "next/cache";

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
    try {
        // 扫描入库是后台功能，仅 admin/boss（防任意用户触发全库重扫耗尽 IO）
        const { getAccess, canAdminSite } = await import("@/lib/roles");
        if (!canAdminSite((await getAccess(request)).role)) {
            return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
        }
        const bodyObj = await request.json().catch(() => ({}));
        const { key } = bodyObj;

        const encoder = new TextEncoder();
        const stream = new ReadableStream({
            async start(controller) {
                function emit(data: any) {
                    try {
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
                    } catch (e) { }
                }

                try {
                    const db = getDb();
                    emit({ phase: "start", message: "初始化扫描配置..." });

                    // 如果提供了 key, 扫描特定目录; 否则扫描所有目录
                    let dirsToScan: { key: string; path: string; name: string; type: string }[] = [];

                    if (key) {
                        const row = db
                            .prepare("SELECT value FROM settings WHERE key = ?")
                            .get(key) as { value: string } | undefined;

                        if (!row) {
                            emit({ phase: "error", message: "目录不存在" });
                            controller.close();
                            return;
                        }

                        const config = JSON.parse(row.value);
                        dirsToScan = [{ key, ...config }];
                    } else {
                        const rows = db
                            .prepare("SELECT key, value FROM settings WHERE key LIKE 'media_dir_%'")
                            .all() as { key: string; value: string }[];

                        dirsToScan = rows.map((r) => ({ key: r.key, ...JSON.parse(r.value) }));
                    }

                    if (dirsToScan.length === 0) {
                        emit({ phase: "success", message: "没有配置任何媒体目录", results: [] });
                        controller.close();
                        return;
                    }

                    emit({ phase: "progress", message: "清理库中已失效的孤儿文件..." });
                    // ==========================================
                    // 垃圾回收 (Garbage Collection)：清理孤儿媒体数据
                    // ==========================================
                    const allConfigRows = db.prepare("SELECT value FROM settings WHERE key LIKE 'media_dir_%'").all() as { value: string }[];
                    const allConfigPaths = allConfigRows.map(r => {
                        try { return JSON.parse(r.value).path; } catch { return null; }
                    }).filter(Boolean);

                    if (allConfigPaths.length > 0) {
                        const gcConditions = allConfigPaths.map(() => `instr(path, ?) != 1`).join(" AND ");
                        const stmt = db.prepare(`DELETE FROM media WHERE ${gcConditions}`);
                        const gcResult = stmt.run(...allConfigPaths);
                        if (gcResult.changes > 0) {
                            emit({ phase: "progress", message: `成功移除 ${gcResult.changes} 条失效数据` });
                        }
                    } else {
                        const gcResult = db.prepare(`DELETE FROM media`).run();
                        if (gcResult.changes > 0) {
                            emit({ phase: "progress", message: `由于无配置目录，清空全部 ${gcResult.changes} 条数据` });
                        }
                    }

                    // 扫描所有目录
                    const results = [];
                    for (const dir of dirsToScan) {
                        emit({ phase: "progress", message: `开始扫描目录: ${dir.name} (${dir.path})` });
                        
                        const result = await scanMediaDirectory(dir.path, dir.type, dir.name, (msg) => {
                            emit({ phase: "progress", message: msg });
                        });
                        results.push({ dir: dir.name, path: dir.path, type: dir.type, ...result });
                    }

                    const totalAdded = results.reduce((sum, r) => sum + r.added, 0);
                    const totalUpdated = results.reduce((sum, r) => sum + r.updated, 0);
                    
                    emit({ phase: "progress", message: `触发首页数据刷新（Revalidating cache）...` });
                    revalidatePath("/");
                    revalidatePath("/watch");

                    emit({ 
                        phase: "success", 
                        message: `扫描完成：新增 ${totalAdded} 个，更新 ${totalUpdated} 个`,
                        results 
                    });
                } catch (err: any) {
                    emit({ phase: "error", message: `扫描发生异常: ${err.message}` });
                } finally {
                    try { controller.close(); } catch { }
                }
            }
        });

        return new NextResponse(stream, {
            headers: {
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache, no-transform",
                Connection: "keep-alive",
            },
        });
    } catch (error: any) {
        return NextResponse.json({ success: false, error: "初始化扫描流失败: " + error.message }, { status: 500 });
    }
}
