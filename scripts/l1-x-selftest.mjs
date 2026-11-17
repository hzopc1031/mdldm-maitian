// 示例 / 假 DOM 与临时 SQLite；不安装依赖，不运行真实浏览器，不访问正式库。
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const folder = fs.mkdtempSync(path.join(root, '_l1-selftest-x-'));
process.env.MAITIAN_HOME = folder;
process.env.MAITIAN_DB = path.join(folder, 'hub.db');
const output = ['> node scripts/l1-x-selftest.mjs', `临时库=${process.env.MAITIAN_DB}`, '本轮未启动真实 Chrome。未连接 9340/9341，未打开正式库。'];
const log = text => { output.push(text); console.log(text); };
// 最小 DOM 实现：支持生产选择器的标签、属性、后缀、后代、closest 和可见性。
class Element {
  constructor(tag, attrs = {}, text = '', children = []) {
    Object.assign(this, { tag, attrs, text, children });
    for (const child of children) child.parentElement = this;
  }
  get innerText() { return [this.text, ...this.children.map(c => c.innerText)].filter(Boolean).join('\n'); }
  get href() { return new URL(this.attrs.href, 'https://x.com').href; }
  getAttribute(key) { return this.attrs[key] ?? null; }
  getBoundingClientRect() { return { width: this.attrs.hidden ? 0 : 100, height: 40 }; }
  matches(selector) {
    return selector.split(',').some(part => {
      const tokens = part.trim().split(/\s+/), own = tokens.pop();
      const tag = own.match(/^[\w-]+/)?.[0];
      if (tag && tag !== this.tag) return false;
      const attributes = [...own.matchAll(/\[([\w-]+)(?:(\$?=)["']?([^\]"']+)["']?)?\]/g)];
      if (!attributes.every(([, key, op, value]) => key in this.attrs && (!op || (op === '$=' ? this.attrs[key].endsWith(value) : this.attrs[key] === value)))) return false;
      if (!tokens.length) return true;
      let parent = this.parentElement;
      while (parent) { if (parent.matches(tokens.join(' '))) return true; parent = parent.parentElement; }
      return false;
    });
  }
  closest(selector) { for (let el = this; el; el = el.parentElement) if (el.matches(selector)) return el; return null; }
  querySelectorAll(selector) { return this.children.flatMap(c => [...(c.matches(selector) ? [c] : []), ...c.querySelectorAll(selector)]); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}
const el = (...args) => new Element(...args);
const now = new Date('2026-11-17T08:00:00Z');
const recent = '2026-11-16T00:00:00Z';
function article(id, { author = 'PeanutPair', date = recent, kind, text = '示例原创', quote = false, label = '1,234 views, 12 likes, 3 replies, 2 bookmarks, 1 repost' } = {}) {
  const children = [el('div', { 'data-testid': 'User-Name' }, '', [el('a', { href: `/${author}` }, author)]),
    el('a', { href: `/${author}/status/${id}` }, '', [el('time', date ? { datetime: date } : {}, date || '')])];
  if (kind === 'repost') children.unshift(el('div', { 'data-testid': 'socialContext' }, 'Someone reposted'));
  if (kind === 'reply') children.push(el('div', {}, 'Replying to @Other'));
  children.push(el('div', { 'data-testid': 'tweetText' }, text));
  if (quote) {
    const quoted = article('999', { author: 'Other', date: '2025-01-01T00:00:00Z', label: '999 likes' });
    children.push(el('div', { role: 'link' }, '', quote === 'nested' ? [quoted] : quoted.children));
  }
  children.push(el('div', { role: 'group', 'aria-label': label }));
  return el('article', {}, '', children);
}
function documentFor(articles, handle = '@PeanutPair', fans = '2,503\nFollowers') {
  return el('document', {}, '', [el('button', { 'data-testid': 'SideNav_AccountSwitcher_Button' }, `示例账号\n${handle}`),
    el('a', { href: '/PeanutPair/verified_followers' }, fans), ...articles]);
}
const context = { URL, location: { href: 'https://x.com/PeanutPair' }, getComputedStyle: () => ({ display: 'block', visibility: 'visible' }), innerHeight: 800, window: { scrollBy() {} } };
const read = (fn, doc, ...args) => vm.runInNewContext(`(${fn.toString()})(...args)`, { ...context, document: doc, args });
globalThis.fetch = () => { throw new Error('离线自测禁止网络'); };
let store;
try {
  const dom = await import('../src/l1-x-dom.mjs');
  const { collectX, assertPeanutPair, registeredXPosts } = await import('../src/l1-x.mjs');
  const { browserSettings, allowedPage, assertBrowserOwner } = await import('../src/l1-browser.mjs');
  const doc = documentFor([article('101'), article('102', { quote: true }), article('103', { kind: 'repost' }), article('104', { kind: 'reply' }),
    article('105', { author: 'Other' }), article('106', { date: '2026-09-01T00:00:00Z' }), article('107', { date: null }),
    article('108', { text: 'Replying to @Other 是本篇示例正文' })]);
  assert.equal(dom.xNumber(read(dom.visibleXFollowers, doc)[0]), 2503);
  const followersOnly = documentFor([]); followersOnly.children[1].attrs.href = '/PeanutPair/followers';
  assert.equal(dom.xNumber(read(dom.visibleXFollowers, followersOnly)[0]), 2503);
  const bareIdentity = documentFor([], ''); bareIdentity.children[0].children.push(el('span', { 'data-testid': 'UserScreenName' }, 'PeanutPair'));
  assert.equal(read(dom.visibleXIdentity, bareIdentity).handle, 'PeanutPair');
  log('PASS 1 粉丝：已渲染 verified_followers 链接 → 2503。');
  assert.deepEqual(dom.parseXLabel(read(dom.visibleXMetricLabel, doc, '101')), { views: 1234, likes: 12, comments: 3, favorites: 2, shares: 1 });
  assert.deepEqual(dom.parseXLabel('2.5K views, 0 likes'), { views: 2500, likes: 0, comments: null, favorites: null, shares: null });
  assert.deepEqual(dom.parseXLabel(null), { views: null, likes: null, comments: null, favorites: null, shares: null });
  const unrelated = documentFor([article('201', { quote: true, label: '500 likes' }), article('999', { label: '7 likes' })]);
  assert.equal(read(dom.visibleXMetricLabel, unrelated, '999'), '7 likes');
  assert.equal(read(dom.visibleXMetricLabel, unrelated, '777'), null);
  log('PASS 2 目标 permalink 精确匹配；五项 aria-label 正确；缺项 NULL，明确的 0 保留，排除引用卡片指标。');
  const cards = read(dom.visibleXPosts, doc);
  assert.deepEqual(Array.from(cards.slice(0, 4), card => card.kind), ['original', 'quote', 'repost', 'reply']);
  const selected = dom.selectXPosts(cards, now);
  assert.deepEqual(selected.posts.map(p => p.id), ['101', '102', '108']);
  assert.equal(selected.skipped.unknownTime, 1); assert.equal(selected.skipped.outsideWindow, 1);
  assert.equal(selected.posts[1].created_at, recent);
  const noTime = article('109'); noTime.children[1].children = [];
  assert.equal(dom.selectXPosts(read(dom.visibleXPosts, documentFor([noTime])), now).skipped.unknownTime, 1);
  const boundary = dom.selectXPosts([{ ...selected.posts[0], created_at: '2026-10-18T08:00:00Z' }, { ...selected.posts[0], id: '110', created_at: '2026-10-18T07:59:59Z' }], now);
  assert.equal(boundary.posts.length, 1);
  log('PASS 3/4 原创/引用保留，转推/回复/其他作者排除；正文提示不误判回复；旧帖和未知时间跳过；30天边界正确。');
  let reads = 0, writes = 0, closed = 0;
  const fakeBrowser = doc => async (_config, fn, platform) => {
    assert.equal(platform, 'x');
    const page = { async goto(url) { context.location = { href: url }; }, async evaluate(fn, ...args) {
      if (fn === dom.scrollXProfile) return true;
      return read(fn, doc, ...args);
    } };
    try { return await fn(page); } finally { closed++; }
  };
  const options = { wait: async () => {}, now: () => now, readRegistered: async () => { reads++; return []; }, persist: async observation => { writes++; return observation; } };
  await assert.rejects(collectX({}, { ...options, withBrowser: fakeBrowser(documentFor([article('101')], '@WrongAccount')) }), /不是 @PeanutPair/);
  assert.equal(reads, 0); assert.equal(writes, 0); assert.equal(closed, 1);
  assert.equal(fs.existsSync(process.env.MAITIAN_DB), false);
  await assert.rejects(assertPeanutPair({ evaluate: async () => ({ handle: null, url: 'https://x.com/PeanutPair' }) }, options.wait), /无法确认/);
  await assertPeanutPair({ evaluate: async () => ({ handle: 'PeanutPair', url: 'https://x.com/PeanutPair' }) }, options.wait);
  log('PASS 5 错误账号立即停止，未读登记、未调用写库、未创建数据库，模拟浏览器已关闭；未知账号失败；支持不带 @。');
  const observation = await collectX({}, { ...options, withBrowser: fakeBrowser(doc) });
  assert.equal(writes, 1); assert.equal(closed, 2); assert.equal(observation.followers, 2503);
  assert.equal(observation.posts.length, 3); assert.equal(observation.source, 'chrome/page');
  let identityCalls = 0;
  await assert.rejects(collectX({}, { ...options, withBrowser: async (_config, fn) => fn({ goto: async url => { context.location = { href: url }; }, evaluate: async (fn, ...args) => {
    if (fn === dom.visibleXIdentity && ++identityCalls > 5) return { handle: '@Wrong', url: context.location.href };
    return fn === dom.scrollXProfile ? true : read(fn, doc, ...args);
  } }) }), /不是 @PeanutPair/);
  assert.equal(writes, 1);
  log('PASS 浏览器全流程：发现→粉丝→逐帖→最终账号校验→关闭→写入；中途换号也不写库。');
  // binary 仅用当前 node 路径满足存在检查，不会启动任何进程。
  const config = { chromeBinary: process.execPath, chromePort: 9340, chromeProfile: path.join(folder, 'chrome-profile-l1-xhs') };
  assert.equal(browserSettings(config, 'x').port, 9341);
  assert.equal(browserSettings(config, 'xhs').port, 9340);
  assert.equal(browserSettings(config, 'x').profile, path.join(folder, 'chrome-profile-l1-x'));
  for (const port of [9333, 9334, 9335, 9340]) assert.throws(() => browserSettings({ ...config, l1: { x: { chromePort: port } } }, 'x'));
  assert.throws(() => browserSettings({ ...config, l1: { x: { chromeProfile: config.chromeProfile } } }, 'x'));
  for (const url of ['https://x.com/intent/like', 'https://x.com/i/api/anything', 'https://x.com/SomeoneElse', 'https://x.com/PeanutPair?x=1', 'https://creator.xiaohongshu.com/new/home']) assert.equal(allowedPage(url, 'x'), false);
  assert.equal(allowedPage('https://x.com/i/flow/login', 'x'), true);
  const owned = browserSettings(config, 'x'), pid = 12345;
  const args = [`--user-data-dir=${owned.profile}`, '--remote-debugging-port=9341', '--remote-debugging-address=127.0.0.1'];
  assertBrowserOwner(args, [{ type: 'browser', id: pid }], owned, pid);
  assert.throws(() => assertBrowserOwner(args, [{ type: 'browser', id: 99999 }], owned, pid));
  for (let i = 0; i < args.length; i++) assert.throws(() => assertBrowserOwner(args.filter((_, index) => i !== index), [{ type: 'browser', id: pid }], owned, pid));
  log('PASS X 强制 9341/专用 profile，不继承全局 9340；拒绝其他端口、操作页、接口页及跨平台 URL。');
  log('PASS 浏览器归属纯函数校验：PID/profile/端口/127.0.0.1 任一不符都拒绝；未创建进程或连接调试端口。');
  // 独立进程的模块钩子只替换采集与日报边界；若误打开任何数据库或浏览器则立即报错。
  const loader = path.join(folder, 'routing-mock.mjs');
  fs.writeFileSync(path.join(folder, 'config.json'), '{}');
  fs.writeFileSync(loader, `import { registerHooks } from 'node:module';
    registerHooks({ load(url, context, next) {
      const stubs = {
        '/src/l1-x.mjs': "export async function collectX(){console.log('ROUTE chrome-x')}",
        '/src/l1-xhs.mjs': "export async function collectXhs(){console.log('ROUTE chrome-xhs')}",
        '/scripts/import-x-public.mjs': "export async function importX(file){console.log('ROUTE import-x '+file)}",
        '/src/local-report.mjs': "export async function writeLocalReport(){console.log('ROUTE report')}"
      };
      if (/\\/(?:db|l1-store|l1-browser)\\.mjs$/.test(url)) throw new Error('离线入口测试禁止浏览器/数据库');
      for (const [suffix, source] of Object.entries(stubs)) if(url.endsWith(suffix)) return {format:'module', source, shortCircuit:true};
      return next(url, context);
    }});`);
  for (const [args, expected] of [
    [[], ['chrome-x', 'chrome-xhs', 'report']],
    [['--only', 'x'], ['chrome-x', 'report']],
    [['--only', 'x', '--import-x', 'manual.json'], ['import-x manual.json', 'report']],
    [['--import-x', 'manual.json'], ['import-x manual.json', 'chrome-xhs', 'report']],
    [['--only', 'xhs'], ['chrome-xhs', 'report']]
  ]) {
    const result = spawnSync(process.execPath, ['--import', pathToFileURL(loader).href, 'scripts/l1-run.mjs', ...args], {
      cwd: root, env: { ...process.env, MAITIAN_CONFIG: path.join(folder, 'config.json') }, encoding: 'utf8'
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual([...result.stdout.matchAll(/ROUTE (.*)/g)].map(m => m[1].trim()), expected);
  }
  log('PASS 入口分流（离线替身）：默认 Chrome X→小红书→日报；--only x 无小红书；显式 --import-x 才手工导入，无默认 inbox 依赖。');
  store = await import('../src/l1-store.mjs');
  const first = { ...observation, source: 'grok-public', posts: [observation.posts[0]], captured_at: '2026-11-17T07:00:00Z' };
  store.transaction(() => store.saveObservation(first));
  const eid = 'external:x:101';
  const beforeTask = store.db.prepare('SELECT * FROM tasks WHERE episode_id=?').get(eid);
  const chrome = { ...observation, posts: [{ ...observation.posts[0], views: 2000, likes: null }], captured_at: '2026-11-17T08:00:00Z' };
  for (let i = 0; i < 2; i++) store.transaction(() => store.saveObservation(chrome));
  let row = store.db.prepare('SELECT * FROM metrics WHERE episode_id=?').get(eid);
  assert.equal(row.views, 2000); assert.equal(row.likes, 12);
  assert.deepEqual(JSON.parse(row.extra).sources, ['grok-public', 'chrome/page']);
  assert.deepEqual(JSON.parse(store.db.prepare('SELECT project FROM snapshots WHERE episode_id=?').get(eid).project).sources, ['grok-public', 'chrome/page']);
  assert.deepEqual(store.db.prepare('SELECT * FROM tasks WHERE episode_id=?').get(eid), beforeTask);
  store.transaction(() => store.saveObservation(first));
  row = store.db.prepare('SELECT * FROM metrics WHERE episode_id=?').get(eid); assert.equal(row.views, 2000);
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM episodes').get().n, 1);
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM snapshots').get().n, 1);
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM tasks').get().n, 1);
  assert.equal((await registeredXPosts()).length, 1);
  store.transaction(() => store.saveObservation({ ...chrome, followers: null, captured_at: '2026-11-18T08:00:00Z' }));
  row = store.db.prepare("SELECT * FROM metrics WHERE day='2026-11-18'").get(); assert.equal(row.likes, 12);
  assert.equal(JSON.parse(row.extra).field_observed_at.likes, first.captured_at);
  // 兼容旧的非 external episode id，同 statusId 依然合并。
  store.db.prepare("UPDATE tasks SET episode_id='legacy-id' WHERE episode_id=?").run(eid);
  store.db.prepare("UPDATE snapshots SET episode_id='legacy-id' WHERE episode_id=?").run(eid);
  store.db.prepare("UPDATE metrics SET episode_id='legacy-id' WHERE episode_id=?").run(eid);
  store.db.prepare("UPDATE episodes SET id='legacy-id' WHERE id=?").run(eid);
  store.transaction(() => store.saveObservation({ ...chrome, captured_at: '2026-11-18T09:00:00Z' }));
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM episodes').get().n, 1);
  log('PASS 6 同 statusId 幂等合并，无重复 episode/task/snapshot；保留登记和 grok-public 来源；NULL 跨日保留非空及字段时间，旧观测不覆盖新值；兼容旧 episode id。');
  log('L1 X SELFTEST PASS，全部检查通过。本轮未启动真实 Chrome。');
} catch (error) { log(`L1 X SELFTEST FAIL: ${error.stack}`); process.exitCode = 1; }
finally { store?.db.close(); fs.writeFileSync(path.join(root, '_l1-selftest-x-output.txt'), output.join('\n') + '\n', 'utf8'); }
