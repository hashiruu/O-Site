import { getDb } from '../lib/db';

const db = getDb();
const filePath = '/home/steven/mydrive/tvshow/House M.D./第一季/003_[电视剧] 美剧《豪斯医生》（House M.D. Season）【字幕修正版】第1-8季 p03 第1季「第03集」奥卡姆剃刀.mp4';
console.log('Testing exactly:', filePath);

const ep = db.prepare('SELECT media_id FROM episodes WHERE path = ?').get(filePath) as any;
console.log('episodes result:', ep);

if (ep) {
    const media = db.prepare('SELECT title FROM media WHERE id = ?').get(ep.media_id) as any;
    console.log('media result:', media);
} else {
    console.log('Episode not found. Looking at all paths:');
    const allEps = db.prepare('SELECT path FROM episodes LIMIT 10').all() as any[];
    allEps.forEach(e => console.log('DB path:', e.path));

    // Try pattern matching
    const likeEp = db.prepare('SELECT path, media_id FROM episodes WHERE path LIKE ?').get('%003_%') as any;
    console.log('Like result:', likeEp);
}
