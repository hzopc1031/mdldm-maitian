import { l1Account } from './l1-account.mjs';
import { createInterface } from 'node:readline/promises';
import { withL1Browser, pause } from './l1-browser.mjs';
import { visibleIdentity, visibleFans, visibleNoteCards, scrollNotes, nextNotesPage, parseVisibleNumber } from './l1-xhs-dom.mjs';
import { inWindow, validDay } from './l1-config.mjs';
import { loginTimeoutMs, waitForVisibleLogin } from './l1-login.mjs';
const HOME = 'https://creator.xiaohongshu.com/new/home';
export async function assertXhsAccount(page, account) {
  let identity;
  for (let i = 0; i < 6; i++) {
    identity = await page.evaluate(visibleIdentity);
    if (identity.login || identity.nickname) break;
    await pause();
  }
  if (identity.login || identity.nickname !== account) throw new Error(`停止：期望可见昵称 ${account}，实际 ${identity.nickname || '暂无/未登录'}；未写入本次小红书数据`);
}
export async function loginXhs(config, { waitLogin = false } = {}) {
  const account=l1Account(config,'xhs');
  if (!waitLogin && !process.stdin.isTTY) throw new Error('扫码登录需要交互终端');
  const timeoutMs = waitLogin ? loginTimeoutMs() : null;
  await withL1Browser(config, async page => {
    await page.goto(HOME);
    if (waitLogin) {
      console.log(`请 Liu 在专用窗口扫码登录 ${account}；自动轮询可见昵称，无需回车，超时 ${timeoutMs} 毫秒。`);
      await waitForVisibleLogin(page, visibleIdentity, identity => {
        if (identity.nickname && identity.nickname !== account) throw new Error(`停止：期望可见昵称 ${account}，实际 ${identity.nickname}；未采集、未写库`);
        return !identity.login && identity.nickname === account;
      }, timeoutMs);
    } else {
      const terminal = createInterface({ input: process.stdin, output: process.stdout });
      try { await terminal.question(`请在该窗口扫码登录 ${account}，不要登录其他号。扫码完成后回车校验并关闭专用 Chrome：`); }
      finally { terminal.close(); }
      await page.goto(HOME); await assertXhsAccount(page, account);
    }
    console.log(`登录校验成功：${account}；随后关闭本次专用 Chrome，登录状态由 Chrome 自行保存在专用 profile。`);
  });
}
export async function collectXhs(config, date) {
  const account=l1Account(config,'xhs');
  const observation = await withL1Browser(config, async page => {
    await page.goto(HOME); await assertXhsAccount(page, account);
    await page.goto('https://creator.xiaohongshu.com/statistics/fans-data');
    let total = null;
    for (let i = 0; i < 6 && total == null; i++) { await pause(); total = parseVisibleNumber(await page.evaluate(visibleFans)); }
    if (total == null) throw new Error('读不到可靠的可见粉丝总数；不写 0，不写入本次小红书数据');
    await page.goto('https://creator.xiaohongshu.com/new/note-manager');
    const posts = new Map(), unknown = new Set(), seen = new Set();
    let stagnant = 0, complete = false, sawCards = false, atEnd = false;
    // 最多 120 轮，每轮等待 1.8–3.2 秒；同一页面批量读卡片。
    for (let round = 0; round < 120; round++) {
      await pause();
      const cards = await page.evaluate(visibleNoteCards);
      sawCards ||= cards.length > 0;
      const before = seen.size;
      for (const card of cards) {
        if (!card.id || !/^[\w-]+$/.test(card.id)) continue;
        seen.add(card.id);
        if (!card.date) { unknown.add(card.id); continue; }
        try { validDay(card.date); } catch { unknown.add(card.id); continue; }
        const created = `${card.date}T00:00:00+08:00`;
        if (!Number.isFinite(Date.parse(created))) { unknown.add(card.id); continue; }
        if (!inWindow(created, date)) continue;
        if (card.state === 'skipped') continue;
        const nums = card.stats.length >= 5 ? card.stats.map(parseVisibleNumber) : [];
        posts.set(card.id, { ...card, created_at: created, precision: 'visible DOM; rounded counts possible; publication date only (Beijing midnight)', views: nums[0] ?? null, comments: nums[1] ?? null, likes: nums[2] ?? null, favorites: nums[3] ?? null, shares: nums[4] ?? null });
      }
      stagnant = before === seen.size ? stagnant + 1 : 0;
      // 不假定按日期排序；看到旧作品仍继续遍历，以免置顶卡片截断。
      if (stagnant >= 3 && atEnd) {
        if (await page.evaluate(nextNotesPage)) { stagnant = 0; atEnd = false; await pause(3500, 5500); }
        else { complete = true; break; }
      } else atEnd = await page.evaluate(scrollNotes);
    }
    if (!sawCards) throw new Error('note-manager 未读到作品卡片，可能页面结构变化；不写入本次小红书数据');
    if (!complete) throw new Error('达到低频遍历上限；本次未确认遍历完成，不写入本次小红书数据');
    // 写库前再回首页核验，整个浏览器阶段结束后才打开数据库。
    await page.goto(HOME); await assertXhsAccount(page, account);
    console.log(`${account}：近30天 ${posts.size} 篇；日期未知 ${unknown.size} 篇已跳过（未当成近期作品）`);
    return { platform: 'xhs', account, source: 'xhs-visible-dom', captured_at: new Date().toISOString(), followers: total, posts: [...posts.values()] };
  });
  const store = await import('./l1-store.mjs');
  return store.transaction(() => store.saveObservation(observation));
}
