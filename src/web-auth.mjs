export const isLoopback = address => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address);

// 免口令模式只接受直连，使用实际监听端口校验 Host 和浏览器来源。
export function localRequestAllowed(req) {
  const { headers, socket, method } = req;
  if (!isLoopback(socket.remoteAddress)) return false;
  if (!req.url.startsWith('/') || req.url.startsWith('//')) return false;
  const host = headers.host?.toLowerCase();
  const port = socket.localPort;
  const localHost = port === 80 ? host?.replace(/:80$/, '') : host;
  const suffix = port === 80 ? '' : `:${port}`;
  if (localHost !== `localhost${suffix}` && localHost !== `127.0.0.1${suffix}`) return false;
  if (Object.keys(headers).some(name => /^(?:forwarded$|via$|x-forwarded-|x-real-ip$|true-client-ip$|cf-)/.test(name))) return false;
  if (headers['sec-fetch-site'] && !['none', 'same-origin'].includes(headers['sec-fetch-site'])) return false;
  if (headers.origin !== undefined) return headers.origin === `http://${localHost}`;
  return method === 'GET' || method === 'HEAD';
}

// 口令只由浏览器 POST /auth；不反射进 HTML、URL 或日志。
export const cleanTarget = value => {
  try {
    if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || /[\\\r\n]/.test(value)) return '/';
    const u = new URL(value, 'http://local');
    if (u.origin !== 'http://local' || u.pathname === '/auth') return '/';
    u.searchParams.delete('key');
    return u.pathname + u.search + u.hash;
  } catch { return '/'; }
};
export const authPage = (error = false, returnTo = null) => `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="same-origin"><title>登录麦田工作台</title><style>body{margin:0;background:#f5f5f7;color:#1d1d1f;font:16px system-ui;display:grid;min-height:100vh;place-items:center}main{box-sizing:border-box;width:min(400px,92vw);background:white;padding:32px;border-radius:20px;box-shadow:0 8px 40px #0001}h1{font-size:26px}label{display:block;margin:24px 0 8px}input,button{box-sizing:border-box;width:100%;padding:12px;font:inherit;border-radius:10px;border:1px solid #aaa}button{margin-top:20px;color:white;background:#0071e3;border:0;cursor:pointer}p{color:#656565;line-height:1.6}.error{color:#b42318}</style></head><body><main><h1>登录麦田工作台</h1><p>请输入工作台访问口令。</p>${error ? '<p class="error" role="alert">口令不正确，请重试。</p>' : ''}<form method="post" action="/auth"><label for="key">访问口令</label><input id="key" name="key" type="password" required autocomplete="off"><input id="returnTo" name="returnTo" type="hidden" value="/"><button type="submit">进入工作台</button></form></main><script>const u=new URL(location.href);u.searchParams.delete('key');history.replaceState(null,'',u.pathname+u.search+u.hash);document.getElementById('returnTo').value=${JSON.stringify(returnTo ? cleanTarget(returnTo) : null).replace(/</g, '\\u003c')} || u.pathname+u.search+u.hash;</script></body></html>`;
