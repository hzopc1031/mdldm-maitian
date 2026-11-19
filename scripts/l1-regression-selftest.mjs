// 两个 L1 回归问题的离线验收：临时库、显式配置，无浏览器或外部网络。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import http from 'node:http';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'maitian-l1-regression-'));
process.env.MAITIAN_HOME = folder;
fs.writeFileSync(path.join(folder,'l1-accounts.local.json'),JSON.stringify({x:'PeanutPair',xhs:'TwoPeanuts'}));
process.env.MAITIAN_DB = path.join(folder, 'hub.db');
process.env.MAITIAN_CONFIG = path.join(folder, 'config.json');
fs.writeFileSync(process.env.MAITIAN_CONFIG, JSON.stringify({ rootPath: folder, web: { requireLocalToken: false } }));
globalThis.fetch = () => { throw new Error('离线自测禁止网络请求'); };
const { importX } = await import('./import-x-public.mjs');
const { db } = await import('../src/l1-store.mjs');
const { writeLocalReport } = await import('../src/local-report.mjs');
const { episodeView, overviewData, episodeFile, coverFile, feed, handle } = await import('../src/web.mjs');
const fixture = JSON.parse(fs.readFileSync(path.join(root, 'examples/x-sample.json'), 'utf8'));
const inputFile = path.join(folder, 'input.json'), reportDir = path.join(folder, 'reports');
const eid = 'external:x:sample-001';
const snapshot = () => JSON.parse(db.prepare('SELECT project FROM snapshots WHERE episode_id=?').get(eid).project);
async function checkExample(input, expected, options = {}) {
  fs.writeFileSync(inputFile, JSON.stringify(input));
  await importX(inputFile, options);
  await writeLocalReport({ date: '2026-11-17', reportDir });
  assert.equal(snapshot().example, expected);
  for (const row of db.prepare('SELECT extra FROM metrics').all()) assert.equal(JSON.parse(row.extra).example, expected);
  for (const row of db.prepare("SELECT value FROM meta WHERE key LIKE 'l1:followers:x:%'").all()) assert.equal(JSON.parse(row.value).example, expected);
  const report = fs.readFileSync(path.join(reportDir, 'latest.md'), 'utf8');
  assert.equal(report.includes('**示例 / 假数据'), expected);
}
try {
  // 没有 example 的最小真实输入，正文同时含有原来会误伤的两个词。
  const real = { ...fixture, posts: [{ ...fixture.posts[0], text: '讲解示例代码，如何识别假数据' }] };
  delete real.example;
  await checkExample(real, false);
  await checkExample({ ...real, example: 'true' }, false);
  await checkExample(real, true, { example: true });
  await checkExample({ ...fixture, posts: [fixture.posts[0]] }, true);
  await checkExample(real, false);
  const project = snapshot();
  assert.equal(project.platforms.x.id, 'sample-001');
  assert.equal(project.platforms.x.url, real.posts[0].url);
  assert.equal(project.platforms.x.title, real.posts[0].text);
  console.log('PASS 正文不推断示例；仅顶层/调用方 example:true 标记示例；示例日报和 platforms.x 正确。');

  // 模拟升级前的快照：缺 platforms/covers，dir 分别为空和 NULL。
  delete project.platforms;
  db.prepare('UPDATE snapshots SET project=? WHERE episode_id=?').run(JSON.stringify(project), eid);
  db.prepare('INSERT INTO logs (ts,episode_id,platform,action,result) VALUES (?,?,?,?,?)').run(real.captured_at, eid, 'x', 'observe', 'published');
  fs.writeFileSync(path.join(folder, 'publish.json'), JSON.stringify({ platforms: { x: { title: '不该读取当前目录' } }, covers: { '4x3': 'cover.jpg' } }));
  fs.writeFileSync(path.join(folder, 'cover.jpg'), 'test');
  const cwd = process.cwd();
  process.chdir(folder);
  try {
    for (const dir of ['', null]) {
      db.prepare('UPDATE episodes SET dir=? WHERE id=?').run(dir, eid);
      const ep = db.prepare('SELECT * FROM episodes WHERE id=?').get(eid);
      const view = episodeView(ep, true);
      assert.equal(view.episode, null);
      assert.equal(view.tasks[0].copy.body, real.posts[0].text);
      assert.equal(view.tasks[0].m.views, 456);
      assert.equal(view.tasks[0].shot, false);
      assert.deepEqual(view.covers, []);
      assert.deepEqual(view.files, []);
      assert.equal(episodeFile(ep, 'cover.jpg'), null);
      assert.equal(coverFile(ep), null);
      assert.equal(overviewData().episodes.length, 1);
      assert.equal(feed()[0].nick, view.nick);
    }
  } finally { process.chdir(cwd); }
  // 空目录不能使日志、封面或小组件路径回退到仓库根目录。
  assert.equal(coverFile(undefined), null);
  assert.equal(episodeFile({ dir: folder }, '../cover.jpg'), null);
  assert.equal(episodeFile({ dir: folder }, 'cover.jpg'), path.join(folder, 'cover.jpg'));
  console.log('PASS 旧快照无 platforms/封面/dir、NULL 期数：overview/feed/detail 安全；封面返回缺失。');

  const server = http.createServer((req,res) => handle(req,res).catch(error => { res.writeHead(500); res.end(error.message); }));
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const request = route => new Promise((resolve,reject) => {
    http.get({ host: '127.0.0.1', port: server.address().port, path: route }, res => {
      let body = ''; res.setEncoding('utf8'); res.on('data', chunk => body += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body }));
    }).on('error', reject);
  });
  try {
    for (const route of ['/api/overview', `/api/episode?id=${eid}`]) {
      const res = await request(route); assert.equal(res.status, 200, res.body); JSON.parse(res.body);
    }
    for (const route of [`/cover?id=${eid}`, `/shot?id=${eid}&p=x`]) assert.equal((await request(route)).status, 404);
  } finally { await new Promise(resolve => server.close(resolve)); }
  console.log('PASS 临时本机 HTTP：overview/detail=200，无封面/截图=404；浏览器健康请求已离线拦截。');

  // NULL 期数按真实发布时间排序；未知日期使用观测时间。
  const second = { ...real, posts: [{ ...real.posts[0], id: 'newer', url: 'https://x.com/PeanutPair/status/newer', created_at: '2026-11-17T00:00:00Z' }] };
  fs.writeFileSync(inputFile, JSON.stringify(second)); await importX(inputFile);
  assert.equal(overviewData().episodes[0].id, 'external:x:newer');
  second.posts[0].created_at = null; second.captured_at = '2026-11-17T02:30:00Z';
  second.posts[0].id = 'unknown'; second.posts[0].url = 'https://x.com/PeanutPair/status/unknown';
  fs.writeFileSync(inputFile, JSON.stringify(second)); await importX(inputFile);
  const overview = overviewData();
  assert.equal(overview.episodes[0].id, 'external:x:unknown');
  assert.equal(overview.episodes[0].publishedAt, null);
  assert.equal(overview.episodes[0].observedAt, second.captured_at.replace('Z', '.000Z'));

  // 不使用浏览器，执行大屏模板，验证无封面作品仍能渲染并进入轮播。
  const board = fs.readFileSync(path.join(root, 'src/web/board.html'), 'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
  const elements = new Map();
  const element = key => { if (!elements.has(key)) elements.set(key, { innerHTML: '', querySelector() { return null; }, classList: { add() {}, remove() {} } }); return elements.get(key); };
  const context = vm.createContext({
    console, URLSearchParams, location: { search: '' }, innerWidth: 1000,
    document: { body: element('body'), hidden: true, querySelector: element, addEventListener() {} },
    setInterval() {}, setTimeout() {}, fetch() { return new Promise(() => {}); },
    matchMedia() { return { matches: true }; }, addEventListener() {}, window: { addEventListener() {} }
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'src/web/health.js'), 'utf8'), context);
  vm.runInContext(board, context);
  context.input = overview;
  vm.runInContext("O = { ...input, health: { login: {} }, actions: [] }; draw = () => {}; render();", context);
  assert.match(elements.get('#screen').innerHTML, /讲解示例代码/);
  assert.ok(vm.runInContext('SL.length > 0 && SL.every(e => e.episode == null)', context));
  assert.equal(vm.runInContext('timeOf(O.episodes[0])', context), overview.episodes[0].observedAt);
  const pages = fs.readFileSync(path.join(root, 'src/web/pages.html'), 'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
  new vm.Script(pages);
  console.log('PASS NULL 期数按发布时间/观测时间排序；大屏模板可渲染导入帖；页面脚本语法正确。');
  console.log(`L1 REGRESSION PASS；临时目录=${folder}`);
} finally { db.close(); }
