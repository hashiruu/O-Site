const db = require('better-sqlite3')('./data/nas-media.db');

// 查找怪奇物语的 media 记录
const media = db.prepare("SELECT id, title, path FROM media WHERE path LIKE '%怪奇物语%'").all();
console.log('找到的媒体记录:', JSON.stringify(media, null, 2));

for (const m of media) {
    // 清除旧的 episodes
    const result = db.prepare('DELETE FROM episodes WHERE media_id = ?').run(m.id);
    console.log(`已删除 ${m.title} 的 ${result.changes} 条旧 episodes`);
}

console.log('清理完成，请触发重新扫描');
