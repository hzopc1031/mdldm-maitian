import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../xhs.mjs', import.meta.url));

test('从任务建档、出图、审核到离线 Chrome 回读，停在提交前', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'maitian-xhs-test-'));
  const dir = path.join(base, 'xhs-offline-demo');
  const draftFile = path.join(dir, 'draft.json');
  const call = (command, ...args) => spawnSync(process.execPath, [cli, command, dir, ...args], {
    encoding: 'utf8', timeout: 45_000,
  });
  const run = (command, ...args) => {
    const result = call(command, ...args);
    assert.equal(result.status, 0, result.stderr || result.error?.message);
    return JSON.parse(result.stdout);
  };
  const refuse = (command, pattern, ...args) => {
    const result = call(command, ...args);
    assert.equal(result.status, 1, result.stderr || result.error?.message);
    assert.match(result.stderr, pattern);
  };
  const write = (file, data) => fs.writeFileSync(path.join(dir, file), JSON.stringify(data));
  try {
    assert.equal(run('init').phase, '待制作');
    refuse('check', /标题/);
    const draft = {
      version: 1, id: 'xhs-offline-demo', title: '图文流水线离线验收',
      body: '这是工程验收用的占位稿。\n\n这里只验证本地出图、图片顺序和表单回读。',
      topics: ['离线验收', '测试图文'],
      sources: [{ kind: 'local', title: '随工程生成的测试说明', path: 'source.md', evidence: '合成数据，只验证工作流。' }],
      scheduledFor: '2030-01-02T19:30:00+08:00', images: [],
    };
    fs.writeFileSync(path.join(dir, 'source.md'), '# 离线验收占位说明\n\n所有内容均为合成测试数据。\n');
    write('draft.json', draft);
    refuse('check', /提供 1–9 张/);
    write('cards.json', [
      { title: '离线验收卡片一', body: '检查文件序号、尺寸和顺序。\n本卡片是合成测试数据。' },
      { title: '离线验收卡片二', body: '检查正文、话题和时间回读。\n这张卡片也仅供验收。' },
    ]);
    assert.deepEqual(run('render').images, ['01.png', '02.png']);
    draft.images = ['images/01.png', 'images/02.png'];
    write('draft.json', { ...draft, images: [...draft.images].reverse() });
    refuse('check', /第 1 张图片须为/);
    write('draft.json', { ...draft, scheduledFor: '2030-02-30T19:30:00+08:00' });
    refuse('check', /日期或时间无效/);
    write('draft.json', draft);
    const missing = path.join(dir, draft.images[1]);
    const restore = fs.readFileSync(missing);
    fs.unlinkSync(missing);
    refuse('check', /ENOENT/);
    fs.writeFileSync(missing, restore);
    const candidate = run('check');
    assert.equal(candidate.phase, '待审核');
    assert.deepEqual(candidate.images.map(({ width, height }) => [width, height]), [[1080, 1440], [1080, 1440]]);
    refuse('preview-offline', /离线验收确认/);
    refuse('approve-offline', /摘要不一致/, 'wrong-digest');
    assert.equal(run('approve-offline', candidate.digest).permission, 'offline-only');
    const first = path.join(dir, draft.images[0]);
    const firstBytes = fs.readFileSync(first);
    fs.writeFileSync(first, restore);
    fs.writeFileSync(missing, firstBytes);
    refuse('preview-offline', /更改/);
    fs.writeFileSync(first, firstBytes);
    fs.writeFileSync(missing, restore);
    assert.deepEqual(JSON.parse(fs.readFileSync(draftFile)), draft);
    const result = run('preview-offline');
    assert.deepEqual(result, {
      id: draft.id, mode: 'offline-only', phase: '待确认', images: ['01.png', '02.png'],
      topics: draft.topics, time: '2030-01-02 19:30', submitClicks: 0,
    });
    refuse('preview-offline', /离线验收确认/);
    refuse('publish', /用法/);
    const report = JSON.parse(fs.readFileSync(path.join(dir, 'offline-result.json')));
    assert.equal(report.body, draft.body);
    assert.equal(report.digest, candidate.digest);
    assert.equal(report.submitButtonPresent, true);
    assert.equal(run('status').phase, '待确认');
    assert(fs.statSync(path.join(dir, 'offline-preview.png')).size > 1000);
    if (process.env.MAITIAN_XHS_EVIDENCE_DIR) {
      const evidence = path.resolve(process.env.MAITIAN_XHS_EVIDENCE_DIR);
      assert(!fs.existsSync(evidence), '验收产物目录必须是新目录');
      fs.cpSync(dir, evidence, { recursive: true, errorOnExist: true });
    }
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});
