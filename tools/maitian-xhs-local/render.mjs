import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { imageName, readJson, requireThat, writeJson } from './project.mjs';

const renderer = fileURLToPath(new URL('./render.swift', import.meta.url));

export function renderProject(project) {
  const draft = readJson(project.draftFile);
  requireThat(draft.version === 1 && draft.id === project.id, '任务版本或固定 ID 不匹配');
  const output = path.join(project.root, 'images');
  requireThat(fs.realpathSync(output) === output, '图片目录不能是符号链接');
  const staging = fs.mkdtempSync(path.join(project.root, '.render-'));
  try {
    const cards = path.join(project.root, 'cards.json');
    requireThat(fs.realpathSync(cards) === cards, '卡片文件不能是符号链接');
    const result = spawnSync('/usr/bin/swift', [renderer, cards, staging], { encoding: 'utf8', timeout: 35_000 });
    requireThat(result.status === 0, result.stderr?.trim() || '本地图片渲染失败');
    const files = fs.readdirSync(staging).sort();
    requireThat(files.length > 0 && files.every((name, i) => name === path.basename(imageName(i))), '渲染结果编号无效');
    project.setState('待制作');
    for (const name of files) fs.renameSync(path.join(staging, name), path.join(output, name));
    writeJson(project.draftFile, { ...draft, images: files.map((name) => `images/${name}`) });
    return { id: project.id, images: files, phase: '待制作' };
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}
