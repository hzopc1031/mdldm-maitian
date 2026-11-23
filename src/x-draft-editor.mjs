import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import { visibleXIdentity } from './l1-x-dom.mjs';

const port = 9336;
const compose = 'https://x.com/compose/post';
const editorSelector = '[data-testid="tweetTextarea_0"]';
const fileSelector = 'input[type="file"][data-testid="fileInput"]';

export function isDedicatedXProfile(value) {
  return typeof value === 'string' && path.isAbsolute(value) && !/^(?:\\\\|\/\/)/.test(value) &&
    /[\\/]agent-publish[\\/]x[\\/]chrome-profile$/i.test(path.normalize(value));
}

export async function queryDedicatedXBrowserOwner(expectedProfile) {
  if (process.platform !== 'win32') throw new Error('X 文图填写需要 Windows 专用 Chrome');
  const powershell = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
  const getOwner = [
    "$ErrorActionPreference = 'Stop'",
    '[Console]::OutputEncoding = [Text.Encoding]::UTF8',
    'try {',
    'Import-Module NetTCPIP -ErrorAction Stop',
    '$s = @(Get-NetTCPConnection -State Listen -LocalPort 9336)',
    "if ($s.Count -ne 1 -or $s[0].LocalAddress -ne '127.0.0.1') { throw 'listener' }",
    "$p = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $s[0].OwningProcess)",
    `$m = [regex]::Matches($p.CommandLine, '--user-data-dir=(?:"([^"]+)"|([^ ]+))')`,
    "if ($p.Name -ne 'chrome.exe' -or $m.Count -ne 1) { throw 'profile' }",
    '[pscustomobject]@{pid=$p.ProcessId;profile=($m[0].Groups[1].Value+$m[0].Groups[2].Value)} | ConvertTo-Json -Compress',
    '} catch {',
    '[pscustomobject]@{message=$_.Exception.Message;id=$_.FullyQualifiedErrorId;category=[string]$_.CategoryInfo.Category} | ConvertTo-Json -Compress',
    'exit 1',
    '}',
  ].join('\n');
  let owner;
  try {
    const { execFile } = await import('node:child_process');
    const { stdout } = await promisify(execFile)(powershell, ['-NoProfile', '-NonInteractive', '-Command', getOwner], { windowsHide: true, timeout: 8000 });
    owner = JSON.parse(stdout);
  } catch (error) {
    let detail = error.code ?? error.name;
    try {
      const { message, id, category } = JSON.parse(error.stdout);
      if ([message, id, category].every(value => typeof value === 'string')) {
        const safe = message.split(/\r?\n/, 1)[0]
          .replace(/(?:command\s*line|cookie|authorization|password|passwd|secret|token|api[-_ ]?key|口令|密码|命令行|chrome\.exe|\s--).*$/i, '[已脱敏]');
        const codes = [category, id].filter(value => /^[\w,. -]+$/.test(value));
        detail = [safe, ...codes].filter(Boolean).join(' / ');
      }
    } catch { /* Child diagnostics may be unavailable if PowerShell could not start. */ }
    throw new Error(`X 专用 Chrome 9336 的进程归属检查未通过（${detail}）`);
  }
  if (!Number.isInteger(owner?.pid) || !isDedicatedXProfile(owner.profile) ||
    path.resolve(owner.profile).toLowerCase() !== path.resolve(expectedProfile).toLowerCase()) {
    throw new Error('X 专用 Chrome profile 与配置不匹配');
  }
  return owner;
}

async function connectDedicatedBrowser(expectedProfile) {
  const owner = await queryDedicatedXBrowserOwner(expectedProfile);
  const response = await fetch(`http://127.0.0.1:${port}/json/version`, { redirect: 'error', signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error('X 专用 Chrome 调试入口不可用');
  const version = await response.json();
  if (!/^ws:\/\/127\.0\.0\.1:9336\/devtools\/browser\/[A-Za-z0-9-]+$/.test(version.webSocketDebuggerUrl)) {
    throw new Error('X 专用 Chrome 调试地址未核实');
  }
  const ws = new WebSocket(version.webSocketDebuggerUrl);
  const pending = new Map();
  let sequence = 0;
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('X 专用 Chrome 连接超时')), 5000);
      ws.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('X 专用 Chrome 连接失败')); }, { once: true });
    });
  } catch (error) {
    ws.close();
    throw error;
  }
  ws.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    const item = pending.get(message.id);
    if (!item) return;
    pending.delete(message.id);
    clearTimeout(item.timer);
    if (message.error) item.reject(new Error(`X 专用 Chrome 拒绝 ${item.method}`));
    else item.resolve(message.result);
  });
  ws.addEventListener('close', () => {
    for (const item of pending.values()) {
      clearTimeout(item.timer);
      item.reject(new Error('X 专用 Chrome 连接已关闭'));
    }
    pending.clear();
  });
  return {
    pid: owner.pid,
    close: () => ws.close(),
    send(method, params = {}, sessionId) {
      return new Promise((resolve, reject) => {
        if (ws.readyState !== WebSocket.OPEN) return reject(new Error('X 专用 Chrome 连接不可用'));
        const id = ++sequence;
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`X 专用 Chrome 响应超时（${method}）`));
        }, 12000);
        pending.set(id, { timer, resolve, reject, method });
        try {
          ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
        } catch {
          clearTimeout(timer);
          pending.delete(id);
          reject(new Error('X 专用 Chrome 发送命令失败'));
        }
      });
    },
  };
}

// 序列化到新建编辑页，用可见控件定位正文和附件。
function editorView(editorSelector, fileSelector, action, expectedText, expectedImages) {
  if (location.href !== 'https://x.com/compose/post') return null;
  const visible = el => el.getClientRects().length > 0 && getComputedStyle(el).visibility === 'visible';
  const editors = [...document.querySelectorAll(editorSelector)].filter(el => el.isContentEditable && visible(el));
  // The home inline editor can also be rendered behind the compose dialog.
  const dialogEditors = editors.map(editor => ({ editor, composer: editor.closest('[role="dialog"]') }))
    .filter(({ composer }) => composer && visible(composer));
  if (dialogEditors.length !== 1) return null;
  const { editor, composer } = dialogEditors[0];
  if (editors.some(other => other !== editor && other.innerText.trim())) return null;
  const inputs = composer?.querySelectorAll(fileSelector);
  if (inputs?.length !== 1) return null;
  const removers = [...composer.querySelectorAll('[data-testid="removeMedia"], [data-testid="attachments"] button[aria-label="Remove media"]')].filter(visible);
  const images = [...composer.querySelectorAll('[data-testid="attachments"] img')].filter(visible);
  const busy = [...composer.querySelectorAll('[role="progressbar"], [aria-busy="true"]')].some(el => {
    if (!visible(el)) return false;
    // X renders determinate counters in the composer footer before any upload starts.
    const footer = el.parentElement?.querySelector('[data-testid="tweetButton"]');
    const toolbarCounter = el.closest('[role="toolbar"], [data-testid="toolBar"]') &&
      el.getAttribute('aria-valuemin') === '0' && el.querySelectorAll('circle').length === 3;
    const textCounter = (footer || toolbarCounter) && el.getAttribute('role') === 'progressbar' &&
      el.getAttribute('aria-valuemax') === '100' && /^\d+(?:\.\d+)?$/.test(el.getAttribute('aria-valuenow') || '') &&
      !el.closest('[data-testid="attachments"]');
    return el.getAttribute('aria-busy') === 'true' || !textCounter;
  });
  const errors = [...composer.querySelectorAll('[role="alert"]')].some(visible);
  const actual = editor.innerText.replace(/\r\n?/g, '\n');
  const empty = !actual.trim() && !removers.length && !images.length && !inputs[0].files.length && !busy && !errors;
  if (action === 'focus') {
    if (!empty) return false;
    editor.focus();
    return document.activeElement === editor;
  }
  if (action === 'input') return actual === expectedText && !busy && !errors && !removers.length &&
    !images.length && !inputs[0].files.length ? inputs[0] : null;
  const r = composer.getBoundingClientRect();
  const ready = actual === expectedText && removers.length === expectedImages && images.length === expectedImages &&
    images.every(image => image.complete && image.naturalWidth > 0) && !busy && !errors;
  return { empty, ready, imageCount: images.length, clip: {
    x: Math.max(0, r.x) + scrollX, y: Math.max(0, r.y) + scrollY,
    width: Math.min(innerWidth, r.right) - Math.max(0, r.x),
    height: Math.min(innerHeight, r.bottom) - Math.max(0, r.y), scale: 1,
  } };
}

function existingXEditor(url) {
  try {
    const u = new URL(url);
    return /(^|\.)(x|twitter)\.com$/i.test(u.hostname) && /^\/compose(?:\/|$)/.test(u.pathname);
  } catch { return false; }
}

// 只管理本次新建的目标。保留新编辑页及所有旧标签，断开调试连接。
export async function fillXEditor({ account, profile, job, folder }, connect = connectDedicatedBrowser, { saveDraft = false } = {}) {
  if (!/^[A-Za-z0-9_]{1,15}$/.test(account) || !isDedicatedXProfile(profile) || job.submit !== false ||
      !job.content.trim() || job.content.length > 2000 || job.images.length > 4) {
    throw new Error('X 文图草稿配置或素材未通过校验');
  }
  const evidence = { at: new Date().toISOString(), stage: 'verify-browser', submitted: false };
  const record = () => fs.writeFileSync(path.join(folder, 'x-editor.json'), JSON.stringify(evidence, null, 2));
  record();
  let browser;
  try {
    browser = await connect(profile);
    const send = (...args) => browser.send(...args);
    const processes = await send('SystemInfo.getProcessInfo');
    if (!processes.processInfo.some(p => p.type === 'browser' && p.id === browser.pid)) {
      throw new Error('X 专用 Chrome PID 已变化');
    }
    evidence.pid = browser.pid;
    const tabs = async () => (await send('Target.getTargets')).targetInfos.filter(target => target.type === 'page');
    const oldTabs = await tabs();
    evidence.existingTabs = oldTabs.length;
    if (oldTabs.some(target => existingXEditor(target.url))) throw new Error('专用 Chrome 已有 X 编辑页，请本人先核对现稿');
    const text = job.content.replace(/\r\n?/g, '\n');
    evidence.stage = 'open-new-editor';
    record();
    const { targetId } = await send('Target.createTarget', { url: compose, background: false });
    if (!targetId || oldTabs.some(target => target.targetId === targetId)) throw new Error('没有确认新建独立 X 标签');
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    if (!sessionId) throw new Error('没有确认独立 X 标签调试会话');
    const command = (method, params) => send(method, params, sessionId);
    const evaluate = async (fn, args = [], byValue = true) => {
      const result = await command('Runtime.evaluate', {
        expression: `(${fn.toString()})(...${JSON.stringify(args)})`, returnByValue: byValue,
      });
      if (result.exceptionDetails) throw new Error('X 编辑器可见控件检查失败');
      return byValue ? result.result.value : result.result.objectId;
    };
    const view = (action, byValue) => evaluate(editorView, [editorSelector, fileSelector, action, text, job.images.length], byValue);
    const waitFor = async (check, message) => {
      for (let i = 0; i < 40; i++) {
        const value = await check();
        if (value) return value;
        await delay(250);
      }
      throw new Error(message);
    };
    const identity = async () => {
      const result = await evaluate(visibleXIdentity);
      if (result.url !== compose || result.login) return false;
      if (!result.handle) return false;
      if (result.handle.replace(/^@/, '').toLowerCase() !== account.toLowerCase()) throw new Error('X 可见账号与预期不符');
      return true;
    };
    const before = await waitFor(async () => (await identity()) && await view(), '未核实 X 登录身份或唯一编辑框');
    if (!before.empty) throw new Error('新 X 编辑框已有内容或附件，请本人核对，停止填写');
    const shot = async (name, clip) => {
      if (!(clip.width > 0 && clip.height > 0)) throw new Error('X 编辑器不在可见区域');
      const result = await command('Page.captureScreenshot', { format: 'png', clip, fromSurface: true });
      const file = path.join(folder, name + '.png');
      fs.writeFileSync(file, Buffer.from(result.data, 'base64'));
      return file;
    };
    evidence.before = await shot('x-editor-before', before.clip);
    evidence.stage = 'fill-text';
    record();
    if (!await identity() || !await view('focus')) throw new Error('X 账号或空白编辑框已变化');
    await command('Input.insertText', { text });
    if (job.images.length) {
      const input = await waitFor(() => view('input', false), '未读回完整 X 正文或没有确认空附件区');
      if (!await identity()) throw new Error('设置附件前 X 身份已变化');
      evidence.stage = 'attach-images';
      record();
      await command('DOM.setFileInputFiles', { objectId: input, files: job.images });
    }
    const after = await waitFor(async () => {
      const state = await view();
      return state?.ready && state;
    }, '未读回完整 X 正文及已载入的全部图片，请本人核对新标签');
    if (!await identity()) throw new Error('读回时 X 身份已变化');
    const currentTabs = await tabs();
    if (oldTabs.some(target => !currentTabs.some(current => current.targetId === target.targetId))) {
      throw new Error('旧标签集合已变化，请本人核对');
    }
    evidence.after = await shot('x-editor-after', after.clip);
    evidence.stage = 'editor-filled';
    evidence.imageCount = after.imageCount;
    evidence.existingTabsPreserved = true;
    record();
    if (saveDraft) {
      evidence.stage = 'save-draft';
      record();
      // 关闭编辑框 → 弹窗里点「保存 / Save」→ 读确认提示。
      await evaluate(() => {
        const visible = el => el.getClientRects().length > 0;
        const close = [...document.querySelectorAll('[data-testid="app-bar-close"]')].filter(visible)[0];
        if (!close) return false;
        close.click();
        return true;
      });
      await delay(1200);
      const saved = await evaluate(() => {
        const visible = el => el.getClientRects().length > 0 && getComputedStyle(el).visibility === 'visible';
        const buttons = [...document.querySelectorAll('[role="dialog"] [role="button"], [role="dialog"] button')].filter(visible);
        const target = buttons.find(el => /^(save|保存)$/i.test((el.innerText || '').trim()));
        if (!target) return false;
        target.click();
        return true;
      });
      if (!saved) {
        evidence.draftSaved = false;
        record();
        throw new Error('没有出现 X 保存草稿确认，结果未确认；请到草稿箱核对');
      }
      await delay(1800);
      const toast = await evaluate(() => document.body.innerText);
      evidence.draftToast = typeof toast === 'string' ? toast.slice(-2000) : '';
      evidence.draftSaved = /saved to drafts|保存到草稿|已保存|草稿箱|saved/i.test(evidence.draftToast);
      evidence.draftCheckedBy = evidence.draftSaved ? 'toast' : null;
      if (!evidence.draftSaved) {
        // 兜底：打开编辑框右上角「Drafts」核对首行文字。
        const opened = await evaluate(() => {
          const visible = el => el.getClientRects().length > 0 && getComputedStyle(el).visibility === 'visible';
          const button = [...document.querySelectorAll('[role="button"], button, a, span')]
            .filter(visible).find(el => /^(drafts|草稿|草稿箱)$/i.test((el.innerText || '').trim()));
          if (!button) return false;
          button.click();
          return true;
        });
        if (opened) {
          await delay(1800);
          const head = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean)[0]?.slice(0, 20) || '';
          const found = head ? await evaluate(needle => {
            const visible = el => el.getClientRects().length > 0 && getComputedStyle(el).visibility === 'visible';
            const panel = [...document.querySelectorAll('[role="dialog"], [data-testid="Draft"]')].filter(visible)
              .map(el => el.innerText).join('\n');
            return (panel || document.body.innerText).includes(needle);
          }, [head]) : false;
          if (found) {
            evidence.draftSaved = true;
            evidence.draftCheckedBy = 'drafts-panel';
            evidence.draftFirstLine = head;
          }
        }
      }
      evidence.stage = 'draft-saved';
      evidence.after = await shot('x-draft-after', after.clip).catch(() => evidence.after);
      record();
      if (!evidence.draftSaved) throw new Error('未读到 X 草稿保存确认（提示和 Drafts 列表都没有），结果未确认；请到草稿箱核对');
      return { submitted: false, editorFilled: true, draftSaved: true, imageCount: after.imageCount, screenshot: evidence.after };
    }
    return { submitted: false, editorFilled: true, imageCount: after.imageCount, screenshot: evidence.after };
  } finally {
    browser?.close();
  }
}
