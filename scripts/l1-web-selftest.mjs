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
  child.connected = true; child.sent = []; child.send = message => child.sent.push(message);
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
db.prepare('INSERT OR REPLACE INTO meta(key,value) VALUES (?,?)').run('l1:platform-selection',JSON.stringify(['x','xhs','wechat'])); // explicit fixture choices, never application defaults
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
  assert.equal((await request('/api/prep/record?id=unknown', { auth: false })).code, 401);
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
      assert.deepEqual(args.slice(0,1+planL1Action(action).length), [path.join(root, 'scripts', 'l1-run.mjs'), ...planL1Action(action)]);
      if(type==='collect')assert.deepEqual(args.slice(-2),['--until',(await request('/api/l1/status')).json().platforms[platform].last.startedAt]);
      assert.equal(options.shell, false); assert.equal(options.stdio[0], 'ignore');
      assert.equal(options.stdio[3], 'ipc');
      assert.equal((await post({ type: 'collect', platform })).code, 409);
      const running = (await request('/api/l1/status')).json();
      assert.equal(running.platforms[platform].state, 'running');
      child.emit('message',{type:'l1:progress',stage:'waiting_login',timeoutMs:5000,raw:'secret-cookie'});
      const progress=(await request('/api/l1/status')).json().platforms[platform].last.progress;
      assert.match(progress.message,/完成登录/);assert.ok(Date.parse(progress.deadline)>Date.now());
      child.emit('message',{type:'l1:progress',stage:'untrusted-secret-cookie'});
      if(type==='collect') {
        child.emit('message',{type:'l1:progress',stage:'reading_posts',completed:2,total:5,raw:'secret-cookie'});
        assert.match((await request('/api/l1/status')).json().platforms[platform].last.progress.message,/2\/5 篇/);
      }
      if(type==='login') {
        assert.equal((await post({type:'show-login',platform})).code,200);
        assert.deepEqual(child.sent.at(-1),{type:'l1:show-window'});
      }
      child.stdout.emit('data', 'some key=offline-'); child.stdout.emit('data', 'test-key\n');
      child.stderr.emit('data', 'https://mp.weixin.qq.com/cgi-bin/home?token=secret-query#fragment\nCookie: session=secret-cookie\n');
      assert.equal(JSON.stringify((await request('/api/l1/status')).json()).includes('secret-cookie'), false);
      child.emit('close', type === 'login' ? 0 : 7, null);
      const last = (await request('/api/l1/status')).json().platforms[platform].last;
      assert.equal(last.done, true); assert.equal(last.ok, type === 'login');
      assert.equal(last.code, type === 'login' ? 0 : 7);
      const identity = (await request('/api/l1/status')).json().platforms[platform].identity;
      assert.equal(identity.account, health.platforms[platform].account);
      assert.equal(identity.profile, health.platforms[platform].profile);
      assert.ok(Date.parse(identity.confirmedAt));
      for (const secret of [key, widgetToken, 'secret-cookie', 'secret-query', 'fragment']) assert.equal(JSON.stringify(last).includes(secret), false);
      if (type === 'collect') assert.ok(last.error);
    }
  }
  await post({type:'login',platform:'x'});
  const cancelChild=children.at(-1).child;
  assert.equal((await post({type:'cancel-login',platform:'x'})).code,200);
  assert.deepEqual(cancelChild.sent.at(-1),{type:'l1:cancel-login'});
  cancelChild.stderr.emit('data','已取消登录');cancelChild.emit('close',1);
  assert.equal((await post({type:'show-login',platform:'x'})).code,409);
  // The QR page is explicit logout evidence; a window/read failure alone is not.
  await post({type:'login',platform:'wechat'});
  const qrChild=children.at(-1).child;
  qrChild.emit('message',{type:'l1:progress',stage:'login_required',timeoutMs:5000});
  let qrStatus=(await request('/api/l1/status')).json().platforms.wechat;
  assert.equal(qrStatus.loginStatus.state,'logged_out');
  assert.equal(qrStatus.identity.status,'logged_out');
  assert.ok(qrStatus.identity.confirmedAt,'Keep the prior confirmation as history');
  qrChild.stderr.emit('data','专用窗口已关闭，未完成账号确认');qrChild.emit('close',1);
  assert.equal((await request('/api/l1/status')).json().platforms.wechat.loginStatus.state,'logged_out');
  await post({type:'login',platform:'wechat'});
  const confirmedChild=children.at(-1).child;
  confirmedChild.emit('message',{type:'l1:progress',stage:'identity_confirmed'});
  assert.equal((await request('/api/l1/status')).json().platforms.wechat.loginStatus.state,'logged_in','Expose confirmation before closing the window');
  confirmedChild.emit('close',0);
  for (const action of [null, [], { type: 'metrics' }, { type: 'doctor' }, { type: 'followers' }, { type: 'sync', id: 'a' },
    { type: 'submit', platform: 'x' }, { type: 'login', platform: 'unsupported-platform' }, { type: 'collect', platform: 'x;whoami' },
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
  const savedIdentity = JSON.parse(db.prepare('SELECT value FROM meta WHERE key=?').get('l1:web:identity:x').value);
  assert.deepEqual((await request('/api/l1/status')).json().platforms.x.identity, savedIdentity);
  const {config:identityConfig}=await import('../src/feishu.mjs');
  const originalHandle=identityConfig.xHandle;
  identityConfig.xHandle='ChangedAccount';
  assert.equal((await request('/api/l1/status')).json().platforms.x.identity, null);
  identityConfig.xHandle=originalHandle;
  assert.equal(db.prepare('SELECT value FROM meta WHERE key=?').get('login:channels').value, 'ok');
  assert.equal(redactL1('token=secret key=secret Cookie: secret').includes('secret'), false);

  // 新发布准备 API：执行真实 HTTP 路由，子进程全部替身；不运行第三方 skill。
  assert.equal((await request('/api/prep', {auth:false})).code,401);
  assert.equal((await request('/api/prep/contract')).json().version,4);
  assert.deepEqual((await request('/api/prep/contract')).json().finalPublishPlatforms,[]);
  assert.match((await request('/api/prep/rules-module')).body,/xWeightedCount/);
  const aiPrompt=await request('/api/prep/ai-prompt');assert.equal(aiPrompt.code,200);assert.match(aiPrompt.body,/Origin: http:\/\/127\.0\.0\.1:8787/);assert.match(aiPrompt.body,/scheduledAt/);assert.match(aiPrompt.body,/不能发布|不发布/);
  assert.equal((await request('/api/prep/posts',{action:{type:'create',input:{title:'test',content:'test'}}})).code,403);
  const postHeaders={origin:`http://127.0.0.1:${server.address().port}`};
  const postActor={runtime:'codex',sessionId:'selftest-web'},postAt=new Date(Date.now()+86400000).toISOString();
  assert.equal((await request('/api/prep/posts',{headers:postHeaders,action:{type:'create',input:{title:'test',content:'no column'},actor:postActor,scheduledAt:postAt}})).code,400);
  assert.equal((await request('/api/prep/posts',{headers:postHeaders,action:{type:'create',column:'AI新闻',input:{title:'test',content:'no actor'},scheduledAt:postAt}})).code,400);
  const manuscript=await request('/api/prep/posts',{headers:postHeaders,action:{type:'create',column:'AI新闻',input:{title:'test',content:'no platform operation'},actor:postActor,scheduledAt:postAt,note:'测试备注'}});
  assert.equal(manuscript.code,200);const manuscriptId=manuscript.json().post.id;
  assert.equal(manuscript.json().post.column,'AI新闻');assert.equal(manuscript.json().post.note,'测试备注');
  const moved=await request('/api/prep/posts',{headers:postHeaders,action:{type:'meta',id:manuscriptId,column:'AI日报',note:'改后备注',actor:postActor}});
  assert.equal(moved.code,200);assert.equal(moved.json().post.column,'AI日报');assert.equal(moved.json().post.note,'改后备注');
  assert.equal((await request('/api/prep/posts/record?id='+manuscriptId)).json().post.version,2);
  assert.equal((await request('/api/prep/posts',{headers:postHeaders,action:{type:'publish',id:manuscriptId}})).code,403);
  assert.equal((await request('/api/prep/posts',{headers:postHeaders,action:{type:'update',id:manuscriptId,platform:'x',input:{content:'test',submit:true}}})).code,400);
  assert.equal((await request('/api/prep/posts',{headers:postHeaders,action:{type:'fill',id:manuscriptId,platform:'xhs',mode:'publish'}})).code,400);
  assert.equal((await request('/api/prep/posts',{headers:postHeaders,action:{type:'check',id:manuscriptId,platform:'x'}})).json().validation.ok,true);
  assert.equal((await request('/api/prep/posts/bundle?id='+manuscriptId)).code,200);
  assert.equal((await request('/api/prep/image?name=test.png', {auth:false,action:{}})).code,401);
  assert.equal((await request('/api/prep/image?name=test.png', {action:{},headers:{origin:'https://evil.test'}})).code,403);
  assert.equal((await request('/api/prep/image?name=test.png', {action:{}})).code,400);
  const createX = await request('/api/prep', {action:{type:'create',input:{platform:'x',content:'offline draft only',test:true}}});
  assert.equal(createX.code,200); const prepId = createX.json().record.id;
  const job = (await request('/api/prep/job?id=' + prepId)).json(); assert.equal(job.submit,false);
  const intent = await request('/api/prep/x?id=' + prepId); assert.equal(intent.code,303);
  assert.match(intent.headers.location,/^https:\/\/twitter.com\/intent\/tweet\?text=/);
  assert.equal((await request('/api/prep', {action:{type:'submit',id:prepId}})).code,403);
  assert.equal((await request('/api/prep', {action:{type:'execute',id:prepId}})).code,400);
  const beforeGate = children.length;
  for (const type of ['doctor','sync']) assert.equal((await post({type,platform:'x',...(type === 'sync' ? {id:'no-episode'} : {})})).code,409);
  assert.equal(children.length,beforeGate);
  const image=path.join(folder,'test-cover.png');fs.writeFileSync(image,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6WQAAAABJRU5ErkJggg==','base64'));
  const draft = await request('/api/prep',{action:{type:'create',input:{platform:'wechat',cover:image,images:[image],title:'offline test',content:'mock only'}}});
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
  const listeners={};
  const context = vm.createContext({ console, URLSearchParams, location: { hash: '#/system', search: '' },
    document: { hidden: true, body: element('body'), querySelector: element, createElement: () => element('new'), addEventListener(type,fn) {(listeners[type]||=[]).push(fn);} },
    fetch() { return new Promise(() => {}); }, setInterval() {}, clearInterval() {}, setTimeout() {}, addEventListener() {}, scrollTo() {} });
  vm.runInContext(fs.readFileSync(path.join(root, 'src/web/mt.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(root, 'src/web/health.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(root, 'src/web/pages.html'), 'utf8').match(/<script>([\s\S]*?)<\/script>/)[1], context);
  const pageActionClick=listeners.click[0];
  vm.runInContext(fs.readFileSync(path.join(root, 'src/web/publish-prep.js'), 'utf8'), context);
  context.input = (await request('/api/overview')).json();
  vm.runInContext('O = input; F = {};', context);
  const html = vm.runInContext('vSystem()', context);
  assert.match(html, /PeanutPair/); assert.match(html, /TwoPeanuts/); assert.match(html, /ENOENT/);
  assert.equal((html.match(/>登录账号<\/button>/g) || []).length, 3);
  assert.equal((html.match(/最近确认登录：/g) || []).length, 3);
  assert.match(html, /刷新工作台不会退出平台账号/);
  assert.equal((html.match(/>更新今日作品数据<\/button>/g) || []).length, 3);
  assert.match(html, /最近动态/); assert.match(html, /账号与采集/);
  assert.ok(html.indexOf('常用平台') < html.indexOf('其他工具'));
  assert.doesNotMatch(html,/守护进程|登录 \/ 校验|附加功能/);
  assert.match(html, /准备发布/); assert.match(html, /小红书填好后由你核对发布/);
  assert.match(html, /同时采流量、采粉丝/); assert.match(html, /自动保活和自动发送日报未开启/);
  assert.match(html,/当天00:00至点击时发布的作品/);
  // 每个真实可执行入口都通过 L1 白名单；未适配入口没有动作属性。
  const uiActions = [...html.matchAll(/data-act='([^']+)'/g)].map(m => JSON.parse(m[1].replaceAll('&quot;', '"')));
  assert.equal(uiActions.length, 6);
  for (const action of uiActions) assert.ok(planL1Action(action));
  context.input.actions = [{ done: false }];
  vm.runInContext('O = input;', context);
  assert.equal((vm.runInContext('vSystem()', context).match(/disabled data-act=/g) || []).length, 6);
  context.input.health.platforms.x.state='running';
  context.input.health.platforms.x.last={type:'login',done:false,progress:{message:'等待本人完成登录',deadline:new Date(Date.now()+120000).toISOString()}};
  assert.match(vm.runInContext('vSystem()',context),/显示登录窗口/);
  assert.match(vm.runInContext('vSystem()',context),/取消登录/);
  assert.doesNotMatch(vm.runInContext('vSystem()',context),/未确认结束/);
  context.input.actions=[];context.input.health.platforms.x.state='idle';
  assert.doesNotMatch(html, /七个平台|开机自启|视频号登录保活/);
  assert.match(vm.runInContext('vTraffic()', context), /前往账号与采集/);
  context.input.episodes=[
    {id:'unknown-pub-date',name:'没有发布时间的作品',nick:'没有发布时间的作品',episode:null,observedAt:new Date().toISOString(),tasks:[],covers:[],views:0},
    {id:'dated-calendar-post',name:'日历有日期的作品',nick:'日历有日期的作品',episode:null,publishedAt:new Date().toISOString(),tasks:[{state:'published'}],covers:[],views:10}
  ];
  const calendarHtml=vm.runInContext('vCalendar()',context);
  assert.match(calendarHtml,/暂无入库记录/);assert.match(calendarHtml,/不代表当天没有发布/);
  assert.match(calendarHtml,/1 篇作品缺少发布时间/);assert.doesNotMatch(calendarHtml,/unknown-pub-date/);
  assert.match(calendarHtml,/dated-calendar-post/);
  context.input.episodes[1].tasks[0].state='submitted';
  assert.match(vm.runInContext('vCalendar()',context),/已提交，待核对/);
  context.input.episodes[1].tasks[0].state='unknown';
  assert.match(vm.runInContext('vCalendar()',context),/异常 \/ 需核对/);
  context.input.episodes=[];
  context.prepData = (await request('/api/prep')).json();
  const statusResponse=await request('/api/prep/status');assert.equal(statusResponse.code,200);
  const statusData=statusResponse.json();assert.equal(statusData.readOnly,true);assert.equal(statusData.submit,false);
  assert.ok(statusData.rows.some(row=>row.id===manuscriptId));
  assert.ok(statusData.rows.some(row=>row.id===draftId));
  assert.equal((await request('/api/prep/status',{headers:{origin:'https://evil.test'}})).code,403);
  assert.equal((await request('/api/prep/status',{headers:{'x-forwarded-for':'127.0.0.1'}})).code,403);
  assert.equal((await request('/api/prep/status',{headers:{origin:`http://127.0.0.1:${server.address().port}`},action:{}})).code,405);
  assert.equal((await request('/api/prep/status',{auth:false})).code,401);
  const pageModule=await import('../src/web/prepare-page.js');
  context.prepPageModule=pageModule;context.statusData=statusData;
  vm.runInContext('loadPreparePage=async()=>prepPageModule;api=async()=>statusData;location.hash="#/prepare";',context);
  const prepHtml=await vm.runInContext('vPrepare()',context);
  assert.match(prepHtml,/发布记录/);assert.match(prepHtml,/待你处理/);assert.match(prepHtml,/失败详情/);
  assert.match(prepHtml,/给 AI 的接入指令/);assert.match(prepHtml,/data-copy-prompt/);assert.match(prepHtml,/data-open-ai-prompt/);
  assert.doesNotMatch(prepHtml,/<textarea|<input|data-action=|data-prep=|生成各平台版本|新建原稿/);
  context.input.health.platforms.x.last={type:'doctor',done:true,ok:true,endedAt:new Date().toISOString()};
  assert.match(vm.runInContext('vSystem()',context),/检查账号已完成/);
  context.input.health.platforms.x.last.type='sync';
  assert.match(vm.runInContext('vSystem()',context),/取链接已完成/);
  const {config:mutableConfig}=await import('../src/feishu.mjs');
  mutableConfig.l1.x.browserExecution=true;
  const preparationId=context.prepData.records.find(r=>r.platform==='x').id;
  assert.equal((await post({type:'sync',platform:'x',preparationId,date:'2026-11-17'})).code,200);
  const linkChild=children.at(-1);
  assert.match(linkChild.args[0],/l1-inspect\.mjs$/);
  assert.deepEqual(linkChild.args.slice(1),['--platform','x','--preparation',preparationId,'--date','2026-11-17']);
  linkChild.child.emit('close',0);
  assert.equal(overviewData().episodes.length, 0);
  vm.runInContext('render=async()=>{};load=async()=>{};fetch=async()=>{throw new TypeError("offline")};pendingAction=null;',context);
  await pageActionClick({target:{closest:()=>({disabled:false,dataset:{act:JSON.stringify({type:'login',platform:'x'})}})}});
  assert.equal(vm.runInContext('pendingAction',context),null);
  assert.match(vm.runInContext('actionError',context),/请求未得到确认/);
  console.log('L1 WEB PASS: 3 平台 CLI 参数、HTTP 鉴权/互斥/校验、非零退出/spawn error、持久化/脱敏、页面模板。');
  console.log('仅临时配置/数据库和 loopback HTTP；未启动/连接 Chrome，未读真实配置/凭据，未调用旧 hub。');
} finally { await new Promise(resolve => server.close(resolve)); db.close(); }
