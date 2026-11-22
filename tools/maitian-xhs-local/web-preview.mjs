import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readSchedule, requireThat, writeJson } from './project.mjs';

const CREATOR = 'https://creator.xiaohongshu.com';
const EDITOR_PATH = '/publish/publish';
const ENTRY = CREATOR + EDITOR_PATH + '?source=official&from=menu&target=image';
const ACCOUNT = 'document.querySelector(".d-topbar-default .user-info .name-box")?.textContent.trim()';
const PICKER = 'input[type=file][multiple][accept*=".png"]';
const TITLE = 'document.querySelector(\'input[placeholder="填写标题会有更多赞哦"]\')';
const BODY = 'document.querySelector(".tiptap.ProseMirror[contenteditable=true]")';
const SCHEDULE = 'document.querySelector(".post-time-switch-container .d-switch-simulator")';
const DATE_INPUT = 'document.querySelector(".post-time-wrapper .d-datepicker-input-filter input")';
const SLOT = '.img-container:has(> .img-idx)';
const CHOSEN_FILES = '__maitianXhsChosenFiles';

const READ_FORM = `({
  title: ${TITLE}?.value,
  body: [...(${BODY}?.children ?? [])]
    .filter(e => !e.querySelector('a.tiptap-topic')).map(e => e.textContent).join('\\n').trimEnd(),
  topics: [...(${BODY}?.querySelectorAll('a.tiptap-topic') ?? [])].map(e => e.textContent),
  scheduleOff: ${SCHEDULE}?.classList.contains('unchecked') && !${SCHEDULE}?.classList.contains('checked'),
})`;

// The platform re-encodes thumbnails. Sample the visible image and the original
// with the same canvas settings, then compare color samples in slot order.
const SAMPLE_PIXELS = `(image => {
  const canvas = document.createElement('canvas');
  canvas.width = 24;
  canvas.height = 32;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return Array.from(context.getImageData(0, 0, canvas.width, canvas.height).data)
    .filter((_, i) => i % 4 !== 3);
})`;

// Read only the local blobs already displayed in the numbered slots.
const READ_IMAGES = `(async () => {
  const slots = [...document.querySelectorAll(${JSON.stringify(SLOT)})];
  return slots.map(slot => {
    const preview = slot.querySelector('.format-img img.preview');
    const position = Number(slot.querySelector('.img-idx')?.textContent);
    if (!preview?.complete || !preview.naturalWidth ||
        !preview.currentSrc.startsWith('blob:' + location.origin + '/')) return { position };
    return { position, pixels: ${SAMPLE_PIXELS}(preview) };
  });
})()`;

const READ_PAGE = `({
  samePage: location.origin === ${JSON.stringify(CREATOR)} &&
    location.pathname === ${JSON.stringify(EDITOR_PATH)},
  loading: location.href === 'about:blank' || document.readyState === 'loading',
  blocked: /登录|captcha|verify|challenge/.test(location.pathname) ||
    (document.body?.innerText ?? '').split('\\n').some(line =>
      /^(请先登录|扫码登录|安全验证|请完成安全验证|访问受限|访问异常|操作过于频繁)[。！!：:]?$/.test(line.trim())),
  account: ${ACCOUNT},
})`;

const matches = (actual, expected) => JSON.stringify(actual) === JSON.stringify(expected);
const topicLabels = (topics) => topics.map((topic) => `#${topic}[话题]#`);

export function requireWebApproval(candidate, digest, account) {
  requireThat(candidate.digest === digest, '稿件与审核摘要不一致，须重新核对');
  requireThat(account && account === account.trim(), '须填写已确认的小红书账号显示名');
  requireThat(candidate.scheduledFor === null, '真实页面验收只接受没有排期的稿件');
}

export function requireScheduleApproval(candidate, digest, account, state, schedule, now = Date.now()) {
  requireWebApproval(candidate, digest, account);
  requireThat(readSchedule(schedule) && Date.parse(schedule) > now, '须填写未来的北京时间');
  requireThat(state.phase === '待确认' && state.mode === 'web-preview' &&
    state.account === account && state.digest === digest && state.submitClicked === false &&
    state.scheduled === false && state.imageOrderVerified === true, '此账号和版本没有可接续的上传验收记录');
}

function pixelDistance(left, right) {
  if (!left?.length || left.length !== right?.length) return Infinity;
  return left.reduce((sum, value, i) => sum + Math.abs(value - right[i]), 0) / left.length;
}

export function imagesMatch(slots, originals, approved) {
  return slots.length === approved.length && originals.length === approved.length &&
    approved.every(({ sha256 }, i) => {
      const slot = slots[i];
      if (originals[i].sha256 !== sha256 || slot.position !== i + 1) return false;
      const distance = pixelDistance(slot.pixels, originals[i].pixels);
      return distance <= 8 && originals.every((other, j) =>
        j === i || pixelDistance(slot.pixels, other.pixels) > distance + 0.75);
    });
}

function stop(message) {
  const error = new Error(message);
  error.name = 'XhsReviewError';
  throw error;
}

async function fill(cdp, id, candidate, expectedAccount) {
  const evaluate = (code) => cdp.evaluate(id, code);
  const find = async (expr, reason, timeout = 8000) => {
    const until = Date.now() + timeout;
    do {
      const page = await evaluate(READ_PAGE);
      if (page.blocked || (!page.samePage && !page.loading)) {
        stop('小红书要求登录、验证或离开了预期编辑页，已暂停');
      }
      if (page.samePage && page.account && page.account !== expectedAccount) stop('小红书账号与确认的显示名不一致');
      if (page.samePage && page.account === expectedAccount) {
        const value = await evaluate(expr);
        if (value) return value;
      }
      await cdp.sleep(250);
    } while (Date.now() < until);
    stop(reason);
  };
  const picker = `document.querySelector(${JSON.stringify(PICKER)})`;
  await find(`document.querySelectorAll(${JSON.stringify(PICKER)}).length === 1 &&
      !${TITLE} && !${picker}?.files?.length`,
    '找不到空白图文页面的多图入口，请检查登录状态或页面变化', 20_000);
  // Observe the native file selection before the uploader can clear the input.
  await evaluate(`(() => {
    ${picker}.addEventListener('change', event => {
      const files = [...event.target.files];
      window.${CHOSEN_FILES} = Promise.all(files.map(async file => {
        const [bytes, bitmap] = await Promise.all([file.arrayBuffer(), createImageBitmap(file)]);
        try {
          const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
          return {
            sha256: Array.from(hash, b => b.toString(16).padStart(2, '0')).join(''),
            pixels: ${SAMPLE_PIXELS}(bitmap),
          };
        } finally {
          bitmap.close();
        }
      }));
    }, { capture: true, once: true });
  })()`);
  await cdp.setFiles(id, picker, candidate.files);
  const originals = await find(`window.${CHOSEN_FILES}`, '未收到浏览器的本地文件选择');
  await evaluate(`delete window.${CHOSEN_FILES}`);
  if (!matches(originals.map(image => image.sha256), candidate.images.map(image => image.sha256))) {
    stop('浏览器选择的文件或顺序与审核稿不一致');
  }
  await find(`!!${TITLE} && !!${BODY} && document.querySelectorAll(${JSON.stringify(SLOT)}).length === ${candidate.images.length}`,
    '上传后没有出现完整的图片预览和编辑器', 45_000);

  const images = await find(`(async () => {
    const images = await ${READ_IMAGES};
    return images.length === ${candidate.images.length} && images.every(img => img.pixels) ? images : null;
  })()`, '图片预览未加载完成，无法核对图片顺序', 25_000);
  if (!imagesMatch(images, originals, candidate.images)) stop('缩略图内容或顺序与审核稿不一致');

  const gotIt = cdp.byText('我知道了');
  if (await evaluate(`!!(${gotIt})`)) await cdp.click(id, gotIt);
  if (await cdp.setValue(id, TITLE, candidate.title) !== candidate.title ||
      !await cdp.focusEnd(id, BODY)) stop('标题或正文输入框不可用');
  await cdp.typeLines(id, candidate.body);
  if ((await evaluate(READ_FORM)).body !== candidate.body) stop('正文逐段回读不一致');

  if (candidate.topics.length) {
    await cdp.pressKey(id, 'Enter');
    await cdp.pressKey(id, 'Enter');
  }
  for (const [i, topic] of candidate.topics.entries()) {
    const topicButton = 'document.querySelector("button.topic-btn")';
    if (!await cdp.click(id, topicButton)) stop('找不到话题按钮');
    await cdp.insertText(id, topic);
    const option = `[...document.querySelectorAll('.items .item')].find(e =>
      e.getClientRects().length && e.innerText.split('\\n')[0].trim() === ${JSON.stringify('#' + topic)})`;
    await find(`!!(${option})`, `找不到第 ${i + 1} 个平台话题的同名候选`);
    if (!await cdp.click(id, option)) stop(`未选中第 ${i + 1} 个话题`);
    await find(`JSON.stringify(${READ_FORM}.topics) === ${JSON.stringify(JSON.stringify(topicLabels(candidate.topics.slice(0, i + 1))))}`,
      `第 ${i + 1} 个话题回读不一致`);
  }

  if (!imagesMatch(await evaluate(READ_IMAGES), originals, candidate.images)) stop('缩略图发生变化，已停止验收');
  const form = await evaluate(READ_FORM);
  if (form.title !== candidate.title || form.body !== candidate.body ||
      !matches(form.topics, topicLabels(candidate.topics)) || form.scheduleOff !== true) {
    stop('标题、正文、话题或定时开关回读不一致');
  }
  if (!await hasPublishButton(cdp, id)) {
    stop('没有找到可用的发布按钮，无法确认停在提交前');
  }
  await evaluate(`document.querySelector('.title-area')?.scrollIntoView({ block: 'start' })`);
}

async function hasPublishButton(cdp, id, name = '发布') {
  const { nodes } = await cdp.send(id, 'Accessibility.getFullAXTree');
  return nodes.some(node => !node.ignored && node.role?.value === 'button' && node.name?.value === name &&
    !node.properties?.some(p => p.name === 'disabled' && p.value.value));
}

export async function connectChrome() {
  const hub = process.env.MAITIAN_HUB_DIR || path.join(os.homedir(), 'maitian/mdldm-maitian');
  const publisher = process.env.MAITIAN_PUBLISHER_DIR || path.join(os.homedir(), 'maitian/mdldm-maitian-publisher');
  const configFile = process.env.MAITIAN_CONFIG || path.join(hub, 'config.json');
  if (!fs.existsSync(configFile)) stop('找不到本机麦田配置');
  process.env.MAITIAN_CONFIG = configFile;
  const shim = await import(pathToFileURL(path.resolve(hub, 'src/chrome-shim.mjs')).href);
  globalThis.chrome = shim.chrome;
  const cdp = await import(pathToFileURL(path.resolve(publisher, 'lib/cdp.js')).href);
  return { shim, cdp, publisher };
}

export async function previewWeb(project, candidate, digest, account) {
  requireWebApproval(candidate, digest, account);
  requireThat(!fs.existsSync(project.scheduleAttemptFile), '本任务已有定时提交记录，不能再次上传');
  const state = project.readState();
  if (state.mode === 'web-preview' && state.phase === '待确认' &&
      state.digest === digest && state.account === account) {
    return { ...state, alreadyPrepared: true };
  }
  const details = { mode: 'web-preview', account, digest, scheduled: false, submitClicked: false };
  const evidence = ['program-web-preview.png', 'program-web-result.json'];
  let shim;
  let tab;
  let stage = '连接专用 Chrome';
  project.setState('待上传', details);
  try {
    const connection = await connectChrome();
    shim = connection.shim;
    const cdp = connection.cdp;
    tab = await shim.chrome.tabs.create({ url: ENTRY, active: false });
    stage = '小红书图文上传和回读';
    await fill(cdp, tab.id, candidate, account);
    stage = '保存程序验收证据';
    await shim.chrome.tabs.update(tab.id, { active: true });
    const png = await cdp.send(tab.id, 'Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(project.root, evidence[0]), Buffer.from(png.data, 'base64'), { mode: 0o600 });
    const result = {
      ...details, images: candidate.images.map(image => path.basename(image.name)), topics: candidate.topics,
      titleVerified: true, bodyVerified: true, imageOrderVerified: true, evidence,
    };
    writeJson(path.join(project.root, evidence[1]), { id: project.id, checkedAt: new Date().toISOString(), ...result });
    return project.setState('待确认', result);
  } catch (error) {
    const reason = error.name === 'XhsReviewError' ? error.message : `${stage}失败`;
    if (tab) await shim.chrome.tabs.remove(tab.id).catch(() => {});
    project.setState('失败', { ...details, reason });
    throw new Error(reason);
  } finally {
    shim?.closeConnection();
  }
}

const SCHEDULE_ENABLED = `(${SCHEDULE}?.classList.contains('checked') === true &&
  ${SCHEDULE}?.querySelector('input[type=checkbox]')?.checked === true)`;
const DATE_VISIBLE = `(${DATE_INPUT}?.getClientRects().length > 0 && !${DATE_INPUT}?.disabled)`;
export const SCHEDULE_VALUE = `(${SCHEDULE_ENABLED} && ${DATE_VISIBLE} ? ${DATE_INPUT}.value : null)`;
const SLOT_ORDER = `[...document.querySelectorAll(${JSON.stringify(SLOT)})].map(slot => {
  const image = slot.querySelector('.format-img img.preview');
  return image?.complete && image.naturalWidth > 0 ? Number(slot.querySelector('.img-idx')?.textContent) : 0;
})`;

async function isApprovedEditor(cdp, id, candidate, account) {
  const page = await cdp.evaluate(id, READ_PAGE);
  if (!page.samePage || page.blocked || page.account !== account) return false;
  const form = await cdp.evaluate(id, READ_FORM);
  if (form.title !== candidate.title || form.body !== candidate.body ||
      !matches(form.topics, topicLabels(candidate.topics))) return false;
  return matches(await cdp.evaluate(id, SLOT_ORDER), candidate.images.map((_, i) => i + 1));
}

export async function findApprovedEditor(shim, cdp, candidate, account) {
  const ids = await shim.adoptTargets(/^https:\/\/creator\.xiaohongshu\.com\/publish\/publish(?:\?|$)/);
  const matched = [];
  for (const id of ids) {
    if (await isApprovedEditor(cdp, id, candidate, account)) matched.push(id);
  }
  if (matched.length !== 1) stop('找不到唯一且与审核稿匹配的现有编辑页');
  return matched[0];
}

export async function verifyEditorImages(cdp, id, candidate) {
  const originals = [];
  for (const file of candidate.files) {
    const bytes = fs.readFileSync(file);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const pixels = await cdp.evaluate(id, `(async () => {
      const bytes = Uint8Array.from(atob(${JSON.stringify(bytes.toString('base64'))}), c => c.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      try { return ${SAMPLE_PIXELS}(bitmap); } finally { bitmap.close(); }
    })()`);
    originals.push({ sha256, pixels });
  }
  requireThat(imagesMatch(await cdp.evaluate(id, READ_IMAGES), originals, candidate.images),
    '提交前回读缩略图发现内容或顺序不同');
}

export async function previewSchedule(project, candidate, digest, account, schedule) {
  const state = project.readState();
  requireScheduleApproval(candidate, digest, account, state, schedule);
  requireThat(!fs.existsSync(project.scheduleAttemptFile), '本任务已有定时提交记录，须先核对平台');
  const { shim, cdp, publisher } = await connectChrome();
  let id;
  let enabledHere = false;
  try {
    id = await findApprovedEditor(shim, cdp, candidate, account);
    const { bjTime } = await import(pathToFileURL(path.resolve(publisher, 'lib/platforms/common.js')).href);
    const requested = bjTime(schedule).text;
    const evaluate = (expression) => cdp.evaluate(id, expression);
    await shim.chrome.tabs.update(id, { active: true });
    if (!await evaluate(SCHEDULE_ENABLED)) {
      if (!await cdp.click(id, SCHEDULE)) stop('找不到定时发布开关');
      enabledHere = true;
    }
    if (!await cdp.waitFor(id, `${SCHEDULE_ENABLED} && ${DATE_VISIBLE}`, 5000)) {
      stop('定时开关打开后未看到可用的时间输入框');
    }
    if (await evaluate(`${DATE_INPUT}.value`) !== requested) {
      const focused = await evaluate(`(() => {
        const input = ${DATE_INPUT};
        if (!input || input.form || input.readOnly) return false;
        input.focus();
        input.select();
        return document.activeElement === input;
      })()`);
      if (!focused) stop('定时时间输入框无法安全填写');
      await cdp.insertText(id, requested);
      if (!await evaluate(`document.activeElement === ${DATE_INPUT} && !${DATE_INPUT}.form &&
          ${DATE_INPUT}.value === ${JSON.stringify(requested)}`)) {
        stop('输入后页面未显示指定时间');
      }
      await cdp.pressKey(id, 'Enter');
      await evaluate(`${DATE_INPUT}?.blur()`);
    }
    await cdp.sleep(400);
    const confirmed = await evaluate(SCHEDULE_VALUE);
    if (confirmed !== requested) stop('关闭输入控件后，页面显示的定时时间与要求不一致');
    if (!await isApprovedEditor(cdp, id, candidate, account)) stop('定时回读时，编辑页内容发生变化');
    if (!await hasPublishButton(cdp, id, '定时发布')) stop('未看到可用的「定时发布」提交按钮');
    await evaluate(`${DATE_INPUT}.scrollIntoView({ block: 'center' })`);
    const evidence = ['program-schedule-preview.png', 'program-schedule-result.json'];
    const screenshot = await cdp.send(id, 'Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(project.root, evidence[0]), Buffer.from(screenshot.data, 'base64'), { mode: 0o600 });
    const schedulePreview = { requested: schedule, displayed: confirmed, timezone: 'Asia/Shanghai', switchOn: true };
    const { updatedAt, phase, id: taskId, evidence: existingEvidence, ...details } = state;
    writeJson(path.join(project.root, evidence[1]), {
      id: taskId, digest, account, checkedAt: new Date().toISOString(), ...schedulePreview,
      submitClicked: false, scheduled: false, screenshot: evidence[0],
    });
    return project.setState(phase, { ...details, schedulePreview, evidence: [...new Set([...existingEvidence, ...evidence])] });
  } catch (error) {
    if (enabledHere && id !== undefined) {
      try {
        if (await isApprovedEditor(cdp, id, candidate, account) && await cdp.evaluate(id, SCHEDULE_ENABLED)) {
          await cdp.click(id, SCHEDULE);
        }
      } catch { /* Leave the existing editor intact if the browser is no longer reachable. */ }
    }
    throw new Error(error.name === 'XhsReviewError' ? error.message : '定时表单验收失败');
  } finally {
    shim.closeConnection();
  }
}
