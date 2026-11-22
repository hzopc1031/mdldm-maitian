import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { requireThat, writeJson } from './project.mjs';

const FILE = `document.querySelector('#files[type=file][multiple]')`;
const TITLE = `document.querySelector('#title')`;
const BODY = `document.querySelector('.tiptap.ProseMirror')`;
const SUGGESTION = `document.querySelector('#suggestion:not([hidden])')`;
// Chrome represents an Enter key as a block. innerText counts the placeholder
// <br> in an empty block as an extra newline. Read the logical editable lines.
const FIXTURE_BODY = `(() => {
  const nodes = [...${BODY}.childNodes];
  if (nodes.some((node, i) => !(node.nodeType === 3 && i === 0) && node.nodeName !== 'DIV')) return null;
  return nodes.map(node => node.textContent).join('\\n');
})()`;

async function debuggerPort(child, profile) {
  const portFile = path.join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 100; i += 1) {
    requireThat(child.exitCode === null, '隔离 Chrome 已退出');
    if (fs.existsSync(portFile)) {
      const port = Number(fs.readFileSync(portFile, 'utf8').split('\n')[0]);
      if (port > 0 && port < 65536) return port;
    }
    await wait(100);
  }
  throw new Error('隔离 Chrome 调试端口未就绪');
}

async function fillFixture(cdp, tabId, url, candidate, timeText) {
  const evaluate = (code) => cdp.evaluate(tabId, code);
  const ready = await cdp.waitFor(tabId,
    `location.href === ${JSON.stringify(url)} && !!${FILE} && document.title.endsWith('离线验收页')`, 6000);
  requireThat(ready, '页面不是预期的离线验收页');
  await cdp.setFiles(tabId, FILE, candidate.files);
  const loaded = await cdp.waitFor(tabId,
    `document.querySelectorAll('#images figure[data-ready=yes]').length === ${candidate.files.length}`, 6000);
  requireThat(loaded, '离线页没有解码出所有图片');
  await cdp.setValue(tabId, TITLE, candidate.title);
  await cdp.focusEnd(tabId, BODY);
  await cdp.typeLines(tabId, candidate.body);
  for (const topic of candidate.topics) {
    await cdp.setValue(tabId, `document.querySelector('#topic')`, topic);
    requireThat(await evaluate(`${SUGGESTION}?.textContent`) === '#' + topic, '话题候选不匹配');
    requireThat(await cdp.click(tabId, SUGGESTION), '未选中话题');
  }
  if (timeText) {
    requireThat(await cdp.click(tabId, `document.querySelector('#schedule-switch')`), '定时开关不可用');
    await cdp.setValue(tabId, `document.querySelector('#schedule:not([hidden])')`, timeText);
  }
  const observed = await evaluate(`({
    title: ${TITLE}.value,
    body: ${FIXTURE_BODY},
    images: [...document.querySelectorAll('#images figcaption')].map(x => x.textContent),
    topics: [...document.querySelectorAll('#topics span')].map(x => x.textContent),
    time: document.querySelector('#schedule-switch').checked ? document.querySelector('#schedule').value : null,
    submitButtonPresent: !!document.querySelector('#submit'),
    submitClicks: Number(document.querySelector('#submit').dataset.clicks),
  })`);
  requireThat(observed.title === candidate.title && observed.body === candidate.body, '标题或正文回读不一致');
  requireThat(JSON.stringify(observed.images) === JSON.stringify(candidate.images.map((item) => path.basename(item.name))), '图片数量或顺序不一致');
  requireThat(JSON.stringify(observed.topics) === JSON.stringify(candidate.topics), '话题回读不一致');
  requireThat(observed.time === timeText, '定时时间回读不一致');
  requireThat(observed.submitButtonPresent && observed.submitClicks === 0, '离线页提交前状态异常');
  return observed;
}

export async function previewOffline(project, candidate) {
  const home = os.homedir();
  const hub = process.env.MAITIAN_HUB_DIR || path.join(home, 'maitian/mdldm-maitian');
  const publisher = process.env.MAITIAN_PUBLISHER_DIR || path.join(home, 'maitian/mdldm-maitian-publisher');
  const shimURL = pathToFileURL(path.resolve(hub, 'src/chrome-shim.mjs')).href;
  const cdpURL = pathToFileURL(path.resolve(publisher, 'lib/cdp.js')).href;
  const commonURL = pathToFileURL(path.resolve(publisher, 'lib/platforms/common.js')).href;
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'xhs-offline-'));
  const profile = path.join(temp, 'chrome');
  const fixture = pathToFileURL(fs.realpathSync(fileURLToPath(new URL('./test/editor.html', import.meta.url)))).href;
  let child;
  let shim;
  const oldConfig = process.env.MAITIAN_CONFIG;
  try {
    child = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
      '--headless', '--window-size=1150,950', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0',
      `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
      '--disable-background-networking', '--disable-component-update', '--disable-sync', '--no-proxy-server',
      '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost', 'about:blank',
    ], { stdio: 'ignore' });
    const startupError = once(child, 'error').then(() => { throw new Error('无法启动隔离 Chrome'); });
    const port = await Promise.race([debuggerPort(child, profile), startupError]);
    const config = path.join(temp, 'config.json');
    writeJson(config, { chromePort: port, chromeProfile: profile });
    process.env.MAITIAN_CONFIG = config;
    shim = await import(shimURL);
    const configURL = pathToFileURL(path.resolve(hub, 'src/feishu.mjs')).href;
    const { config: chromeConfig } = await import(configURL);
    requireThat(chromeConfig.chromeProfile === profile && chromeConfig.chromePort === port &&
      (shim.PROFILE === undefined || path.resolve(shim.PROFILE) === profile), 'Chrome shim 未使用隔离配置');
    globalThis.chrome = shim.chrome;
    const cdp = await import(cdpURL);
    const { bjTime } = await import(commonURL);
    const tab = await shim.chrome.tabs.create({ url: fixture, active: true });
    const timeText = candidate.scheduledFor ? bjTime(candidate.scheduledFor).text : null;
    const observed = await fillFixture(cdp, tab.id, fixture, candidate, timeText);
    const screenshot = await cdp.send(tab.id, 'Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(project.root, 'offline-preview.png'), Buffer.from(screenshot.data, 'base64'), { mode: 0o600 });
    writeJson(path.join(project.root, 'offline-result.json'), {
      id: project.id, mode: 'offline-only', digest: candidate.digest, checkedAt: new Date().toISOString(), ...observed,
    });
    return observed;
  } finally {
    if (shim) shim.closeConnection();
    if (child?.pid && child.exitCode === null && child.signalCode === null) {
      const closed = once(child, 'exit');
      child.kill();
      if (!await Promise.race([closed.then(() => true), wait(2000, false, { ref: false })])) {
        child.kill('SIGKILL');
        await closed;
      }
    }
    if (oldConfig === undefined) delete process.env.MAITIAN_CONFIG;
    else process.env.MAITIAN_CONFIG = oldConfig;
    fs.rmSync(temp, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 });
  }
}
