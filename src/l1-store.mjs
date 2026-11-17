// 仅依赖现有 SQLite schema；按观测时间写入，不调用 live/backfill 存储。
import { db } from './db.mjs';
import { beijingDay } from './l1-config.mjs';
db.exec(`CREATE TABLE IF NOT EXISTS followers (day TEXT, platform TEXT, total INTEGER, gain INTEGER, loss INTEGER, source TEXT, collected_at TEXT, PRIMARY KEY (day, platform));`);
export { db };
export function transaction(fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const result = fn(); db.exec('COMMIT'); return result; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}
export function saveObservation({ platform, account, captured_at, source, posts, followers, example = false }) {
  const day = beijingDay(captured_at), imported = new Date().toISOString();
  let saved = 0, skipped = 0;
  for (const post of posts) {
    const eid = `external:${platform}:${post.id}`;
    const oldSnapshot = db.prepare('SELECT * FROM snapshots WHERE episode_id=?').get(eid);
    const updateSnapshot = !oldSnapshot || Date.parse(oldSnapshot.taken_at) <= Date.parse(captured_at);
    if (updateSnapshot) {
      db.prepare(`INSERT INTO episodes (id,name,dir,created_at) VALUES (?,?,'',?) ON CONFLICT(id) DO UPDATE SET name=excluded.name`).run(eid, post.text.slice(0, 100) || post.id, imported);
      db.prepare(`INSERT INTO tasks (episode_id,platform,state,detail,url,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(episode_id,platform) DO UPDATE SET state=excluded.state, detail=excluded.detail, url=COALESCE(excluded.url,tasks.url), updated_at=excluded.updated_at`)
        .run(eid, platform, post.state || 'published', 'L1 只读观测', post.url || null, captured_at);
      const previous = oldSnapshot ? JSON.parse(oldSnapshot.project) : {};
      const created_at = post.created_at || previous.created_at || null;
      const snapshot = { ...previous, account, postId: post.id, noteId: platform === 'xhs' ? post.id : undefined, created_at, source, text: post.text, date_status: created_at ? 'known' : 'unknown', status: post.state || 'published', example,
        platforms: { ...previous.platforms, [platform]: { ...previous.platforms?.[platform], id: post.id, title: post.text.slice(0, 100) || post.id, text: post.text, url: post.url || previous.platforms?.[platform]?.url || '', created_at } } };
      db.prepare('INSERT OR REPLACE INTO snapshots (episode_id,taken_at,project) VALUES (?,?,?)').run(eid, captured_at, JSON.stringify(snapshot));
    }
    const old = db.prepare('SELECT * FROM metrics WHERE day=? AND episode_id=? AND platform=?').get(day, eid, platform);
    if (old && Date.parse(old.collected_at) > Date.parse(captured_at)) { skipped++; continue; }
    const oldExtra = old ? JSON.parse(old.extra || '{}') : {};
    const extra = { ...oldExtra, source, account, captured_at, precision: post.precision || 'public-reported; exactness unverified', example, field_observed_at: { ...oldExtra.field_observed_at } };
    const keys = ['views', 'likes', 'comments', 'favorites', 'shares'];
    const values = keys.map(key => {
      if (post[key] != null) extra.field_observed_at[key] = captured_at;
      return post[key] ?? old?.[key] ?? null;
    });
    extra.quotes = post.quotes ?? oldExtra.quotes ?? null;
    if (post.quotes != null) extra.field_observed_at.quotes = captured_at;
    db.prepare(`INSERT OR REPLACE INTO metrics (day,episode_id,platform,views,likes,comments,favorites,shares,extra,collected_at) VALUES (?,?,?,?,?,?,?,?,?,?)`).run(day, eid, platform, ...values, JSON.stringify(extra), captured_at);
    // samples 没有逐条观测时间列；同分钟仅保存最晚观测，null 保留已有值。
    const minute = new Date(captured_at).toISOString().slice(0, 16);
    const sampleKey = `l1:sample:${platform}:${post.id}:${minute}`;
    const sampleTime = db.prepare('SELECT value FROM meta WHERE key=?').get(sampleKey)?.value;
    if (!sampleTime || Date.parse(sampleTime) <= Date.parse(captured_at)) {
      db.prepare(`INSERT INTO samples (ts,episode_id,platform,views,likes,comments,favorites,shares) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(ts,episode_id,platform) DO UPDATE SET views=COALESCE(excluded.views,samples.views),likes=COALESCE(excluded.likes,samples.likes),comments=COALESCE(excluded.comments,samples.comments),favorites=COALESCE(excluded.favorites,samples.favorites),shares=COALESCE(excluded.shares,samples.shares)`).run(minute, eid, platform, ...keys.map(key => post[key] ?? null));
      db.prepare('INSERT OR REPLACE INTO meta (key,value) VALUES (?,?)').run(sampleKey, captured_at);
    }
    saved++;
  }
  if (followers != null) {
    db.prepare(`INSERT INTO followers (day,platform,total,gain,loss,source,collected_at) VALUES (?,?,?,NULL,NULL,?,?) ON CONFLICT(day,platform) DO UPDATE SET total=excluded.total,gain=NULL,loss=NULL,source=excluded.source,collected_at=excluded.collected_at WHERE julianday(excluded.collected_at)>=julianday(followers.collected_at)`)
      .run(day, platform, followers, source, captured_at);
    db.prepare('INSERT OR REPLACE INTO meta (key,value) VALUES (?,?)').run(`l1:followers:${platform}:${captured_at}`, JSON.stringify({ account, total: followers, captured_at, source, example }));
  }
  return { imported: saved, skipped, validationErrors: 0, followers: followers != null };
}
