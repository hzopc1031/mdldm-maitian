// L1 独占 CDP：不复用端口，不加载发布插件；只关闭本次启动的进程。
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { home } from './l1-config.mjs';
import { l1Account } from './l1-account.mjs';
export const pause = (min = 1800, max = 3200) => new Promise(resolve => setTimeout(resolve, min + Math.random() * (max - min)));
export function browserProxyArgs(config, platform, env=process.env) {
  const value=config.l1?.[platform]?.proxy ?? (platform==='x' ? env.HTTPS_PROXY || env.HTTP_PROXY : null);
  if(!value || value==='system')return [];
  if(value==='direct')return ['--no-proxy-server'];
  let url;try{url=new URL(value);}catch{throw new Error('L1代理配置格式无效');}
  if(!['http:','https:','socks5:'].includes(url.protocol)||url.username||url.password||url.search||url.hash||!['','/'].includes(url.pathname))throw new Error('L1代理只接受无凭据的HTTP/HTTPS/SOCKS5服务地址');
  return [`--proxy-server=${url.protocol}//${url.host}`];
}
export function browserSettings(config, platform = 'xhs') {
  if (!['x', 'xhs', 'wechat'].includes(platform)) throw new Error('未知 L1 浏览器平台');
  const settings = config.l1?.[platform] || {};
  // X 绝不继承旧全局的 9340/profile；小红书保留旧配置兼容。
  const expected = path.resolve(home, `chrome-profile-l1-${platform}`);
  const profile = path.resolve(settings.chromeProfile || (platform === 'xhs' ? config.chromeProfile : null) || expected);
  const expectedPort = { x: 9341, xhs: 9340, wechat: 9342 }[platform];
  const port = settings.chromePort ?? (platform === 'xhs' ? config.chromePort : null) ?? expectedPort;
  if (port !== expectedPort) throw new Error(`L1 ${platform} 仅允许端口 ${expectedPort}`);
  if (!path.isAbsolute(settings.chromeProfile || (platform === 'xhs' ? config.chromeProfile : null) || expected) || /^(?:\\\\|\/\/)/.test(profile)) throw new Error('L1 profile 必须为专用本机绝对路径');
  const normalProfiles = [process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA,'Google/Chrome/User Data'),process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA,'Microsoft/Edge/User Data'),path.join(os.homedir(),'Library/Application Support/Google/Chrome'),path.join(os.homedir(),'.config/google-chrome')].filter(Boolean);
  if(normalProfiles.some(root=>{const rel=path.relative(root,profile);return !rel||(!rel.startsWith('..')&&!path.isAbsolute(rel));}))throw new Error('拒绝普通Chrome/Edge用户profile；请配置独立L1目录');
  for(const other of ['x','xhs','wechat'].filter(p=>p!==platform)) {
    const otherProfile=path.resolve(config.l1?.[other]?.chromeProfile || (other==='xhs'?config.chromeProfile:null) || path.join(home,`chrome-profile-l1-${other}`));
    if(otherProfile.toLowerCase()===profile.toLowerCase())throw new Error('L1平台必须使用不同专用profile');
  }
  const candidates = [config.chromeBinary, process.env.CHROME_PATH, process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google/Chrome/Application/chrome.exe'), process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Google/Chrome/Application/chrome.exe'), process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'), '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean);
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
  const child = spawn(binary, [`--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1', '--enable-automation', '--no-first-run', '--no-default-browser-check', '--disable-background-mode', ...browserProxyArgs(config,platform), 'about:blank'], { stdio: 'ignore', windowsHide: false });
  let launchError, exited = false, ws, seq = 0, session, verifiedOwner = false;
  child.once('error', error => { launchError = error; });
  child.once('exit', () => { exited = true; });
  const pending = new Map();
  function send(method, params = {}, sessionId) {
    return new Promise((resolve, reject) => {
      const id = ++seq;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP 超时：${method}`)); }, method === 'Page.navigate' ? 60000 : 15000);
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
        if (!allowedPage(url, platform, platform==='x'?l1Account(config,'x'):null)) throw new Error('L1 拒绝非本平台只读页面');
        const result = await send('Page.navigate', { url }, session);
        if (result.errorText) throw new Error(result.errorText);
        await pause(5000, 7000);
      },
      async evaluate(fn, ...args) {
        const result = await send('Runtime.evaluate', { expression: `(${fn.toString()})(...${JSON.stringify(args)})`, returnByValue: true, awaitPromise: true }, session);
        if (result.exceptionDetails) throw new Error('页面 DOM 读取失败');
        return result.result.value;
      },
      async screenshot(file) {
        if(!path.isAbsolute(file)||/^(?:\\\\|\/\/)/.test(file))throw new Error('截图仅允许本机绝对路径');
        const shot=await send('Page.captureScreenshot',{format:'png'},session);
        fs.writeFileSync(file,Buffer.from(shot.data,'base64'));
        return file;
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
export function allowedPage(value, platform, account) {
  try {
    // 公众号只主动导航入口。连显式 :443、空 query/hash 都拒绝；不拼接后台 token URL。
    if (platform === 'wechat') return typeof value === 'string' && /^https:\/\/mp\.weixin\.qq\.com\/?$/i.test(value);
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash) return false;
    if (platform === 'xhs') return url.hostname === 'creator.xiaohongshu.com' || ['www.xiaohongshu.com','xiaohongshu.com'].includes(url.hostname) && /^\/explore\/[\w-]+$/.test(url.pathname);
    return platform === 'x' && url.hostname === 'x.com' && (url.pathname==='/i/flow/login' || /^[A-Za-z0-9_]{1,15}$/.test(account || '') && new RegExp(`^/${account}(?:/status/\\d+)?/?$`,'i').test(url.pathname));
  } catch { return false; }
}
