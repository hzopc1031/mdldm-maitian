import fs from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { withL1Browser, pause } from './l1-browser.mjs';
import { l1Account } from './l1-account.mjs';
import { dbPath } from './l1-config.mjs';
import { loginTimeoutMs, waitForVisibleLogin } from './l1-login.mjs';
import { reportL1Progress } from './l1-progress.mjs';
import {dayWindow, inDayWindow} from './l1-collection-window.mjs';
import {beijingDay} from './l1-config.mjs';
import { visibleXIdentity, visibleXFollowers, visibleXPosts, visibleXMetricLabel, scrollXProfile, xNumber, parseXLabel, selectXPosts } from './l1-x-dom.mjs';


export async function assertXAccount(page, account, wait = pause) {
  if(!/^[A-Za-z0-9_]{1,15}$/.test(account || ''))throw new Error('X 预期账号未配置');
  for (let i = 0; i < 6; i++) {
    const identity = await page.evaluate(visibleXIdentity);
    if (identity.handle && identity.handle.replace(/^@/, '').toLowerCase() === account.toLowerCase() &&
        new RegExp(`^https://x\\.com/(?:home|${account}(?:/status/\\d+)?)/?$`,'i').test(identity.url)) return;
    if (identity.handle) throw new Error(`停止：可见登录账号 ${identity.handle} 不是 @${account}；本次 X 未写库`);
    if (i < 5) await wait();
  }
  throw new Error(`停止：无法确认可见登录账号为 @${account}；本次 X 未写库`);
}

export async function loginX(config, { waitLogin = false } = {}) {
  const account=l1Account(config,'x'), PROFILE=`https://x.com/${account}`;
  if (!waitLogin && !process.stdin.isTTY) throw new Error('X 登录需要交互终端');
  const timeoutMs = waitLogin ? loginTimeoutMs() : null;
  await withL1Browser(config, async page => {
  // The signed-in home is the identity entry; a public profile preview proves no login.
    // Enter the official sign-in route only when the visible page requires login.
    reportL1Progress('checking_login');
    await page.goto('https://x.com/home');
    await page.bringToFront?.().catch(() => reportL1Progress('window_unavailable'));
    const current = await page.evaluate(visibleXIdentity);
    if (new URL(current.url).origin !== 'https://x.com') throw new Error('停止：X页面来源不符；未确认登录');
    if (current.handle) {
      if (current.handle.replace(/^@/, '').toLowerCase() !== account.toLowerCase()) throw new Error(`停止：可见登录账号 ${current.handle} 不是 @${account}；未采集、未写库`);
      reportL1Progress('identity_confirmed');
      console.log(`X 登录校验成功：@${account}；已复用本专用窗口的登录状态，没有重新进入登录页。`);
      return;
    }
    if (!current.login) throw new Error('当前X页面没有提供可确认的账号或登录入口；未确认登录，请查看专用窗口');
    if (!/^\/i\/(?:flow\/login|jf\/onboarding)(?:\/|$)/.test(new URL(current.url).pathname)) await page.goto('https://x.com/i/flow/login');
    if (waitLogin) {
      reportL1Progress('waiting_login', timeoutMs);
      console.log(`请在专用窗口登录 @${account}；自动轮询当前账号切换器，无需回车，超时 ${timeoutMs} 毫秒。`);
      await waitForVisibleLogin(page, visibleXIdentity, identity => {
        if (!identity.handle) return false;
        if (identity.handle.replace(/^@/, '').toLowerCase() !== account.toLowerCase()) throw new Error(`停止：可见登录账号 ${identity.handle} 不是 @${account}；未采集、未写库`);
        return new URL(identity.url).origin === 'https://x.com';
      }, timeoutMs);
    } else {
      const terminal = createInterface({ input: process.stdin, output: process.stdout });
      try { await terminal.question(`请在该窗口登录 @${account}，不要登录其他号。完成后回车校验并关闭专用 Chrome：`); }
      finally { terminal.close(); }
      await page.goto(PROFILE); await assertXAccount(page, account);
    }
    reportL1Progress('identity_confirmed');
    console.log(`X 登录校验成功：@${account}；随后关闭本次专用 Chrome。`);
  }, 'x');
}

// 账号验证后才读取登记，readOnly 避免读阶段创建库或改变 schema。
export async function registeredXPosts(account) {
  if(!/^[A-Za-z0-9_]{1,15}$/.test(account || ''))throw new Error('X 预期账号未配置');
  if (!fs.existsSync(dbPath)) return [];
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    return db.prepare("SELECT t.url,s.project FROM tasks t LEFT JOIN snapshots s ON s.episode_id=t.episode_id WHERE t.platform='x'").all().flatMap(row => {
      const match = row.url?.match(new RegExp(`^https://x\\.com/${account}/status/(\\d+)$`,'i'));
      if (!match) return [];
      let project = {}; try { project = JSON.parse(row.project || '{}'); } catch { /* 仍可按已登记 URL 读指标 */ }
      return [{ id: match[1], url: `https://x.com/${account}/status/${match[1]}`, text: project.text || project.platforms?.x?.text || '', created_at: project.created_at || project.platforms?.x?.created_at || null }];
    });
  } finally { db.close(); }
}
async function persistX(observation) {
  const store = await import('./l1-store.mjs');
  return store.transaction(() => store.saveObservation(observation));
}

// 依赖注入只用于离线模拟；默认入口始终启动已核验归属的 X 专用 Chrome。
export async function collectX(config, { withBrowser = withL1Browser, wait = pause, readRegistered = registeredXPosts, persist = persistX, now = () => new Date(), history = false, date, until, targets } = {}) {
  const account=l1Account(config,'x'), PROFILE=`https://x.com/${account}`;
  const window = history || targets ? null : dayWindow(date || beijingDay(now()), until || now());
  if(targets?.some(p=>!/^\d+$/.test(p.id)||p.url?.toLowerCase()!==`${PROFILE}/status/${p.id}`.toLowerCase()))
    throw new Error('同龄采样仅接受已登记的本人 X 作品链接');
  async function readMetrics(page,posts){
    let completed=0;
    for(const post of posts){
      reportL1Progress('reading_posts',{completed,total:posts.length});
      await wait(); await page.goto(post.url); await assertXAccount(page,account,wait);
      let label=null;
      for(let i=0;i<3&&!label;i++){await wait();label=await page.evaluate(visibleXMetricLabel,post.id,account);}
      Object.assign(post,parseXLabel(label),{precision:'chrome/page rendered aria-label; rounded counts possible'});
      reportL1Progress('reading_posts',{completed:++completed,total:posts.length});
    }
  }
  const select = (cards, started) => {
    const selected = selectXPosts(cards, started, account, window);
    if (window) selected.posts = selected.posts.filter(p => inDayWindow(p.created_at, window));
    return selected;
  };
  const observation = await withBrowser(config, async page => {
    await page.goto(PROFILE); await assertXAccount(page, account, wait);
    if(targets){
      const posts=targets.map(post=>({...post}));
      await readMetrics(page,posts);
      await page.goto(PROFILE); await assertXAccount(page,account,wait);
      return {platform:'x',account,captured_at:now().toISOString(),source:'age/visible-posts',posts};
    }
    const started = now(), registered = (await readRegistered(account)).filter(p => !window || inDayWindow(p.created_at, window));
    let followers = null;
    for (let i = 0; i < 6 && followers == null; i++) {
      await wait();
      const numbers = [...new Set((await page.evaluate(visibleXFollowers, account)).map(xNumber).filter(n => n != null))];
      if (numbers.length === 1) followers = numbers[0];
    }
    // 主页虚拟列表逐轮去重；遇到旧置顶不停止；持续看到旧时间线且无新近期帖才停止。
    const cards = new Map(); let stagnant = 0, oldRounds = 0, complete = false, atEnd = false;
    for (let round = 0; round < 120; round++) {
      reportL1Progress('discovering', {round:round+1});
      await wait(); await assertXAccount(page, account, wait);
      const batch = await page.evaluate(visibleXPosts);
      const before = cards.size;
      for (const card of batch) cards.set(card.id || JSON.stringify(card), card);
      stagnant = cards.size === before ? stagnant + 1 : 0;
      const selected = select(batch, started);
      const older = window ? batch.some(p => !p.pinned && p.author?.toLowerCase()===account.toLowerCase() && p.permalinkAuthor?.toLowerCase()===account.toLowerCase() && ['original','quote'].includes(p.kind) && Date.parse(p.created_at)<Date.parse(window.start)) : selected.skipped.outsideWindow > 0;
      oldRounds = batch.length && !selected.posts.length && older ? oldRounds + 1 : 0;
      if ((stagnant >= 3 && atEnd) || oldRounds >= 3) { complete = true; break; }
      atEnd = await page.evaluate(scrollXProfile);
    }
    if (!cards.size || !complete) throw new Error('X 主页为空或达到低频遍历上限；本次 X 未写库');
    if (![...cards.values()].some(p=>/^\d+$/.test(p.id||'') && p.author?.toLowerCase()===account.toLowerCase() && p.permalinkAuthor?.toLowerCase()===account.toLowerCase() && ['original','quote'].includes(p.kind))) throw new Error('X 未读到可核验的本人作品；不把页面结构缺失当作当天0篇');
    const selected = select([...cards.values()], started);
    const posts = new Map(registered.map(p => [p.id, p]));
    for (const post of selected.posts) posts.set(post.id, { ...posts.get(post.id), ...post });
    await readMetrics(page,[...posts.values()]);
    await wait(); await page.goto(PROFILE); await assertXAccount(page, account, wait);
    console.log(`X ${account}：${window ? window.date+'（北京时间）' : '历史近30天'} ${selected.posts.length} 篇；日期未知跳过 ${selected.skipped.unknownTime}；补读 ${posts.size} 篇；粉丝 ${followers ?? 'NULL'}`);
    return { platform: 'x', account, captured_at: now().toISOString(), source: 'chrome/page', followers, posts: [...posts.values()], ...(window ? {collection:{...window, complete:selected.skipped.unknownTime===0,unknownDates:selected.skipped.unknownTime}} : {}) };
  }, 'x');
  // 浏览器阶段与最终账号校验全部成功、关闭本次 Chrome 后才打开可写数据库。
  reportL1Progress('saving');
  return persist(observation);
}
