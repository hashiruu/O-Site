// 字幕格式转换工具（服务端/测试共用）

// SRT -> VTT：仅替换时间戳行的逗号分隔符，不碰字幕正文
export function srtToVtt(srt: string): string {
    let s = srt;
    if (s.charCodeAt(0) === 0xfeff) s = s.substring(1); // 去 BOM
    s = s.replace(/\r\n/g, "\n");
    // 00:01:02,345 --> 00:01:04,567 形式的时间戳逗号换成点号。
    // 放宽到 1-2 位小时、1-3 位毫秒，毫秒补零到 3 位（部分非标 SRT 用 1 位毫秒/小时，原正则不匹配 → 逗号未替换 → VTT 时间戳非法）（报告第四章）
    s = s.replace(/(\d{1,2}:\d{2}:\d{2}),(\d{1,3})/g, (_m, hms: string, ms: string) => `${hms}.${ms.padStart(3, "0")}`);
    // 防止重复添加头
    s = s.replace(/^WEBVTT[^\n]*\n+/i, "");
    return "WEBVTT\n\n" + s.trimStart();
}

// 把 VTT 中所有时间戳平移 offsetSeconds 秒（可为负，用于 HLS -ss 起播场景的字幕对齐）
export function shiftVtt(vtt: string, offsetSeconds: number): string {
    if (!offsetSeconds) return vtt;

    const toSeconds = (h: string, m: string, s: string, ms: string) =>
        parseInt(h, 10) * 3600 + parseInt(m, 10) * 60 + parseInt(s, 10) + parseInt(ms, 10) / 1000;

    const format = (total: number) => {
        const clamped = Math.max(0, total);
        // 毫秒四舍五入后可能到 1000（如 clamped=1.9995 → ms=1000），需向秒进位，否则产生非法 .1000（报告第四章）
        let ms = Math.round((clamped - Math.floor(clamped)) * 1000);
        let wholeSec = Math.floor(clamped);
        if (ms >= 1000) { ms -= 1000; wholeSec += 1; }
        const h = Math.floor(wholeSec / 3600);
        const m = Math.floor((wholeSec % 3600) / 60);
        const s = wholeSec % 60;
        const pad = (n: number, w = 2) => String(n).padStart(w, "0");
        return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(ms, 3)}`;
    };

    // 同时支持 hh:mm:ss.mmm 和 mm:ss.mmm 两种 VTT 时间戳
    return vtt.replace(
        /(?:(\d{2,}):)?(\d{2}):(\d{2})\.(\d{3})/g,
        (_match, h: string | undefined, m: string, s: string, ms: string) => {
            const total = toSeconds(h || "0", m, s, ms) + offsetSeconds;
            return format(total);
        }
    );
}

// 判断内容是否已经是 VTT
export function isVtt(content: string): boolean {
    return content.trimStart().replace(/^﻿/, "").toUpperCase().startsWith("WEBVTT");
}
