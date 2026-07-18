"use client";

// 沉浸阅读开关：挂载时给 body 加 reader-immersive（收起全站顶栏/页脚/底部 tab），
// 卸载时移除。供服务端渲染的阅读页（如 /reader/md）嵌入使用；
// 客户端阅读页（/reader/epub）直接在自己的 useEffect 里做同样的事。
import { useEffect } from "react";

export function ReaderImmersive() {
    useEffect(() => {
        document.body.classList.add("reader-immersive");
        return () => document.body.classList.remove("reader-immersive");
    }, []);
    return null;
}
