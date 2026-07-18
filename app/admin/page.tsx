"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";

interface MediaDir {
    key: string;
    path: string;
    name: string;
    type: string;
}

const typeLabels: Record<string, string> = {
    movie: "电影",
    series: "电视剧",
    anime: "动漫",
    travel: "旅行相册",
    private: "私密空间",
};

const typeColors: Record<string, string> = {
    movie: "bg-bili-pink/10 text-bili-pink border-bili-pink/20",
    series: "bg-bili-blue/10 text-bili-blue border-bili-blue/20",
    anime: "bg-accent-glow text-bili-pink border-bili-pink/20",
    travel: "bg-primary/10 text-primary border-primary/20",
    private: "bg-text-3/10 text-text-3 border-text-3/20",
};

interface LibStats {
    movie: number; series: number; anime: number;
    travel: number; private: number; total: number;
}

export default function AdminPage() {
    const [dirs, setDirs] = useState<MediaDir[]>([]);
    const [libStats, setLibStats] = useState<LibStats | null>(null);
    const [loading, setLoading] = useState(true);
    const [scanning, setScanning] = useState(false);
    const [scanLogs, setScanLogs] = useState<string[]>([]);
    const [showScanTerminal, setShowScanTerminal] = useState(false);
    const logsEndRef = useRef<HTMLDivElement>(null);

    // 转码系统状态
    const [tcFiles, setTcFiles] = useState<any[]>([]); // 媒体库文件列表
    const [tcSelected, setTcSelected] = useState<Set<string>>(new Set()); // 选中的文件路径
    const [tcProbing, setTcProbing] = useState(false);
    const [tcProbeResults, setTcProbeResults] = useState<Map<string, any>>(new Map()); // 路径 -> probe 结果
    const [tcShowTrackModal, setTcShowTrackModal] = useState(false);
    const [tcTrackSelections, setTcTrackSelections] = useState<Map<string, { audioIndex: number | null; subtitleIndex: number | null }>>(new Map());
    const [tcJobs, setTcJobs] = useState<any[]>([]);
    const [tcLoading, setTcLoading] = useState(false);
    const tcProgressRef = useRef<EventSource | null>(null);

    // 每日情报走马灯：/api/admin/ticker（库藏/近7天入库/磁盘余量/TMDB今日热门，服务端按天缓存）
    const [tickerItems, setTickerItems] = useState<string[]>([]);
    useEffect(() => {
        fetch("/api/admin/ticker")
            .then(r => r.json())
            .then(d => { if (d.success && d.items?.length) setTickerItems(d.items); })
            .catch(() => { /* 拉取失败则显示加载占位 */ });
    }, []);
    const recommendations = tickerItems.length > 0
        ? tickerItems.join("　｜　")
        : "正在汇集今日情报：馆藏统计 · 入库动态 · 磁盘余量 · TMDB 热门…";

    // 添加目录表单
    const [showAddForm, setShowAddForm] = useState(false);
    const [newPath, setNewPath] = useState("");
    const [newName, setNewName] = useState("");
    const [newType, setNewType] = useState("movie");
    const [addError, setAddError] = useState("");

    const fetchDirs = useCallback(async () => {
        try {
            const res = await fetch("/api/settings");
            const data = await res.json();
            if (data.success) {
                setDirs(data.data.mediaDirs || []);
            }
        } catch (error) {
            console.error("获取目录列表失败:", error);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchDirs();
    }, [fetchDirs]);

    // 库藏统计（指标行数据源）；扫描结束后随 fetchDirs 一起刷新
    const fetchStats = useCallback(async () => {
        try {
            const res = await fetch("/api/media");
            const data = await res.json();
            if (data.success) setLibStats(data.data);
        } catch { /* 指标行降级为占位符 */ }
    }, []);

    useEffect(() => { fetchStats(); }, [fetchStats]);

    useEffect(() => {
        if (logsEndRef.current) {
            logsEndRef.current.scrollIntoView({ behavior: "smooth" });
        }
    }, [scanLogs]);

    const handleAddDir = async () => {
        if (!newPath.trim()) { setAddError("请输入目录路径"); return; }
        setAddError("");
        try {
            const res = await fetch("/api/settings", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    action: "add_dir",
                    dirPath: newPath,
                    name: newName || undefined,
                    type: newType,
                }),
            });
            const data = await res.json();
            if (data.success) {
                setShowAddForm(false);
                setNewPath("");
                setNewName("");
                setNewType("movie");
                fetchDirs();
            } else {
                setAddError(data.error || "添加失败");
            }
        } catch {
            setAddError("请求失败");
        }
    };

    const handleDeleteDir = async (key: string) => {
        try {
            await fetch(`/api/settings?key=${key}`, { method: "DELETE" });
            fetchDirs();
        } catch (error) {
            console.error("删除失败:", error);
        }
    };

    const handleClearDirData = async (dir: MediaDir) => {
        if (!confirm(`确定清除「${dir.name}」的映射数据？\n目录配置不会被删除，重新扫描即可恢复。`)) return;
        try {
            const res = await fetch("/api/settings", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "clear_dir_data", key: dir.key }),
            });
            const data = await res.json();
            if (data.success) {
                alert(`已清除 ${data.deleted} 条映射数据`);
            } else {
                alert(data.error || "清除失败");
            }
        } catch (error) {
            console.error("清除数据失败:", error);
            alert("请求失败");
        }
    };

    const handleClearCache = async () => {
        try {
            const res = await fetch("/api/revalidate", { method: "POST" });
            const data = await res.json();
            if (data.success) {
                alert("首页缓存已刷新");
            } else {
                alert(data.error || "刷新失败");
            }
        } catch {
            alert("请求失败");
        }
    };

    const handleScanAll = async () => {
        setScanning(true);
        setShowScanTerminal(true);
        setScanLogs(["[SYSTEM] 即将启动媒体库全盘扫描引擎..."]);

        try {
            const res = await fetch("/api/media/scan", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({}),
            });

            if (!res.ok || !res.body) {
                throw new Error("向服务器发送扫描指令失败");
            }

            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });

                const lines = buffer.split('\n\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        try {
                            const data = JSON.parse(line.slice(6));
                            if (data.phase === "progress" || data.phase === "start") {
                                setScanLogs(prev => [...prev, data.message]);
                            } else if (data.phase === "success") {
                                setScanLogs(prev => [...prev, `[SUCCESS] ${data.message}`]);
                            } else if (data.phase === "error") {
                                setScanLogs(prev => [...prev, `[ERROR] ${data.message}`]);
                            }
                        } catch { }
                    }
                }
            }
        } catch (error: any) {
            setScanLogs(prev => [...prev, `[FATAL] 扫描进程断开: ${error.message}`]);
        } finally {
            setScanning(false);
            fetchDirs();
            fetchStats();
        }
    };

    // 转码队列活跃数（指标行）
    const activeJobs = tcJobs.filter((j: any) => j.status === "running" || j.status === "pending").length;

    return (
        <div className="w-full max-w-[1280px] py-2">
            {/* ===== 页头：标题 + 全局操作 ===== */}
            <div className="pb-6 flex flex-wrap items-end justify-between gap-4">
                <div>
                    <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.28em] text-text-3">
                        <span aria-hidden className="h-px w-5 bg-gradient-to-r from-primary to-secondary" />
                        Backstage · Dashboard
                    </div>
                    <h1 className="font-display text-[30px] leading-tight tracking-tight text-text-1 sm:text-[38px]">媒体库后台</h1>
                </div>
                <div className="flex flex-wrap gap-2">
                    <a
                        href="/admin/users"
                        className="px-4 py-1.5 rounded-full border border-line text-text-3 text-xs font-medium whitespace-nowrap hover:bg-bg-hover hover:text-text-1 transition-all cursor-pointer"
                    >
                        用户管理 →
                    </a>
                    <button
                        onClick={handleClearCache}
                        className="px-4 py-1.5 rounded-full border border-line text-text-3 text-xs font-medium whitespace-nowrap hover:bg-bg-hover hover:text-text-1 transition-all cursor-pointer"
                    >
                        清首页缓存
                    </button>
                    <button
                        onClick={handleScanAll}
                        disabled={scanning || dirs.length === 0}
                        className="px-4 py-1.5 rounded-full bg-primary text-white text-xs font-medium whitespace-nowrap hover:bg-primary-hover transition-all disabled:opacity-50 cursor-pointer"
                    >
                        {scanning ? "扫描中..." : "扫描全部"}
                    </button>
                </div>
            </div>

            {/* ===== 指标行 ===== */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-4">
                <StatTile label="电影" value={libStats?.movie} />
                <StatTile label="剧集" value={libStats?.series} />
                <StatTile label="动漫" value={libStats?.anime} />
                <StatTile label="相册" value={libStats?.travel} />
                <StatTile label="媒体目录" value={loading ? undefined : dirs.length} />
                <StatTile label="转码队列" value={activeJobs} accent={activeJobs > 0} />
            </div>

            {/* ===== 灵感飞卷走马灯（瘦身为独立细条） ===== */}
            <div className="w-full bg-primary/5 border border-primary/15 rounded-xl overflow-hidden flex items-center mb-4 h-9 px-4">
                <svg className="w-4 h-4 text-primary shrink-0 mr-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <div className="flex-1 overflow-hidden whitespace-nowrap mask-image-scroll relative">
                    <div className="inline-flex gap-20 animate-[scroll_40s_linear_infinite] text-[12px] text-primary/90 font-medium tracking-widest leading-none items-center">
                        <span>{recommendations}</span>
                        <span>{recommendations}</span>
                    </div>
                </div>
            </div>

            {/* ===== Dashboard 网格：左列（媒体目录 + 书籍导入）｜右侧双行高（转码工作台） ===== */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">

            {/* 媒体目录卡片 */}
            <section className="lg:col-span-5 rounded-xl bg-bg-card border border-line p-5 transition-colors" style={{ boxShadow: '0 1px 4px var(--color-shadow-card)' }}>
                <div className="flex items-center justify-between mb-4">
                    <h2 className="font-display text-[19px] text-text-1">媒体目录</h2>
                    <button
                        onClick={() => setShowAddForm(true)}
                        className="px-4 py-1.5 rounded-full border border-primary text-primary text-xs font-medium whitespace-nowrap hover:bg-primary/10 transition-all cursor-pointer"
                    >
                        + 添加目录
                    </button>
                </div>

                {loading ? (
                    <div className="text-center py-8 text-text-3 text-sm">加载中...</div>
                ) : dirs.length === 0 ? (
                    <div className="text-center py-8">
                        <svg className="w-10 h-10 mx-auto text-text-4 mb-2" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M20 6h-8l-2-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm0 12H4V8h16v10z" />
                        </svg>
                        <p className="text-sm text-text-2">尚未配置任何媒体目录</p>
                        <p className="text-xs text-text-3 mt-1">点击"添加目录"开始配置</p>
                    </div>
                ) : (
                    <div className="space-y-2 max-h-[320px] overflow-y-auto custom-scrollbar pr-1">
                        {dirs.map((dir) => (
                            <div key={dir.key} className="flex items-center gap-3 p-3 rounded-lg bg-bg-input border border-line-light transition-colors">
                                <svg className="w-5 h-5 text-text-3 shrink-0" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
                                </svg>
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium text-text-1 truncate">{dir.name}</p>
                                    <p className="text-xs text-text-3 truncate">{dir.path}</p>
                                </div>
                                <span className={`px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap shrink-0 ${typeColors[dir.type] || "bg-bg-tag text-text-3"}`}>
                                    {typeLabels[dir.type] || dir.type}
                                </span>
                                <button
                                    onClick={() => handleClearDirData(dir)}
                                    className="text-text-3 hover:text-amber-500 transition-colors p-1 cursor-pointer"
                                    title="清除映射数据"
                                >
                                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                    </svg>
                                </button>
                                <button
                                    onClick={() => handleDeleteDir(dir.key)}
                                    className="text-text-3 hover:text-[#f44336] transition-colors p-1 cursor-pointer"
                                    title="删除目录"
                                >
                                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                                        <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" />
                                    </svg>
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </section>

            {/* 转码工作台（右侧，双行高，与左列两卡对齐） */}
            <div className="lg:col-span-7 lg:row-span-2 min-w-0">
                <TranscodePanel
                    tcFiles={tcFiles} setTcFiles={setTcFiles}
                    tcSelected={tcSelected} setTcSelected={setTcSelected}
                    tcProbing={tcProbing} setTcProbing={setTcProbing}
                    tcProbeResults={tcProbeResults} setTcProbeResults={setTcProbeResults}
                    tcShowTrackModal={tcShowTrackModal} setTcShowTrackModal={setTcShowTrackModal}
                    tcTrackSelections={tcTrackSelections} setTcTrackSelections={setTcTrackSelections}
                    tcJobs={tcJobs} setTcJobs={setTcJobs}
                    tcLoading={tcLoading} setTcLoading={setTcLoading}
                    tcProgressRef={tcProgressRef}
                />
            </div>

            {/* 书籍导入 */}
            <div className="lg:col-span-5 min-w-0">
                <BookImportPanel />
            </div>

            {/* AI 用量与账单（全站，所有用户合并） */}
            <div className="lg:col-span-12 min-w-0">
                <AiBillingPanel />
            </div>

            </div>{/* ===== Dashboard 网格结束 ===== */}

            {/* 添加目录弹窗 */}
            {showAddForm && (
                <div
                    className="fixed inset-0 flex items-center justify-center z-[100]"
                    style={{ backgroundColor: 'var(--color-bg-mask)' }}
                    onClick={(e) => e.target === e.currentTarget && setShowAddForm(false)}
                >
                    <div className="bg-bg-card border border-line rounded-xl p-6 w-full max-w-md mx-4 animate-fadeIn transition-colors" style={{ boxShadow: '0 8px 32px var(--color-shadow-card)' }}>
                        <h3 className="text-base font-semibold text-text-1 mb-4">添加媒体目录</h3>

                        <div className="space-y-3">
                            <div>
                                <label className="text-xs text-text-2 mb-1 block">目录路径 *</label>
                                <input
                                    value={newPath}
                                    onChange={(e) => { setNewPath(e.target.value); setAddError(""); }}
                                    placeholder="例如: /srv/media/movies"
                                    className="w-full px-3 py-2.5 rounded-lg bg-bg-input border border-line text-text-1 text-sm placeholder:text-text-3 focus:outline-none focus:border-primary transition-colors"
                                />
                            </div>
                            <div>
                                <label className="text-xs text-text-2 mb-1 block">显示名称 (可选)</label>
                                <input
                                    value={newName}
                                    onChange={(e) => setNewName(e.target.value)}
                                    placeholder="例如: 我的电影收藏"
                                    className="w-full px-3 py-2.5 rounded-lg bg-bg-input border border-line text-text-1 text-sm placeholder:text-text-3 focus:outline-none focus:border-primary transition-colors"
                                />
                            </div>
                            <div>
                                <label className="text-xs text-text-2 mb-1 block">媒体类型 *</label>
                                <div className="grid grid-cols-3 gap-2 mb-2">
                                    {(["movie", "series", "anime", "travel", "private"] as const).map((t) => (
                                        <button
                                            key={t}
                                            onClick={() => setNewType(t)}
                                            className={`px-3 py-2 rounded-lg text-sm font-medium transition-all cursor-pointer border ${newType === t
                                                ? "border-primary bg-primary/10 text-primary"
                                                : "border-line text-text-2 hover:bg-bg-hover"
                                                }`}
                                        >
                                            {typeLabels[t]}
                                        </button>
                                    ))}
                                </div>
                                <div className="flex items-center gap-2 mt-2">
                                    <span className="text-xs text-text-3 shrink-0">或自定义：</span>
                                    <input
                                        value={["movie", "series", "anime", "travel", "private"].includes(newType) ? "" : newType}
                                        onChange={(e) => setNewType(e.target.value)}
                                        placeholder="输入自定义分类名 (如: theater)"
                                        className="flex-1 px-3 py-2 rounded-lg bg-bg-input border border-line text-text-1 text-sm placeholder:text-text-3 focus:outline-none focus:border-primary transition-colors"
                                    />
                                </div>
                            </div>

                            {addError && <p className="text-[#f44336] text-xs mt-2">{addError}</p>}

                            <div className="flex gap-2.5 mt-5">
                                <button
                                    onClick={() => { setShowAddForm(false); setAddError(""); }}
                                    className="flex-1 px-3 py-2.5 rounded-lg border border-line text-text-2 hover:bg-bg-hover text-sm font-medium transition-all cursor-pointer"
                                >
                                    取消
                                </button>
                                <button
                                    onClick={handleAddDir}
                                    className="flex-1 px-3 py-2.5 rounded-lg bg-primary text-white hover:bg-primary-hover text-sm font-medium transition-all cursor-pointer"
                                >
                                    添加
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
            {/* 扫描终端弹窗 */}
            {showScanTerminal && (
                <div
                    className="fixed inset-0 flex items-center justify-center z-[100]"
                    style={{ backgroundColor: 'var(--color-bg-mask)' }}
                >
                    <div className="bg-[#0D1117] border border-[#30363D] rounded-xl shadow-2xl w-full max-w-2xl mx-4 flex flex-col overflow-hidden">
                        <div className="bg-[#161B22] px-4 py-3 flex items-center justify-between border-b border-[#30363D]">
                            <div className="flex items-center gap-2">
                                <div className="flex gap-1.5 mr-3">
                                    <div className="w-3 h-3 rounded-full bg-[#FF5F56]"></div>
                                    <div className="w-3 h-3 rounded-full bg-[#FFBD2E]"></div>
                                    <div className="w-3 h-3 rounded-full bg-[#27C93F]"></div>
                                </div>
                                <span className="text-[#8B949E] text-xs font-mono">NAS_Scanner_Terminal ~ {scanning ? 'running' : 'stopped'}</span>
                            </div>
                            {!scanning && (
                                <button
                                    onClick={() => setShowScanTerminal(false)}
                                    className="text-[#8B949E] hover:text-white text-xs px-2 py-1 rounded transition-colors bg-[#21262D] hover:bg-[#30363D] cursor-pointer"
                                >
                                    关闭
                                </button>
                            )}
                        </div>
                        <div className="p-4 h-[400px] overflow-y-auto leading-relaxed custom-scrollbar font-mono text-[13px]">
                            {scanLogs.map((log, i) => (
                                <div key={i} className={`mb-1 break-all ${
                                    log.startsWith('[SUCCESS]') ? 'text-[#3FB950]' :
                                    log.startsWith('[ERROR]') || log.startsWith('[FATAL]') ? 'text-[#F85149]' :
                                    log.startsWith('[目录]') ? 'text-[#58A6FF]' :
                                    log.startsWith('[剧集]') ? 'text-[#D2A8FF]' :
                                    log.startsWith('[文件]') ? 'text-[#A5D6FF]' :
                                    'text-[#C9D1D9]'
                                }`}>
                                    <span className="text-[#484F58] mr-2 select-none">{String(i + 1).padStart(4, '0')} |</span>
                                    {log}
                                </div>
                            ))}
                            {scanning && (
                                <div className="flex items-center text-[#C9D1D9] mt-2 mb-1 animate-pulse">
                                    <span className="text-[#484F58] mr-2 select-none">     |</span>
                                    扫描进行中...
                                </div>
                            )}
                            <div ref={logsEndRef} />
                        </div>
                    </div>
                </div>
            )}

        </div>
    );
}

// ==================== 指标卡片 ====================
function StatTile({ label, value, accent }: { label: string; value: number | undefined; accent?: boolean }) {
    return (
        <div className="rounded-xl bg-bg-card border border-line px-4 py-3.5 transition-colors" style={{ boxShadow: '0 1px 4px var(--color-shadow-card)' }}>
            <div className="text-[11px] tracking-[0.2em] uppercase text-text-3">{label}</div>
            <div className={`mt-1.5 font-display text-[26px] leading-none tabular-nums ${accent ? "text-primary" : "text-text-1"}`}>
                {value === undefined ? "—" : value}
            </div>
        </div>
    );
}

// ==================== 树状组件库 ====================
const ChevronIcon = ({ expanded }: { expanded: boolean }) => (
    <svg className={`w-4 h-4 text-text-3 transition-transform duration-200 ${expanded ? 'rotate-90' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="9 18 15 12 9 6" />
    </svg>
);

const TriCheckbox = ({ state, onClick }: { state: 'checked' | 'unchecked' | 'partial', onClick: () => void }) => (
    <div 
        onClick={(e) => { e.stopPropagation(); onClick(); }} 
        className={`shrink-0 w-4 h-4 rounded-[3px] border flex items-center justify-center transition-colors cursor-pointer ${
            state === 'unchecked' ? 'border-text-4 hover:border-primary' : 'bg-primary border-primary'
        }`}
    >
        {state === 'checked' && <svg className="w-3 h-3 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>}
        {state === 'partial' && <div className="w-2 h-[2px] bg-white rounded-full" />}
    </div>
);

const getCheckState = (paths: string[], selected: Set<string>): 'checked' | 'unchecked' | 'partial' => {
    if (paths.length === 0) return 'unchecked';
    let count = 0;
    for (const p of paths) {
        if (selected.has(p)) count++;
    }
    if (count === 0) return 'unchecked';
    if (count === paths.length) return 'checked';
    return 'partial';
};

// ==================== 转码面板组件 ====================
function TranscodePanel({ tcFiles, setTcFiles, tcSelected, setTcSelected, tcProbing, setTcProbing, tcProbeResults, setTcProbeResults, tcShowTrackModal, setTcShowTrackModal, tcTrackSelections, setTcTrackSelections, tcJobs, setTcJobs, tcLoading, setTcLoading, tcProgressRef }: any) {

    // 加载媒体文件列表
    const loadFiles = async () => {
        setTcLoading(true);
        try {
            const res = await fetch('/api/media/transcode', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'list_files' })
            }).then(r => r.json());

            if (res.success && res.files) {
                setTcFiles(res.files);
            }
        } catch (err) {
            console.error('加载文件列表失败:', err);
        } finally {
            setTcLoading(false);
        }
    };

    // 探测选中文件的轨道信息
    const probeSelected = async () => {
        setTcProbing(true);
        const results = new Map<string, any>();
        const selections = new Map<string, { audioIndex: number | null; subtitleIndex: number | null }>();

        for (const filePath of tcSelected) {
            try {
                const res = await fetch('/api/media/transcode', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'probe', filePath })
                }).then(r => r.json());

                if (res.success) {
                    results.set(filePath, res);
                    selections.set(filePath, {
                        audioIndex: res.audioTracks?.[0]?.index ?? null,
                        subtitleIndex: null
                    });
                }
            } catch {}
        }

        setTcProbeResults(results);
        setTcTrackSelections(selections);
        setTcProbing(false);
        setTcShowTrackModal(true);
    };

    // 提交转码任务
    const submitTranscode = async () => {
        const files = Array.from(tcSelected).map(p => ({
            path: p,
            audioIndex: tcTrackSelections.get(p)?.audioIndex ?? null,
            subtitleIndex: tcTrackSelections.get(p)?.subtitleIndex ?? null
        }));

        try {
            await fetch('/api/media/transcode', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'start', files })
            });
            setTcShowTrackModal(false);
            setTcSelected(new Set());
            refreshJobs();
            startSSE();
        } catch (err) {
            console.error('提交转码失败:', err);
        }
    };

    // 刷新任务列表
    const refreshJobs = async () => {
        try {
            const res = await fetch('/api/media/transcode').then(r => r.json());
            if (res.success) setTcJobs(res.jobs);
        } catch {}
    };

    // 启动 SSE 进度监听
    const startSSE = () => {
        if (tcProgressRef.current) tcProgressRef.current.close();
        const es = new EventSource('/api/media/transcode/progress');
        tcProgressRef.current = es;

        es.onmessage = (e) => {
            try {
                const data = JSON.parse(e.data);
                if (data.heartbeat) return;
                setTcJobs((prev: any[]) => {
                    const idx = prev.findIndex((j: any) => j.id === data.jobId);
                    const updated = {
                        id: data.jobId,
                        source_path: data.sourcePath,
                        output_path: data.outputPath,
                        status: data.status,
                        progress: data.progress,
                        video_codec: data.videoCodec,
                        audio_codec: data.audioCodec,
                        error: data.error,
                        liveProgress: { speed: data.speed, eta: data.eta }
                    };
                    if (idx >= 0) {
                        const copy = [...prev];
                        copy[idx] = { ...copy[idx], ...updated };
                        return copy;
                    } else {
                        return [updated, ...prev];
                    }
                });
            } catch {}
        };

        es.onerror = () => {
            es.close();
            tcProgressRef.current = null;
        };
    };

    // 取消任务
    const cancelJob = async (jobId: string) => {
        await fetch('/api/media/transcode', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'cancel', jobId })
        });
        refreshJobs();
    };

    // 删除原文件
    const deleteSource = async (jobId: string) => {
        if (!confirm('确认删除原文件并用转码文件替换？此操作不可撤销！')) return;
        const res = await fetch('/api/media/transcode', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'delete_source', jobId })
        }).then(r => r.json());
        if (res.success) {
            alert(`已替换: ${res.finalPath}`);
            refreshJobs();
        } else {
            alert(`失败: ${res.error}`);
        }
    };

    // 初始加载
    useEffect(() => {
        refreshJobs();
        // 有运行中任务时启动 SSE
        return () => { if (tcProgressRef.current) tcProgressRef.current.close(); };
    }, []);

    // 树状展示逻辑 --------------------
    const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
    const toggleExpand = (id: string) => {
        setExpandedNodes(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const treeData = useMemo(() => {
        const movies: any[] = [];
        const seriesMap = new Map<string, any>(); 

        (tcFiles || []).forEach((f: any) => {
            if (f.type === 'movie' || f.type === 'private' || f.type === 'travel') {
                movies.push(f);
            } else {
                if (!seriesMap.has(f.mediaId)) {
                    seriesMap.set(f.mediaId, {
                        mediaId: f.mediaId,
                        title: f.seriesTitle || f.title,
                        type: f.type,
                        seasonsMap: new Map<number, any>(),
                        paths: []
                    });
                }
                const sNode = seriesMap.get(f.mediaId);
                sNode.paths.push(f.path);

                const sNum = f.season ?? 1;
                if (!sNode.seasonsMap.has(sNum)) {
                    sNode.seasonsMap.set(sNum, {
                        season: sNum,
                        paths: [],
                        episodes: []
                    });
                }
                const seasonNode = sNode.seasonsMap.get(sNum);
                seasonNode.paths.push(f.path);
                seasonNode.episodes.push(f);
            }
        });

        const seriesList = Array.from(seriesMap.values()).map(s => ({
            ...s,
            seasons: Array.from(s.seasonsMap.values()).sort((a: any, b: any) => a.season - b.season)
        })).sort((a,b) => a.title.localeCompare(b.title));

        return { movies, seriesList };
    }, [tcFiles]);

    const handleSelectPaths = (paths: string[], forceState: boolean) => {
        setTcSelected((prev: Set<string>) => {
            const next = new Set(prev);
            for (const p of paths) {
                if (forceState) next.add(p);
                else next.delete(p);
            }
            return next;
        });
    };
    // ---------------------------------

    const codecTag = (codec: string) => {
        const safe = ['h264', 'aac', 'mp3', 'opus', 'vorbis'];
        const isSafe = safe.some(s => (codec || '').toLowerCase().includes(s));
        return (
            <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-bold uppercase ${
                isSafe ? 'bg-[#3FB950]/15 text-[#3FB950]' : 'bg-[#F85149]/15 text-[#F85149]'
            }`}>
                {codec || '?'}
            </span>
        );
    };

    const baseName = (p: string) => {
        const parts = (p || '').replace(/\\/g, '/').split('/');
        return parts[parts.length - 1] || p;
    };

    return (
        <section className="h-full rounded-xl bg-bg-card border border-line p-5 transition-colors" style={{ boxShadow: '0 1px 4px var(--color-shadow-card)' }}>
            <div className="flex items-center justify-between mb-4">
                <h2 className="font-display text-[19px] text-text-1">转码工作台</h2>
                <div className="flex gap-2">
                    <button
                        onClick={loadFiles}
                        disabled={tcLoading}
                        className="px-3 py-1.5 rounded-sm border border-line text-text-3 text-xs font-medium hover:bg-bg-hover transition-all cursor-pointer disabled:opacity-50"
                    >
                        {tcLoading ? '加载中...' : '加载文件列表'}
                    </button>
                    {tcSelected.size > 0 && (
                        <button
                            onClick={probeSelected}
                            disabled={tcProbing}
                            className="px-3 py-1.5 rounded-sm bg-primary text-white text-xs font-medium hover:bg-primary-hover transition-all cursor-pointer disabled:opacity-50"
                        >
                            {tcProbing ? '探测中...' : `转码 ${tcSelected.size} 个文件`}
                        </button>
                    )}
                </div>
            </div>

            {/* 文件列表 (层级树) */}
            {tcFiles.length > 0 && (
                <div className="max-h-[400px] overflow-y-auto custom-scrollbar border border-line rounded-lg mb-4 bg-bg">
                    
                    {/* 单实例电影 */}
                    {treeData.movies.map((f: any, i: number) => (
                        <div key={f.path + i} className="flex items-center gap-3 px-3 py-2 cursor-pointer transition-colors border-b border-line last:border-b-0 hover:bg-bg-hover" onClick={() => handleSelectPaths([f.path], !tcSelected.has(f.path))}>
                            <TriCheckbox state={getCheckState([f.path], tcSelected)} onClick={() => handleSelectPaths([f.path], !tcSelected.has(f.path))} />
                            <div className="flex-1 min-w-0">
                                <p className="text-sm text-text-1 truncate">{f.title}</p>
                                <p className="text-[11px] text-text-3 truncate font-mono">{baseName(f.path)}</p>
                            </div>
                            <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-bili-pink/10 text-bili-pink">Movie</span>
                        </div>
                    ))}

                    {/* 剧集/动漫树 */}
                    {treeData.seriesList.map((series: any) => {
                        const sExpanded = expandedNodes.has(series.mediaId);
                        
                        return (
                            <div key={series.mediaId} className="border-b border-line last:border-b-0">
                                {/* 剧集标题层 */}
                                <div className="flex items-center justify-between px-3 py-2 cursor-pointer bg-bg hover:bg-bg-hover transition-colors" onClick={() => toggleExpand(series.mediaId)}>
                                    <div className="flex items-center gap-2">
                                        <ChevronIcon expanded={sExpanded} />
                                        <TriCheckbox state={getCheckState(series.paths, tcSelected)} onClick={() => handleSelectPaths(series.paths, getCheckState(series.paths, tcSelected) !== 'checked')} />
                                        <p className="text-sm font-medium text-text-1">{series.title}</p>
                                    </div>
                                    <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${series.type === 'anime' ? 'bg-accent-glow text-bili-pink' : 'bg-bili-blue/10 text-bili-blue'}`}>
                                        {series.type === 'anime' ? 'Anime' : 'Series'}
                                    </span>
                                </div>

                                {/* 季/集子节点 */}
                                {sExpanded && series.seasons.map((season: any) => {
                                    const seasonId = `${series.mediaId}-S${season.season}`;
                                    const seasonExpanded = expandedNodes.has(seasonId);
                                    
                                    return (
                                        <div key={seasonId} className="bg-bg-input">
                                            {/* 季级节点 */}
                                            <div className="flex items-center gap-2 pl-8 pr-3 py-1.5 cursor-pointer hover:bg-bg-card transition-colors border-t border-line/50" onClick={() => toggleExpand(seasonId)}>
                                                <ChevronIcon expanded={seasonExpanded} />
                                                <TriCheckbox state={getCheckState(season.paths, tcSelected)} onClick={() => handleSelectPaths(season.paths, getCheckState(season.paths, tcSelected) !== 'checked')} />
                                                <p className="text-[13px] text-text-1">Season {season.season}</p>
                                            </div>

                                            {/* 集级节点 */}
                                            {seasonExpanded && season.episodes.map((ep: any, i: number) => (
                                                <div key={ep.path} className="flex items-center gap-2 pl-14 pr-3 py-1.5 cursor-pointer hover:bg-bg-card transition-colors border-t border-line/30" onClick={() => handleSelectPaths([ep.path], !tcSelected.has(ep.path))}>
                                                    <TriCheckbox state={getCheckState([ep.path], tcSelected)} onClick={() => handleSelectPaths([ep.path], !tcSelected.has(ep.path))} />
                                                    <div className="flex-1 min-w-0">
                                                        <p className="text-[13px] text-text-2 truncate">{ep.episodeTitle || `Episode ${ep.episode}`}</p>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    );
                                })}
                            </div>
                        );
                    })}
                </div>
            )}

            {/* 转码任务进度 */}
            {tcJobs.length > 0 && (
                <div className="bg-[#0D1117] rounded-lg border border-[#30363D] overflow-hidden">
                    <div className="bg-[#161B22] px-4 py-2.5 flex items-center justify-between border-b border-[#30363D]">
                        <span className="text-[#8B949E] text-xs font-mono">Transcode Queue</span>
                        <button
                            onClick={() => { fetch('/api/media/transcode', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'clear_done' }) }).then(() => refreshJobs()); }}
                            className="text-[#8B949E] hover:text-white text-[10px] px-2 py-0.5 rounded bg-[#21262D] hover:bg-[#30363D] transition-colors cursor-pointer"
                        >
                            清除历史
                        </button>
                    </div>
                    <div className="p-3 space-y-2 max-h-[300px] overflow-y-auto custom-scrollbar">
                        {tcJobs.map((job: any) => (
                            <div key={job.id} className="flex items-center gap-3 text-[13px]">
                                {/* 状态图标 */}
                                <span className="shrink-0">
                                    {job.status === 'done' ? '✅' : job.status === 'error' ? '❌' : job.status === 'running' ? '⚙️' : '⏳'}
                                </span>

                                {/* 文件名 + 编码标签 */}
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                        <span className="text-[#C9D1D9] truncate">{baseName(job.source_path)}</span>
                                        <span className="flex gap-1 shrink-0">
                                            {codecTag(job.video_codec)}
                                            {codecTag(job.audio_codec)}
                                        </span>
                                    </div>

                                    {/* 进度条 */}
                                    {job.status === 'running' && (
                                        <div className="flex items-center gap-2 mt-1">
                                            <div className="flex-1 h-1.5 bg-[#21262D] rounded-full overflow-hidden">
                                                <div
                                                    className="h-full bg-[#3FB950] rounded-full transition-all duration-500"
                                                    style={{ width: `${job.liveProgress?.progress ?? job.progress ?? 0}%` }}
                                                />
                                            </div>
                                            <span className="text-[#3FB950] text-[11px] font-mono w-12 text-right">
                                                {Math.round(job.liveProgress?.progress ?? job.progress ?? 0)}%
                                            </span>
                                            {job.liveProgress?.speed && (
                                                <span className="text-[#8B949E] text-[10px] font-mono">
                                                    {job.liveProgress.speed} {job.liveProgress.eta ? `ETA ${job.liveProgress.eta}` : ''}
                                                </span>
                                            )}
                                        </div>
                                    )}

                                    {job.status === 'error' && job.error && (
                                        <p className="text-[#F85149] text-[11px] mt-0.5">{job.error}</p>
                                    )}
                                </div>

                                {/* 操作按钮 */}
                                <div className="flex gap-1 shrink-0">
                                    {(job.status === 'running' || job.status === 'pending') && (
                                        <button
                                            onClick={() => cancelJob(job.id)}
                                            className="text-[#F85149] hover:bg-[#F85149]/20 px-2 py-1 rounded text-[11px] transition-colors cursor-pointer"
                                        >
                                            取消
                                        </button>
                                    )}
                                    {job.status === 'done' && (
                                        <button
                                            onClick={() => deleteSource(job.id)}
                                            className="text-[#F0883E] hover:bg-[#F0883E]/20 px-2 py-1 rounded text-[11px] transition-colors cursor-pointer"
                                        >
                                            删原文件
                                        </button>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* 轨道选择弹窗 */}
            {tcShowTrackModal && (
                <div
                    className="fixed inset-0 flex items-center justify-center z-[100]"
                    style={{ backgroundColor: 'var(--color-bg-mask)' }}
                    onClick={(e) => e.target === e.currentTarget && setTcShowTrackModal(false)}
                >
                    <div className="bg-bg-card border border-line rounded-xl p-6 w-full max-w-xl mx-4 max-h-[80vh] overflow-y-auto custom-scrollbar" style={{ boxShadow: '0 8px 32px var(--color-shadow-card)' }}>
                        <h3 className="text-base font-semibold text-text-1 mb-4">选择音轨和字幕</h3>

                        {(Array.from(tcProbeResults.entries()) as [string, any][]).map(([filePath, probe]) => (
                            <div key={filePath} className="mb-5 p-4 border border-line rounded-lg bg-bg-input">
                                <p className="text-sm font-medium text-text-1 mb-1 truncate">{baseName(filePath)}</p>
                                <div className="flex gap-2 mb-3">
                                    {codecTag(probe.videoCodec)}
                                    {probe.audioTracks?.[0] && codecTag(probe.audioTracks[0].codec)}
                                    {probe.needsVideoTranscode && <span className="text-[10px] text-[#F0883E]">→ H.264</span>}
                                    {!probe.needsVideoTranscode && <span className="text-[10px] text-[#3FB950]">Video Copy</span>}
                                </div>

                                {/* 音轨选择 */}
                                {(probe.audioTracks || []).length > 0 && (
                                    <div className="mb-3">
                                        <p className="text-xs text-text-2 mb-1.5 font-medium">🎵 音轨</p>
                                        <div className="space-y-1">
                                            {probe.audioTracks.map((t: any) => (
                                                <label key={t.index} className="flex items-center gap-2 cursor-pointer text-sm text-text-1 px-2 py-1 rounded hover:bg-bg-hover">
                                                    <input
                                                        type="radio"
                                                        name={`audio-${filePath}`}
                                                        checked={tcTrackSelections.get(filePath)?.audioIndex === t.index}
                                                        onChange={() => {
                                                            const next = new Map(tcTrackSelections);
                                                            next.set(filePath, { ...next.get(filePath)!, audioIndex: t.index });
                                                            setTcTrackSelections(next);
                                                        }}
                                                        className="accent-primary"
                                                    />
                                                    <span>{t.title || t.language}</span>
                                                    {codecTag(t.codec)}
                                                    {t.channels > 0 && <span className="text-text-3 text-[10px]">{t.channels}ch</span>}
                                                </label>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* 字幕选择 */}
                                {(probe.subtitleTracks || []).length > 0 && (
                                    <div>
                                        <p className="text-xs text-text-2 mb-1.5 font-medium">💬 字幕（烧录到视频，仅在重编码时可用）</p>
                                        <div className="space-y-1">
                                            <label className="flex items-center gap-2 cursor-pointer text-sm text-text-1 px-2 py-1 rounded hover:bg-bg-hover">
                                                <input
                                                    type="radio"
                                                    name={`sub-${filePath}`}
                                                    checked={tcTrackSelections.get(filePath)?.subtitleIndex === null}
                                                    onChange={() => {
                                                        const next = new Map(tcTrackSelections);
                                                        next.set(filePath, { ...next.get(filePath)!, subtitleIndex: null });
                                                        setTcTrackSelections(next);
                                                    }}
                                                    className="accent-primary"
                                                />
                                                <span className="text-text-3">不烧录字幕</span>
                                            </label>
                                            {probe.subtitleTracks.map((t: any) => (
                                                <label key={t.index} className={`flex items-center gap-2 cursor-pointer text-sm text-text-1 px-2 py-1 rounded hover:bg-bg-hover ${probe.needsVideoTranscode ? '' : 'opacity-40 pointer-events-none'}`}>
                                                    <input
                                                        type="radio"
                                                        name={`sub-${filePath}`}
                                                        checked={tcTrackSelections.get(filePath)?.subtitleIndex === t.index}
                                                        disabled={!probe.needsVideoTranscode}
                                                        onChange={() => {
                                                            const next = new Map(tcTrackSelections);
                                                            next.set(filePath, { ...next.get(filePath)!, subtitleIndex: t.index });
                                                            setTcTrackSelections(next);
                                                        }}
                                                        className="accent-primary"
                                                    />
                                                    <span>{t.title || t.language}</span>
                                                    {codecTag(t.codec)}
                                                    {t.isImage && <span className="text-[10px] text-[#F0883E]">图形</span>}
                                                </label>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        ))}

                        <div className="flex gap-2 mt-4">
                            <button
                                onClick={() => setTcShowTrackModal(false)}
                                className="flex-1 px-3 py-2.5 rounded-lg border border-line text-text-2 hover:bg-bg-hover text-sm font-medium transition-all cursor-pointer"
                            >
                                取消
                            </button>
                            <button
                                onClick={submitTranscode}
                                className="flex-1 px-3 py-2.5 rounded-lg bg-primary text-white hover:bg-primary-hover text-sm font-medium transition-all cursor-pointer"
                            >
                                🚀 开始转码
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </section>
    );
}

// ==================== 书籍导入面板 ====================
// 上传到 /api/books/import：分类下拉（5 个基础分类）+ 多文件选择 + 逐文件结果。
// 落盘 ~/mydrive/book/<分类>/，书架页（/bookshelf）刷新即可见。
const BOOK_CATEGORIES = ["推理悬疑", "科幻", "文学名著", "科研学术", "技术文档", "其他"];

function BookImportPanel() {
    const [category, setCategory] = useState(BOOK_CATEGORIES[0]);
    const [files, setFiles] = useState<File[]>([]);
    const [uploading, setUploading] = useState(false);
    const [results, setResults] = useState<{ name: string; ok: boolean; message: string }[]>([]);
    const [fatalError, setFatalError] = useState("");
    const fileInputRef = useRef<HTMLInputElement>(null);

    // 导入模式：server = 浏览服务器目录选文件（默认，书都在 NAS 上）；upload = 从访问设备上传
    const [mode, setMode] = useState<"server" | "upload">("server");
    // 服务器浏览器状态
    const [browseDir, setBrowseDir] = useState<string | null>(null);
    const [browseData, setBrowseData] = useState<{
        dir: string; parent: string | null; root: string;
        dirs: { name: string; path: string }[];
        files: { name: string; path: string; size: number; ext: string }[];
    } | null>(null);
    const [browseLoading, setBrowseLoading] = useState(false);
    const [picked, setPicked] = useState<Set<string>>(new Set());
    const [moveMode, setMoveMode] = useState(false); // false=复制保留原文件

    useEffect(() => {
        if (mode !== "server") return;
        setBrowseLoading(true);
        const url = browseDir ? `/api/books/server-browse?dir=${encodeURIComponent(browseDir)}` : "/api/books/server-browse";
        fetch(url)
            .then((r) => r.json())
            .then((d) => { if (d.success) setBrowseData(d.data); else setFatalError(d.error || "读取目录失败"); })
            .catch(() => setFatalError("读取目录失败"))
            .finally(() => setBrowseLoading(false));
    }, [mode, browseDir]);

    const togglePick = (p: string) => {
        setPicked((prev) => {
            const next = new Set(prev);
            if (next.has(p)) next.delete(p); else next.add(p);
            return next;
        });
    };

    const handleServerImport = async () => {
        if (picked.size === 0 || uploading) return;
        setUploading(true);
        setResults([]);
        setFatalError("");
        try {
            const res = await fetch("/api/books/import-server", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ paths: Array.from(picked), category, move: moveMode }),
            });
            const data = await res.json();
            if (data.results) {
                setResults(data.results);
                if (data.results.every((r: any) => r.ok)) setPicked(new Set());
            } else {
                setFatalError(data.error || "导入失败");
            }
        } catch {
            setFatalError("请求失败，请重试");
        } finally {
            setUploading(false);
        }
    };

    const handleUpload = async () => {
        if (files.length === 0 || uploading) return;
        setUploading(true);
        setResults([]);
        setFatalError("");
        try {
            const form = new FormData();
            form.append("category", category);
            for (const f of files) form.append("files", f);
            const res = await fetch("/api/books/import", { method: "POST", body: form });
            const data = await res.json();
            if (data.results) {
                setResults(data.results);
                // 全部成功才清空选择；有失败时保留，便于用户对照重传
                if (data.results.every((r: any) => r.ok)) {
                    setFiles([]);
                    if (fileInputRef.current) fileInputRef.current.value = "";
                }
            } else {
                setFatalError(data.error || "导入失败");
            }
        } catch {
            setFatalError("请求失败，请检查网络后重试");
        } finally {
            setUploading(false);
        }
    };

    return (
        <section className="h-full rounded-xl bg-bg-card border border-line p-5 transition-colors" style={{ boxShadow: '0 1px 4px var(--color-shadow-card)' }}>
            <div className="flex items-center justify-between mb-4">
                <h2 className="font-display text-[19px] text-text-1">书籍导入</h2>
                <div className="flex items-center gap-2">
                    {/* 模式切换：默认从服务器选（书都在 NAS 上），上传是给外部设备用的备用路径 */}
                    <div className="flex rounded-full border border-line overflow-hidden text-xs font-medium">
                        <button onClick={() => { setMode("server"); setResults([]); setFatalError(""); }}
                            className={`px-3.5 py-1.5 transition-colors cursor-pointer ${mode === "server" ? "bg-primary text-white" : "text-text-3 hover:text-text-1"}`}>
                            从服务器选择
                        </button>
                        <button onClick={() => { setMode("upload"); setResults([]); setFatalError(""); }}
                            className={`px-3.5 py-1.5 transition-colors cursor-pointer ${mode === "upload" ? "bg-primary text-white" : "text-text-3 hover:text-text-1"}`}>
                            上传本地文件
                        </button>
                    </div>
                    <a href="/bookshelf" className="px-4 py-1.5 rounded-full border border-line text-text-3 text-xs font-medium whitespace-nowrap hover:bg-bg-hover hover:text-text-1 transition-all cursor-pointer">
                        查看书架 →
                    </a>
                </div>
            </div>

            {mode === "server" && (
                <div>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-end mb-3">
                        <div className="sm:w-44">
                            <label className="text-xs text-text-2 mb-1 block">目标分类</label>
                            <select value={category} onChange={(e) => setCategory(e.target.value)}
                                className="w-full px-3 py-2.5 rounded-lg bg-bg-input border border-line text-text-1 text-sm focus:outline-none focus:border-primary transition-colors cursor-pointer">
                                {BOOK_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                            </select>
                        </div>
                        <label className="flex items-center gap-2 text-xs text-text-2 pb-2.5 cursor-pointer select-none">
                            <input type="checkbox" checked={moveMode} onChange={(e) => setMoveMode(e.target.checked)} className="accent-[var(--color-primary)]" />
                            移动（不保留原位置文件；默认为复制）
                        </label>
                        <button onClick={handleServerImport} disabled={uploading || picked.size === 0}
                            className="sm:ml-auto px-5 py-2.5 rounded-lg bg-primary text-white text-sm font-medium whitespace-nowrap hover:bg-primary-hover transition-all disabled:opacity-50 cursor-pointer shrink-0">
                            {uploading ? "导入中..." : picked.size > 0 ? `导入 ${picked.size} 本到「${category}」` : "导入"}
                        </button>
                    </div>

                    {/* 服务器目录浏览器 */}
                    <div className="rounded-lg border border-line bg-bg-input overflow-hidden">
                        <div className="flex items-center gap-2 px-3 py-2 border-b border-line text-xs text-text-3">
                            <button
                                onClick={() => browseData?.parent && setBrowseDir(browseData.parent)}
                                disabled={!browseData?.parent}
                                className="px-2 py-1 rounded border border-line hover:bg-bg-hover disabled:opacity-40 cursor-pointer transition-colors">
                                ← 上级
                            </button>
                            <span className="truncate font-mono">{browseData?.dir ?? "..."}</span>
                            {browseLoading && <span className="shrink-0">读取中...</span>}
                            {/* 全选/取消全选 本目录的电子书文件 */}
                            {browseData && browseData.files.length > 0 && (() => {
                                const allPicked = browseData.files.every((f) => picked.has(f.path));
                                return (
                                    <button
                                        onClick={() => setPicked((prev) => {
                                            const next = new Set(prev);
                                            for (const f of browseData.files) { if (allPicked) next.delete(f.path); else next.add(f.path); }
                                            return next;
                                        })}
                                        className="ml-auto shrink-0 px-2 py-1 rounded border border-line hover:bg-bg-hover hover:text-text-1 cursor-pointer transition-colors">
                                        {allPicked ? "取消全选" : `全选本目录（${browseData.files.length}）`}
                                    </button>
                                );
                            })()}
                        </div>
                        <div className="max-h-72 overflow-y-auto custom-scrollbar divide-y divide-line/40">
                            {browseData?.dirs.map((d) => (
                                <div key={d.path} className="flex items-center hover:bg-bg-hover transition-colors">
                                    {/* 勾选文件夹 = 导入整个文件夹内的电子书（服务端递归收集） */}
                                    <label className="pl-3 pr-1 py-2 cursor-pointer" title="勾选整个文件夹（递归导入其中的电子书）">
                                        <input type="checkbox" checked={picked.has(d.path)} onChange={() => togglePick(d.path)} className="accent-[var(--color-primary)]" />
                                    </label>
                                    <button onClick={() => setBrowseDir(d.path)}
                                        className="flex flex-1 min-w-0 items-center gap-2.5 pr-3 py-2 text-sm text-text-2 cursor-pointer text-left">
                                        <span>📁</span><span className="truncate">{d.name}</span>
                                        {picked.has(d.path) && <span className="ml-auto shrink-0 text-[10px] text-primary font-medium">整个文件夹</span>}
                                    </button>
                                </div>
                            ))}
                            {browseData?.files.map((f) => (
                                <label key={f.path} className="flex items-center gap-2.5 px-3 py-2 text-sm text-text-1 hover:bg-bg-hover transition-colors cursor-pointer">
                                    <input type="checkbox" checked={picked.has(f.path)} onChange={() => togglePick(f.path)} className="accent-[var(--color-primary)]" />
                                    <span className="text-[10px] font-bold uppercase text-primary bg-primary/10 rounded px-1 py-0.5">{f.ext}</span>
                                    <span className="truncate">{f.name}</span>
                                    <span className="ml-auto shrink-0 text-[11px] text-text-3">{(f.size / 1024 / 1024).toFixed(1)} MB</span>
                                </label>
                            ))}
                            {browseData && browseData.dirs.length === 0 && browseData.files.length === 0 && (
                                <div className="px-3 py-6 text-center text-xs text-text-3">此目录下没有子目录或电子书文件</div>
                            )}
                        </div>
                    </div>
                    {picked.size > 0 && (
                        <div className="mt-2 text-[11px] text-text-3">
                            已勾选 {picked.size} 项（文件/文件夹均可，跨目录累计；文件夹会递归导入其中的电子书，单次最多 500 本）
                        </div>
                    )}
                </div>
            )}

            <div className={mode === "upload" ? "flex flex-col gap-3 sm:flex-row sm:items-end" : "hidden"}>
                {/* 分类下拉 */}
                <div className="sm:w-44">
                    <label className="text-xs text-text-2 mb-1 block">目标分类</label>
                    <select
                        value={category}
                        onChange={(e) => setCategory(e.target.value)}
                        className="w-full px-3 py-2.5 rounded-lg bg-bg-input border border-line text-text-1 text-sm focus:outline-none focus:border-primary transition-colors cursor-pointer"
                    >
                        {BOOK_CATEGORIES.map((c) => (
                            <option key={c} value={c}>{c}</option>
                        ))}
                    </select>
                </div>

                {/* 文件选择 */}
                <div className="flex-1 min-w-0">
                    <label className="text-xs text-text-2 mb-1 block">书籍文件（epub / pdf / md / mobi，单文件 ≤ 300MB）</label>
                    <input
                        ref={fileInputRef}
                        type="file"
                        multiple
                        accept=".epub,.pdf,.md,.mobi"
                        onChange={(e) => { setFiles(Array.from(e.target.files || [])); setResults([]); setFatalError(""); }}
                        className="w-full text-sm text-text-2 file:mr-3 file:px-4 file:py-2 file:rounded-lg file:border file:border-line file:bg-bg-input file:text-text-1 file:text-sm file:font-medium file:cursor-pointer hover:file:bg-bg-hover file:transition-colors cursor-pointer"
                    />
                </div>

                {/* 上传按钮 */}
                <button
                    onClick={handleUpload}
                    disabled={uploading || files.length === 0}
                    className="px-5 py-2.5 rounded-lg bg-primary text-white text-sm font-medium whitespace-nowrap hover:bg-primary-hover transition-all disabled:opacity-50 cursor-pointer shrink-0"
                >
                    {uploading ? "上传中..." : files.length > 0 ? `导入 ${files.length} 本到「${category}」` : "导入"}
                </button>
            </div>

            {/* 待上传清单 */}
            {files.length > 0 && results.length === 0 && !uploading && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                    {files.map((f, i) => (
                        <span key={i} className="px-2 py-1 rounded-md bg-bg-input border border-line-light text-[11px] text-text-2 max-w-[280px] truncate">
                            {f.name} · {(f.size / 1024 / 1024).toFixed(1)} MB
                        </span>
                    ))}
                </div>
            )}

            {fatalError && <p className="mt-3 text-[#f44336] text-xs">{fatalError}</p>}

            {/* 逐文件结果列表 */}
            {results.length > 0 && (
                <div className="mt-4 space-y-1.5">
                    {results.map((r, i) => (
                        <div key={i} className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-bg-input border border-line-light text-sm">
                            {r.ok ? (
                                <svg className="w-4 h-4 text-[#3FB950] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                                    <polyline points="20 6 9 17 4 12" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                            ) : (
                                <svg className="w-4 h-4 text-[#f44336] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            )}
                            <span className="text-text-1 truncate min-w-0">{r.name}</span>
                            <span className={`ml-auto shrink-0 text-xs ${r.ok ? "text-text-3" : "text-[#f44336]"}`}>
                                {r.ok ? `已保存为 ${r.message}` : r.message}
                            </span>
                        </div>
                    ))}
                </div>
            )}
        </section>
    );
}

// ==================== AI 用量与账单 ====================
// 全站（所有用户合并）的 DeepSeek token 消耗与花费，按阅读器组件拆分。数据来自 /api/admin/ai-usage。
interface UsageRow {
    component: string; label: string; calls: number;
    inputTokens: number; cacheTokens: number; outputTokens: number; totalTokens: number; costUsd: number;
}
interface UsageData {
    components: UsageRow[]; total: UsageRow; since: string | null;
    price: { inputMiss: number; cacheHit: number; output: number };
}

const CNY_PER_USD = 7.2; // 人民币约数（仅换算展示，账单以美元结算）
const fmtInt = (n: number) => n.toLocaleString("en-US");
const fmtTok = (n: number) => n >= 1_000_000 ? `${(n / 1_000_000).toFixed(2)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}K` : String(n);
const fmtUsd = (n: number) => n === 0 ? "$0" : n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`;

function AiBillingPanel() {
    const [data, setData] = useState<UsageData | null>(null);
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState("");

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const d = await fetch("/api/admin/ai-usage").then((r) => r.json());
            if (d.success) { setData(d); setErr(""); }
            else setErr(d.error || "读取失败");
        } catch { setErr("请求失败"); }
        finally { setLoading(false); }
    }, []);
    useEffect(() => { load(); }, [load]);

    const total = data?.total;
    return (
        <section className="rounded-xl bg-bg-card border border-line p-5 transition-colors" style={{ boxShadow: '0 1px 4px var(--color-shadow-card)' }}>
            <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                <div>
                    <h2 className="font-display text-[19px] text-text-1">AI 用量与账单</h2>
                    <p className="text-[11px] text-text-3 mt-0.5">
                        全站合计（所有用户）· 模型 deepseek-chat（现价 V4 Flash）
                        {data?.since && ` · 起始 ${new Date(data.since + "Z").toLocaleDateString("zh-CN")}`}
                    </p>
                </div>
                <button onClick={load} disabled={loading}
                    className="px-3 py-1.5 rounded-full border border-line text-text-3 text-xs font-medium hover:bg-bg-hover hover:text-text-1 transition-all cursor-pointer disabled:opacity-50">
                    {loading ? "刷新中…" : "刷新"}
                </button>
            </div>

            {err ? (
                <div className="text-center py-8 text-[#f44336] text-sm">{err}</div>
            ) : !data ? (
                <div className="text-center py-8 text-text-3 text-sm">加载中…</div>
            ) : (
                <>
                    {/* 合计指标 */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                        <BillTile label="累计花费" value={fmtUsd(total!.costUsd)} sub={`≈ ¥${(total!.costUsd * CNY_PER_USD).toFixed(2)}`} accent />
                        <BillTile label="总 Token" value={fmtTok(total!.totalTokens)} sub={`${fmtInt(total!.totalTokens)}`} />
                        <BillTile label="调用次数" value={fmtInt(total!.calls)} sub="次 API 请求" />
                        <BillTile label="输出 Token" value={fmtTok(total!.outputTokens)} sub="最贵的一档" />
                    </div>

                    {/* 分组件表 */}
                    <div className="overflow-x-auto custom-scrollbar rounded-lg border border-line">
                        <table className="w-full text-sm border-collapse min-w-[560px]">
                            <thead>
                                <tr className="bg-bg-input text-text-3 text-[11px] uppercase tracking-wider">
                                    <th className="text-left font-medium px-3 py-2.5">组件</th>
                                    <th className="text-right font-medium px-3 py-2.5">调用</th>
                                    <th className="text-right font-medium px-3 py-2.5">输入</th>
                                    <th className="text-right font-medium px-3 py-2.5">缓存命中</th>
                                    <th className="text-right font-medium px-3 py-2.5">输出</th>
                                    <th className="text-right font-medium px-3 py-2.5">花费</th>
                                </tr>
                            </thead>
                            <tbody>
                                {data.components.map((c) => (
                                    <tr key={c.component} className="border-t border-line/60 hover:bg-bg-hover transition-colors">
                                        <td className="px-3 py-2.5 text-text-1">{c.label}</td>
                                        <td className="px-3 py-2.5 text-right tabular-nums text-text-2">{fmtInt(c.calls)}</td>
                                        <td className="px-3 py-2.5 text-right tabular-nums text-text-2" title={fmtInt(c.inputTokens)}>{fmtTok(c.inputTokens)}</td>
                                        <td className="px-3 py-2.5 text-right tabular-nums text-text-3" title={fmtInt(c.cacheTokens)}>{fmtTok(c.cacheTokens)}</td>
                                        <td className="px-3 py-2.5 text-right tabular-nums text-text-2" title={fmtInt(c.outputTokens)}>{fmtTok(c.outputTokens)}</td>
                                        <td className="px-3 py-2.5 text-right tabular-nums font-medium text-primary">{fmtUsd(c.costUsd)}</td>
                                    </tr>
                                ))}
                                <tr className="border-t-2 border-line bg-bg-input/50 font-medium">
                                    <td className="px-3 py-2.5 text-text-1">合计</td>
                                    <td className="px-3 py-2.5 text-right tabular-nums text-text-1">{fmtInt(total!.calls)}</td>
                                    <td className="px-3 py-2.5 text-right tabular-nums text-text-1">{fmtTok(total!.inputTokens)}</td>
                                    <td className="px-3 py-2.5 text-right tabular-nums text-text-1">{fmtTok(total!.cacheTokens)}</td>
                                    <td className="px-3 py-2.5 text-right tabular-nums text-text-1">{fmtTok(total!.outputTokens)}</td>
                                    <td className="px-3 py-2.5 text-right tabular-nums text-primary">{fmtUsd(total!.costUsd)}</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>

                    {/* 计费说明 */}
                    <p className="text-[11px] text-text-3 mt-3 leading-relaxed">
                        计费单价（每 1M token）：输入·未命中 ${data.price.inputMiss} ｜ 输入·缓存命中 ${data.price.cacheHit} ｜ 输出 ${data.price.output}。
                        缓存命中的输入便宜约 50 倍——相同前缀（系统提示/上下文）复用越多越省。
                        <span className="text-amber-500"> 注意：deepseek-chat 模型名将于 2026-07-24 弃用，届时需改用 deepseek-v4-flash。</span>
                    </p>
                </>
            )}
        </section>
    );
}

function BillTile({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
    return (
        <div className="rounded-xl bg-bg-input border border-line px-4 py-3">
            <div className="text-[11px] tracking-[0.15em] uppercase text-text-3">{label}</div>
            <div className={`mt-1.5 font-display text-[24px] leading-none tabular-nums ${accent ? "text-primary" : "text-text-1"}`}>{value}</div>
            {sub && <div className="mt-1 text-[11px] text-text-3 tabular-nums">{sub}</div>}
        </div>
    );
}
