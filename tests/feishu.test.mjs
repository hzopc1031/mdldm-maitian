import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-fs-'));
process.env.MAITIAN_CONFIG = path.join(dir, 'config.json');
fs.writeFileSync(process.env.MAITIAN_CONFIG, JSON.stringify({ name: '麦田', feishuWebhook: 'https://saved' }));

test('成功', async () => {
  globalThis.fetch = async () => ({ json: async () => ({ code: 0 }) });
  const { testFeishu } = await import(`../src/feishu.mjs?t=${Date.now()}`);
  const r = await testFeishu('https://input');
  assert.equal(r.ok, true);
});

test('飞书拒绝', async () => {
  globalThis.fetch = async () => ({ json: async () => ({ code: 19001, msg: 'bad token' }) });
  const { testFeishu } = await import(`../src/feishu.mjs?t=${Date.now()}`);
  const r = await testFeishu('https://input');
  assert.equal(r.ok, false);
  assert.match(r.error, /bad token/);
});

test('网络异常', async () => {
  globalThis.fetch = async () => { throw new Error('offline'); };
  const { testFeishu } = await import(`../src/feishu.mjs?t=${Date.now()}`);
  const r = await testFeishu('https://input');
  assert.equal(r.ok, false);
  assert.match(r.error, /offline/);
});

test('空 webhook 直接报错', async () => {
  const { testFeishu } = await import(`../src/feishu.mjs?t=${Date.now()}`);
  const r = await testFeishu('');
  assert.equal(r.ok, false);
  assert.match(r.error, /webhook/);
});
