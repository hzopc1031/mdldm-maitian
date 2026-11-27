import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-cfg-'));
process.env.MAITIAN_CONFIG = path.join(dir, 'config.json');
const seed = { name: '麦田', feishuWebhook: 'https://old', web: { port: 8787, key: 'k' }, board: { url: 'B' }, rootPath: '/tmp/x' };
fs.writeFileSync(process.env.MAITIAN_CONFIG, JSON.stringify(seed, null, 2));

const { config } = await import('../src/feishu.mjs');
const mod = await import('../src/config-admin.mjs');

test('飞书 patch 只动飞书字段', () => {
  const r = mod.applyFeishuPatch(config, { webhook: 'https://new', login: true });
  assert.equal(r.webhook, 'https://new');
  assert.equal(config.feishuWebhook, 'https://new');
  assert.equal(config.web.login, 'feishu');
  assert.equal(config.web.key, 'k');        // 其它 web 字段不动
  assert.equal(config.board.url, 'B');      // board 不动
  assert.equal(config.rootPath, '/tmp/x');
  mod.applyFeishuPatch(config, { webhook: 'https://new', login: false });
  assert.equal('login' in config.web, false);
});

test('开着飞书登录不能清空 webhook', () => {
  assert.throws(() => mod.applyFeishuPatch(config, { webhook: '', login: true }), /先填 webhook/);
  assert.equal(config.feishuWebhook, 'https://new');   // 抛错前不改配置
});

test('知识站 patch 写 enabled 并保留字段', () => {
  const s = mod.applySitePatch(config, { enabled: true, name: '站', base: 'https://a.com/', dashboardApi: '/api/admin/dashboard' });
  assert.equal(s.enabled, true);
  assert.equal(s.base, 'https://a.com/');   // 原样存，拼接在 site.mjs 里去斜杠
  mod.applySitePatch(config, { enabled: false });
  assert.equal(config.site.enabled, false);
});

test('知识站启用时必须有站点地址', () => {
  assert.throws(() => mod.applySitePatch(config, { enabled: true, base: '' }), /先填站点地址/);
  // 停用可以空着
  const s = mod.applySitePatch(config, { enabled: false, base: '' });
  assert.equal(s.enabled, false);
  assert.equal(s.base, '');
});

test('saveConfig 备份并可回滚', () => {
  const before = fs.readFileSync(process.env.MAITIAN_CONFIG, 'utf8');
  mod.saveConfig(config);
  assert.ok(fs.existsSync(process.env.MAITIAN_CONFIG + '.bak'));
  assert.notEqual(fs.readFileSync(process.env.MAITIAN_CONFIG, 'utf8'), before);
});
