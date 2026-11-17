// 离线验收：仅新 L1 入口、示例 JSON 和隔离临时库，无浏览器路径。
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (process.cwd().toLowerCase() !== root.toLowerCase()) throw new Error(`请在 ${root} 运行`);
const folder = path.join(root, '_l1-selftest', new Date().toISOString().replace(/[:.]/g, '-'));
fs.mkdirSync(folder, { recursive: true });
const database = path.join(folder, 'hub.db'), config = path.join(folder, 'config.json'), reports = path.join(folder, 'reports');
fs.writeFileSync(config, '{}');
const env = { ...process.env, MAITIAN_HOME: folder, MAITIAN_DB: database, MAITIAN_CONFIG: config };
const output = ['示例 / 假数据离线自测，不是真实账号数据', `cwd=${root}`, `MAITIAN_DB=${database}`, `MAITIAN_CONFIG=${config}`, `MAITIAN_HOME=${folder}`, '未启动 Chrome；未连接 9340；未访问正式库。'];
let inspect;
function run(args, expected = 0, overrides = {}) {
  output.push(`\n> node ${args.join(' ')}`);
  const result = spawnSync(process.execPath, args, { cwd: root, env: { ...env, ...overrides }, encoding: 'utf8' });
  output.push(`exit=${result.status}`, result.stdout || '', result.stderr || '');
  assert.equal(result.status, expected, result.error?.message || result.stderr);
}
const fixture = JSON.parse(fs.readFileSync(path.join(root, 'examples/x-sample.json'), 'utf8'));
function copy(name, edit) {
  const input = structuredClone(fixture); edit(input);
  const file = path.join(folder, `${name}.json`); fs.writeFileSync(file, JSON.stringify(input)); return file;
}
try {
  run(['scripts/l1-run.mjs', '--only', 'x', '--date', '2026-11-17', '--x-json', 'examples/x-sample.json', '--report-dir', reports]);
  inspect = new DatabaseSync(database);
  const count = table => inspect.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
  const counts = () => Object.fromEntries(['episodes','tasks','metrics','followers','samples','snapshots'].map(table => [table, count(table)]));
  assert.deepEqual(counts(), { episodes: 2, tasks: 2, metrics: 2, followers: 1, samples: 2, snapshots: 2 });
  const first = inspect.prepare("SELECT * FROM metrics WHERE episode_id='external:x:sample-001'").get();
  assert.equal(first.favorites, null); assert.equal(first.shares, null); assert.equal(JSON.parse(first.extra).quotes, 2);
  assert.equal(inspect.prepare("SELECT views FROM metrics WHERE episode_id='external:x:sample-002'").get().views, null);
  assert.equal(inspect.prepare('SELECT ts FROM samples LIMIT 1').get().ts, '2026-11-17T00:30');
  const follower = inspect.prepare('SELECT * FROM followers').get();
  assert.equal(follower.day, '2026-11-17'); assert.equal(follower.source, 'grok-public'); assert.equal(follower.gain, null); assert.equal(follower.loss, null);
  assert.equal(JSON.parse(inspect.prepare("SELECT project FROM snapshots WHERE episode_id='external:x:sample-002'").get().project).created_at, null);
  assert.equal(inspect.prepare('SELECT dir FROM episodes LIMIT 1').get().dir, '');
  const before = counts();
  run(['scripts/import-x-public.mjs', 'examples/x-sample.json']);
  assert.deepEqual(counts(), before);
  const report = fs.readFileSync(path.join(reports, 'daily/2026-11-17.md'), 'utf8');
  assert.match(report, /示例 \/ 假数据/); assert.match(report, /较上次实测新增：暂无/); assert.match(report, /456/); assert.match(report, /TwoPeanuts/);
  assert.equal(fs.readFileSync(path.join(reports, 'latest.md'), 'utf8'), report);
  output.push(`PASS 初次入库 ${JSON.stringify(before)}；重复导入行数不变；NULL/quotes/UTC分钟/快照未知日期/日报均正确。`);

  const newer = copy('newer-null', input => { input.captured_at = '2026-11-17T09:30:00+08:00'; input.followers = null; input.posts[0].likes = null; input.posts[0].views = 999; });
  run(['scripts/import-x-public.mjs', newer]);
  let row = inspect.prepare("SELECT * FROM metrics WHERE episode_id='external:x:sample-001'").get();
  assert.equal(row.likes, 12); assert.equal(row.views, 999); assert.equal(count('followers'), 1);
  assert.equal(JSON.parse(row.extra).field_observed_at.likes, '2026-11-17T00:30:00.000Z');
  run(['scripts/import-x-public.mjs', 'examples/x-sample.json']);
  row = inspect.prepare("SELECT * FROM metrics WHERE episode_id='external:x:sample-001'").get();
  assert.equal(row.views, 999); assert.equal(row.collected_at, '2026-11-17T01:30:00.000Z');
  output.push('PASS 新观测 null 不覆盖已有非空；旧观测不覆盖更新值；null followers 不写入。');

  const boundary = copy('beijing-boundary', input => { input.captured_at = '2026-11-17T18:00:00Z'; input.followers = 130; });
  run(['scripts/l1-run.mjs', '--only', 'x', '--date', '2026-11-18', '--x-json', boundary, '--report-dir', reports]);
  assert.equal(inspect.prepare("SELECT total FROM followers WHERE day='2026-11-18'").get().total, 130);
  assert.equal(inspect.prepare("SELECT COUNT(*) AS n FROM metrics WHERE day='2026-11-18'").get().n, 2);
  assert.match(fs.readFileSync(path.join(reports, 'latest.md'), 'utf8'), /较上次实测新增：\+7/);
  output.push('PASS captured_at UTC→北京时间跨日；粉丝增量 +7 来自 130−123 实测基线。');

  const unchanged = JSON.stringify(counts());
  for (const [name, edit] of [
    ['wrong-account', input => { input.account = 'house'; }],
    ['bad-url', input => { input.posts[0].url = 'https://x.com/SomeoneElse/status/sample-001'; }],
    ['negative', input => { input.posts[0].likes = -1; }],
    ['non-number', input => { input.posts[0].views = '456'; }],
    ['missing-zone', input => { input.captured_at = '2026-11-17T08:30:00'; }],
  ]) {
    const file = copy(name, edit);
    run(['scripts/import-x-public.mjs', file], 1);
    assert.equal(JSON.stringify(counts()), unchanged);
    const untouched = path.join(folder, `${name}-must-not-exist.db`);
    run(['scripts/import-x-public.mjs', file], 1, { MAITIAN_DB: untouched });
    assert.equal(fs.existsSync(untouched), false);
  }
  output.push('PASS 错误账号/URL/负数/字符串数字/无时区均退出1，原库行数不变，未创建目标库。');
  const oldPosts = copy('old-posts', input => { input.posts = [input.posts[0]]; input.posts[0].created_at = '2026-09-01T12:00:00+08:00'; input.followers = null; });
  run(['scripts/import-x-public.mjs', oldPosts]);
  assert.equal(JSON.stringify(counts()), unchanged);
  output.push('PASS 窗口外作品跳过，没有新增行。');
  const rollback = copy('transaction-rollback', input => { input.posts[0].id = 'sample-rollback'; input.posts[0].url = 'https://x.com/PeanutPair/status/sample-rollback'; });
  inspect.exec("CREATE TRIGGER l1_test_abort BEFORE INSERT ON metrics BEGIN SELECT RAISE(ABORT, 'offline rollback test'); END");
  run(['scripts/import-x-public.mjs', rollback], 1);
  assert.equal(JSON.stringify(counts()), unchanged);
  assert.equal(inspect.prepare("SELECT COUNT(*) AS n FROM episodes WHERE id='external:x:sample-rollback'").get().n, 0);
  inspect.exec('DROP TRIGGER l1_test_abort');
  output.push('PASS 模拟数据库写入失败，整批事务回滚，未残留 episode/task/snapshot。');
  // 配置缺失时 standalone 仍可运行，且不会加载 feishu.mjs。
  run(['scripts/import-x-public.mjs', 'examples/x-sample.json'], 0, { MAITIAN_CONFIG: '', MAITIAN_HOME: path.join(folder, 'no-config') });
  output.push('PASS 无 config.json 仍可导入（独立 MAITIAN_HOME 临时目录）。');
  output.push(`FINAL counts=${JSON.stringify(counts())}`, 'SELFTEST PASS，全部检查通过。');
} catch (error) {
  output.push(`SELFTEST FAIL: ${error.stack}`); process.exitCode = 1;
} finally {
  inspect?.close();
  fs.writeFileSync(path.join(root, '_l1-selftest-output.txt'), output.join('\n'), 'utf8');
  console.log(output.join('\n'));
}
