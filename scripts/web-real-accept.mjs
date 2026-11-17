// 本机真实 Chrome 渲染验收。只导航工作台；不连接平台或已有浏览器。
// 现有工作台口令仅在内存使用，禁止记录请求/响应头、原始 CDP 消息或含口令 URL。
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
const root = process.cwd(), base = 'http://127.0.0.1:8787', port = 9350;
const config = JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8').replace(/^\uFEFF/, ''));
const secret = config.web?.key;
if (!secret) throw new Error('需要已有工作台口令配置；本测试不生成口令');
const clean = value => String(value).split(secret).join('[已隐藏]').replace(/mt_key=[^;\s]+/g, 'mt_key=[已隐藏]');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
await new Promise((resolve, reject) => { const s = net.createServer(); s.once('error', () => reject(new Error('验收 Chrome 端口被占用，拒绝复用'))); s.listen(port, '127.0.0.1', () => s.close(resolve)); });
const profile = path.join(root, `_local-web-check-profile-${Date.now()}`);
const browser = spawn(config.chromeBinary || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
  '--headless=new', '--incognito', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  '--disable-background-networking', '--window-size=1440,1100', `--user-data-dir=${profile}`,
  '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${port}`, 'about:blank'
], { windowsHide: true, stdio: 'ignore' });
const evidence = { at: new Date().toISOString(), chromePid: browser.pid, mode: '本机真实 Chrome headless=new；独立 incognito profile；非 mock', results: [], exceptions: [] };
let socket, seq = 0;
const pending = new Map();
async function cdp(method, params = {}) {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 15000);
    pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) { const r = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error('页面表达式执行失败'); return r.result.value; }
async function waitFor(expression) { for (let i = 0; i < 80; i++) { if (await evaluate(expression)) return; await sleep(100); } throw new Error('真实页面等待超时'); }
async function navigate(target, ready) {
  const expected = new URL(target);
  await cdp('Page.navigate', { url: target });
  await waitFor(`location.pathname===${JSON.stringify(expected.pathname)} && location.hash===${JSON.stringify(expected.hash)} && document.readyState==='complete' && (${ready})`);
}
async function shot(name) {
  // 截图前强制检查地址已去 key；不输出原地址。
  assert.equal(await evaluate("new URL(location.href).searchParams.has('key')"), false);
  const { data } = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const file = path.join(root, `_local-web-real-${name}.png`); fs.writeFileSync(file, Buffer.from(data, 'base64')); return file;
}
async function check(name, fn) {
  try { await fn(); evidence.results.push({ name, result: '通过' }); }
  catch (e) {
    const failure = { name, result: '失败', reason: clean(e.message) };
    try { failure.page = clean(await evaluate("document.body.innerText.slice(0,200)")); failure.shot = await shot('failure-' + evidence.results.length); } catch {}
    evidence.results.push(failure);
  }
  console.log(JSON.stringify(evidence.results.at(-1)));
}
try {
  let pages;
  for (let i = 0; i < 100; i++) { try { pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); if (pages.length) break; } catch {} await sleep(100); }
  if (!pages?.length) throw new Error('本机 Chrome 启动失败');
  socket = new WebSocket(pages.find(p => p.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', () => reject(new Error('CDP connection failed')), { once: true }); });
  socket.addEventListener('message', event => {
    const m = JSON.parse(event.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(`CDP error ${m.error.code}`)) : p.resolve(m.result); }
    if (m.method === 'Runtime.exceptionThrown') evidence.exceptions.push(clean(m.params.exceptionDetails.exception?.description?.split('\n')[0] || m.params.exceptionDetails.text));
  });
  await cdp('Page.enable'); await cdp('Runtime.enable');
  await check('未鉴权系统深链显示登录表单', async () => {
    await navigate(base + '/p#/system', "!!document.querySelector('input[type=password]')");
    assert.equal(await evaluate('location.pathname+location.hash'), '/p#/system');
    assert.equal(await evaluate("document.querySelector('#returnTo').value"), '/p#/system');
    evidence.unauthShot = await shot('unauth-system');
  });
  await check('错误口令提示且不放行', async () => {
    await evaluate("document.querySelector('#key').value='invalid-acceptance-value';document.querySelector('form').requestSubmit();true");
    await waitFor("!!document.querySelector('[role=alert]')");
    assert.equal(await evaluate("!!document.querySelector('input[type=password]')"), true);
    assert.equal(await evaluate("document.querySelector('#returnTo').value"), '/p#/system');
    evidence.invalidShot = await shot('invalid-login');
  });
  await check('POST表单登录保留系统深链并真实渲染', async () => {
    // 不读取 cookie；浏览器完成正常的表单 POST 和 cookie 管理。
    await evaluate(`document.querySelector('#key').value=${JSON.stringify(secret)};document.querySelector('form').requestSubmit();true`);
    await waitFor("!!document.querySelector('.h1') && document.querySelector('.h1').textContent==='系统'");
    assert.equal(await evaluate('location.pathname+location.hash'), '/p#/system');
    assert.equal(await evaluate("document.querySelectorAll('[data-act]').length"), 12);
    for (const label of ['手动操作', '采流量', '采粉丝', '体检（未适配）', '取链接（未适配）', '同步知识站数据（未适配）', '最近动态', '平台登录与校验']) {
      assert.equal(await evaluate(`document.body.innerText.includes(${JSON.stringify(label)})`), true);
    }
    assert.equal(await evaluate("document.body.innerText.includes('未实时检查')"), true);
    assert.equal(await evaluate("document.body.innerText.includes('今日已检')"), false);
    evidence.systemShot = await shot('authed-system');
  });
  await check('cookie鉴权大屏真实渲染和累计文案', async () => {
    await navigate(base + '/', "!!document.querySelector('.hero .nums')");
    await sleep(1300);
    assert.equal(await evaluate("document.body.innerText.includes('当前内容累计浏览')"), true);
    assert.equal(await evaluate("document.body.innerText.includes('今日新增 暂无')"), true);
    assert.equal(await evaluate("document.body.innerText.includes('加载中…')"), false);
    evidence.homeShot = await shot('authed-home');
  });
  await check('大屏当前内容切换', async () => {
    const before = await evaluate("document.querySelector('.hero .h2, .hero h2, .hero .title')?.textContent || document.querySelector('.hero').innerText");
    const clicked = await evaluate("(() => { const tabs=[...document.querySelectorAll('#hero [data-i]')]; const tab=tabs.find(t=>!t.classList.contains('on')); if(!tab) return false; tab.click(); return true; })()");
    assert.equal(clicked, true, '当前数据无可切换标签或选择器需核实');
    await sleep(300);
    assert.notEqual(await evaluate("document.querySelector('.hero .h2, .hero h2, .hero .title')?.textContent || document.querySelector('.hero').innerText"), before);
    evidence.switchShot = await shot('home-switch');
  });
  for (const [route, title] of [['traffic','流量'], ['calendar','日历'], ['archive','档案']]) await check(`真实渲染 ${route}`, async () => {
    await navigate(base + '/p#/' + route, `document.querySelector('.h1')?.textContent===${JSON.stringify(title)}`);
    assert.equal(await evaluate("!!document.querySelector('[role=alert]') || document.body.innerText.includes('出错了：')"), false);
    evidence[route + 'Shot'] = await shot(route);
  });
  await check('档案进入作品详情并展开存档文案', async () => {
    const href = await evaluate("document.querySelector('.poster')?.getAttribute('href')");
    assert.ok(href?.startsWith('#/ep/'));
    await evaluate("document.querySelector('.poster').click();true");
    await waitFor("!!document.querySelector('.ephero') && !!document.querySelector('details')");
    assert.equal(await evaluate('location.hash'), href);
    await evaluate("document.querySelector('details summary').click();true");
    assert.equal(await evaluate("document.querySelector('details').open"), true);
    assert.equal(await evaluate("document.body.innerText.includes('出错了：')"), false);
    await evaluate("document.querySelector('details').scrollIntoView({block:'center'});true");
    evidence.detailShot = await shot('episode-detail');
  });
  await check('流量选择作品明细', async () => {
    await navigate(base + '/p#/traffic', "document.querySelector('.h1')?.textContent==='流量'");
    const selected = await evaluate("(() => {const a=document.querySelectorAll('[data-pick]')[1]; if(!a)return null; const id=a.dataset.pick; a.click(); return {id, selected:pick};})()");
    assert.ok(selected); assert.equal(selected.id, selected.selected);
    assert.equal(await evaluate("document.body.innerText.includes('出错了：')"), false);
    evidence.trafficPickShot = await shot('traffic-pick');
  });
  await check('未启用站点的转化入口空态', async () => {
    await navigate(base + '/p#/convert', "document.querySelector('.h1')?.textContent==='转化'");
    assert.equal(await evaluate("document.body.innerText.includes('还没有站点数据')"), true);
    evidence.convertShot = await shot('convert-empty');
  });
  await check('无cookie带key深链保留路径/hash且地址栏去key', async () => {
    await cdp('Network.clearBrowserCookies');
    await navigate(base + '/p?key=' + encodeURIComponent(secret) + '#/system', "location.search==='' && !!document.querySelector('.h1') && document.querySelector('.h1').textContent==='系统'");
    assert.equal(await evaluate('location.pathname+location.hash'), '/p#/system');
    evidence.deepShot = await shot('key-deep-clean');
  });
  await check('已有cookie的带key地址仍去key且保留查询/hash', async () => {
    await navigate(base + '/p?tab=check&key=' + encodeURIComponent(secret) + '#/system', "location.search==='?tab=check' && !!document.querySelector('.h1') && document.querySelector('.h1').textContent==='系统'");
    assert.equal(await evaluate('location.pathname+location.search+location.hash'), '/p?tab=check#/system');
    evidence.cookieDeepShot = await shot('cookie-key-clean');
  });
  await check('真实页面无未捕获JS异常', async () => assert.deepEqual(evidence.exceptions, []));
} catch (e) { evidence.results.push({ name: '验收运行环境', result: '阻塞', reason: clean(e.message) }); }
finally {
  socket?.close();
  browser.kill();
  fs.writeFileSync(path.join(root, '_local-web-real-accept.json'), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
}
process.exitCode = evidence.results.some(r => r.result !== '通过') ? 1 : 0;
