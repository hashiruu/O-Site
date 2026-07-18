const db = require('better-sqlite3')('./data/nas-media.db');
const m = db.prepare("SELECT id FROM media WHERE path LIKE '%怪奇物语%'").get();
const eps = db.prepare('SELECT season, episode FROM episodes WHERE media_id = ? ORDER BY season, episode').all(m.id);
// Output just season:episode pairs in compact form
console.log(eps.map(e => `S${e.season}E${e.episode}`).join(' '));
