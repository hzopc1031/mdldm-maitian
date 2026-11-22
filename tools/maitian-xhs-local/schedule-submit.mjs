import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readJson, readSchedule, requireThat, writeJson } from './project.mjs';
import {
  connectChrome, findApprovedEditor, requireScheduleApproval, requireWebApproval, SCHEDULE_VALUE, verifyEditorImages,
} from './web-preview.mjs';

const MANAGER = 'https://creator.xiaohongshu.com/new/note-manager';
const READ_MANAGER = `(() => {
  if (location.origin + location.pathname !== ${JSON.stringify(MANAGER)}) return null;
  const account = document.querySelector('.d-topbar-default .user-info .name-box')?.textContent.trim();
  return account && document.querySelector('.note-card') ? account : null;
})()`;

const matchingCards = (title) => `[...document.querySelectorAll('.note-card')].filter(card =>
  card.querySelector('.note-card__title')?.textContent.trim() === ${JSON.stringify(title)})`;

async function readRows(cdp, id, account, title) {
  const shown = await cdp.waitFor(id, READ_MANAGER, 6000);
  requireThat(shown === account, '笔记管理未显示已确认的账号或未加载');
  return cdp.evaluate(id, `${matchingCards(title)}.map(card => ({
    text: card.innerText.trim(),
    time: card.querySelector('.note-card__time')?.innerText.trim() ?? '',
  }))`);
}

export function isConfirmedSchedule(rows, displayedTime) {
  if (rows.length !== 1) return false;
  const text = rows[0].text.replace(/[–—－]/g, '-').replace(/\s+/g, ' ');
  return text.includes(displayedTime) && /定时发布|待发布|定时中|已定时/.test(text);
}

export function requireMatchingAttempt(attempt, id, digest, account, schedule) {
  requireThat(attempt.id === id && attempt.digest === digest &&
    attempt.account === account && attempt.requested === schedule, '该任务已有其他版本或时间的提交记录');
}

export function hasIdentityChallenge(nodes) {
  return nodes.some(node => !node.ignored && node.role?.value === 'StaticText' &&
    (/扫码验证身份|请完成安全验证/.test(node.name?.value ?? '') || node.name?.value === '扫码验证'));
}

export function requireResumableAttempt(attempt, now = Date.now()) {
  requireThat(attempt?.status === '等待扫码验证' && !attempt.resumedAt, '没有可接续的扫码验证提交记录');
  requireThat(Date.parse(attempt.requested) > now, '原定时时间已过');
}

async function readAllRows(cdp, id, account, title) {
  const inspect = () => cdp.evaluate(id, `({
    total: Number(document.body.innerText.match(/全部\\s+(\\d+)/)?.[1]),
    visible: document.querySelectorAll('.note-card').length
  })`);
  let rows = await readRows(cdp, id, account, title);
  let count = await inspect();
  for (let i = 0; i < 12 && !rows.length && count.visible < count.total; i += 1) {
    const previous = count.visible;
    await cdp.evaluate(id, `[...document.querySelectorAll('body *')].reverse()
      .find(e => !e.children.length && /正在加载中/.test(e.innerText ?? ''))?.scrollIntoView({block:'center'})`);
    await cdp.waitFor(id, `document.querySelectorAll('.note-card').length > ${previous}`, 5000);
    rows = await readRows(cdp, id, account, title);
    count = await inspect();
    if (count.visible <= previous) break;
  }
  if (!rows.length) requireThat(count.total > 0 && count.visible === count.total, '未能核对笔记管理的全部记录，停止接续提交');
  return rows;
}

async function scheduleButtonCenter(cdp, id) {
  const { nodes } = await cdp.send(id, 'Accessibility.getFullAXTree');
  const controls = nodes.filter(node => !node.ignored && node.role?.value === 'button' &&
    node.name?.value === '定时发布' && node.backendDOMNodeId);
  requireThat(controls.length === 1, '未找到唯一的「定时发布」按钮');
  const { object } = await cdp.send(id, 'DOM.resolveNode', { backendNodeId: controls[0].backendDOMNodeId });
  const center = await cdp.send(id, 'Runtime.callFunctionOn', {
    objectId: object.objectId, returnByValue: true,
    functionDeclaration: `function() {
      const root = this.getRootNode();
      if (this.tagName !== 'BUTTON' || this.disabled || this.textContent.trim() !== '定时发布' ||
          root.host?.tagName !== 'XHS-PUBLISH-BTN' || !this.classList.contains('bg-red')) return null;
      const rect = this.getBoundingClientRect();
      if (!rect.width || !rect.height) return null;
      const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
      if (this.ownerDocument.elementFromPoint(x, y) !== root.host ||
          !this.contains(root.elementFromPoint(x, y))) return null;
      return { x, y };
    }`,
  });
  requireThat(center.result?.value, '定时按钮被遮挡或状态已变化');
  return center.result.value;
}

async function clickOnce(cdp, id, center) {
  const event = { ...center, button: 'left', clickCount: 1 };
  await cdp.send(id, 'Input.dispatchMouseEvent', { type: 'mousePressed', ...event });
  await cdp.send(id, 'Input.dispatchMouseEvent', { type: 'mouseReleased', ...event });
}

async function verifyInManager(cdp, id, account, title, displayed, checkChallenge) {
  let rows = [];
  for (let index = 0; index < 4; index += 1) {
    await checkChallenge();
    await cdp.send(id, 'Page.reload');
    await cdp.waitFor(id, `(${matchingCards(title)}.length > 0)`, 3000);
    rows = await readRows(cdp, id, account, title);
    if (isConfirmedSchedule(rows, displayed)) break;
  }
  if (!isConfirmedSchedule(rows, displayed)) await checkChallenge();
  return rows;
}

export async function submitSchedule(project, candidate, digest, account, schedule, { resumeAfterIdentity = false } = {}) {
  requireWebApproval(candidate, digest, account);
  requireThat(readSchedule(schedule), '须指定北京时间');
  const state = project.readState();
  let attempt = fs.existsSync(project.scheduleAttemptFile) ? readJson(project.scheduleAttemptFile) : null;
  if (resumeAfterIdentity) requireResumableAttempt(attempt);
  if (attempt) {
    requireMatchingAttempt(attempt, project.id, digest, account, schedule);
  } else {
    requireScheduleApproval(candidate, digest, account, state, schedule);
    requireThat(state.schedulePreview?.requested === schedule && state.schedulePreview.switchOn,
      '须先设置并验收这篇的指定时间');
  }

  const { shim, cdp, publisher } = await connectChrome();
  let manager;
  let editor;
  let confirmed = false;
  const checkChallenge = async () => {
    if (editor === undefined) return;
    // The verification panel can live in a shadow root and won't show in body text.
    const tree = await cdp.send(editor, 'Accessibility.getFullAXTree').catch(() => null);
    if (!tree || !hasIdentityChallenge(tree.nodes)) return;
    const lastCheckedAt = new Date().toISOString();
    writeJson(project.scheduleAttemptFile, {
      ...attempt, status: '等待扫码验证', platformConfirmed: false, lastCheckedAt,
    });
    const { id, phase, updatedAt, ...details } = state;
    project.setState('待确认', {
      ...details, submitClicked: true, scheduled: false, submissionStatus: '等待扫码验证', lastCheckedAt,
    });
    requireThat(false, '小红书要求扫码验证身份，尚未确认定时成功。请在原编辑页完成验证。');
  };
  try {
    const { bjTime } = await import(pathToFileURL(path.resolve(publisher, 'lib/platforms/common.js')).href);
    const displayed = bjTime(schedule).text;
    manager = await shim.chrome.tabs.create({ url: MANAGER, active: false });
    let rows = await readRows(cdp, manager.id, account, candidate.title);
    if (resumeAfterIdentity && !isConfirmedSchedule(rows, displayed)) {
      await shim.chrome.tabs.update(manager.id, { active: true });
      rows = await readAllRows(cdp, manager.id, account, candidate.title);
    }
    if (!attempt || (resumeAfterIdentity && !isConfirmedSchedule(rows, displayed))) {
      requireThat(rows.length === 0, '笔记管理已有同名记录，已停止提交以免重复');
      const id = editor = await findApprovedEditor(shim, cdp, candidate, account);
      await shim.chrome.tabs.update(id, { active: true });
      if (resumeAfterIdentity) await checkChallenge();
      requireThat(await cdp.evaluate(id, SCHEDULE_VALUE) === displayed, '编辑页上的时间已变动');
      await verifyEditorImages(cdp, id, candidate);
      requireThat(await findApprovedEditor(shim, cdp, candidate, account) === id &&
        await cdp.evaluate(id, SCHEDULE_VALUE) === displayed, '点击前编辑页或定时时间发生变化');
      const center = await scheduleButtonCenter(cdp, id);
      const startedAt = new Date().toISOString();
      attempt = attempt
        ? { ...attempt, resumedAt: startedAt, status: '等待核对' }
        : { id: project.id, account, digest, requested: schedule, displayed, startedAt, status: '等待核对' };
      writeJson(project.scheduleAttemptFile, attempt);
      try {
        await clickOnce(cdp, id, center);
      } catch { /* A disconnect can occur after Chrome received the click. Only verify. */ }
    } else if (!isConfirmedSchedule(rows, displayed)) {
      editor = await findApprovedEditor(shim, cdp, candidate, account).catch(() => undefined);
    }

    if (!isConfirmedSchedule(rows, displayed)) {
      rows = await verifyInManager(cdp, manager.id, account, candidate.title, displayed, checkChallenge);
    }
    requireThat(isConfirmedSchedule(rows, displayed), '尚未从笔记管理确认定时成功。提交记录已保留，程序没有重复点击。');
    confirmed = true;
    const checkedAt = new Date().toISOString();
    const result = {
      ...attempt, status: '已定时', checkedAt, title: candidate.title, platformText: rows[0].text,
      scheduled: true, platformConfirmed: true, screenshot: 'program-scheduled-note.png',
    };
    writeJson(project.scheduleAttemptFile, result);
    const { id: taskId, phase, updatedAt, submissionStatus, ...details } = state;
    const current = project.setState('已定时', {
      ...details, digest, account, scheduled: true, scheduledFor: schedule, submitClicked: true, platformConfirmedAt: checkedAt,
      evidence: [...new Set([...(details.evidence ?? []), 'program-schedule-submit-attempt.json'])],
    });
    try {
      await shim.chrome.tabs.update(manager.id, { active: true });
      await cdp.evaluate(manager.id, `${matchingCards(candidate.title)}[0]?.scrollIntoView({block:'center'})`);
      const shot = await cdp.send(manager.id, 'Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(project.root, result.screenshot), Buffer.from(shot.data, 'base64'), { mode: 0o600 });
      return { ...current, platformText: result.platformText, screenshot: result.screenshot };
    } catch {
      return { ...current, platformText: result.platformText };
    }
  } finally {
    if (manager && !confirmed) await shim.chrome.tabs.remove(manager.id).catch(() => {});
    shim.closeConnection();
  }
}
