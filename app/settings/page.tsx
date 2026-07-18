"use client";

import { useState, useEffect } from "react";
import { useTheme } from "../../components/ThemeProvider";
import { PageHeader } from "../../components/PageHeader";
import { useLang } from "@/lib/i18n";

export default function SettingsPage() {
    const { t } = useLang();
    const { theme, toggleTheme } = useTheme();
    const [tmdbKey, setTmdbKey] = useState("");
    const [hwAccel, setHwAccel] = useState(false);
    const [liveAudioUrl, setLiveAudioUrl] = useState("");
    const [liveDanmakuUrl, setLiveDanmakuUrl] = useState("");
    const [saving, setSaving] = useState(false);
    const [loading, setLoading] = useState(true);

    // 页面加载时拉取全局配置
    useEffect(() => {
        const fetchSettings = async () => {
            try {
                const res = await fetch("/api/settings");
                const { success, data } = await res.json();
                if (success) {
                    setTmdbKey(data.tmdbApiKey || "");
                    setHwAccel(data.hwAccelPrefer || false);
                    setLiveAudioUrl(data.liveTvAudioUrl || "");
                    setLiveDanmakuUrl(data.liveTvDanmakuUrl || "");
                }
            } catch (err) {
                console.error("加载配置失败", err);
            } finally {
                setLoading(false);
            }
        };
        fetchSettings();
    }, []);

    const handleSave = async () => {
        setSaving(true);
        try {
            const res = await fetch("/api/settings", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    action: "save_config",
                    tmdbApiKey: tmdbKey,
                    hwAccelPrefer: hwAccel,
                    liveTvAudioUrl: liveAudioUrl,
                    liveTvDanmakuUrl: liveDanmakuUrl
                })
            });
            const data = await res.json();
            if (!data.success) {
                alert("保存失败: " + data.error);
            }
        } catch (err) {
            alert("保存遇到网络错误");
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="w-full h-full text-text-1 custom-scrollbar pb-20">
            <div className="w-full max-w-4xl mx-auto">
                <PageHeader title={t("设置")} description={t("管理外观、媒体抓取接口以及播放偏好配置。")} />

                <div className="space-y-8">
                    {/* UI 外观 */}
                    <section className="bg-bg-nav p-6 rounded-lg border border-line">
                        <h2 className="text-lg font-medium mb-4 flex items-center gap-2">
                            <span className="w-1.5 h-4 bg-primary rounded-sm"></span> 外观与个性化
                        </h2>
                        <div className="flex items-center justify-between">
                            <div>
                                <div className="font-medium text-[15px]">深色模式</div>
                                <div className="text-xs text-text-3 mt-1">切换网站的昼夜主题效果</div>
                            </div>
                            <div className="flex items-center gap-3">
                                <span className="text-sm text-text-3">{theme === 'dark' ? '深色夜间' : '浅色日间'}</span>
                                <button
                                    onClick={toggleTheme}
                                    role="switch"
                                    aria-checked={theme === 'dark'}
                                    className={`relative w-12 h-7 rounded-full transition-colors duration-300 cursor-pointer ${theme === 'dark' ? 'bg-primary' : 'bg-bg-tag border border-line'}`}
                                >
                                    <span className={`absolute top-0.5 w-6 h-6 rounded-full bg-white shadow-md transition-all duration-300 ${theme === 'dark' ? 'left-[22px]' : 'left-0.5'}`} />
                                </button>
                            </div>
                        </div>
                    </section>

                    {/* 元数据配置 */}
                    <section className="bg-bg-nav p-6 rounded-lg border border-line">
                        <h2 className="text-lg font-medium mb-4 flex items-center gap-2">
                            <span className="w-1.5 h-4 bg-primary rounded-sm"></span> 刮削器参数 (Phase 4)
                        </h2>
                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium mb-1.5 text-text-2">TMDB API 密钥</label>
                                <input
                                    type="text"
                                    value={tmdbKey}
                                    onChange={(e) => setTmdbKey(e.target.value)}
                                    placeholder="输入你在 The Movie Database 申请的 v3 认证秘钥"
                                    className="w-full max-w-md h-10 px-3 bg-bg-input border border-line rounded-md text-sm focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
                                />
                                <p className="text-xs text-text-3 mt-2">当填入秘钥后，扫描器将能够自动获取影片的海报图和故事梗概。</p>
                            </div>
                        </div>
                    </section>

                    {/* 播放器转码 */}
                    <section className="bg-bg-nav p-6 rounded-lg border border-line">
                        <h2 className="text-lg font-medium mb-4 flex items-center gap-2">
                            <span className="w-1.5 h-4 bg-[#02b340] rounded-sm"></span> 流媒体转码引擎
                        </h2>
                        <div className="flex items-center justify-between">
                            <div>
                                <div className="font-medium text-[15px]">硬件加速优先</div>
                                <div className="text-xs text-text-3 mt-1">FFmpeg 提取切片时尝试调用 NVENC / VAAPI。如果服务器没有显卡，请保持关闭以使用纯 CPU 序列。</div>
                            </div>
                            <label className="relative inline-flex items-center cursor-pointer">
                                <input
                                    type="checkbox"
                                    className="sr-only peer"
                                    checked={hwAccel}
                                    onChange={(e) => setHwAccel(e.target.checked)}
                                />
                                <div className="w-11 h-6 bg-bg-tag rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
                            </label>
                        </div>
                    </section>

                    {/* 直播信号源 */}
                    <section className="bg-bg-nav p-6 rounded-lg border border-line">
                        <h2 className="text-lg font-medium mb-4 flex items-center gap-2">
                            <span className="w-1.5 h-4 bg-primary rounded-sm"></span> 直播信号源 (Live TV)
                        </h2>
                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium mb-1.5 text-text-2">音频流地址</label>
                                <input
                                    type="text"
                                    value={liveAudioUrl}
                                    onChange={(e) => setLiveAudioUrl(e.target.value)}
                                    placeholder="如 http://<局域网IP>:8000/live.m3u8"
                                    className="w-full max-w-md h-10 px-3 bg-bg-input border border-line rounded-md text-sm focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
                                />
                                <p className="text-xs text-text-3 mt-2">.m3u8 走 HLS 解码，其余按连续音频流直连。由本地 audio 元素承载，音量可控，替代嵌入播放器的跨域音频。</p>
                            </div>
                            <div>
                                <label className="block text-sm font-medium mb-1.5 text-text-2">弹幕流地址</label>
                                <input
                                    type="text"
                                    value={liveDanmakuUrl}
                                    onChange={(e) => setLiveDanmakuUrl(e.target.value)}
                                    placeholder="如 ws://<局域网IP>:9000"
                                    className="w-full max-w-md h-10 px-3 bg-bg-input border border-line rounded-md text-sm focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
                                />
                                <p className="text-xs text-text-3 mt-2">ws:// 走 WebSocket；http:// 自动识别 SSE 或轮询。每条建议含 text / color / type 字段。</p>
                            </div>
                        </div>
                    </section>

                    {/* 纯展示占位的保存 */}
                    <div className="flex justify-end pt-4">
                        <button
                            onClick={handleSave}
                            disabled={saving}
                            className="bg-primary hover:bg-primary/90 text-white px-8 py-2.5 rounded-full font-medium whitespace-nowrap transition-all flex items-center gap-2 active:scale-[0.97] disabled:opacity-70"
                        >
                            {saving ? "履约中..." : "保存配置"}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
