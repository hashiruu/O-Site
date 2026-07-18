// Live TV 信号源客户端：弹幕流协议自适应（WebSocket / SSE / 轮询）+ 音频流解码（HLS / 直连）
// 所有浏览器 API（WebSocket/EventSource/fetch）仅在函数内调用，由客户端组件在 useEffect 中触发。

export type DanmakuType = 0 | 1 | 2; // 0 = 右→左滚动, 1 = 顶部, 2 = 底部

export interface DanmakuItem {
    text: string;
    color?: string;      // 归一化为 #RRGGBB
    type?: DanmakuType;
    user?: string;       // 发送者昵称（可选，渲染时前缀显示）
}

export type SourceStatus = "idle" | "connecting" | "connected" | "error";

export interface DanmakuHandlers {
    onItem: (item: DanmakuItem) => void;
    onStatus?: (s: SourceStatus) => void;
}

export interface DanmakuSource {
    close: () => void;
}

// ---- 归一化：把任意后端载荷转成标准弹幕数组 ----
function normalizeColor(c: unknown): string | undefined {
    if (c == null || c === "") return undefined;
    if (typeof c === "number" && Number.isFinite(c)) {
        return "#" + Math.max(0, Math.floor(c)).toString(16).padStart(6, "0").slice(-6);
    }
    const s = String(c).trim();
    if (/^[0-9a-fA-F]{6}$/.test(s)) return "#" + s;
    if (/^#[0-9a-fA-F]{6}$/.test(s)) return s;
    return undefined;
}

function normalizeType(t: unknown): DanmakuType {
    if (t === 1 || t === "top" || t === "1") return 1;
    if (t === 2 || t === "bottom" || t === "2") return 2;
    return 0;
}

export function normalizeItems(raw: unknown): DanmakuItem[] {
    let arr: unknown[] = [];
    if (Array.isArray(raw)) {
        arr = raw;
    } else if (raw && typeof raw === "object") {
        const r = raw as Record<string, unknown>;
        arr = Array.isArray(r.data) ? r.data : Array.isArray(r.items) ? r.items : [r];
    } else if (typeof raw === "string") {
        const s = raw.trim();
        if (!s) return [];
        try {
            return normalizeItems(JSON.parse(s));
        } catch {
            return [{ text: s }];
        }
    } else {
        return [];
    }

    const out: DanmakuItem[] = [];
    for (const it of arr) {
        if (it == null) continue;
        if (typeof it === "string") {
            if (it.trim()) out.push({ text: it });
            continue;
        }
        if (typeof it === "object") {
            const o = it as Record<string, unknown>;
            const text = o.text ?? o.content ?? o.message ?? o.body ?? o.msg ?? o.value;
            if (text == null || String(text) === "") continue;
            const userRaw = o.user ?? o.username ?? o.nickname ?? o.name;
            const user = userRaw != null && String(userRaw).trim() ? String(userRaw) : undefined;
            out.push({ text: String(text), color: normalizeColor(o.color ?? o.colour), type: normalizeType(o.type), user });
        }
    }
    return out;
}

// ---- 工厂：按 URL scheme 选择传输方式 ----
export function createDanmakuSource(url: string, h: DanmakuHandlers): DanmakuSource {
    const u = (url || "").trim();
    if (!u) {
        h.onStatus?.("idle");
        return { close: () => {} };
    }
    if (/^wss?:\/\//i.test(u)) return createWsSource(u, h);
    if (/^https?:\/\//i.test(u)) return createHttpSource(u, h);
    h.onStatus?.("error");
    return { close: () => {} };
}

function createWsSource(url: string, h: DanmakuHandlers): DanmakuSource {
    h.onStatus?.("connecting");
    let closing = false;
    let ws: WebSocket | null;
    try {
        ws = new WebSocket(url);
    } catch {
        h.onStatus?.("error");
        return { close: () => {} };
    }
    ws.onopen = () => { if (!closing) h.onStatus?.("connected"); };
    ws.onerror = () => { if (!closing) h.onStatus?.("error"); };
    ws.onclose = () => { if (!closing) h.onStatus?.("error"); };
    ws.onmessage = (ev) => {
        let raw: unknown = ev.data;
        if (typeof raw === "string") {
            try { raw = JSON.parse(raw); } catch { /* 保留纯字符串 */ }
        }
        for (const it of normalizeItems(raw)) h.onItem(it);
    };
    return {
        close: () => {
            closing = true;
            try { ws?.close(); } catch { /* noop */ }
        },
    };
}

function createHttpSource(url: string, h: DanmakuHandlers): DanmakuSource {
    let cancelled = false;
    let es: EventSource | null = null;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;

    const startPoll = () => {
        h.onStatus?.("connecting");
        const tick = async () => {
            if (cancelled) return;
            try {
                const r = await fetch(url, { cache: "no-store" });
                const data = await r.json();
                for (const it of normalizeItems(data)) h.onItem(it);
                if (!cancelled) h.onStatus?.("connected");
            } catch {
                if (!cancelled) h.onStatus?.("error");
            }
            if (!cancelled) pollTimer = setTimeout(tick, 2000);
        };
        void tick();
    };

    const startSse = () => {
        h.onStatus?.("connecting");
        try {
            es = new EventSource(url);
            es.onopen = () => { if (!cancelled) h.onStatus?.("connected"); };
        es.onerror = () => { if (!cancelled) h.onStatus?.("error"); };
        // 具名事件（如 event: danmaku）不会触发 onmessage，需按事件名监听；
        // 默认只接弹幕类事件，debug/ready 等控制类自然被过滤。
        const handle = (raw: string) => {
            if (!raw) return;
            let parsed: unknown = raw;
            try { parsed = JSON.parse(raw); } catch { /* 纯文本，保留 */ }
            for (const it of normalizeItems(parsed)) h.onItem(it);
        };
        es.onmessage = (ev) => handle(ev.data);
        for (const name of ["danmaku", "message", "chat", "comment", "msg", "bullet"]) {
            es.addEventListener(name, ((ev: MessageEvent) => handle(ev.data)) as EventListener);
        }
        } catch {
            startPoll();
        }
    };

    // 先探测响应类型：text/event-stream → SSE，否则轮询
    void (async () => {
        if (cancelled) return;
        try {
            const r = await fetch(url, { method: "GET", cache: "no-store" });
            const ct = r.headers.get("content-type") || "";
            if (cancelled) return;
            if (ct.includes("text/event-stream")) startSse();
            else startPoll();
        } catch {
            if (!cancelled) startPoll();
        }
    })();

    return {
        close: () => {
            cancelled = true;
            if (es) { try { es.close(); } catch { /* noop */ } es = null; }
            if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
        },
    };
}

// ---- 音频/媒体：按 content-type 自适应解码 ----
// .m3u8 或 application/vnd.apple.mpegurl → hls.js
// video/x-flv 或 .flv → mpegts.js（flv.js 继任，浏览器原生不认 FLV）
// 其他（mp3/aac/mp4…）→ 媒体元素直连
async function sniffContentType(url: string): Promise<string> {
    try {
        const ctrl = new AbortController();
        const r = await fetch(url, { signal: ctrl.signal, cache: "no-store" });
        const ct = (r.headers.get("content-type") || "").toLowerCase();
        try { ctrl.abort(); } catch { /* noop */ }
        return ct;
    } catch {
        return "";
    }
}

export async function attachAudio(mediaEl: HTMLMediaElement, url: string): Promise<() => void> {
    const u = (url || "").trim();
    if (!u) return () => {};
    const lower = u.toLowerCase();
    let useHls = lower.endsWith(".m3u8") || lower.includes(".m3u8?");
    let useFlv = lower.endsWith(".flv") || lower.includes(".flv?");

    if (!useHls && !useFlv) {
        const ct = await sniffContentType(u);
        if (ct.includes("mpegurl") || ct.includes("m3u8")) useHls = true;
        else if (ct.includes("flv")) useFlv = true;
    }

    if (useHls) {
        try {
            const mod = await import("hls.js");
            const Hls = mod.default;
            if (Hls && Hls.isSupported()) {
                const hls = new Hls({ lowLatencyMode: true });
                hls.loadSource(u);
                hls.attachMedia(mediaEl);
                return () => hls.destroy();
            }
        } catch { /* 回退 */ }
    }

    if (useFlv) {
        try {
            const mod: any = await import("mpegts.js");
            const mpegts = mod.default || mod;
            if (mpegts && mpegts.isSupported()) {
                const player = mpegts.createPlayer({ type: "flv", url: u, isLive: true }, { enableWorker: false });
                player.attachMediaElement(mediaEl as HTMLVideoElement);
                player.load();
                return () => { try { player.destroy(); } catch { /* noop */ } };
            }
        } catch { /* 回退到直连 */ }
    }

    // 浏览器原生可播放格式（mp3/aac/mp4…）
    mediaEl.src = u;
    return () => {
        mediaEl.removeAttribute("src");
        try { mediaEl.load(); } catch { /* noop */ }
    };
}
