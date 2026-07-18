import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { execFile } from "child_process";
import { promisify } from "util";
import { isPathUnder } from "@/lib/path-guard";

// /api/books/cover?path=<绝对路径>
// 提取书籍封面：
//   - .epub：unzip 读 container.xml → OPF → cover-image item → 抽出图片
//   - .pdf ：pdftoppm 渲染第一页为 JPEG（480px 宽，10s 超时）
// 结果缓存 data/book-covers/<sha1(path)>.jpg，命中直接回源；
// 响应带 immutable 强缓存（项目铁律：网格一律缩略图 + 强缓存）。
// 提取失败一律 404，前端落生成式封面。
export const dynamic = "force-dynamic";

const ALLOWED_ROOTS = ["/home/steven/mydrive/book", "/home/steven/mydrive/PAPERS"];
const CACHE_DIR = "/home/steven/mydrive/nas-app/data/book-covers";

const UNZIP = "/usr/bin/unzip";
const PDFTOPPM = "/usr/bin/pdftoppm";

const execFileAsync = promisify(execFile);

// ── 图片魔数嗅探（epub 里的封面可能是 png/gif/webp，缓存文件统一 .jpg 后缀但按真实类型回 MIME）──
function sniffImageMime(buf: Buffer): string | null {
    if (buf.length < 12) return null;
    if (buf[0] === 0xff && buf[1] === 0xd8) return "image/jpeg";
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
    if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return "image/gif";
    if (buf.slice(0, 4).toString("ascii") === "RIFF" && buf.slice(8, 12).toString("ascii") === "WEBP") return "image/webp";
    return null;
}

// unzip -p 抽取 zip 内单个文件（binary Buffer）。条目不存在时 unzip 退出码非 0 → 抛错。
async function unzipEntry(zipPath: string, entry: string): Promise<Buffer> {
    const { stdout } = await execFileAsync(UNZIP, ["-p", zipPath, entry], {
        encoding: "buffer",
        maxBuffer: 50 * 1024 * 1024,
        timeout: 10_000,
    });
    return stdout as unknown as Buffer;
}

// XML 属性提取小工具（封面定位只需属性值，不值得引入完整 XML 解析器）
function attr(tag: string, name: string): string | null {
    const m = tag.match(new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, "i"));
    return m ? m[1] : null;
}

// ── EPUB 封面提取 ──
// container.xml → OPF 路径 → 找 properties="cover-image" 的 item，
// 退而求其次 <meta name="cover" content="id"> 指向的 item，再兜底 id/href 含 "cover" 的图片 item。
// OPF 内 href 是相对 OPF 所在目录的路径，且可能 URL 编码。
async function extractEpubCover(epubPath: string): Promise<Buffer | null> {
    const containerXml = (await unzipEntry(epubPath, "META-INF/container.xml")).toString("utf-8");
    const rootfileTag = containerXml.match(/<rootfile\b[^>]*>/i)?.[0];
    const opfPath = rootfileTag ? attr(rootfileTag, "full-path") : null;
    if (!opfPath) return null;

    const opfXml = (await unzipEntry(epubPath, opfPath)).toString("utf-8");
    const opfDir = path.posix.dirname(opfPath);
    const items = opfXml.match(/<item\b[^>]*>/gi) || [];

    let coverHref: string | null = null;

    // 1) EPUB3 规范：properties 含 cover-image
    for (const tag of items) {
        const props = attr(tag, "properties") || "";
        if (/\bcover-image\b/i.test(props)) {
            coverHref = attr(tag, "href");
            break;
        }
    }
    // 2) EPUB2 惯例：<meta name="cover" content="item-id">
    if (!coverHref) {
        const metaTag = (opfXml.match(/<meta\b[^>]*>/gi) || []).find(
            (t) => (attr(t, "name") || "").toLowerCase() === "cover"
        );
        const coverId = metaTag ? attr(metaTag, "content") : null;
        if (coverId) {
            const item = items.find((t) => attr(t, "id") === coverId);
            if (item) coverHref = attr(item, "href");
        }
    }
    // 3) 兜底：id 或 href 带 "cover" 的图片 item
    if (!coverHref) {
        const item = items.find((t) => {
            const mediaType = attr(t, "media-type") || "";
            if (!mediaType.startsWith("image/")) return false;
            return /cover/i.test(attr(t, "id") || "") || /cover/i.test(attr(t, "href") || "");
        });
        if (item) coverHref = attr(item, "href");
    }
    if (!coverHref) return null;

    // href 相对 OPF 目录解析 + URL 解码（zip 内部路径永远 posix 分隔）
    let entry = path.posix.normalize(
        path.posix.join(opfDir === "." ? "" : opfDir, decodeURIComponent(coverHref))
    );
    if (entry.startsWith("/")) entry = entry.slice(1);

    const img = await unzipEntry(epubPath, entry);
    return sniffImageMime(img) ? img : null;
}

// ── PDF 首页渲染 ──
async function extractPdfCover(pdfPath: string, cachePath: string): Promise<Buffer | null> {
    // pdftoppm 输出到 <prefix>.jpg，直接以缓存路径（去 .jpg）为前缀，成功即已落缓存
    const prefix = cachePath.replace(/\.jpg$/, "");
    await execFileAsync(
        PDFTOPPM,
        ["-jpeg", "-f", "1", "-singlefile", "-scale-to", "480", pdfPath, prefix],
        { timeout: 10_000 }
    );
    try {
        return fs.readFileSync(cachePath);
    } catch {
        return null;
    }
}

function imageResponse(buf: Buffer): NextResponse {
    return new NextResponse(new Uint8Array(buf), {
        headers: {
            "Content-Type": sniffImageMime(buf) || "image/jpeg",
            "Content-Length": String(buf.length),
            "Cache-Control": "public, max-age=31536000, immutable",
        },
    });
}

export async function GET(request: NextRequest) {
    // 内容范围守卫：book 栏目需 boss 授权（admin/boss 全开）
    {
        const { getAccess, allows } = await import("@/lib/roles");
        if (!allows(await getAccess(request), "book")) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }
    }
    const raw = request.nextUrl.searchParams.get("path");
    if (!raw) {
        return NextResponse.json({ error: "缺少 path 参数" }, { status: 400 });
    }

    // resolve 后再做白名单判定，"../" 之类的穿越在这里被拍平并拒绝
    const resolved = path.resolve(raw);
    if (!ALLOWED_ROOTS.some((root) => isPathUnder(resolved, root))) {
        return NextResponse.json({ error: "无权访问此路径" }, { status: 403 });
    }
    if (path.basename(resolved).startsWith(".")) {
        return NextResponse.json({ error: "不支持的文件类型" }, { status: 400 });
    }

    const ext = path.extname(resolved).toLowerCase();
    if (ext !== ".epub" && ext !== ".pdf") {
        return NextResponse.json({ error: "该格式无内嵌封面" }, { status: 404 });
    }

    let stat: fs.Stats;
    try {
        stat = fs.statSync(resolved);
    } catch {
        return NextResponse.json({ error: "文件不存在" }, { status: 404 });
    }
    if (!stat.isFile()) {
        return NextResponse.json({ error: "不是文件" }, { status: 400 });
    }

    // ── 缓存命中 ──
    const cachePath = path.join(CACHE_DIR, crypto.createHash("sha1").update(resolved).digest("hex") + ".jpg");
    try {
        const cached = fs.readFileSync(cachePath);
        if (cached.length > 0) return imageResponse(cached);
    } catch {
        // 未命中，往下走提取
    }

    try {
        fs.mkdirSync(CACHE_DIR, { recursive: true });
        let img: Buffer | null = null;
        if (ext === ".epub") {
            img = await extractEpubCover(resolved);
            if (img) fs.writeFileSync(cachePath, img);
        } else {
            img = await extractPdfCover(resolved, cachePath); // pdftoppm 直接写缓存路径
        }
        if (!img) {
            return NextResponse.json({ error: "封面提取失败" }, { status: 404 });
        }
        return imageResponse(img);
    } catch (error) {
        console.error("封面提取失败:", resolved, error);
        return NextResponse.json({ error: "封面提取失败" }, { status: 404 });
    }
}
