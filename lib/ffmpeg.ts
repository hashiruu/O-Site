import fs from "fs";
import path from "path";

// 统一解析 ffmpeg/ffprobe 路径：环境变量 > 常见安装位置 > PATH
function resolveBinary(envVar: string, name: string): string {
    const fromEnv = process.env[envVar];
    if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;

    const candidates = [
        path.join(process.env.HOME || require("os").homedir(), ".local/bin", name),
        `/usr/local/bin/${name}`,
        `/usr/bin/${name}`,
    ];
    for (const c of candidates) {
        if (fs.existsSync(c)) return c;
    }
    // 最后兜底交给 PATH 查找
    return name;
}

export const FFMPEG_PATH = resolveBinary("FFMPEG_PATH", "ffmpeg");
export const FFPROBE_PATH = resolveBinary("FFPROBE_PATH", "ffprobe");
