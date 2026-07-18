import path from "path";

/**
 * 判断 target 是否严格位于 dir 之内（或等于 dir）。
 *
 * 用 path.relative 而非字符串 startsWith，避免兄弟目录前缀绕过：
 *   对 dir="/data/media"，startsWith 会误放行 "/data/media-private/x"
 *   ——二者共享字符串前缀，但属于不同目录。
 *
 * relative 返回 "" 表示同一路径；返回值不以 ".." 开头且非绝对路径，才算落在 dir 内。
 */
export function isPathUnder(target: string, dir: string): boolean {
    const root = path.resolve(dir);
    const rel = path.relative(root, path.resolve(target));
    if (rel === "") return true; // target === dir
    return rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}
