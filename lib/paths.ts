// 服务器路径集中配置：全部相对 HOME 推导，可用环境变量覆盖。
// 铁律：任何源文件不得再硬编码绝对家目录路径（公开仓库不泄露部署环境）。
import os from "os";
import path from "path";

const HOME = process.env.HOME || os.homedir();
const DRIVE = process.env.OSITE_DRIVE || path.join(HOME, "mydrive");

export const BOOK_DIR = process.env.OSITE_BOOK_DIR || path.join(DRIVE, "book");
export const PAPERS_DIR = process.env.OSITE_PAPERS_DIR || path.join(DRIVE, "PAPERS");
export const BOOK_ALLOWED_ROOTS = [BOOK_DIR, PAPERS_DIR];
export const BOOK_COVER_CACHE_DIR = path.join(process.cwd(), "data", "book-covers");
export const SOURCE_ROOT = DRIVE;
export const TRAVEL_ROOT = process.env.OSITE_TRAVEL_DIR || path.join(DRIVE, "重要资料！", "旅行相册");
export const MUSIC_DIR = process.env.OSITE_MUSIC_DIR || path.join(HOME, "Music");
export const EDGE_TTS_BIN = process.env.OSITE_EDGE_TTS || path.join(HOME, ".local", "bin", "edge-tts");
export { HOME };
