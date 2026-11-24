// 小红书草稿收尾：填完后先等自动保存，再离开页面并核对草稿列表，最后关浏览器。
const PORT = 9333;

async function listPages() {
  const response = await fetch(`http://127.0.0.1:${PORT}/json/list`, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error('小红书调试入口不可用');
  return response.json();
}

async function connect(url) {
  const ws = new WebSocket(url);
  const pending = new Map();
  let id = 0;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('小红书调试连接超时')), 5000);
    ws.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
    ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('小红书调试连接失败')); }, { once: true });
  });
  ws.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    const item = pending.get(message.id);
    if (!item) return;
    pending.delete(message.id);
    clearTimeout(item.timer);
    message.error ? item.reject(new Error(message.error.message)) : item.resolve(message.result);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const n = ++id;
    const timer = setTimeout(() => { pending.delete(n); reject(new Error(`小红书调试超时（${method}）`)); }, 10000);
    pending.set(n, { resolve, reject, timer });
    ws.send(JSON.stringify({ id: n, method, params }));
  });
  return { ws, send };
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function finishXhsDraft({ title }) {
  const pages = await listPages();
  const page = pages.find(item => item.type === 'page' && /creator\.xiaohongshu\.com\/publish/.test(item.url));
  if (!page) throw new Error('找不到已填写的小红书发布页，无法确认草稿');
  const { ws, send } = await connect(page.webSocketDebuggerUrl);
  let verified = false;
  try {
    // 停在发布页等客户端把草稿写回服务端（关闭太快会丢）。
    await sleep(8000);
    // 先离开编辑页（回首页），页面卸载时小红书才会把草稿写进本地草稿箱。
    await send('Page.navigate', { url: 'https://creator.xiaohongshu.com/new/home' });
    await sleep(5000);
    await send('Page.navigate', { url: 'https://creator.xiaohongshu.com/publish/publish?from=menu&target=image' });
    await sleep(6000);
    await send('Runtime.evaluate', {
      expression: `(() => {
        const visible = el => el.getClientRects().length > 0;
        const button = [...document.querySelectorAll('button,div,span,a')].filter(visible)
          .find(el => /^草稿箱/.test((el.innerText || '').trim()));
        if (!button) return false;
        button.click();
        return true;
      })()`, returnByValue: true,
    });
    await sleep(2500);
    await send('Runtime.evaluate', {
      expression: `(() => {
        const visible = el => el.getClientRects().length > 0;
        const tab = [...document.querySelectorAll('div,span,button')].filter(visible)
          .find(el => /^图文笔记/.test((el.innerText || '').trim()));
        if (!tab) return false;
        tab.click();
        return true;
      })()`, returnByValue: true,
    });
    await sleep(3000);
    const text = await send('Runtime.evaluate', { expression: 'document.body.innerText', returnByValue: true });
    const body = typeof text?.result?.value === 'string' ? text.result.value : '';
    verified = Boolean(title && body.includes(String(title).slice(0, 18)));
    return { verified, sample: body.slice(0, 500) };
  } finally {
    ws.close();
    // 关闭浏览器，避免继续占用专用窗口。
    try {
      const version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`, { signal: AbortSignal.timeout(3000) })).json();
      if (/^ws:\/\/127\.0\.0\.1:9333\/devtools\/browser\//.test(version.webSocketDebuggerUrl)) {
        const browser = new WebSocket(version.webSocketDebuggerUrl);
        browser.addEventListener('open', () => browser.send(JSON.stringify({ id: 1, method: 'Browser.close' })), { once: true });
        browser.addEventListener('error', () => {}, { once: true });
      }
    } catch { /* 关不掉时留给下次运行复用 */ }
  }
}
