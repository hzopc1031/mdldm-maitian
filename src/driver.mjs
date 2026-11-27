// 驱动选择：direct = 中控直连专用 Chrome（默认）；plugin = 通过插件面板的开发桥
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { config } from './feishu.mjs';
import * as bridge from './bridge.mjs';
import { pluginDir, pluginInfo } from './plugin.mjs';

export const mode = (process.env.HUB_DRIVER || config.driver || 'direct');
export const sleep = bridge.sleep;
let lib = null;   // 插件的 publish.js / cdp.js（direct 模式下在本进程里加载）
async function load() {
  if (lib) return lib;
  const shim = await import('./chrome-shim.mjs');
  globalThis.chrome = shim.chrome;
  const dir = pluginDir();
  const pub = await import(pathToFileURL(path.join(dir, 'lib/publish.js')).href);
  const cdp = await import(pathToFileURL(path.join(dir, 'lib/cdp.js')).href);
  return (lib = { shim, pub, cdp });
}
// 正式加载原库、检查导出；不调用ensure/run/preflight，不打开浏览器。
export async function publisherInfo() {
  const {pub,cdp}=await load();
  if(typeof pub.run!=='function'||typeof pub.collectLinks!=='function'||typeof cdp.evaluate!=='function')throw new Error('publisher 导出不完整');
  return {loaded:true,adapters:Object.keys(pub.ADAPTERS),browserLaunched:false,platformOperation:false};
}

export async function ensure() { if (mode === 'plugin') return bridge.ensureBridge(); const l = await load(); await l.shim.launchChrome(); }
export async function evaluate(tabId, expr, timeout) { if (mode === 'plugin') return bridge.evaluate(tabId, expr, timeout); return (await load()).cdp.evaluate(tabId, expr); }
// 真实鼠标点击（直连模式用插件 cdp.js 的 click；开发桥模式退回元素 .click()）
export async function click(tabId, expr) {
  if (mode === 'plugin') return bridge.evaluate(tabId, `(()=>{const e=${expr};if(!e)return false;e.click();return true})()`);
  return (await load()).cdp.click(tabId, expr);
}
// 认领已开着的页面（hub submit 用）；插件方式不支持
export async function adoptTabs(re) { if (mode === 'plugin') throw new Error('插件方式不支持认领页面，请用专用 Chrome（driver: direct）'); return (await load()).shim.adoptTargets(re); }
export async function withTab(url, fn, { wait = 8000 } = {}) {
  if (mode === 'plugin') return bridge.withTab(url, fn, { wait });
  await load(); const t = await chrome.tabs.create({ url, active: false });
  try { await sleep(wait); return await fn(t.id); } finally { await chrome.tabs.remove(t.id).catch(() => {}); }
}
export async function busy() { if (mode !== 'plugin') return false; const j = await bridge.panel('job', [], 30000); return !!(j && j.running); }

// 商店里的插件版本还没有某个平台的适配器（比如新平台刚加、商店还在审核）：这几个平台先跳过并说明
const split = (pub, ids) => [ids.filter(id => pub.ADAPTERS[id]), ids.filter(id => !pub.ADAPTERS[id])];
const tooOld = (id) => { const p = pluginInfo(); return `麦田发布助手 ${p.version || ''}（${p.source === 'store' ? '商店版' : '本地'}）还不支持 ${id}，等插件更新`; };

// 跑一批平台；onState(st) 在每次状态变化时调用，st = {id, status, logs, tabId}
export async function runBatch(project, batch, onState, onStall) {
  if (mode !== 'plugin') {
    const { pub } = await load();
    const [ok, missing] = split(pub, batch);
    const gone = missing.map(id => ({ id, status: '异常', logs: [{ kind: 'err', msg: tooOld(id) }] }));
    gone.forEach(onState);
    if (!ok.length) return gone;
    const states = await pub.run(project, { rootPath: config.rootPath, platforms: ok, onChange: (st) => onState(st), shouldStop: () => false });
    return [...Object.values(states), ...gone];
  }
  const r = await bridge.panel('startRaw', [project, batch, config.rootPath]);
  if (!r || !r.ok) throw new Error(`插件没能开始：${r ? r.error : '没有响应'}`);
  for (let miss = 0, warned = false; ;) {
    await sleep(20000);
    let j; try { j = await bridge.panel('job', [], 30000); miss = 0; } catch { miss++; }
    if (miss >= 6 && !warned) { warned = true; onStall && onStall(); }
    if (!j) continue;
    const st = Array.isArray(j.states) ? j.states : Object.values(j.states || {});
    for (const s of st) if (batch.includes(s.id)) onState(s);
    if (!j.running) return st;
  }
}
export async function checkLogin(ids) {
  if (mode === 'plugin') { const r = await bridge.panel('checkLogin', [ids], 120000); return r && r.ok ? r.result : {}; }
  const { pub } = await load(); const [ok, missing] = split(pub, ids);
  const r = ok.length ? await pub.preflight(ok, { keepTabs: false }) : {};
  for (const id of missing) r[id] = { ok: false, reason: tooOld(id) };
  return r;
}
export async function links(project, ids) {
  if (mode === 'plugin') { const r = await bridge.panel('links', [project, ids], 600000); if (!r || !r.ok) throw new Error(r ? r.error : '没有响应'); return r.result; }
  return (await load()).pub.collectLinks(project, ids, {});
}
// 登录不需要插件代码：只开专用 Chrome 和页面（第一次还没装插件时也能用）
export async function openForLogin(urls) { const shim = await import('./chrome-shim.mjs'); await shim.launchChrome({ foreground: true }); for (const u of urls) await shim.chrome.tabs.create({ url: u, active: true }); }
export async function close() { if (lib) lib.shim.closeConnection(); }
// 页面截图（存档用），返回 JPEG Buffer
export async function screenshot(tabId) {
  const params = { format: 'jpeg', quality: 70 };
  const r = mode === 'plugin' ? await bridge.call({ op: 'cdp', tabId, method: 'Page.captureScreenshot', params }) : await (await load()).cdp.send(tabId, 'Page.captureScreenshot', params);
  return Buffer.from(r.data, 'base64');
}
