// 只读体检 / 按期取链接；可见 DOM，无旧 hub，无平台内部 API。
import { beijingDay, validDay } from './l1-config.mjs';
import { l1Account } from './l1-account.mjs';
export function publishedTarget(platform, episode, project) {
  const p=project.platforms?.[platform] || {};
  const id=p.id || (platform==='x'?project.postId:platform==='xhs'?project.noteId:project.appmsgId) || (!project.platforms ? project.postId : null);
  if(id && /^[\w-]+$/.test(String(id)))return {postId:String(id)};
  const text=platform==='x' ? p.text || project.text : p.title;
  const dateValue=p.created_at || project.created_at || project.publishDate || episode.schedule;
  if(typeof text!=='string' || !text.trim() || !dateValue)throw new Error('缺少稳定平台ID或完整匹配文字与发表日期；不按相似标题取链接');
  const date=/^\d{4}-\d{2}-\d{2}$/.test(dateValue)?validDay(dateValue):beijingDay(dateValue);
  return {text:text.trim(),date};
}
export function preparationTarget(record,job,date) {
  if(!record || !['x','xhs','wechat'].includes(record.platform)||record.state==='running'||job.submit!==false)throw new Error('准备记录不适合只读取链接');
  const text=record.platform==='x'?job.content:record.evidence?.titleFinal||job.title;
  if(typeof text!=='string'||!text.trim())throw new Error('缺少完整匹配文字');
  return {text:text.trim(),date:validDay(date)};
}
function validateProof(platform,result) {
  if(!result?.ok || result.platform!==platform || !result.account || !result.checkedAt)throw new Error('缺少本次可见身份/链接核验回执');
  selectPublishedLink(platform,[{id:result.url?.split('/').at(-1),url:result.url,state:'published',kind:'original',author:result.account,permalinkAuthor:result.account}],{postId:result.url?.split('/').at(-1),account:result.account});
}
function writeTask(db,episodeId,platform,result) {
  const changed=db.prepare('UPDATE tasks SET url=?,state=?,detail=?,updated_at=? WHERE episode_id=? AND platform=?').run(result.url,'published','L1 可见已发布列表唯一匹配公开链接',result.checkedAt,episodeId,platform);
  if(changed.changes!==1)throw new Error('作品平台任务不存在或不唯一；不回写');
}
export function writePublishedLink(db, episodeId, platform, result) {
  validateProof(platform,result);
  // 回写前再验证公开链接形状；与日志在同一事务内，任一步失败全部回滚。
  db.exec('BEGIN IMMEDIATE');
  try {
    writeTask(db,episodeId,platform,result);
    db.prepare('INSERT INTO logs (ts,episode_id,platform,action,result) VALUES (?,?,?,?,?)').run(result.checkedAt,episodeId,platform,'links','可见公开链接已核对回写');
    db.exec('COMMIT');
  } catch(e){db.exec('ROLLBACK');throw e;}
}
export function writePreparationLink(db,id,result) {
  validateProof(result?.platform,result);db.exec('BEGIN IMMEDIATE');
  try {
    const row=db.prepare('SELECT record FROM publish_preparations WHERE id=?').get(id);
    if(!row)throw new Error('准备记录不存在');
    const record=JSON.parse(row.record);
    if(record.platform!==result.platform||record.state==='running')throw new Error('准备记录平台或运行状态已变化');
    if(record.episodeId)writeTask(db,record.episodeId,result.platform,result);
    Object.assign(record,{url:result.url,state:'published',linkCheckedAt:result.checkedAt,note:'本人发布后，从可见已发布列表核对了公开链接；本系统未执行发布'});
    db.prepare('UPDATE publish_preparations SET record=? WHERE id=?').run(JSON.stringify(record),id);
    db.prepare('INSERT INTO logs (ts,episode_id,platform,action,result) VALUES (?,?,?,?,?)').run(result.checkedAt,record.episodeId||null,result.platform,'links','准备稿的可见公开链接已核对回写');
    db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e;}
}
export function selectPublishedLink(platform, cards, target) {
  const eligible = cards.filter(c => {
    if (platform !== 'x' && c.state !== 'published') return false;
    if (platform === 'x' && (!target.account || !['original', 'quote'].includes(c.kind) || c.author?.toLowerCase() !== target.account.toLowerCase() || c.permalinkAuthor?.toLowerCase() !== target.account.toLowerCase())) return false;
    if (target.postId) return c.id === target.postId;
    let date = c.date;
    try { date ||= c.created_at && beijingDay(c.created_at); } catch { return false; }
    return !!target.date && date === target.date && c.text?.trim() === target.text?.trim();
  });
  if (eligible.length !== 1) throw new Error(`已发布作品未唯一匹配（${eligible.length} 条）；未回写，不按标题片段猜测`);
  const value = eligible[0].url;
  const patterns = { x: /^https:\/\/x\.com\/[A-Za-z0-9_]+\/status\/\d+$/i,
    xhs: /^https:\/\/(?:www\.)?xiaohongshu\.com\/explore\/[\w-]+$/,
    wechat: /^https:\/\/mp\.weixin\.qq\.com\/s\/[\w-]+$/ };
  if (!patterns[platform]?.test(value || '')) throw new Error('未读到无查询参数的公开永久链接；未回写，不根据 ID 拼造链接');
  if (platform !== 'wechat' && new URL(value).pathname.split('/').at(-1) !== String(eligible[0].id)) throw new Error('可见链接 ID 与作品 ID 不符');
  if (platform === 'x' && (!target.account || new URL(value).pathname.split('/')[1].toLowerCase() !== target.account.toLowerCase())) throw new Error('公开链接作者与已校验账号不符');
  return value;
}

export async function inspectPlatform(config, platform, target, { withBrowser, wait } = {}) {
  if (!['x', 'xhs', 'wechat'].includes(platform)) throw new Error('平台未适配');
  const expected = l1Account(config,platform);
  if (typeof expected !== 'string' || !expected.trim()) throw new Error(`请配置 l1.${platform}.account 为预期可见账号；不使用隐含账号`);
  if (platform === 'x' && !/^[A-Za-z0-9_]{1,15}$/.test(expected)) throw new Error('X 预期账号格式不对');
  const browser = await import('./l1-browser.mjs');
  withBrowser ||= browser.withL1Browser; wait ||= browser.pause;
  const x = await import('./l1-x-dom.mjs'), h = await import('./l1-xhs-dom.mjs'), w = await import('./l1-wechat-dom.mjs');
  const identityFn = { x: x.visibleXIdentity, xhs: h.visibleIdentity, wechat: w.visibleWechatIdentity }[platform];
  return withBrowser(config, async page => {
    await page.goto({ x: `https://x.com/${expected}`, xhs: 'https://creator.xiaohongshu.com/new/home', wechat: 'https://mp.weixin.qq.com/' }[platform]);
    async function identity() {
      const i = await page.evaluate(identityFn);
      const account = platform === 'x' ? i.handle?.replace(/^@/, '') : platform === 'xhs' ? i.nickname : i.names?.length === 1 ? i.names[0] : null;
      if (i.login) throw Object.assign(new Error('当前专用窗口可见登录界面；需要本人登录后再校验'),{code:'LOGIN_REQUIRED'});
      if (!account || (platform === 'wechat' && !i.trustedOrigin)) throw Object.assign(new Error('未读到唯一可见账号，页面状态未确认；不能据此判为未登录'),{code:'PAGE_CHANGED'});
      if (platform==='x' ? account.toLowerCase() !== expected.toLowerCase() : account !== expected) throw Object.assign(new Error('可见账号与预期账号不符；没有继续采集或回写'),{code:'ACCOUNT_MISMATCH'});
      return account;
    }
    let account;
    try {account=await identity();}catch(e){
      if(platform!=='x'||e.code!=='PAGE_CHANGED')throw e;
      // 公开主页可在未登录时展示；只读打开正式登录页确认，不自动填写身份。
      await page.goto('https://x.com/i/flow/login');
      await wait();account=await identity();
    }
    if (!target) return { ok: true, platform, account, checkedAt: new Date().toISOString(), scope: '仅可见账号身份；不检查上传表单、不上传、不读粉丝' };
    if (platform === 'xhs') await page.goto('https://creator.xiaohongshu.com/new/note-manager');
    if (platform === 'wechat' && !(await page.evaluate(w.clickWechatSection, 'posts'))) throw new Error('找不到唯一可见发表记录入口');
    const cards = new Map();
    for (let round = 0; round < 8; round++) {
      await wait();
      if (platform !== 'xhs') await identity();
      const rows = await page.evaluate({ x: x.visibleXPosts, xhs: h.visibleNoteCards, wechat: w.visibleWechatArticles }[platform]);
      for (const row of rows) if (row.id) cards.set(row.id, row);
      // 有已知 ID 时唯一匹配可停止；标题+日期须完成有限搜索后检查歧义。
      if (target.postId && rows.some(r => r.id === target.postId)) break;
      if (platform === 'x') await page.evaluate(x.scrollXProfile);
      if (platform === 'xhs') { await page.evaluate(h.scrollNotes); if (round % 2) await page.evaluate(h.nextNotesPage); }
      if (platform === 'wechat' && await page.evaluate(w.advanceWechatArticles) === 'end') break;
    }
    if(platform==='xhs') {
      const candidates=[...cards.values()].filter(c=>c.state==='published'&&(target.postId?c.id===target.postId:c.date===target.date&&c.text?.trim()===target.text?.trim()));
      await page.goto('https://creator.xiaohongshu.com/new/home');
      if(candidates.length===1&&!candidates[0].url) {
        await identity();
        throw new Error('已匹配真实已发布笔记，但该可见列表未提供公开链接；不按ID拼造。需要从本人实际分享页取得可核验公开地址');
      }
    }
    await identity();
    return { ok: true, platform, account, url: selectPublishedLink(platform, [...cards.values()], {...target,account}), checkedAt: new Date().toISOString(), scope: '最多8轮可见列表；范围内唯一匹配，不证明遍历全账号' };
  }, platform);
}
