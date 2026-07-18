"use client";

// Document Picture-in-Picture：把舞台（iframe + 弹幕层 + 控制面板）整体移入浮窗。
// 注意：iframe 跨 document 移动会触发重载，直播流断流重连一次（~2-3s），属已知行为。
import { useCallback, useEffect, useRef, useState } from "react";

export interface PiPController {
    supported: boolean;
    isOpen: boolean;
    open: (stageEl: HTMLElement) => Promise<void>;
    close: () => void;
}

export function useDocumentPiP(initialWidth = 520, initialHeight = 320): PiPController {
    const [supported, setSupported] = useState(false);
    const [isOpen, setIsOpen] = useState(false);
    const pipRef = useRef<Window | null>(null);
    const stageRef = useRef<HTMLElement | null>(null);
    const originParentRef = useRef<HTMLElement | null>(null);
    const originNextRef = useRef<Node | null>(null);

    useEffect(() => {
        setSupported(typeof document !== "undefined" && "documentPictureInPicture" in document);
    }, []);

    const moveBack = useCallback(() => {
        const stage = stageRef.current;
        const parent = originParentRef.current;
        if (stage && parent) {
            try { parent.insertBefore(stage, originNextRef.current); } catch { /* noop */ }
        }
        pipRef.current = null;
        stageRef.current = null;
        originParentRef.current = null;
        originNextRef.current = null;
        setIsOpen(false);
    }, []);

    const open = useCallback(async (stageEl: HTMLElement) => {
        if (!supported || pipRef.current || !stageEl) return;
        const dpip = (document as Document & { documentPictureInPicture?: { requestWindow(o?: unknown): Promise<Window> } }).documentPictureInPicture;
        if (!dpip) return;
        let pw: Window;
        try {
            pw = await dpip.requestWindow({ width: initialWidth, height: initialHeight });
        } catch {
            return;
        }
        // 注入基础样式：暗底 + 让舞台占满浮窗
        const style = pw.document.createElement("style");
        style.textContent = `
            html, body { margin: 0; padding: 0; height: 100%; background: #000; }
            body { display: block; width: 100vw; height: 100vh; overflow: hidden; }
            [data-pip-stage] { width: 100% !important; height: 100% !important; }
        `;
        pw.document.head.appendChild(style);
        // 记录原位置后整体迁入
        stageRef.current = stageEl;
        originParentRef.current = stageEl.parentElement;
        originNextRef.current = stageEl.nextSibling;
        pw.document.body.appendChild(stageEl);
        pw.addEventListener("pagehide", () => moveBack());
        pipRef.current = pw;
        setIsOpen(true);
    }, [supported, initialWidth, initialHeight, moveBack]);

    const close = useCallback(() => {
        try { pipRef.current?.close(); } catch { /* noop */ }
        moveBack();
    }, [moveBack]);

    return { supported, isOpen, open, close };
}
