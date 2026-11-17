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
    if (platform === 'wechat' && (!/^[\w-]+$/.test(post.id) || (post.url != null && !/^https:\/\/mp\.weixin\.qq\.com\/s\/[\w-]+$/.test(post.url)))) throw new Error('公众号文章 ID/公开 URL 不安全；回滚本次观测');
    // 同一 statusId 兼容原有登记 id；不要求所有历史 episode 都采用 external 前缀。
    const registered = platform === 'x' ? db.prepare("SELECT episode_id,url FROM tasks WHERE platform='x'").all().find(row => {
      const match=row.url?.match(/^https:\/\/(?:x|twitter)\.com\/([A-Za-z0-9_]+)\/status\/(\d+)\/?$/i);
      return match?.[1].toLowerCase()===account.toLowerCase() && match?.[2]===post.id;
    }) : null;
    const eid = registered?.episode_id || `external:${platform}:${post.id}`;
    const oldSnapshot = db.prepare('SELECT * FROM snapshots WHERE episode_id=?').get(eid);
    if (platform === 'wechat' && oldSnapshot && JSON.parse(oldSnapshot.project).account !== account) throw new Error('公众号文章 ID 已属于其他账号；回滚本次观测');
    const updateSnapshot = !oldSnapshot || Date.parse(oldSnapshot.taken_at) <= Date.parse(captured_at);
    if (updateSnapshot) {
      db.prepare(`INSERT INTO episodes (id,name,dir,created_at) VALUES (?,?,'',?) ON CONFLICT(id) ${platform === 'x' ? 'DO NOTHING' : 'DO UPDATE SET name=excluded.name'}`).run(eid, post.text.slice(0, 100) || post.id, imported);
      db.prepare(`INSERT INTO tasks (episode_id,platform,state,detail,url,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(episode_id,platform) ${platform === 'x' ? 'DO NOTHING' : 'DO UPDATE SET state=excluded.state, detail=excluded.detail, url=COALESCE(excluded.url,tasks.url), updated_at=excluded.updated_at'}`)
        .run(eid, platform, post.state || 'published', 'L1 只读观测', post.url || null, captured_at);
      const previous = oldSnapshot ? JSON.parse(oldSnapshot.project) : {};
      const created_at = post.created_at || previous.created_at || null;
      const sources = [...new Set([...(previous.sources || []), previous.source, source].filter(Boolean))];
      const snapshot = { ...previous, account, postId: post.id, noteId: platform === 'xhs' ? post.id : undefined, appmsgId: platform === 'wechat' ? post.id : undefined, created_at, source, sources, text: post.text || previous.text || '', date_status: created_at ? 'known' : 'unknown', status: post.state || 'published', example,
        platforms: { ...previous.platforms, [platform]: { ...previous.platforms?.[platform], id: post.id, title: (post.text || previous.text || '').slice(0, 100) || post.id, text: post.text || previous.text || '', url: post.url || previous.platforms?.[platform]?.url || (platform === 'wechat' ? null : ''), created_at } } };
      db.prepare('INSERT OR REPLACE INTO snapshots (episode_id,taken_at,project) VALUES (?,?,?)').run(eid, captured_at, JSON.stringify(snapshot));
    }
    const old = db.prepare('SELECT * FROM metrics WHERE day=? AND episode_id=? AND platform=?').get(day, eid, platform);
    if (old && Date.parse(old.collected_at) > Date.parse(captured_at)) { skipped++; continue; }
    const baseline = old || db.prepare('SELECT * FROM metrics WHERE episode_id=? AND platform=? AND julianday(collected_at)<=julianday(?) ORDER BY julianday(collected_at) DESC LIMIT 1').get(eid, platform, captured_at);
    const oldExtra = baseline ? JSON.parse(baseline.extra || '{}') : {};
    const extra = { ...oldExtra, source, sources: [...new Set([...(oldExtra.sources || []), oldExtra.source, source].filter(Boolean))], account, captured_at, precision: post.precision || 'public-reported; exactness unverified', example, field_observed_at: { ...oldExtra.field_observed_at } };
    const keys = ['views', 'likes', 'comments', 'favorites', 'shares'];
    const values = keys.map(key => {
      if (post[key] != null) extra.field_observed_at[key] = captured_at;
      return post[key] ?? baseline?.[key] ?? null;
    });
    extra.quotes = post.quotes ?? oldExtra.quotes ?? null;
    if (post.quotes != null) extra.field_observed_at.quotes = captured_at;
    if (platform === 'wechat') {
      extra.watching = post.watching ?? oldExtra.watching ?? null;
      if (post.watching != null) extra.field_observed_at.watching = captured_at;
    }
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
