"use client";

// 根级错误边界：连 layout 都崩了时兜底（必须自带 <html>/<body>，此时全站样式可能未加载）。
import { useEffect } from "react";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
    useEffect(() => { console.error("[global-error]", error); }, [error]);
    return (
        <html lang="zh-CN">
            <body style={{ margin: 0, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "-apple-system, sans-serif", background: "#101014", color: "#e6e6e8" }}>
                <div style={{ textAlign: "center", padding: "2rem" }}>
                    <div style={{ fontSize: 40, marginBottom: 12 }}>⚠️</div>
                    <h1 style={{ fontSize: 20, margin: "0 0 8px" }}>网站遇到严重错误</h1>
                    <p style={{ fontSize: 14, color: "#a2a7ae", margin: "0 0 20px" }}>请刷新页面重试。</p>
                    <button onClick={reset} style={{ background: "#EC6E42", color: "#fff", border: "none", padding: "10px 22px", borderRadius: 999, fontSize: 14, cursor: "pointer" }}>
                        刷新重试
                    </button>
                </div>
            </body>
        </html>
    );
}
