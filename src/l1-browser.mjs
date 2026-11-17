// L1 独占 CDP：不复用端口，不加载发布插件；只关闭本次启动的进程。
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { home } from './l1-config.mjs';
export const pause = (min = 1800, max = 3200) => new Promise(resolve => setTimeout(resolve, min + Math.random() * (max - min)));
export function browserSettings(config, platform = 'xhs') {
  if (!['x', 'xhs', 'wechat'].includes(platform)) throw new Error('未知 L1 浏览器平台');
  const settings = config.l1?.[platform] || {};
  // X 绝不继承旧全局的 9340/profile；小红书保留旧配置兼容。
  const expected = path.resolve(home, `chrome-profile-l1-${platform}`);
  const profile = path.resolve(settings.chromeProfile || (platform === 'xhs' ? config.chromeProfile : null) || expected);
  const expectedPort = { x: 9341, xhs: 9340, wechat: 9342 }[platform];
  const port = settings.chromePort ?? (platform === 'xhs' ? config.chromePort : null) ?? expectedPort;
  if (port !== expectedPort || profile.toLowerCase() !== expected.toLowerCase()) throw new Error(`L1 ${platform} 仅允许端口 ${expectedPort} 和 ${expected} 专用 profile`);
  const candidates = [config.chromeBinary, process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google/Chrome/Application/chrome.exe'), process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Google/Chrome/Application/chrome.exe'), process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe')].filter(Boolean);
  const binary = candidates.find(file => fs.existsSync(file));
  if (!binary) throw new Error('找不到 Chrome 程序，请配置 chromeBinary');
  return { profile, port, binary };
}
async function assertFree(port) {
  await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', () => reject(new Error(`127.0.0.1:${port} 已被占用；拒绝连接现有浏览器`)));
    server.listen({ host: '127.0.0.1', port, exclusive: true }, () => server.close(resolve));
  });
}
export async function withL1Browser(config, fn, platform = 'xhs') {
  const { profile, port, binary } = browserSettings(config, platform);
  await assertFree(port);
  fs.mkdirSync(profile, { recursive: true });
  const child = spawn(binary, [`--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1', '--enable-automation', '--no-first-run', '--no-default-browser-check', '--disable-background-mode', 'about:blank'], { stdio: 'ignore', windowsHide: false });
  let launchError, exited = false, ws, seq = 0, session, verifiedOwner = false;
  child.once('error', error => { launchError = error; });
  child.once('exit', () => { exited = true; });
  const pending = new Map();
  function send(method, params = {}, sessionId) {
    return new Promise((resolve, reject) => {
      const id = ++seq;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP 超时：${method}`)); }, 15000);
      pending.set(id, { resolve, reject, timer });
      try { ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); }
      catch (error) { clearTimeout(timer); pending.delete(id); reject(error); }
    });
  }
  let shutdownPromise;
  const shutdown = () => shutdownPromise ||= closeOwned();
  const closeOwned = async () => {
    if (verifiedOwner && ws?.readyState === WebSocket.OPEN && !exited) await send('Browser.close').catch(() => {});
    ws?.close();
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error('L1 浏览器已关闭')); }
    pending.clear();
    for (let i = 0; !exited && i < 20; i++) await pause(100, 150);
    if (!exited && child.pid) {
      // 不按 Chrome 名称或端口杀进程，仅处理持有的本次子进程。
      if (process.platform === 'win32') await new Promise((resolve, reject) => {
        const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
        killer.once('error', reject); killer.once('exit', code => code === 0 || exited ? resolve() : reject(new Error(`本次专用 Chrome 清理失败（PID ${child.pid}），请检查该专用窗口`)));
      });
      else child.kill('SIGTERM');
      for (let i = 0; !exited && i < 20; i++) await pause(100, 150);
      if (!exited) throw new Error(`无法确认本次专用 Chrome 已退出（PID ${child.pid}）`);
    }
  };
  const interrupt = () => { void shutdown().finally(() => process.exit(130)); };
  process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
  try {
    let version;
    for (let i = 0; i < 40; i++) {
      if (launchError) throw launchError;
      if (exited) throw new Error('本次 Chrome 进程提前退出；拒绝复用其他浏览器');
      try { const response = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(800) }); if (response.ok) { version = await response.json(); break; } } catch { /* 等待本次子进程 */ }
      await pause(250, 500);
    }
    if (!version) throw new Error('专用 Chrome 启动超时');
    const endpoint = new URL(version.webSocketDebuggerUrl);
    if (endpoint.hostname !== '127.0.0.1' || Number(endpoint.port) !== port || endpoint.protocol !== 'ws:') throw new Error('调试端点不是预期 loopback');
    ws = new WebSocket(endpoint);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('CDP 连接超时')), 5000);
      ws.onopen = () => { clearTimeout(timer); resolve(); };
      ws.onerror = () => { clearTimeout(timer); reject(new Error('CDP 连接失败')); };
    });
    ws.onmessage = event => {
      const message = JSON.parse(event.data), item = pending.get(message.id);
      if (!item) return;
      clearTimeout(item.timer); pending.delete(message.id);
      message.error ? item.reject(new Error(message.error.message)) : item.resolve(message.result);
    };
    ws.onclose = () => { for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error('专用 Chrome 连接关闭')); } pending.clear(); };
    const command = await send('Browser.getBrowserCommandLine');
    const processes = await send('SystemInfo.getProcessInfo');
    try { assertBrowserOwner(command.arguments, processes.processInfo, { profile, port }, child.pid); }
    catch (error) { ws.close(); throw error; }
    verifiedOwner = true;
    const target = await send('Target.createTarget', { url: 'about:blank' });
    session = (await send('Target.attachToTarget', { targetId: target.targetId, flatten: true })).sessionId;
    await send('Page.enable', {}, session);
    const page = {
      async goto(url) {
        if (!allowedPage(url, platform)) throw new Error('L1 拒绝非本平台只读页面');
        const result = await send('Page.navigate', { url }, session);
        if (result.errorText) throw new Error(result.errorText);
        await pause(5000, 7000);
      },
      async evaluate(fn, ...args) {
        const result = await send('Runtime.evaluate', { expression: `(${fn.toString()})(...${JSON.stringify(args)})`, returnByValue: true, awaitPromise: true }, session);
        if (result.exceptionDetails) throw new Error('页面 DOM 读取失败');
        return result.result.value;
      },
    };
    return await fn(page);
  } finally { process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt); await shutdown(); }
}
export function assertBrowserOwner(args, processes, { profile, port }, pid) {
  if (!Number.isInteger(pid) || !args?.includes(`--user-data-dir=${profile}`) ||
      !args.includes(`--remote-debugging-port=${port}`) ||
      !args.includes('--remote-debugging-address=127.0.0.1') ||
      ['--user-data-dir', '--remote-debugging-port', '--remote-debugging-address'].some(flag => args.filter(arg => arg === flag || arg.startsWith(`${flag}=`)).length !== 1) ||
      !processes?.some(p => p.type === 'browser' && p.id === pid)) {
    throw new Error('浏览器 PID/profile/端口归属校验失败');
  }
}
export function allowedPage(value, platform) {
  try {
    // 公众号只主动导航入口。连显式 :443、空 query/hash 都拒绝；不拼接后台 token URL。
    if (platform === 'wechat') return typeof value === 'string' && /^https:\/\/mp\.weixin\.qq\.com\/?$/i.test(value);
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash) return false;
    if (platform === 'xhs') return url.hostname === 'creator.xiaohongshu.com';
    return platform === 'x' && url.hostname === 'x.com' && /^(?:\/PeanutPair\/?|\/PeanutPair\/status\/\d+|\/i\/flow\/login)$/i.test(url.pathname);
  } catch { return false; }
}
