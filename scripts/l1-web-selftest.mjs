// 第一方离线验收：临时 SQLite/配置，HTTP 仅 loopback，子进程完全 mock。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import vm from 'node:vm';
import { EventEmitter, once } from 'node:events';
import { registerHooks } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'maitian-l1-web-'));
const key = 'offline-test-key', widgetToken = 'offline-widget-token';
process.env.MAITIAN_HOME = folder;
process.env.MAITIAN_DB = path.join(folder, 'hub.db');
process.env.MAITIAN_CONFIG = path.join(folder, 'config.json');
process.env.MAITIAN_LOCAL_SKILLS = path.join(folder, 'skills');
for (const name of ['xhs','wechat']) {
  const dir = path.join(process.env.MAITIAN_LOCAL_SKILLS, `${name === 'xhs' ? 'xhs' : 'wechat'}-publish`, 'scripts');
  fs.mkdirSync(dir, {recursive:true}); fs.writeFileSync(path.join(dir, `${name}.mjs`), "// offline mock opts['keep-browser']");
}
fs.writeFileSync(process.env.MAITIAN_CONFIG, JSON.stringify({ xHandle:'PeanutPair', publishPrep:{browserExecution:false}, l1:{x:{browserExecution:false},wechat:{browserExecution:false},xhs:{account:'TwoPeanuts',browserExecution:false}}, web: { key, widgetToken }, keepAlive: ['channels'] }));
// 跑真实 CLI 的成功/失败退出路径；替换全部采集器和报告写入，禁止浏览器/旧 hub 模块。
const loader = path.join(folder, 'cli-mock.mjs');
fs.writeFileSync(loader, `import { registerHooks } from 'node:module';
  registerHooks({ load(url, context, next) {
    const name = /\\/l1-(x|xhs|wechat)\\.mjs$/.exec(url)?.[1];
    if (name) return { format: 'module', shortCircuit: true,
      source: 'export async function collect' + ({ x: 'X', xhs: 'Xhs', wechat: 'Wechat' }[name]) + '() { if (process.env.L1_WEB_CLI_FAIL) throw new Error("mock-collection-failure"); console.log("COLLECT ' + name + '"); }' };
    if (url.endsWith('/local-report.mjs')) return { format: 'module', shortCircuit: true, source: 'export async function writeLocalReport() { console.log("MOCK_REPORT"); }' };
    if (/\\/(hub|driver|l1-browser|l1-store)\\.mjs$/.test(url)) throw new Error('forbidden module');
    return next(url, context);
  } });`);
for (const platform of ['x', 'xhs', 'wechat']) {
  for (const fail of ['', '1']) {
    const result = spawnSync(process.execPath, ['--import', pathToFileURL(loader).href, 'scripts/l1-run.mjs', '--only', platform, '--date', '2026-11-17'],
      { cwd: root, env: { ...process.env, L1_WEB_CLI_FAIL: fail }, encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, fail ? 1 : 0, result.stderr);
    assert.equal(result.stdout.includes('MOCK_REPORT'), !fail);
    assert.match(result.stdout + result.stderr, fail ? /mock-collection-failure/ : new RegExp(`COLLECT ${platform}`));
  }
}
globalThis.fetch = () => { throw new Error('禁止浏览器探测 / 外部网络'); };
globalThis.WebSocket = class { constructor() { throw new Error('禁止 CDP'); } };
const children = [];
let throwSpawn = false;
globalThis.__l1WebSpawn = (binary, args, options) => {
  if (throwSpawn) throw new Error(`spawn failed key=${key}`);
  const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
  children.push({ binary, args, options, child }); return child;
};
registerHooks({ resolve(specifier, context, next) {
  if (specifier === 'node:child_process') return { url: 'mock:l1-child-process', shortCircuit: true };
  return next(specifier, context);
}, load(url, context, next) {
  if (url === 'mock:l1-child-process') return { format: 'module', shortCircuit: true,
    source: 'export const spawn = globalThis.__l1WebSpawn; export function execFileSync() { throw new Error("禁止外部程序"); }' };
  if (/\/(hub|driver|chrome-shim|bridge|l1-browser)\.mjs$/.test(url)) throw new Error(`禁止旧入口或浏览器模块 ${url}`);
  return next(url, context);
} });
await import('../src/l1-store.mjs'); // 与 L1 初始化一致，建立 followers 表。
const { handle, overviewData } = await import('../src/web.mjs');
const { db } = await import('../src/db.mjs');
const { planL1Action, redactL1 } = await import('../src/l1-web.mjs');
db.prepare('INSERT INTO meta (key,value) VALUES (?,?)').run('doctorDay', 'legacy-day');
db.prepare('INSERT INTO meta (key,value) VALUES (?,?)').run('login:channels', 'ok');
const server = http.createServer((req, res) => handle(req, res).catch(error => { res.writeHead(500); res.end(error.message); }));
server.listen(0, '127.0.0.1'); await once(server, 'listening');
function request(route, { action, auth = true, headers = {}, raw } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: server.address().port, path: route,
      method: action !== undefined || raw !== undefined ? 'POST' : 'GET',
      headers: { ...(auth ? { 'x-maitian-key': key } : {}), 'content-type': 'application/json', ...headers } }, res => {
      let body = ''; res.setEncoding('utf8'); res.on('data', data => body += data);
      res.on('end', () => resolve({ code: res.statusCode, headers:res.headers, body, json: () => JSON.parse(body) }));
    }); req.on('error', reject); req.end(raw ?? (action === undefined ? undefined : JSON.stringify(action)));
  });
}
const post = action => request('/api/action', { action });
try {
  assert.equal((await request('/api/overview', { auth: false })).code, 401);
  assert.equal((await post({ type: 'status', platform: 'x' })).code, 200);
  assert.equal(children.length, 0);
  const health = (await request('/api/overview')).json().health;
  assert.equal(health.mode, 'l1'); assert.equal(health.daemon, false);
  assert.equal(health.doctorDay, undefined); assert.equal(health.login, undefined);
  for (const [platform, port] of Object.entries({ x: 9341, xhs: 9340, wechat: 9342 })) {
    assert.equal(health.platforms[platform].port, port);
    assert.equal(health.platforms[platform].profile, path.join(folder, `chrome-profile-l1-${platform}`));
    assert.deepEqual(planL1Action({ type: 'login', platform }), [`--login-${platform}`, '--wait-login']);
    for (const type of ['login', 'collect']) {
      const action = { type, platform, ...(type === 'collect' ? { date: '2026-11-17' } : {}) };
      assert.equal((await post(action)).code, 200);
      const { args, options, child } = children.at(-1);
      assert.deepEqual(args, [path.join(root, 'scripts', 'l1-run.mjs'), ...planL1Action(action)]);
      assert.equal(options.shell, false); assert.equal(options.stdio[0], 'ignore');
      assert.equal((await post({ type: 'collect', platform })).code, 409);
      const running = (await request('/api/l1/status')).json();
      assert.equal(running.platforms[platform].state, 'running');
      child.stdout.emit('data', 'some key=offline-'); child.stdout.emit('data', 'test-key\n');
      child.stderr.emit('data', 'https://mp.weixin.qq.com/cgi-bin/home?token=secret-query#fragment\nCookie: session=secret-cookie\n');
      assert.equal(JSON.stringify((await request('/api/l1/status')).json()).includes('secret-cookie'), false);
      child.emit('close', type === 'login' ? 0 : 7, null);
      const last = (await request('/api/l1/status')).json().platforms[platform].last;
      assert.equal(last.done, true); assert.equal(last.ok, type === 'login');
      assert.equal(last.code, type === 'login' ? 0 : 7);
      for (const secret of [key, widgetToken, 'secret-cookie', 'secret-query', 'fragment']) assert.equal(JSON.stringify(last).includes(secret), false);
      if (type === 'collect') assert.ok(last.error);
    }
  }
  for (const action of [null, [], { type: 'metrics' }, { type: 'doctor' }, { type: 'followers' }, { type: 'sync', id: 'a' },
    { type: 'submit', platform: 'x' }, { type: 'login', platform: 'youtube' }, { type: 'collect', platform: 'x;whoami' },
    { type: 'collect', platform: 'x', date: '2026-02-30' }, { type: 'collect', platform: 'x', date: '--submit' },
    { type: 'login', platform: 'wechat', url: 'https://evil.test' }, { type: 'collect', platform: 'xhs', argv: ['--force'] }]) {
    assert.equal((await post(action)).code, 400);
  }
  const count = children.length;
  assert.equal((await request('/api/action', { raw: 'invalid' })).code, 400);
  assert.equal((await request('/api/action', { raw: 'x'.repeat(5000) })).code, 413);
  assert.equal((await request('/api/action', { action: { type: 'login', platform: 'x' }, auth: false })).code, 401);
  assert.equal((await request('/api/action', { action: { type: 'login', platform: 'x' }, headers: { origin: 'https://evil.test' } })).code, 403);
  assert.equal(children.length, count);
  throwSpawn = true;
  const failed = await post({ type: 'login', platform: 'x' });
  assert.equal(failed.code, 500); assert.equal(failed.body.includes(key), false);
  throwSpawn = false;
  await post({ type: 'collect', platform: 'x' });
  children.at(-1).child.emit('error', new Error('ENOENT fake-launch-error'));
  children.at(-1).child.emit('close', 0);
  assert.equal((await request('/api/l1/status')).json().platforms.x.last.ok, false);
  assert.match((await request('/api/l1/status')).json().platforms.x.last.error, /ENOENT/);
  assert.match(db.prepare('SELECT value FROM meta WHERE key=?').get('l1:web:x').value, /ENOENT/);
  assert.equal(db.prepare('SELECT value FROM meta WHERE key=?').get('login:channels').value, 'ok');
  assert.equal(redactL1('token=secret key=secret Cookie: secret').includes('secret'), false);

  // 新发布准备 API：执行真实 HTTP 路由，子进程全部替身；不运行第三方 skill。
  assert.equal((await request('/api/prep', {auth:false})).code,401);
  const createX = await request('/api/prep', {action:{type:'create',input:{platform:'x',content:'offline draft only',test:true}}});
  assert.equal(createX.code,200); const prepId = createX.json().record.id;
  const job = (await request('/api/prep/job?id=' + prepId)).json(); assert.equal(job.submit,false);
  const intent = await request('/api/prep/x?id=' + prepId); assert.equal(intent.code,303);
  assert.match(intent.headers.location,/^https:\/\/twitter.com\/intent\/tweet\?text=/);
  assert.equal((await request('/api/prep', {action:{type:'submit',id:prepId}})).code,400);
  assert.equal((await request('/api/prep', {action:{type:'execute',id:prepId}})).code,400);
  const beforeGate = children.length;
  for (const type of ['doctor','sync']) assert.equal((await post({type,platform:'x',...(type === 'sync' ? {id:'no-episode'} : {})})).code,409);
  assert.equal(children.length,beforeGate);
  const draft = await request('/api/prep',{action:{type:'create',input:{platform:'wechat',title:'offline test',content:'mock only'}}});
  const draftId = draft.json().record.id;
  assert.equal((await request('/api/prep',{action:{type:'execute',id:draftId}})).code,400);
  assert.equal(children.length,beforeGate);
  assert.equal((await request('/api/prep',{action:{type:'check',id:draftId}})).code,200);
  assert.match(children.at(-1).args[0],/wechat\.mjs$/); assert.equal(children.at(-1).args[1],'check');
  assert.equal((await post({type:'collect',platform:'x'})).code,409);
  children.at(-1).child.stdout.emit('data',JSON.stringify({ok:true,offline:true})); children.at(-1).child.emit('close',0);
  assert.equal((await request('/api/prep')).json().records.find(r=>r.id===draftId).state,'checked');
  assert.equal((await request('/api/prep',{action:{type:'create',input:{platform:'x',content:'bad',submit:true}}})).code,400);
  assert.equal((await request('/api/prep',{action:{type:'create',input:{platform:'x',content:'bad'}},headers:{origin:'https://evil.test'}})).code,403);

  // 执行真实页面模板，核验空数据、系统控制和持久化失败记录均可渲染。
  const elements = new Map();
  const element = key => { if (!elements.has(key)) elements.set(key, { innerHTML: '', style: {}, append() {} }); return elements.get(key); };
  const context = vm.createContext({ console, URLSearchParams, location: { hash: '#/system', search: '' },
    document: { hidden: true, body: element('body'), querySelector: element, createElement: () => element('new'), addEventListener() {} },
    fetch() { return new Promise(() => {}); }, setInterval() {}, clearInterval() {}, setTimeout() {}, addEventListener() {}, scrollTo() {} });
  vm.runInContext(fs.readFileSync(path.join(root, 'src/web/mt.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(root, 'src/web/health.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(root, 'src/web/pages.html'), 'utf8').match(/<script>([\s\S]*?)<\/script>/)[1], context);
  vm.runInContext(fs.readFileSync(path.join(root, 'src/web/publish-prep.js'), 'utf8'), context);
  context.input = (await request('/api/overview')).json();
  vm.runInContext('O = input; F = {};', context);
  const html = vm.runInContext('vSystem()', context);
  assert.match(html, /PeanutPair/); assert.match(html, /TwoPeanuts/); assert.match(html, /ENOENT/);
  assert.equal((html.match(/>登录 \/ 校验<\/button>/g) || []).length, 3);
  assert.equal((html.match(/>采集数据<\/button>/g) || []).length, 3);
  assert.match(html, /手动操作/); assert.match(html, /最近动态/); assert.match(html, /平台登录与校验/);
  assert.ok(html.indexOf('手动操作') < html.indexOf('平台登录与校验'));
  for (const capability of ['采流量', '采粉丝']) for (const name of ['X', '小红书', '公众号']) assert.ok(html.includes(`${capability} · ${name}`));
  assert.ok(html.includes('<button class="btn" disabled>同步知识站数据（未适配）</button>'));
  assert.match(html, /准备发布/); assert.match(html, /小红书填好后由你核对发布/);
  assert.match(html, /同时读取流量和粉丝/); assert.match(html, /自动保活、定时体检、定时采集和自动日报发送均未启用/);
  // 每个真实可执行入口都通过 L1 白名单；未适配入口没有动作属性。
  const uiActions = [...html.matchAll(/data-act='([^']+)'/g)].map(m => JSON.parse(m[1].replaceAll('&quot;', '"')));
  assert.equal(uiActions.length, 12);
  for (const action of uiActions) assert.ok(planL1Action(action));
  context.input.actions = [{ done: false }];
  vm.runInContext('O = input;', context);
  assert.equal((vm.runInContext('vSystem()', context).match(/disabled data-act=/g) || []).length, 12);
  assert.doesNotMatch(html, /七个平台|开机自启|视频号登录保活/);
  assert.match(vm.runInContext('vTraffic()', context), /登录与采集状态/);
  context.prepData = (await request('/api/prep')).json();
  vm.runInContext('api = async () => prepData; location.hash = "#/prepare";',context);
  const prepHtml = await vm.runInContext('vPrepare()',context);
  assert.match(prepHtml,/生成准备任务/); assert.match(prepHtml,/打开 X 文字草稿/); assert.match(prepHtml,/保存公众号草稿/);
  assert.match(prepHtml,/disabled/); assert.doesNotMatch(prepHtml,/data-prep="submit"/);
  assert.match(prepHtml,/实际发表日期/);assert.match(prepHtml,/data-prep="links"/);
  context.input.health.platforms.x.last={type:'doctor',done:true,ok:true,endedAt:new Date().toISOString()};
  assert.match(vm.runInContext('vSystem()',context),/最近体检：成功/);
  context.input.health.platforms.x.last.type='sync';
  assert.match(vm.runInContext('vSystem()',context),/最近取链接：成功/);
  const {config:mutableConfig}=await import('../src/feishu.mjs');
  mutableConfig.l1.x.browserExecution=true;
  const preparationId=context.prepData.records.find(r=>r.platform==='x').id;
  assert.equal((await post({type:'sync',platform:'x',preparationId,date:'2026-11-17'})).code,200);
  const linkChild=children.at(-1);
  assert.match(linkChild.args[0],/l1-inspect\.mjs$/);
  assert.deepEqual(linkChild.args.slice(1),['--platform','x','--preparation',preparationId,'--date','2026-11-17']);
  linkChild.child.emit('close',0);
  assert.equal(overviewData().episodes.length, 0);
  console.log('L1 WEB PASS: 3 平台 CLI 参数、HTTP 鉴权/互斥/校验、非零退出/spawn error、持久化/脱敏、页面模板。');
  console.log('仅临时配置/数据库和 loopback HTTP；未启动/连接 Chrome，未读真实配置/凭据，未调用旧 hub。');
} finally { await new Promise(resolve => server.close(resolve)); db.close(); }
