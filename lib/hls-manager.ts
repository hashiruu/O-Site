import { spawn, ChildProcess } from "child_process";
import fs from "fs";
import path from "path";

export const HLS_TEMP_DIR = "/tmp/nas-hls";
const PID_FILE = path.join(HLS_TEMP_DIR, "pids.json");

// 空闲超时：超过这个时间没有任何切片请求/心跳就杀进程
const IDLE_TIMEOUT_MS = 30_000;
// 清理器轮询间隔（与请求无关，保证浏览器直接关闭后也能回收）
const REAPER_INTERVAL_MS = 5_000;
// 残留 session 目录的最大保留时间
const DIR_MAX_AGE_MS = 60 * 60 * 1000;

export interface HlsSession {
    sessionId: string;
    proc: ChildProcess | null; // null = 从 PID 文件恢复的孤儿，只有 pid
    pid: number;
    filePath: string;
    dir: string;
    tmpFiles: string[];
    lastActivity: number;
}

// 全局单例（防 Next.js HMR 重复创建）
const g = globalThis as unknown as {
    __hlsSessions?: Map<string, HlsSession>;
    __hlsFileMap?: Map<string, string>;
    __hlsReaper?: ReturnType<typeof setInterval>;
};
if (!g.__hlsSessions) g.__hlsSessions = new Map();
if (!g.__hlsFileMap) g.__hlsFileMap = new Map();
const sessions = g.__hlsSessions;
const fileMap = g.__hlsFileMap;

function readPidFile(): Record<string, number> {
    try {
        return JSON.parse(fs.readFileSync(PID_FILE, "utf-8"));
    } catch {
        return {};
    }
}

function writePidFile(pids: Record<string, number>) {
    try {
        if (Object.keys(pids).length === 0) {
            if (fs.existsSync(PID_FILE)) fs.unlinkSync(PID_FILE);
        } else {
            if (!fs.existsSync(HLS_TEMP_DIR)) fs.mkdirSync(HLS_TEMP_DIR, { recursive: true });
            fs.writeFileSync(PID_FILE, JSON.stringify(pids));
        }
    } catch {}
}

// 杀整个进程组：spawn 时 detached=true 使 ffmpeg 成为组长，
// kill(-pid) 连同其子进程一起回收，杜绝孤儿 ffmpeg
function killPidTree(pid: number) {
    try { process.kill(-pid, "SIGKILL"); } catch {}
    try { process.kill(pid, "SIGKILL"); } catch {}
}

function removeDirLater(dir: string) {
    // 稍等片刻再删目录，让正在传输的切片请求收尾
    setTimeout(() => {
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
    }, 2000);
}

export function startSession(opts: {
    sessionId: string;
    filePath: string;
    ffmpegPath: string;
    args: string[];
    tmpFiles?: string[];
}): HlsSession {
    const { sessionId, filePath, ffmpegPath, args, tmpFiles = [] } = opts;

    // 同一个文件的旧 session 先杀掉（刷新 / 切轨道场景）
    const oldSid = fileMap.get(filePath);
    if (oldSid && oldSid !== sessionId) {
        killSession(oldSid, "superseded by new session for same file");
    }

    const dir = path.join(HLS_TEMP_DIR, sessionId);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const proc = spawn(ffmpegPath, args, {
        detached: true, // 独立进程组，便于整组回收
        stdio: ["ignore", "ignore", "pipe"],
    });

    // spawn 的 error 事件（如 ffmpeg 路径失效 ENOENT）若无监听会击穿整个 Next 进程（报告 #14）。
    // 捕获后按 exit 同款清理该 session，避免遗留半成品条目。
    proc.on("error", (err) => {
        console.error(`[HLS] ffmpeg spawn error (session ${sessionId}):`, err.message);
        const s = sessions.get(sessionId);
        if (s && s.proc === proc) {
            sessions.delete(sessionId);
            if (fileMap.get(s.filePath) === sessionId) fileMap.delete(s.filePath);
        }
        const pids = readPidFile();
        if (pids[sessionId] === proc.pid) { delete pids[sessionId]; writePidFile(pids); }
    });

    let stderrTail = "";
    proc.stderr?.on("data", (chunk: Buffer) => {
        stderrTail = (stderrTail + chunk.toString()).slice(-2000);
    });

    proc.on("exit", (code, signal) => {
        if (code !== 0 && code !== null && signal === null) {
            console.error(`[HLS] ffmpeg exited with code ${code} (session ${sessionId}): ${stderrTail.slice(-500)}`);
        }
        // 客户端可能复用 sessionId 起新 session 覆盖旧条目；旧 proc 的 exit 晚到时
        // 必须校验 s.proc === proc，否则会误删新会话、留下无法回收的孤儿 ffmpeg（报告 #14）。
        const s = sessions.get(sessionId);
        if (s && s.proc === proc) {
            sessions.delete(sessionId);
            if (fileMap.get(s.filePath) === sessionId) fileMap.delete(s.filePath);
            for (const f of s.tmpFiles) { try { fs.unlinkSync(f); } catch {} }
        }
        const pids = readPidFile();
        // 仅当 PID 文件里记的仍是本 proc 时才清，避免清掉复用同 sid 的新进程
        if (pids[sessionId] === proc.pid) { delete pids[sessionId]; writePidFile(pids); }
    });

    const session: HlsSession = {
        sessionId,
        proc,
        pid: proc.pid!,
        filePath,
        dir,
        tmpFiles,
        lastActivity: Date.now(),
    };
    sessions.set(sessionId, session);
    fileMap.set(filePath, sessionId);

    const pids = readPidFile();
    pids[sessionId] = proc.pid!;
    writePidFile(pids);

    ensureReaper();
    return session;
}

// 记录存活信号（切片请求或客户端心跳）
export function touchSession(sessionId: string) {
    const s = sessions.get(sessionId);
    if (s) s.lastActivity = Date.now();
}

export function killSession(sessionId: string, reason = "requested"): boolean {
    const s = sessions.get(sessionId);
    sessions.delete(sessionId);

    const pids = readPidFile();
    const filePid = pids[sessionId];
    if (pids[sessionId]) { delete pids[sessionId]; writePidFile(pids); }

    const pid = s?.pid ?? filePid;
    if (pid) killPidTree(pid);

    if (s) {
        if (fileMap.get(s.filePath) === sessionId) fileMap.delete(s.filePath);
        for (const f of s.tmpFiles) { try { fs.unlinkSync(f); } catch {} }
        removeDirLater(s.dir);
        console.log(`[HLS] Killed session ${sessionId} (${reason})`);
        return true;
    }
    // 不在内存里（服务重启过）：按 PID 文件杀，目录交给定期清理
    if (filePid) {
        console.log(`[HLS] Killed orphan session ${sessionId} via pid file (${reason})`);
        return true;
    }
    return false;
}

export function killAllSessions(reason = "kill all"): number {
    let count = 0;
    for (const sid of Array.from(sessions.keys())) {
        if (killSession(sid, reason)) count++;
    }
    // PID 文件里残留的孤儿也一并清理
    const pids = readPidFile();
    for (const [sid, pid] of Object.entries(pids)) {
        killPidTree(pid);
        count++;
        console.log(`[HLS] Killed orphan pid ${pid} (session ${sid}, ${reason})`);
    }
    writePidFile({});
    return count;
}

function isProcessAlive(pid: number): boolean {
    try { process.kill(pid, 0); return true; } catch { return false; }
}

function reap() {
    const now = Date.now();

    // 1. 空闲 session：超时没有任何切片请求/心跳 → 杀
    for (const [sid, s] of sessions) {
        if (now - s.lastActivity > IDLE_TIMEOUT_MS) {
            killSession(sid, `idle for ${Math.round((now - s.lastActivity) / 1000)}s`);
        }
    }

    // 2. PID 文件中的孤儿（服务重启后内存状态丢失的进程）
    const pids = readPidFile();
    let changed = false;
    for (const [sid, pid] of Object.entries(pids)) {
        if (sessions.has(sid)) continue;
        if (isProcessAlive(pid)) {
            killPidTree(pid);
            console.log(`[HLS] Reaped orphan pid ${pid} (session ${sid})`);
        }
        delete pids[sid];
        changed = true;
    }
    if (changed) writePidFile(pids);

    // 3. 残留的 session 目录（崩溃遗留）
    try {
        if (fs.existsSync(HLS_TEMP_DIR)) {
            for (const entry of fs.readdirSync(HLS_TEMP_DIR)) {
                const p = path.join(HLS_TEMP_DIR, entry);
                if (entry === "pids.json" || sessions.has(entry)) continue;
                try {
                    const st = fs.statSync(p);
                    if (st.isDirectory() && now - st.mtimeMs > DIR_MAX_AGE_MS) {
                        fs.rmSync(p, { recursive: true, force: true });
                    }
                } catch {}
            }
        }
    } catch {}
}

// 与请求无关的定时清理器：保证「浏览器直接关掉」之后进程依然会被回收
export function ensureReaper() {
    if (g.__hlsReaper) return;
    g.__hlsReaper = setInterval(reap, REAPER_INTERVAL_MS);
    // 不阻止 Node 进程退出
    if (typeof g.__hlsReaper.unref === "function") g.__hlsReaper.unref();
}

export function getSession(sessionId: string): HlsSession | undefined {
    return sessions.get(sessionId);
}
