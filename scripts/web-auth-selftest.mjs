// 离线/HTTP 补充检查，不计入真实 Chrome 页面验收。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { authPage, cleanTarget } from '../src/web-auth.mjs';
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
const base = 'http://127.0.0.1:8787';
const evidence = { at: new Date().toISOString(), classification: '离线/HTTP，不是真实页面通过', results: [] };
for (const endpoint of ['/api/overview', '/api/l1/status']) {
  const r = await fetch(base + endpoint);
  assert.equal(r.status, 401); assert.deepEqual(await r.json(), { error: '需要登录' });
  evidence.results.push({ test: '未鉴权 ' + endpoint, result: '401，已阻止' });
}
const cross = await fetch(base + '/auth', { method: 'POST', headers: { origin: 'https://example.invalid' }, body: 'key=invalid-sample' });
assert.equal(cross.status, 403);
evidence.results.push({ test: '跨来源 POST /auth', result: '403，已阻止' });
const oversized = await fetch(base + '/auth', { method: 'POST', body: 'a'.repeat(4097) });
assert.equal(oversized.status, 413);
evidence.results.push({ test: '过大 POST /auth', result: '413，已阻止' });
evidence.results.push({ test: '跳转目标过滤与 health 缺失/空值', result: '离线通过' });
fs.writeFileSync('_local-web-auth-http.json', JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence, null, 2));
