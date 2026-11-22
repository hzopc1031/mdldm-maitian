import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { readJson, writeJson } from '../project.mjs';
import { runQueue } from '../queue.mjs';

const cli = fileURLToPath(new URL('../xhs.mjs', import.meta.url));

test('队列只处理当前批准的稿件，撤回、变更和重复执行均被拦截', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maitian-xhs-queue-'));
  const id = 'queue-fixture';
  const dir = path.join(root, id);
  const draftFile = path.join(dir, 'draft.json');
  const account = '离线测试账号';
  const call = (command, ...args) => spawnSync(process.execPath, [cli, command, ...args], {
    encoding: 'utf8', timeout: 45_000,
  });
  const run = (command, ...args) => {
    const result = call(command, ...args);
    assert.equal(result.status, 0, result.stderr || result.error?.message);
    return JSON.parse(result.stdout);
  };
  const refuse = (pattern, command, ...args) => {
    const result = call(command, ...args);
    assert.equal(result.status, 1, result.stderr || result.error?.message);
    assert.match(result.stderr, pattern);
  };
  const dryRun = () => run('run-queue', root, '--dry-run');
  try {
    run('init', dir);
    writeJson(draftFile, {
      ...readJson(draftFile), title: '队列验收', body: '一份仅在本地使用的队列测试稿。',
      sources: [{ kind: 'url', title: '测试', url: 'https://example.com/', evidence: '合成测试来源' }],
    });
    writeJson(path.join(dir, 'cards.json'), [{ title: '队列验收', body: '占位卡片' }]);
    run('render', dir);
    const { digest } = run('check', dir);
    assert.equal(dryRun().status, 'empty');
    refuse(/摘要不一致/, 'queue-web', dir, 'wrong', account);
    run('approve-offline', dir, digest);
    assert.equal(dryRun().status, 'empty');

    const queued = run('queue-web', dir, digest, account);
    assert.equal(queued.phase, '待上传');
    assert.deepEqual(dryRun(), { status: 'ready', dryRun: true, id, digest, account });
    assert.deepEqual(run('status', dir), queued);
    assert.equal(run('cancel-web', dir).phase, '待审核');
    assert.equal(dryRun().status, 'empty');

    run('queue-web', dir, digest, account);
    writeJson(draftFile, { ...readJson(draftFile), body: '审核后修改。' });
    assert.equal(dryRun().status, 'blocked');
    assert.equal(run('status', dir).phase, '待上传');
    refuse(/摘要不一致/, 'run-queue', root);
    assert.equal(run('status', dir).phase, '失败');
    assert.equal(dryRun().status, 'empty');

    const next = run('check', dir);
    run('queue-web', dir, next.digest, account);
    fs.mkdirSync(path.join(root, '.lock'));
    refuse(/已被锁定/, 'run-queue', root);
    fs.rmdirSync(path.join(root, '.lock'));
    let calls = 0;
    const prepare = async (project, candidate, approvedDigest, approvedAccount) => {
      calls += 1;
      assert.equal(project.id, id);
      assert.equal(candidate.digest, next.digest);
      assert.equal(approvedDigest, next.digest);
      assert.equal(approvedAccount, account);
      return project.setState('待确认', { mode: 'web-preview', digest: approvedDigest, account, submitClicked: false });
    };
    assert.equal((await runQueue(root, { prepare })).status, 'prepared');
    assert.equal((await runQueue(root, { prepare })).status, 'empty');
    assert.equal(calls, 1);
    assert.equal(run('queue-web', dir, next.digest, account).alreadyPrepared, true);
    assert.equal(dryRun().status, 'empty');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
