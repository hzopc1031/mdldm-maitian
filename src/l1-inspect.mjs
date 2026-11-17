// 只读体检 / 按期取链接；可见 DOM，无旧 hub，无平台内部 API。
import { beijingDay } from './l1-config.mjs';
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
  const expected = config.l1?.[platform]?.account || (platform === 'x' ? config.xHandle : null);
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
      if (!account || i.login || (platform === 'wechat' && !i.trustedOrigin) || account.toLowerCase() !== expected.toLowerCase()) throw new Error('未确认预期可见账号；请在专用窗口完成人工登录后再校验');
      return account;
    }
    const account = await identity();
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
    if (platform === 'xhs') await page.goto('https://creator.xiaohongshu.com/new/home');
    await identity();
    return { ok: true, platform, account, url: selectPublishedLink(platform, [...cards.values()], {...target,account}), checkedAt: new Date().toISOString(), scope: '最多8轮可见列表；范围内唯一匹配，不证明遍历全账号' };
  }, platform);
}
