import { parseArgs } from 'node:util';
import { readConfig } from '../src/l1-config.mjs';
import { inspectPlatform } from '../src/l1-inspect.mjs';
import { redactL1 } from '../src/l1-web.mjs';
try {
  const { values: a } = parseArgs({ options: { platform: { type: 'string' }, episode: { type: 'string' } } });
  const config = readConfig();
  if (config.publishPrep?.browserExecution !== true) throw new Error('浏览器执行未启用；保留 blocked by policy 阻塞，不尝试启动');
  let target, db;
  if (a.episode) {
    const store = await import('../src/db.mjs'); db = store.db;
    const ep = store.getEpisode(a.episode), snap = store.getSnapshot(a.episode);
    if (!ep || !store.getTasks(ep.id).some(t => t.platform === a.platform)) throw new Error('作品 / 平台任务不存在');
    const pj = JSON.parse(snap?.project || '{}'), p = pj.platforms?.[a.platform] || {};
    // 首版只支持已登记稳定 ID；无 ID 的新准备稿不按相似标题猜链接。
    const postId = p.id || pj.postId || pj.noteId || pj.appmsgId;
    if (!postId || !/^[\w-]+$/.test(String(postId))) throw new Error('此作品没有稳定平台 ID；自动取链接未适配，请人工从可见已发布页复制公开链接');
    target = { postId: String(postId) };
  }
  const result = await inspectPlatform(config, a.platform, target);
  if (target) {
    db.prepare('UPDATE tasks SET url=?,state=?,detail=?,updated_at=? WHERE episode_id=? AND platform=?').run(result.url, 'published', 'L1 可见已发布列表按稳定 ID 核对', result.checkedAt, a.episode, a.platform);
    db.prepare('INSERT INTO logs (ts,episode_id,platform,action,result) VALUES (?,?,?,?,?)').run(result.checkedAt, a.episode, a.platform, 'links', '可见公开链接已核对回写');
  }
  if (db) db.close();
  console.log(JSON.stringify(result));
} catch (error) { console.error(`L1 体检 / 取链接失败：${redactL1(error.message)}；无成功回执，不使用旧 hub。`); process.exitCode = 1; }
