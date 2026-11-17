import { createInterface } from 'node:readline/promises';
import { withL1Browser, pause } from './l1-browser.mjs';
import { loginTimeoutMs, waitForVisibleLogin } from './l1-login.mjs';
import { validDay, inWindow } from './l1-config.mjs';
import { visibleWechatIdentity, visibleWechatFollowers, visibleWechatArticles, clickWechatSection, advanceWechatArticles, wechatNumber, wechatMetrics } from './l1-wechat-dom.mjs';
const HOME = 'https://mp.weixin.qq.com/';
export function wechatAccount(config) {
  const account = config.l1?.wechat?.account;
  if (typeof account !== 'string' || !account.trim() || account !== account.trim() || /[\r\n]/.test(account)) throw new Error('请配置 l1.wechat.account 为预期公众号可见名称；未启动 Chrome、未写库');
  return account;
}
export function checkWechatIdentity(identity, account) {
  if (!identity.trustedOrigin) throw new Error('停止：公众号页面来源不符；未采集、未写库');
  if (identity.names.length > 1) throw new Error('停止：可见公众号账号有歧义；未采集、未写库');
  if (identity.names.length === 1 && identity.names[0] !== account) throw new Error('停止：可见公众号账号与 l1.wechat.account 不符；未采集、未写库');
  return identity.names.length === 1 && !identity.login;
}
export async function assertWechatAccount(page, account, wait = pause) {
  for (let i = 0; i < 6; i++) {
    if (checkWechatIdentity(await page.evaluate(visibleWechatIdentity), account)) return;
    if (i < 5) await wait();
  }
  throw new Error('停止：无法确认预期公众号已登录；未采集、未写库');
}
export async function loginWechat(config, { waitLogin = false } = {}) {
  const account = wechatAccount(config);
  if (!waitLogin && !process.stdin.isTTY) throw new Error('公众号登录需要交互终端');
  const timeoutMs = waitLogin ? loginTimeoutMs() : null;
  await withL1Browser(config, async page => {
    await page.goto(HOME);
    if (waitLogin) {
      console.log(`请 Liu 在公众号专用窗口扫码登录；按配置名称校验，超时 ${timeoutMs} 毫秒。`);
      await waitForVisibleLogin(page, visibleWechatIdentity, identity => checkWechatIdentity(identity, account), timeoutMs);
    } else {
      const terminal = createInterface({ input: process.stdin, output: process.stdout });
      try { await terminal.question('请 Liu 在本次公众号专用窗口扫码登录预期账号，完成后回车校验：'); }
      finally { terminal.close(); }
      await assertWechatAccount(page, account);
    }
    console.log('公众号登录校验成功；随后关闭本次专用 Chrome。');
  }, 'wechat');
}
async function persistWechat(observation) {
  const store = await import('./l1-store.mjs');
  return store.transaction(() => store.saveObservation(observation));
}
export async function collectWechat(config, date, { withBrowser = withL1Browser, wait = pause, persist = persistWechat, now = () => new Date() } = {}) {
  const account = wechatAccount(config); validDay(date);
  const observation = await withBrowser(config, async page => {
    await page.goto(HOME); await assertWechatAccount(page, account, wait);
    await wait(); await page.evaluate(clickWechatSection, 'followers');
    let followers = null;
    for (let i = 0; i < 6; i++) {
      await wait(); await assertWechatAccount(page, account, wait);
      followers = wechatNumber(await page.evaluate(visibleWechatFollowers));
      if (followers != null) break;
    }
    await wait(); await page.evaluate(clickWechatSection, 'posts');
    const posts = new Map(), unknown = new Set(), seen = new Set();
    let complete = false;
    for (let round = 0; round < 120; round++) {
      await wait(); await assertWechatAccount(page, account, wait);
      const cards = await page.evaluate(visibleWechatArticles);
      for (const card of cards) {
        if (!card.id || !/^[\w-]+$/.test(card.id) || card.state === 'skipped') continue;
        seen.add(card.id);
        try { validDay(card.date); } catch { unknown.add(card.id); continue; }
        unknown.delete(card.id);
        const created_at = `${card.date}T00:00:00+08:00`;
        if (!inWindow(created_at, date)) continue;
        const metrics = wechatMetrics(card.stats);
        posts.set(card.id, { id: card.id, text: card.text, url: card.url, state: 'published', created_at, ...metrics, favorites: null, precision: 'visible DOM; rounded counts possible; Beijing publication day' });
      }
      // 不因旧/置顶文章停止；必须看到明确末页，否则整轮不落库。
      const action = await page.evaluate(advanceWechatArticles);
      if (action === 'end') { complete = true; break; }
    }
    if (!complete) throw new Error('公众号遍历未确认完成（上限120轮）；未写库');
    if (!seen.size) throw new Error('公众号未读到已发表文章，可能 DOM 变化；未写库');
    await assertWechatAccount(page, account, wait);
    console.log(`公众号：近30个北京时间自然日 ${posts.size} 篇；未知日期跳过 ${unknown.size} 篇；粉丝${followers == null ? '暂无' : '已读取'}。`);
    return { platform: 'wechat', account, source: 'wechat-visible-dom', captured_at: now().toISOString(), followers, posts: [...posts.values()] };
  }, 'wechat');
  return persist(observation);
}
