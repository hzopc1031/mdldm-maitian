// 原创离线夹具；无依赖安装、真实 Chrome、真实配置或正式库访问。
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import http from 'node:http';
import { once } from 'node:events';
import { EventEmitter } from 'node:events';
import { registerHooks } from 'node:module';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
if (process.argv[2] === '--browser-child') { await browserChild(); process.exit(); }
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const folder = fs.mkdtempSync(path.join(root, '_l1-selftest-wechat-'));
Object.assign(process.env, { MAITIAN_HOME: folder, MAITIAN_DB: path.join(folder, 'hub.db'), MAITIAN_CONFIG: path.join(folder, 'config.json') });
fs.writeFileSync(process.env.MAITIAN_CONFIG, JSON.stringify({ rootPath: folder }));
globalThis.fetch = () => { throw new Error('禁止外部网络'); };
globalThis.WebSocket = class { constructor() { throw new Error('禁止调试连接'); } };
const output = [], log = line => { output.push(line); console.log(line); };
class Element {
  constructor(tag, attrs = {}, text = '', children = []) { Object.assign(this, { tag, attrs, text, children }); children.forEach(c => c.parentElement = this); }
  get innerText() { return [this.text, ...this.children.map(c => c.innerText)].filter(Boolean).join('\n'); }
  get className() { return this.attrs.class || ''; }
  get disabled() { return this.attrs.disabled === true; }
  getAttribute(key) { return this.attrs[key] ?? null; }
  getBoundingClientRect() { return { width: this.attrs.hidden ? 0 : 100, height: 30 }; }
  contains(el) { return this.children.some(c => c === el || c.contains(el)); }
  matches(selector) {
    return selector.split(',').some(part => {
      const tokens = part.trim().split(/\s+/), own = tokens.pop();
      if (own.match(/^[\w-]+/)?.[0] && own.match(/^[\w-]+/)[0] !== this.tag) return false;
      if (![...own.matchAll(/\.([\w-]+)/g)].every(([, cls]) => this.className.split(' ').includes(cls))) return false;
      if (own.startsWith('#') && this.attrs.id !== own.slice(1)) return false;
      if (![...own.matchAll(/\[([\w-]+)(?:=["']?([^\]"']+)["']?)?\]/g)].every(([, key, value]) => key in this.attrs && (value == null || this.attrs[key] === value))) return false;
      if (!tokens.length) return true;
      for (let p = this.parentElement; p; p = p.parentElement) if (p.matches(tokens.join(' '))) return true;
      return false;
    });
  }
  closest(selector) { for (let p = this; p; p = p.parentElement) if (p.matches(selector)) return p; return null; }
  querySelectorAll(selector) { return this.children.flatMap(c => [...(c.matches(selector) ? [c] : []), ...c.querySelectorAll(selector)]); }
  click() { this.clicked = true; }
}
const el = (...args) => new Element(...args);
const metric = (label, value, hidden = false) => el('div', { hidden }, '', [el('span', { hidden }, label), el('span', { hidden }, value)]);
function article(id, date = '2026-11-17', { url = `https://mp.weixin.qq.com/s/article-${id}`, state = '', metrics = [metric('阅读', '1.2万'), metric('点赞', '0'), metric('留言', '--'), metric('分享', '3'), metric('在看', '7')] } = {}) {
  return el('div', { class: 'appmsg-card', ...(id ? { 'data-appmsgid': id } : {}) }, state, [el('a', { href: url, class: 'appmsg_title' }, '测试标题'), el('time', {}, date || '昨天'), ...metrics]);
}
function doc(cards = [], names = ['TestAccount'], fans = '1,234') {
  return el('document', {}, '', [el('span', { class: 'weui-desktop-account__nickname', hidden: true }, 'Hidden'), ...names.map(name => el('span', { class: 'weui-desktop-account__nickname' }, name)), metric('总用户数', fans), ...cards,
    el('button', {}, '用户分析'), el('button', {}, '内容分析'), el('button', { disabled: true }, '下一页')]);
}
const context = { URL, location: { origin: 'https://mp.weixin.qq.com' }, getComputedStyle: () => ({ display: 'block', visibility: 'visible' }), innerHeight: 800, window: { scrollBy() {} } };
const read = (fn, document, ...args) => vm.runInNewContext(`(${fn.toString()})(...args)`, { ...context, document, args });
let store;
try {
  const dom = await import('../src/l1-wechat-dom.mjs');
  const { collectWechat, wechatAccount, assertWechatAccount } = await import('../src/l1-wechat.mjs');
  const { browserSettings, allowedPage, assertBrowserOwner } = await import('../src/l1-browser.mjs');
  const config = { chromeBinary: process.execPath, chromePort: 9333, chromeProfile: 'forbidden', l1: { wechat: { account: 'TestAccount' } } };
  const base = doc([article('101'), article('102', '2026-10-19'), article('103', '2026-10-18'), article('104', null), article('105', '2026-11-18'), article('106', '2026-02-30'), article('107', '2026-11-17', { state: '草稿' })]);
  assert.deepEqual(Array.from(read(dom.visibleWechatIdentity, base).names), ['TestAccount']);
  assert.equal(dom.wechatNumber(read(dom.visibleWechatFollowers, base)), 1234);
  assert.equal(dom.wechatNumber(read(dom.visibleWechatFollowers, doc([], [], '0'))), 0);
  for (const value of [null, '', '--', '昨日新增 2', '10%', '-1']) assert.equal(dom.wechatNumber(value), null);
  const hidden = doc(); hidden.children.find(c => c.innerText.startsWith('总用户数')).children.forEach(c => c.attrs.hidden = true);
  assert.equal(read(dom.visibleWechatFollowers, hidden), null);
  const ambiguousFans = doc(); ambiguousFans.children.push(metric('总粉丝数', '999'));
  assert.equal(read(dom.visibleWechatFollowers, ambiguousFans), null);
  const cards = read(dom.visibleWechatArticles, base);
  assert.deepEqual(dom.wechatMetrics(Array.from(cards[0].stats)), { views: 12000, likes: 0, comments: null, shares: 3, watching: 7 });
  assert.equal(dom.wechatMetrics([['阅读', '1'], ['阅读', '2']]).views, null);
  assert.equal(dom.wechatMetrics([['收藏', '20']]).watching, null);
  const table = el('table', { class: 'weui-desktop-table' }, '', [
    el('thead', {}, '', [el('tr', {}, '', ['标题', '分享', '阅读', '在看', '留言'].map(text => el('th', {}, text)))]),
    el('tbody', {}, '', [el('tr', { 'data-id': 'table1' }, '', [el('td', {}, '', [el('span', { 'data-field': 'title' }, '表格文章'), el('time', {}, '2026-11-17')]), ...['4', '1,001', '0', '--'].map(text => el('td', {}, text))])])]);
  const tableCard = read(dom.visibleWechatArticles, doc([table]))[0];
  assert.deepEqual(dom.wechatMetrics(Array.from(tableCard.stats)), { views: 1001, likes: null, comments: null, shares: 4, watching: 0 });
  const unsafe = article(null, '2026-11-17', { url: 'https://mp.weixin.qq.com/s?mid=123&idx=2&token=DO_NOT_RETURN' });
  const sanitized = read(dom.visibleWechatArticles, doc([unsafe]))[0];
  assert.equal(sanitized.id, '123_2'); assert.equal(sanitized.url, null);
  assert.ok(!JSON.stringify(sanitized).includes('DO_NOT_RETURN'));
  assert.equal(read(dom.visibleWechatArticles, doc([article(null, '2026-11-17', { url: 'https://evil.example/s/fake' })]))[0].id, null);
  assert.equal(read(dom.clickWechatSection, base, 'followers'), true);
  assert.equal(read(dom.clickWechatSection, base, 'publish'), false);
  assert.equal(read(dom.advanceWechatArticles, base), 'end');
  log('PASS 真实 DOM 函数：身份/隐藏和歧义粉丝/数值单位/明确0/缺项NULL；标签配对；安全文章ID与URL；只读菜单。');
  let writes = 0, closes = 0, waits = 0;
  const wait = async () => { waits++; };
  const fakeBrowser = document => async (_config, fn, platform) => {
    assert.equal(platform, 'wechat');
    try { return await fn({ goto: async url => assert.equal(url, 'https://mp.weixin.qq.com/'), evaluate: async (fn, ...args) => read(fn, document, ...args) }); }
    finally { closes++; }
  };
  const options = { withBrowser: fakeBrowser(base), wait, now: () => new Date('2026-11-17T16:30:00Z'), persist: async observation => { writes++; assert.equal(closes, writes + 3); return observation; } };
  assert.equal(wechatAccount({}), null);
  assert.throws(() => wechatAccount({ l1: { wechat: { account: ' x' } } }), /可见名称/);
  for (const names of [['Wrong'], [], ['TestAccount', 'Second']]) {
    await assert.rejects(collectWechat(config, '2026-11-17', { ...options, withBrowser: fakeBrowser(doc([], names)) }), /停止/);
    assert.equal(writes, 0); assert.equal(fs.existsSync(process.env.MAITIAN_DB), false);
  }
  const observation = await collectWechat(config, '2026-11-17', options);
  assert.deepEqual(observation.posts.map(p => p.id), ['101', '102']);
  const unconfigured = await collectWechat({}, '2026-11-17', { ...options, persist: async value => value });
  assert.equal(unconfigured.account, 'TestAccount');
  assert.equal(observation.posts[0].favorites, null); assert.equal(observation.source, 'wechat-visible-dom'); assert.ok(waits > 0);
  let identityReads = 0;
  await assert.rejects(collectWechat(config, '2026-11-17', { ...options, withBrowser: async (_c, fn) => fn({ goto: async () => {}, evaluate: async (fn, ...args) => {
    if (fn === dom.visibleWechatIdentity && ++identityReads >= 4) return { names: ['Wrong'], trustedOrigin: true };
    return read(fn, base, ...args);
  } }) }), /不符/);
  assert.equal(writes, 1);
  const pages = [doc([article('pinned', '2026-01-01'), article('page1')]), doc([article('page2')])];
  let pageIndex = 0;
  const paged = await collectWechat(config, '2026-11-17', { ...options, persist: async value => value, withBrowser: async (_config, fn) => fn({ goto: async () => {}, evaluate: async (fn, ...args) => {
    if (fn === dom.advanceWechatArticles) return pageIndex++ === 0 ? 'next' : 'end';
    return read(fn, pages[Math.min(pageIndex, 1)], ...args);
  } }) });
  assert.deepEqual(paged.posts.map(p => p.id), ['page1', 'page2']);
  await assert.rejects(assertWechatAccount({ evaluate: async () => ({ names: ['TestAccount'], trustedOrigin: false }) }, 'TestAccount', wait), /来源/);
  const noEnd = doc([article('101')]); noEnd.children.pop(); noEnd.scrollingElement = { scrollTop: 0, scrollHeight: 800 };
  await assert.rejects(collectWechat(config, '2026-11-17', { ...options, withBrowser: fakeBrowser(noEnd) }), /未确认完成/); assert.equal(writes, 1);
  log('PASS 采集：错号/未知/歧义/换号均零落库；关闭后持久化；--date自然日边界/旧置顶/未知日期；不确认末页则失败。');
  const settings = browserSettings(config, 'wechat'); assert.equal(settings.port, 9342); assert.equal(settings.profile, path.join(folder, 'chrome-profile-l1-wechat'));
  for (const port of [9333, 9334, 9335, 9336, 9340, 9341, 9343]) assert.throws(() => browserSettings({ ...config, l1: { wechat: { chromePort: port } } }, 'wechat'));
  assert.throws(() => browserSettings({ ...config, l1: { wechat: { chromeProfile: 'relative-profile' } } }, 'wechat'));
  assert.equal(browserSettings({...config,l1:{wechat:{chromeProfile:path.join(folder,'dedicated-custom')}}},'wechat').profile,path.join(folder,'dedicated-custom'));
  for (const url of ['https://mp.weixin.qq.com/', 'https://mp.weixin.qq.com']) assert.equal(allowedPage(url, 'wechat'), true);
  for (const url of ['http://mp.weixin.qq.com/', 'https://mp.weixin.qq.com:443/', 'https://mp.weixin.qq.com/?', 'https://mp.weixin.qq.com/#', 'https://mp.weixin.qq.com/?token=x', 'https://u:p@mp.weixin.qq.com/', 'https://mp.weixin.qq.com.evil/', 'https://mp.weixin.qq.com/cgi-bin/appmsg', 'https://x.com/', 'https://creator.xiaohongshu.com/']) assert.equal(allowedPage(url, 'wechat'), false);
  const args = [`--user-data-dir=${settings.profile}`, '--remote-debugging-port=9342', '--remote-debugging-address=127.0.0.1'];
  assertBrowserOwner(args, [{ type: 'browser', id: 12 }], settings, 12);
  assert.throws(() => assertBrowserOwner(args, [{ type: 'browser', id: 13 }], settings, 12));
  for (let i = 0; i < args.length; i++) assert.throws(() => assertBrowserOwner(args.filter((_, n) => n !== i), [{ type: 'browser', id: 12 }], settings, 12));
  assert.throws(() => assertBrowserOwner([...args, '--remote-debugging-port=9333'], [{ type: 'browser', id: 12 }], settings, 12));
  log('PASS 9342/专用profile/127.0.0.1/PID隔离；拒绝全局配置继承与敏感导航URL；未启动任何真实进程。');
  for (const scenario of ['success', 'callback-error', 'owner-error', 'occupied', 'sigint']) {
    const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--browser-child', scenario], { env: process.env, encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, scenario === 'sigint' ? 130 : 0, result.error?.message || result.stderr || result.stdout);
    const state = JSON.parse(result.stdout.trim());
    assert.equal(state.launches, scenario === 'occupied' ? 0 : 1);
    assert.equal(state.browserCloses, ['success', 'callback-error', 'sigint'].includes(scenario) ? 1 : 0);
    assert.equal(state.kills, scenario === 'owner-error' ? 1 : 0);
    assert.equal(state.exited, scenario !== 'occupied');
  }
  log('PASS 真实withL1Browser + 假进程/CDP：占用即拒绝；成功、异常、归属失败、Ctrl+C均只清理本次PID；可见窗口参数与loopback端点。');
  const loader = path.join(folder, 'route.mjs');
  fs.writeFileSync(loader, `import { registerHooks } from 'node:module'; registerHooks({load(url, ctx, next) {
    if (/\\/(?:db|l1-store|l1-browser|l1-x|l1-xhs)\\.mjs$/.test(url)) throw new Error('禁止浏览器/X/小红书/数据库');
    if(url.endsWith('/l1-wechat.mjs')) return {format:'module',shortCircuit:true,source:"export async function collectWechat(c,d){console.log('WECHAT '+d)}; export async function loginWechat(){console.log('LOGIN')}"};
    if(url.endsWith('/local-report.mjs')) return {format:'module',shortCircuit:true,source:"export async function writeLocalReport(){console.log('REPORT')}"};
    return next(url,ctx); }});`);
  for (const [args, status, match] of [[['--only', 'wechat', '--date', '2026-11-17'], 0, /WECHAT 2026-11-17[\s\S]*REPORT/], [['--login-wechat', '--wait-login'], 0, /LOGIN/], [['--only', 'wechat', '--import-x', 'x.json'], 1, /不能导入 X/], [['--wait-login'], 1, /必须与/], [['--only', 'bad'], 1, /仅允许/]]) {
    const result = spawnSync(process.execPath, ['--import', pathToFileURL(loader).href, 'scripts/l1-run.mjs', ...args], { cwd: root, env: process.env, encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, status, result.stderr); assert.match(result.stdout + result.stderr, match);
  }
  assert.equal(fs.existsSync(process.env.MAITIAN_DB), false);
  log('PASS 实际CLI分流：--only wechat / --login-wechat；禁止导入X和错误参数；无其他平台、配置或数据库副作用。');
  store = await import('../src/l1-store.mjs');
  const first = { ...observation, captured_at: '2026-11-17T08:00:00Z', posts: [observation.posts[0]] };
  store.transaction(() => store.saveObservation(first)); store.transaction(() => store.saveObservation(first));
  const eid = 'external:wechat:101';
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM episodes').get().n, 1);
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM tasks').get().n, 1);
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM samples').get().n, 1);
  let row = store.db.prepare('SELECT * FROM metrics').get(); assert.equal(row.likes, 0); assert.equal(row.comments, null); assert.equal(row.favorites, null);
  assert.equal(JSON.parse(row.extra).watching, 7); assert.equal(JSON.parse(row.extra).field_observed_at.watching, first.captured_at);
  const snapshot = JSON.parse(store.db.prepare('SELECT project FROM snapshots').get().project);
  assert.equal(snapshot.appmsgId, '101'); assert.equal(snapshot.account, 'TestAccount'); assert.equal(snapshot.platforms.wechat.title, '测试标题');
  const later = { ...first, captured_at: '2026-11-18T08:00:00Z', followers: null, posts: [{ ...first.posts[0], views: null, likes: null, watching: null }] };
  store.transaction(() => store.saveObservation(later)); store.transaction(() => store.saveObservation(first));
  row = store.db.prepare("SELECT * FROM metrics WHERE day='2026-11-18'").get(); assert.equal(row.views, 12000); assert.equal(JSON.parse(row.extra).watching, 7); assert.equal(JSON.parse(row.extra).field_observed_at.views, first.captured_at);
  store.transaction(() => store.saveObservation({ ...later, captured_at: '2026-11-18T09:00:00Z', posts: [{ ...later.posts[0], watching: 0 }] }));
  row = store.db.prepare("SELECT * FROM metrics WHERE day='2026-11-18'").get(); assert.equal(JSON.parse(row.extra).watching, 0);
  assert.equal(store.db.prepare('SELECT gain FROM followers').get().gain, null);
  assert.throws(() => store.transaction(() => store.saveObservation({ ...later, account: 'Wrong' })), /其他账号/);
  assert.throws(() => store.transaction(() => store.saveObservation({ ...later, posts: [{ ...later.posts[0], url: 'https://mp.weixin.qq.com/?token=secret' }] })), /不安全/);
  store.transaction(() => store.saveObservation({ ...later, posts: [{ ...later.posts[0], id: 'no-url', url: null, watching: null }] }));
  assert.equal(JSON.parse(store.db.prepare("SELECT project FROM snapshots WHERE episode_id='external:wechat:no-url'").get().project).platforms.wechat.url, null);
  const { writeLocalReport } = await import('../src/local-report.mjs');
  await writeLocalReport({ date: '2026-11-18' });
  const report = fs.readFileSync(path.join(folder, 'reports/latest.md'), 'utf8');
  assert.match(report, /公众号 TestAccount/); assert.match(report, /wechat-visible-dom/); assert.match(report, /在看/); assert.match(report, /较上次实测新增：暂无/); assert.match(report, /保留历史非空字段/);
  const { overviewData, episodeView, handle } = await import('../src/web.mjs');
  assert.equal(overviewData().episodes[0].tasks[0].name, '公众号');
  assert.equal(episodeView(store.db.prepare('SELECT * FROM episodes WHERE id=?').get(eid), true).tasks[0].m.extra.watching, 0);
  const server = http.createServer((req, res) => handle(req, res).catch(error => { res.writeHead(500); res.end(error.message); }));
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    for (const route of ['/api/overview', `/api/episode?id=${encodeURIComponent(eid)}`]) {
      const response = await new Promise((resolve, reject) => http.get({ host: '127.0.0.1', port: server.address().port, path: route }, res => {
        let body = ''; res.setEncoding('utf8'); res.on('data', chunk => body += chunk); res.on('end', () => resolve({ status: res.statusCode, body }));
      }).on('error', reject));
      assert.equal(response.status, 200, response.body); assert.match(response.body, /wechat/); JSON.parse(response.body);
    }
  } finally { await new Promise(resolve => server.close(resolve)); }
  const ui = vm.createContext({ document: { createElement: () => ({ style: {} }), addEventListener() {} }, URLSearchParams });
  vm.runInContext(fs.readFileSync(path.join(root, 'src/web/mt.js'), 'utf8'), ui);
  assert.equal(vm.runInContext("PN.wechat === '公众号' && PL.indexOf('wechat') === PL.indexOf('xhs') + 1", ui), true);
  assert.match(vm.runInContext("logo('wechat')", ui), /<svg viewBox="0 0 24 24">/);
  const elements = new Map();
  const element = key => { if (!elements.has(key)) elements.set(key, { innerHTML: '', querySelector() { return null; }, classList: { add() {}, remove() {} } }); return elements.get(key); };
  const board = vm.createContext({ URLSearchParams, location: { search: '' }, innerWidth: 1000,
    document: { body: element('body'), hidden: true, querySelector: element, addEventListener() {} },
    setInterval() {}, setTimeout() {}, fetch() { return new Promise(() => {}); }, matchMedia() { return { matches: true }; }, addEventListener() {}, window: { addEventListener() {} } });
  vm.runInContext(fs.readFileSync(path.join(root, 'src/web/health.js'), 'utf8'), board);
  vm.runInContext(fs.readFileSync(path.join(root, 'src/web/board.html'), 'utf8').match(/<script>([\s\S]*?)<\/script>/)[1], board);
  board.input = overviewData();
  vm.runInContext("O = { ...input, health: { login: {} }, actions: [] }; draw = () => {}; render();", board);
  assert.match(elements.get('#screen').innerHTML, /公众号/); assert.ok(!elements.get('#screen').innerHTML.includes('undefined'));
  log('PASS 临时SQLite：episode/task/snapshot/sample幂等，appmsgId与platforms.wechat；NULL合并/字段时间/旧观测保护/在看0/跨账号回滚；日报与overview/detail/UI模板。');
  log('L1 WECHAT SELFTEST PASS；未连接9333–9336/9340/9341/9342，未访问正式hub.db、config.json或Chrome profile。');
} catch (error) { log(`L1 WECHAT SELFTEST FAIL: ${error.stack}`); process.exitCode = 1; }
finally { store?.db.close(); fs.writeFileSync(path.join(root, '_l1-selftest-wechat-output.txt'), output.join('\n') + '\n'); }

async function browserChild() {
  const scenario = process.argv[3], state = { launches: 0, browserCloses: 0, kills: 0, exited: false };
  const child = new EventEmitter(); child.pid = 12345;
  let launchArgs;
  const nativeTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (fn, ms, ...args) => nativeTimeout(fn, Math.min(ms, 5), ...args);
  globalThis.__browserFake = {
    fs: { existsSync: () => true, mkdirSync() {} },
    net: { createServer() {
      const server = new EventEmitter();
      server.listen = (options, ready) => { assert.equal(options.host, '127.0.0.1'); assert.equal(options.port, 9342); queueMicrotask(() => scenario === 'occupied' ? server.emit('error', new Error('occupied')) : ready()); };
      server.close = ready => ready(); return server;
    } },
    spawn(binary, args, options) {
      if (binary === 'taskkill.exe') {
        assert.deepEqual(args, ['/PID', '12345', '/T', '/F']); assert.equal(options.windowsHide, true); state.kills++;
        const killer = new EventEmitter(); queueMicrotask(() => { state.exited = true; child.emit('exit', 0); killer.emit('exit', 0); }); return killer;
      }
      assert.equal(binary, process.execPath); assert.equal(options.windowsHide, false);
      assert.ok(!args.some(arg => arg.startsWith('--headless')));
      launchArgs = args; state.launches++; return child;
    },
  };
  registerHooks({ resolve(specifier, context, next) {
    if (['node:fs', 'node:net', 'node:child_process'].includes(specifier)) return { url: `l1-fake:${specifier.slice(5)}`, shortCircuit: true };
    return next(specifier, context);
  }, load(url, context, next) {
    if (url === 'l1-fake:fs') return { format: 'module', shortCircuit: true, source: 'export default globalThis.__browserFake.fs;' };
    if (url === 'l1-fake:net') return { format: 'module', shortCircuit: true, source: 'export default globalThis.__browserFake.net;' };
    if (url === 'l1-fake:child_process') return { format: 'module', shortCircuit: true, source: 'export const spawn = globalThis.__browserFake.spawn;' };
    return next(url, context);
  } });
  globalThis.fetch = async url => { assert.equal(url, 'http://127.0.0.1:9342/json/version'); return { ok: true, json: async () => ({ webSocketDebuggerUrl: 'ws://127.0.0.1:9342/devtools/browser/fake' }) }; };
  globalThis.WebSocket = class {
    static OPEN = 1;
    constructor(url) { assert.equal(String(url), 'ws://127.0.0.1:9342/devtools/browser/fake'); this.readyState = 1; queueMicrotask(() => this.onopen()); }
    send(data) {
      const { id, method } = JSON.parse(data);
      const result = method === 'Browser.getBrowserCommandLine' ? { arguments: launchArgs } : method === 'SystemInfo.getProcessInfo' ? { processInfo: [{ type: 'browser', id: scenario === 'owner-error' ? 999 : child.pid }] } : method === 'Target.createTarget' ? { targetId: 'fake' } : method === 'Target.attachToTarget' ? { sessionId: 'fake' } : {};
      queueMicrotask(() => { this.onmessage({ data: JSON.stringify({ id, result }) }); if (method === 'Browser.close') { state.browserCloses++; state.exited = true; child.emit('exit', 0); } });
    }
    close() { this.readyState = 3; this.onclose?.(); }
  };
  process.once('exit', () => console.log(JSON.stringify(state)));
  const { withL1Browser } = await import('../src/l1-browser.mjs');
  try {
    await withL1Browser({ chromeBinary: process.execPath }, async () => {
      if (scenario === 'sigint') { process.emit('SIGINT'); await new Promise(() => {}); }
      if (scenario === 'callback-error') throw new Error('callback failure');
    }, 'wechat');
    assert.equal(scenario, 'success');
  } catch (error) {
    assert.match(error.message, { 'callback-error': /callback failure/, 'owner-error': /归属校验失败/, occupied: /已被占用/ }[scenario] || /unexpected/);
  }
}
