// 隔离配置和数据库的 loopback HTTP 测试，不连接正式服务或浏览器。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import vm from 'node:vm';
import { authPage, cleanTarget, localRequestAllowed } from '../src/web-auth.mjs';
for (const value of ['https://example.invalid/', '//example.invalid/', '/\\example.invalid/', '/auth', '/p\r\nLocation:evil']) assert.equal(cleanTarget(value), '/');
assert.equal(cleanTarget('/p?key=sample-only&tab=1#/system'), '/p?tab=1#/system');
assert.equal(cleanTarget('/p#/system'), '/p#/system');
assert.ok(authPage(true, '/p#/system').includes('same-origin'));
const source = fs.readFileSync(new URL('../src/web/health.js', import.meta.url), 'utf8');
for (const input of [undefined, null, {}, { login: {} }, { mode: 'l1', daemon: false }]) {
  const context = { input }; vm.createContext(context);
  const result = vm.runInContext(source + ';healthLights(input)', context);
  assert.ok(result.includes('未实时检查')); assert.ok(!result.includes('今日已检')); assert.ok(!result.includes('守护进程 运行中'));
}
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'maitian-web-auth-'));
const testKey = 'fixture-key';
process.env.MAITIAN_HOME = directory;
process.env.MAITIAN_DB = path.join(directory, 'hub.db');
process.env.MAITIAN_CONFIG = path.join(directory, 'config.json');
fs.writeFileSync(process.env.MAITIAN_CONFIG, JSON.stringify({ web: { key: testKey, widgetToken: 'fixture-widget' } }));
await import('../src/l1-store.mjs');
const { config } = await import('../src/feishu.mjs');
const { db } = await import('../src/db.mjs');
const { handle } = await import('../src/web.mjs');
const server = http.createServer((req, res) => {
  handle(req, res).catch(error => {
    res.writeHead(500);
    res.end(error.message);
  });
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const { port } = server.address(), host = `localhost:${port}`, origin = `http://${host}`;

function request(route, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: route,
      method: body === undefined ? 'GET' : 'POST', headers: { host, ...headers } }, res => {
      let text = '';
      res.setEncoding('utf8').on('data', chunk => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, text, headers: res.headers }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

try {
  const protectedReads = ['/', '/p', '/api/overview', '/api/l1/status', '/api/prep'];
  for (const route of protectedReads) assert.equal((await request(route)).status, 401, route);
  assert.equal((await request('/api/overview', { headers: { 'x-maitian-key': testKey } })).status, 200);
  const login = await request('/auth', { headers: { origin }, body: `key=${testKey}&returnTo=%2Fp%23%2Fsystem` });
  assert.equal(login.status, 303);
  assert.equal(login.headers.location, '/p#/system');
  const [sessionCookie] = login.headers['set-cookie'][0].split(';');
  assert.equal((await request('/p', { headers: { cookie: sessionCookie } })).status, 200);
  assert.equal((await request('/auth', { headers: { origin: 'https://other.invalid' }, body: 'key=wrong' })).status, 403);
  assert.equal((await request('/auth', { body: 'a'.repeat(4097) })).status, 413);
  delete config.web.key;
  config.web.requireLocalToken = 'false';
  assert.equal((await request('/api/overview')).status, 401);
  console.log('PASS default authentication, header/cookie compatibility, login origin and body limit, fail-closed without a key');

  config.web.requireLocalToken = false;
  for (const route of protectedReads) {
    const response = await request(route);
    assert.equal(response.status, 200, route);
    assert.equal(response.headers['set-cookie'], undefined, route);
    assert.equal(response.headers['access-control-allow-origin'], undefined, route);
    assert.equal(response.headers['cross-origin-resource-policy'], 'same-origin', route);
  }
  assert.equal((await request('/p', { headers: { host: `127.0.0.1:${port}` } })).status, 200);
  const status = await request('/api/action', { headers: { origin, 'sec-fetch-site': 'same-origin' }, body: JSON.stringify({ type: 'status', platform: 'xhs' }) });
  assert.equal(status.status, 200);
  assert.equal((await request('/api/prep', { headers: { origin }, body: '{}' })).status, 400);
  assert.equal((await request('/api/prep/image', { headers: { origin }, body: '' })).status, 400);
  assert.equal((await request('/widget')).status, 401);
  assert.equal((await request('/api/widget')).status, 401);
  assert.equal((await request('/api/widget', { headers: { 'x-widget-token': 'fixture-widget' } })).status, 200);
  console.log('PASS direct local pages and APIs without a token or cookie, with separate widget authentication');

  for (const headers of [
    { host: `other.invalid:${port}` }, { host: 'localhost:8788' }, { host: 'localhost' },
    { forwarded: 'for=192.0.2.1' }, { 'x-forwarded-host': host }, { 'cf-connecting-ip': '192.0.2.1' },
    { origin: `http://127.0.0.1:${port}` }, { origin: 'null' },
    { 'sec-fetch-site': 'cross-site' }, { 'sec-fetch-site': 'same-site' },
  ]) assert.equal((await request('/api/overview', { headers })).status, 403);
  for (const route of ['/auth', '/api/action', '/api/prep', '/api/prep/image']) {
    for (const headers of [{}, { origin: 'http://localhost:8788' }, { origin, 'sec-fetch-site': 'cross-site' }]) {
      assert.equal((await request(route, { headers, body: '{}' })).status, 403, route);
    }
  }
  assert.equal((await request('http://other.invalid/api/overview')).status, 403);
  assert.equal(localRequestAllowed({ headers: { host }, method: 'GET', url: '/', socket: { remoteAddress: '192.0.2.1', localPort: port } }), false);
  console.log('PASS Host, forwarded headers, non-loopback peer and cross-origin/missing-Origin CSRF checks');
} finally {
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  db.close();
  fs.unlinkSync(process.env.MAITIAN_CONFIG);
  fs.unlinkSync(process.env.MAITIAN_DB);
  fs.rmdirSync(directory);
}
