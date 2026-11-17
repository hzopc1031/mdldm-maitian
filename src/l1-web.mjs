// 网页只调独立 L1 CLI；不导入旧 hub/driver，不探测已有 Chrome。
import path from 'node:path';
import { spawn } from 'node:child_process';
import { beijingDay, validDay } from './l1-config.mjs';

export const L1_PLATFORMS = ['x', 'xhs', 'wechat'];
export const L1_PORTS = { x: 9341, xhs: 9340, wechat: 9342 };
export function planL1Action(action) {
  if (!action || typeof action !== 'object' || Array.isArray(action) ||
      !['login', 'collect', 'status'].includes(action.type) || !L1_PLATFORMS.includes(action.platform)) {
    throw new Error('请选择 L1 平台和登录 / 采集 / 状态操作');
  }
  const keys = action.type === 'collect' ? ['type', 'platform', 'date'] : ['type', 'platform'];
  if (Object.keys(action).some(key => !keys.includes(key))) throw new Error('操作包含不支持的参数');
  if (action.type === 'status') return null;
  return action.type === 'login' ? [`--login-${action.platform}`, '--wait-login']
    : ['--only', action.platform, '--date', validDay(action.date ?? beijingDay())];
}

export function redactL1(value, secrets = []) {
  let text = String(value ?? '');
  for (const secret of secrets.filter(s => typeof s === 'string' && s)) text = text.split(secret).join('[已隐藏]');
  return text.replace(/https?:\/\/[^\s<>"']+/gi, value => {
    try { const url = new URL(value); return `${url.origin}${url.pathname}${url.search || url.hash ? ' [参数已隐藏]' : ''}`; }
    catch { return '[URL 已隐藏]'; }
  }).replace(/\b(?:authorization|cookie|set-cookie)\s*[:=][^\r\n]*/gi, '[凭据已隐藏]')
    .replace(/\b(?:[\w.-]*(?:token|secret|password|cookie)[\w.-]*|(?:web\.)?key)\b["']?\s*[:=]\s*["']?[^\s,;"'}]+/gi, '[凭据已隐藏]');
}

export function launchL1(action, { root, env = process.env, spawnChild = spawn, save = () => {}, secrets = [] }) {
  const argv = planL1Action(action);
  if (!argv) throw new Error('状态读取不应启动子进程');
  const rec = { type: action.type, platform: action.platform,
    label: `${action.type === 'login' ? '登录校验' : '采集'} · ${action.platform}`,
    startedAt: new Date().toISOString(), done: false, ok: null, tail: '' };
  let output = '', finished = false;
  const finish = (ok, error, code = null) => {
    if (finished) return;
    finished = true;
    Object.assign(rec, { done: true, ok, code, endedAt: new Date().toISOString() });
    rec.tail = redactL1([output, error].filter(Boolean).join('\n'), secrets).slice(-1200);
    if (!ok && !rec.tail) rec.tail = `L1 子进程失败（exit=${code}）`;
    rec.error = ok ? '' : rec.tail;
    save({ ...rec });
  };
  try {
    save({ ...rec });
    const child = spawnChild(process.execPath, [path.join(root, 'scripts', 'l1-run.mjs'), ...argv],
      { cwd: root, env: { ...env, HUB_NO_WEB: '1' }, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    // 整段保留到结束后再脱敏，避免凭据在两个 data chunk 之间被拆开。
    const onData = data => { output += data; };
    child.stdout?.on('data', onData); child.stderr?.on('data', onData);
    child.once('error', error => finish(false, error.message));
    child.once('close', (code, signal) => finish(code === 0, signal ? `信号：${signal}` : '', code));
  } catch (error) { finish(false, error.message); }
  return rec;
}
