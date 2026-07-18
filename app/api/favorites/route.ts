import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { resolveUserKeyOrNull, OWNER } from "@/lib/identity";

const FAVORITES_FILE = path.join(process.cwd(), "list", "favorites.json");

type Fav = { path: string; title: string; addedAt: string };
// v2 格式：按用户分桶。旧格式（顶层数组）读取时自动迁移为站长的收藏。
type FavStore = { version: 2; users: Record<string, Fav[]> };

function readStore(): FavStore {
    try {
        if (fs.existsSync(FAVORITES_FILE)) {
            const raw = JSON.parse(fs.readFileSync(FAVORITES_FILE, "utf-8"));
            if (Array.isArray(raw)) {
                // 旧格式 → 历史收藏归站长
                return { version: 2, users: { [OWNER]: raw } };
            }
            if (raw?.version === 2 && raw.users) return raw as FavStore;
        }
    } catch { /* 落空返回空库 */ }
    return { version: 2, users: {} };
}

function writeStore(store: FavStore) {
    const dir = path.dirname(FAVORITES_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(FAVORITES_FILE, JSON.stringify(store, null, 2), "utf-8");
}

// GET: 当前用户的收藏列表（自动清理已不存在的文件，例如目录改名留下的死路径）
export async function GET(req: NextRequest) {
    const user = await resolveUserKeyOrNull(req);
    if (!user) return NextResponse.json({ success: false, error: "LOGIN_REQUIRED" }, { status: 401 });
    const store = readStore();
    const favs = store.users[user] ?? [];
    const alive = favs.filter(f => {
        try { return fs.existsSync(f.path); } catch { return false; }
    });
    if (alive.length !== favs.length) {
        store.users[user] = alive;
        writeStore(store);
        console.log(`[Favorites] Pruned ${favs.length - alive.length} dead entries (user=${user})`);
    }
    return NextResponse.json({ success: true, data: alive });
}

// POST: 添加或移除当前用户的收藏
export async function POST(req: NextRequest) {
    try {
        const { action, filePath, title } = await req.json();
        const user = await resolveUserKeyOrNull(req);
        if (!user) {
            // 未登录：check 静默返回未收藏（watch 页启动探测用），写操作明确 401
            if (action === "check") return NextResponse.json({ success: true, isFavorite: false });
            return NextResponse.json({ success: false, error: "LOGIN_REQUIRED" }, { status: 401 });
        }
        const store = readStore();
        const favs = store.users[user] ?? [];

        if (action === "add") {
            if (!filePath) return NextResponse.json({ success: false, error: "Missing filePath" }, { status: 400 });
            if (!favs.some(f => f.path === filePath)) {
                favs.push({
                    path: filePath,
                    title: title || path.basename(filePath),
                    addedAt: new Date().toISOString(),
                });
                store.users[user] = favs;
                writeStore(store);
            }
            return NextResponse.json({ success: true, isFavorite: true, data: favs });
        }

        if (action === "remove") {
            if (!filePath) return NextResponse.json({ success: false, error: "Missing filePath" }, { status: 400 });
            store.users[user] = favs.filter(f => f.path !== filePath);
            writeStore(store);
            return NextResponse.json({ success: true, isFavorite: false, data: store.users[user] });
        }

        if (action === "check") {
            return NextResponse.json({ success: true, isFavorite: favs.some(f => f.path === filePath) });
        }

        return NextResponse.json({ success: false, error: "Invalid action" }, { status: 400 });
    } catch (error) {
        return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
    }
}
