import fs from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { withL1Browser, pause } from './l1-browser.mjs';
import { dbPath } from './l1-config.mjs';
import { loginTimeoutMs, waitForVisibleLogin } from './l1-login.mjs';
import { visibleXIdentity, visibleXFollowers, visibleXPosts, visibleXMetricLabel, scrollXProfile, xNumber, parseXLabel, selectXPosts } from './l1-x-dom.mjs';
const PROFILE = 'https://x.com/PeanutPair';

export async function assertPeanutPair(page, wait = pause) {
  for (let i = 0; i < 6; i++) {
    const identity = await page.evaluate(visibleXIdentity);
    if (identity.handle && identity.handle.replace(/^@/, '').toLowerCase() === 'peanutpair' &&
        /^https:\/\/x\.com\/PeanutPair(?:\/status\/\d+)?\/?$/i.test(identity.url)) return;
    if (identity.handle) throw new Error(`停止：可见登录账号 ${identity.handle} 不是 @PeanutPair；本次 X 未写库`);
    if (i < 5) await wait();
  }
  throw new Error('停止：无法确认可见登录账号为 @PeanutPair；本次 X 未写库');
}

export async function loginX(config, { waitLogin = false } = {}) {
  if (!waitLogin && !process.stdin.isTTY) throw new Error('X 登录需要交互终端');
  const timeoutMs = waitLogin ? loginTimeoutMs() : null;
  await withL1Browser(config, async page => {
    await page.goto('https://x.com/i/flow/login');
    if (waitLogin) {
      console.log(`请 Liu 在专用窗口登录 @PeanutPair；自动轮询当前账号切换器，无需回车，超时 ${timeoutMs} 毫秒。`);
      await waitForVisibleLogin(page, visibleXIdentity, identity => {
        if (!identity.handle) return false;
        if (identity.handle.replace(/^@/, '').toLowerCase() !== 'peanutpair') throw new Error(`停止：可见登录账号 ${identity.handle} 不是 @PeanutPair；未采集、未写库`);
        return new URL(identity.url).origin === 'https://x.com';
      }, timeoutMs);
    } else {
      const terminal = createInterface({ input: process.stdin, output: process.stdout });
      try { await terminal.question('请 Liu 在该窗口登录 @PeanutPair，不要登录其他号。完成后回车校验并关闭专用 Chrome：'); }
      finally { terminal.close(); }
      await page.goto(PROFILE); await assertPeanutPair(page);
    }
    console.log('X 登录校验成功：@PeanutPair；随后关闭本次专用 Chrome。');
  }, 'x');
}

// 账号验证后才读取登记，readOnly 避免读阶段创建库或改变 schema。
export async function registeredXPosts() {
  if (!fs.existsSync(dbPath)) return [];
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    return db.prepare("SELECT t.url,s.project FROM tasks t LEFT JOIN snapshots s ON s.episode_id=t.episode_id WHERE t.platform='x'").all().flatMap(row => {
      const match = row.url?.match(/^https:\/\/x\.com\/PeanutPair\/status\/(\d+)$/i);
      if (!match) return [];
      let project = {}; try { project = JSON.parse(row.project || '{}'); } catch { /* 仍可按已登记 URL 读指标 */ }
      return [{ id: match[1], url: `https://x.com/PeanutPair/status/${match[1]}`, text: project.text || project.platforms?.x?.text || '', created_at: project.created_at || project.platforms?.x?.created_at || null }];
    });
  } finally { db.close(); }
}
async function persistX(observation) {
  const store = await import('./l1-store.mjs');
  return store.transaction(() => store.saveObservation(observation));
}

// 依赖注入只用于离线模拟；默认入口始终启动已核验归属的 X 专用 Chrome。
export async function collectX(config, { withBrowser = withL1Browser, wait = pause, readRegistered = registeredXPosts, persist = persistX, now = () => new Date() } = {}) {
  const observation = await withBrowser(config, async page => {
    await page.goto(PROFILE); await assertPeanutPair(page, wait);
    const started = now(), registered = await readRegistered();
    let followers = null;
    for (let i = 0; i < 6 && followers == null; i++) {
      await wait();
      const numbers = [...new Set((await page.evaluate(visibleXFollowers)).map(xNumber).filter(n => n != null))];
      if (numbers.length === 1) followers = numbers[0];
    }
    // 主页虚拟列表逐轮去重；遇到旧置顶不停止；持续看到旧时间线且无新近期帖才停止。
    const cards = new Map(); let stagnant = 0, oldRounds = 0, complete = false, atEnd = false;
    for (let round = 0; round < 120; round++) {
      await wait(); await assertPeanutPair(page, wait);
      const batch = await page.evaluate(visibleXPosts);
      const before = cards.size;
      for (const card of batch) cards.set(card.id || JSON.stringify(card), card);
      stagnant = cards.size === before ? stagnant + 1 : 0;
      const selected = selectXPosts(batch, started);
      oldRounds = batch.length && !selected.posts.length && selected.skipped.outsideWindow > 0 ? oldRounds + 1 : 0;
      if ((stagnant >= 3 && atEnd) || oldRounds >= 3) { complete = true; break; }
      atEnd = await page.evaluate(scrollXProfile);
    }
    if (!cards.size || !complete) throw new Error('X 主页为空或达到低频遍历上限；本次 X 未写库');
    const selected = selectXPosts([...cards.values()], started);
    const posts = new Map(registered.map(p => [p.id, p]));
    for (const post of selected.posts) posts.set(post.id, { ...posts.get(post.id), ...post });
    for (const post of posts.values()) {
      await wait(); await page.goto(post.url); await assertPeanutPair(page, wait);
      let label = null;
      for (let i = 0; i < 3 && !label; i++) { await wait(); label = await page.evaluate(visibleXMetricLabel, post.id); }
      Object.assign(post, parseXLabel(label), { precision: 'chrome/page rendered aria-label; rounded counts possible' });
    }
    await wait(); await page.goto(PROFILE); await assertPeanutPair(page, wait);
    console.log(`X PeanutPair：发现近30天 ${selected.posts.length} 篇；日期未知跳过 ${selected.skipped.unknownTime}；窗口外 ${selected.skipped.outsideWindow}；转推/回复/其他作者 ${selected.skipped.excluded}；补读 ${posts.size} 篇；粉丝 ${followers ?? 'NULL'}`);
    return { platform: 'x', account: 'PeanutPair', captured_at: now().toISOString(), source: 'chrome/page', followers, posts: [...posts.values()] };
  }, 'x');
  // 浏览器阶段与最终账号校验全部成功、关闭本次 Chrome 后才打开可写数据库。
  return persist(observation);
}
