import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { produce } from '../produce.mjs';
import { openProject, readJson, validateProject, writeJson } from '../project.mjs';
import { runQueue } from '../queue.mjs';

test('出稿只封装已核对的来源，渲染后进入待审核，失败不留下半成品', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maitian-xhs-produce-'));
  const directory = path.join(root, 'produce-demo');
  const briefFile = path.join(root, 'input.json');
  const brief = {
    topic: '图文生产占位测试',
    guidance: '写给初次看到验收页的人。',
    cardCount: 2,
    sources: [{ title: '合成资料', url: 'https://example.com/', evidence: '绿色表示已完成，灰色表示待办。' }],
    localTest: { environment: '合成验收环境', observed: '用于模拟实测字段。', limits: '本用例使用占位数据。' },
  };
  const modelAnswer = {
    title: '两个颜色怎么看',
    body: '先看颜色。绿色表示已完成，灰色表示待办。',
    topics: ['占位测试'],
    cards: [
      { title: '绿色卡片', body: '绿色表示已完成。', label: '', code: '' },
      { title: '灰色卡片', body: '灰色表示待办。', label: '', code: '' },
    ],
  };
  let modelCalls = 0;
  const generate = (payload) => {
    modelCalls += 1;
    assert.equal(payload.topic, brief.topic);
    assert.deepEqual(payload.sources, brief.sources.map(source => ({ ...source, kind: 'url' })));
    return modelAnswer;
  };
  try {
    writeJson(briefFile, brief);
    const result = await produce(directory, briefFile, { generate });
    const candidate = validateProject(openProject(directory));
    assert.equal(result.phase, '待审核');
    assert.equal(result.digest, candidate.digest);
    assert.equal(candidate.scheduledFor, null);
    assert.deepEqual(candidate.sources.slice(0, 1), brief.sources.map(source => ({ ...source, kind: 'url' })));
    assert.equal(candidate.sources[1].kind, 'local');
    assert.deepEqual(readJson(path.join(directory, '本机实测.json')), brief.localTest);
    assert.deepEqual(candidate.images.map(({ name, width, height }) => [name, width, height]), [
      ['images/01.png', 1080, 1440], ['images/02.png', 1080, 1440],
    ]);
    assert.equal((await runQueue(root, { dryRun: true })).status, 'empty');
    assert.equal(readJson(path.join(directory, 'brief.json')).cardCount, 2);
    await assert.rejects(() => produce(directory, briefFile, { generate }), /任务目录已存在/);
    const incomplete = path.join(root, 'incomplete');
    await assert.rejects(() => produce(incomplete, briefFile, {
      generate: () => ({ ...modelAnswer, cards: [] }),
    }), /卡片数量/);
    assert.equal(fs.existsSync(incomplete), false);
    writeJson(briefFile, { ...brief, sources: [] });
    await assert.rejects(() => produce(incomplete, briefFile, { generate }), /须提供/);
    writeJson(briefFile, { ...brief, localTest: null });
    await assert.rejects(() => produce(incomplete, briefFile, { generate }), /本机 DSH 实测/);
    assert.equal(modelCalls, 1);
    assert.deepEqual(fs.readdirSync(root).sort(), ['input.json', 'produce-demo']);

    writeJson(briefFile, { ...brief, visualMode: 'interface' });
    await assert.rejects(() => produce(incomplete, briefFile, { generate }), /本期插件名称/);
    const interfaceBrief = {
      ...brief, visualMode: 'interface', pluginName: 'dsh-sample', episode: 2, coverSummary: '用一张总览看清会话统计。',
    };
    writeJson(briefFile, interfaceBrief);
    await assert.rejects(() => produce(incomplete, briefFile, { generate }), /全局效果封面/);
    const screenshot = 'screen-fixture.png';
    fs.copyFileSync(path.join(directory, candidate.images[0].name), path.join(root, screenshot));
    const interfaceScreenshots = [
      { card: 1, file: screenshot, role: 'overview', crop: { x: 12, y: 20, width: 880, height: 660 } },
      { card: 2, file: screenshot, crop: { x: 20, y: 30, width: 600, height: 430 } },
    ];
    writeJson(briefFile, { ...interfaceBrief, interfaceScreenshots });
    const withImages = path.join(root, 'interface-demo');
    assert.equal((await produce(withImages, briefFile, { generate })).phase, '待审核');
    const screenshotProject = validateProject(openProject(withImages));
    assert.notEqual(screenshotProject.images[0].sha256, candidate.images[0].sha256);
    const cards = readJson(path.join(withImages, 'cards.json'));
    assert.equal(cards[0].label, 'DEEPSEEK HARNESS / 插件教程 02 · dsh-sample');
    assert.equal(cards[1].label, cards[0].label);
    assert.equal(cards[0].body, interfaceBrief.coverSummary);
    assert.equal(cards[0].screenshots[0].role, 'overview');
    assert.equal(Object.hasOwn(cards[0].screenshots[0], 'caption'), false);
    assert.equal(cards[1].screenshots[0].file, screenshot);
    assert.ok(fs.existsSync(path.join(withImages, screenshot)));
    interfaceScreenshots[0].crop.width = 100_000;
    writeJson(briefFile, { ...interfaceBrief, interfaceScreenshots });
    await assert.rejects(() => produce(incomplete, briefFile, { generate }), /裁切范围/);
    assert.equal(fs.existsSync(incomplete), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
