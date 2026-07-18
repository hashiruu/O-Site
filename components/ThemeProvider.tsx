"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";

type Theme = "light" | "dark";

interface ThemeContextType {
    theme: Theme;
    toggleTheme: () => void;
    setThemeMode: (mode: Theme) => void; // 明确设某模式（阅读器背景联动全站用）
}

const ThemeContext = createContext<ThemeContextType>({
    theme: "light",
    toggleTheme: () => { },
    setThemeMode: () => { },
});

export function useTheme() {
    return useContext(ThemeContext);
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
    // 规则 3：亮色为默认（spec §1.2 + §0）
    const [theme, setTheme] = useState<Theme>("light");
    const [mounted, setMounted] = useState(false);
    const switchTimer = useRef<number>(0);

    useEffect(() => {
        setMounted(true);
        const saved = localStorage.getItem("theme") as Theme;
        if (saved) {
            setTheme(saved);
            document.documentElement.classList.toggle("dark", saved === "dark");
        } else {
            // 默认亮色：html 初始即无 dark 类，确保移除（防御）
            document.documentElement.classList.remove("dark");
        }
    }, []);

    const applyTheme = (next: Theme) => {
        const root = document.documentElement;
        // 切换前先开全局同步过渡，切换完撤掉——避免只有 body 渐变、卡片瞬变导致的撕裂
        root.classList.add("theme-switching");
        setTheme(next);
        localStorage.setItem("theme", next);
        root.classList.toggle("dark", next === "dark");
        window.clearTimeout(switchTimer.current);
        switchTimer.current = window.setTimeout(() => root.classList.remove("theme-switching"), 320);
    };
    const toggleTheme = () => applyTheme(theme === "dark" ? "light" : "dark");
    const setThemeMode = (mode: Theme) => { if (mode !== theme) applyTheme(mode); };

    // 始终返回 Provider 避免 React Fiber Tree 在 hydration 时因结构变化导致子组件(SVG等)解绑变成 TEXT 节点
    return (
        <ThemeContext.Provider value={{ theme: mounted ? theme : "light", toggleTheme, setThemeMode }}>
            {children}
        </ThemeContext.Provider>
    );
}
