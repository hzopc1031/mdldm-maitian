import { parseArgs } from 'node:util';
import fs from 'node:fs';import path from 'node:path';
import { readConfig,home } from '../src/l1-config.mjs';
import { inspectPlatform, publishedTarget, writePublishedLink,preparationTarget,writePreparationLink } from '../src/l1-inspect.mjs';
import { redactL1 } from '../src/l1-web.mjs';
import {xAccountConfig} from '../src/x-accounts.mjs';
try {
  const { values: a } = parseArgs({ options: { 'account-id':{type:'string'}, platform: { type: 'string' }, episode: { type: 'string' },preparation:{type:'string'},date:{type:'string'} } });
  if(a.episode && a.preparation || a.date && !a.preparation)throw new Error('取链接参数冲突');
  if(a['account-id']&&a.platform!=='x')throw Error('账户ID仅支持X');
  const config = xAccountConfig(readConfig(),a['account-id']);
  if (config.l1?.[a.platform]?.browserExecution === false) throw new Error('此平台只读浏览器通道已在本地配置停用');
  let target, db;
  if(a.preparation) {
    if(!/^[a-f0-9-]{36}$/.test(a.preparation)||!a.date)throw new Error('准备记录需要合法ID和明确发表日期');
    const store=await import('../src/db.mjs');db=store.db;
    const row=db.prepare('SELECT record FROM publish_preparations WHERE id=?').get(a.preparation);
    if(!row)throw new Error('准备记录不存在');
    const record=JSON.parse(row.record);
    if(a.platform==='x'&&(record.accountId||'default')!==(a['account-id']||'default'))throw Error('准备记录与所选X账户不符');
    if(record.platform!==a.platform)throw new Error('准备记录平台不符');
    const job=JSON.parse(fs.readFileSync(path.join(home,'data/publish-prep',a.preparation,'job.json'),'utf8'));
    target=preparationTarget(record,job,a.date);
  }
  if (a.episode) {
    const store = await import('../src/db.mjs'); db = store.db;
    const ep = store.getEpisode(a.episode), snap = store.getSnapshot(a.episode);
    if (!ep || !store.getTasks(ep.id).some(t => t.platform === a.platform)) throw new Error('作品 / 平台任务不存在');
    target = publishedTarget(a.platform, ep, JSON.parse(snap?.project || '{}'));
  }
  const result = await inspectPlatform(config, a.platform, target);
  if (target) {
    if(a.preparation)writePreparationLink(db,a.preparation,result);
    else writePublishedLink(db, a.episode, a.platform, result);
  }
  if (db) db.close();
  console.log(JSON.stringify(result));
} catch (error) { console.error(`L1 体检 / 取链接失败：${redactL1(error.message)}；无成功回执，不使用旧 hub。`); process.exitCode = 1; }
