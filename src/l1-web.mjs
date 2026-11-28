// 网页只调独立 L1 CLI；不导入旧 hub/driver，不探测已有 Chrome。
import path from 'node:path';
import { spawn } from 'node:child_process';
import { beijingDay, validDay } from './l1-config.mjs';
import {PLATFORM_IDS,PLATFORM_CATALOG} from './platform-registry.mjs';
import {accountId} from './x-accounts.mjs';

export const L1_PLATFORMS = PLATFORM_IDS;
export const L1_PORTS = Object.fromEntries(PLATFORM_CATALOG.map(p=>[p.id,p.port]));
const activeChildren = new WeakMap();
const progressMessages = {
  starting: '正在启动专用浏览器', browser_ready: '专用窗口已打开，正在加载平台',
  waiting_login: '请在电脑上的专用窗口完成登录，工作台会自动确认账号',
  waiting_manual_login: '请在专用 Chrome 完成 X 验证。进入首页后点「我已登录，核验账号」，也可按 ⌘Q 退出专用窗口',
  manual_login_finishing: '正在关闭专用窗口，随后核验账号',
  checking_login: '正在确认专用窗口中的账号，请暂时不要关闭窗口',
  login_required: '当前未登录，请在专用窗口完成登录；确认成功后窗口会自动关闭',
  identity_confirmed: '账号已确认，正在结束本次登录',
  collecting: '正在读取平台可见数据，完成后生成本地日报',
  discovering: '正在按指定日期查找作品', reading_posts:'正在逐篇读取作品数据', saving:'正在核对账号并保存数据',
  window_shown: '已请求显示专用登录窗口，请查看电脑桌面或任务栏',
  window_unavailable: '窗口暂未就绪，请稍后再点「显示登录窗口」',
  cancelling: '正在取消登录并关闭本次专用窗口',
};
export function planL1Action(action) {
  if (!action || typeof action !== 'object' || Array.isArray(action) ||
      !['login', 'collect', 'status', 'doctor', 'sync', 'show-login', 'cancel-login','confirm-login'].includes(action.type) || !L1_PLATFORMS.includes(action.platform)) {
    throw new Error('请选择 L1 平台和登录 / 采集 / 状态操作');
  }
  const keys = action.type === 'collect' ? ['type', 'platform', 'date'] : action.type === 'sync' ? ['type', 'platform', 'id','preparationId','date'] : ['type', 'platform'];
  if(action.accountId!==undefined){if(action.platform!=='x')throw Error('账户ID仅支持X');accountId(action.accountId);keys.push('accountId');}
  if (Object.keys(action).some(key => !keys.includes(key))) throw new Error('操作包含不支持的参数');
  if(action.type==='confirm-login'&&(action.platform!=='x'||!action.accountId||action.accountId==='default'))throw Error('只有专用 X 账号可以确认手动登录');
  if (['status', 'show-login', 'cancel-login','confirm-login'].includes(action.type)) return null;
  if (action.type === 'sync') {
    if(action.preparationId) {
      if(action.id || !/^[a-f0-9-]{36}$/.test(action.preparationId) || !action.date)throw new Error('准备记录取链接需唯一记录ID和明确发表日期');
      return ['--platform',action.platform,'--preparation',action.preparationId,'--date',validDay(action.date)];
    }
    if(action.date)throw new Error('作品ID取链接不接受日期覆盖');
    if (typeof action.id !== 'string' || !action.id || action.id.length > 200) throw new Error('请选择作品');
    return ['--platform', action.platform, '--episode', action.id];
  }
  if (action.type === 'doctor') return ['--platform', action.platform];
  return action.type === 'login' ? (['x','xhs','wechat'].includes(action.platform)?[`--login-${action.platform}`, '--wait-login']:['--login-native',action.platform,'--wait-login'])
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
  const argv = action.type==='age' ? [JSON.stringify(action.plan)] : planL1Action(action);
  if (!argv) throw new Error('状态读取不应启动子进程');
  const rec = { type: action.type, platform: action.platform,
    ...(action.accountId?{accountId:action.accountId}:{}),
    label: `${({ login: '登录', collect: '更新数据', doctor: '检查账号', sync: '按作品取链接', age:'同龄采样' })[action.type]} · ${action.platform}`,
    startedAt: new Date().toISOString(), done: false, ok: null, tail: '',
    progress: { stage: 'starting', message: progressMessages.starting } };
  if (action.type==='collect') { rec.date=argv.at(-1); rec.until=rec.startedAt; argv.push('--until', rec.until); }
  if(action.accountId)argv.push('--account-id',action.accountId);
  let output = '', finished = false;
  const finish = (ok, error, code = null) => {
    if (finished) return;
    finished = true;
    Object.assign(rec, { done: true, ok, code, endedAt: new Date().toISOString() });
    rec.tail = redactL1([output, error].filter(Boolean).join('\n'), secrets).slice(-1200);
    if (!ok && !rec.tail) rec.tail = `L1 子进程失败（exit=${code}）`;
    rec.error = ok ? '' : rec.tail;
    activeChildren.delete(rec);
    save({ ...rec });
  };
  try {
    save({ ...rec });
    const script=action.type==='age' ? 'l1-age-run.mjs' : ['doctor','sync'].includes(action.type) ? 'l1-inspect.mjs' : 'l1-run.mjs';
    const child = spawnChild(process.execPath, [path.join(root, 'scripts', script), ...argv],
      { cwd: root, env: { ...env, HUB_NO_WEB: '1' }, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    activeChildren.set(rec, child);
    child.on('message', message => {
      if (finished || message?.type !== 'l1:progress' || !Object.hasOwn(progressMessages, message.stage)) return;
      rec.progress = { ...(rec.progress?.deadline?{deadline:rec.progress.deadline}:{}), stage: message.stage, message: progressMessages[message.stage], at: new Date().toISOString() };
      if (['login_required','waiting_manual_login'].includes(message.stage)) rec.loginState = 'logged_out';
      if (message.stage === 'checking_login' && rec.loginState === 'logged_out') delete rec.loginState;
      if (message.stage === 'identity_confirmed') rec.loginState = 'logged_in';
      if (message.stage==='discovering' && Number.isSafeInteger(message.round) && message.round>0 && message.round<=120) rec.progress.message += `（第 ${message.round} 轮）`;
      if (message.stage==='reading_posts' && Number.isSafeInteger(message.total) && message.total>=0 && message.total<=100000 && Number.isSafeInteger(message.completed) && message.completed>=0 && message.completed<=message.total) rec.progress.message += `（${message.completed}/${message.total} 篇）`;
      if (['waiting_login','waiting_manual_login','checking_login','login_required'].includes(message.stage) && Number.isSafeInteger(message.timeoutMs) && message.timeoutMs > 0 && message.timeoutMs <= 86400000) {
        rec.progress.deadline = new Date(Date.now() + message.timeoutMs).toISOString();
      }
      save({ ...rec });
    });
    // 整段保留到结束后再脱敏，避免凭据在两个 data chunk 之间被拆开。
    const onData = data => { output += data; };
    child.stdout?.on('data', onData); child.stderr?.on('data', onData);
    child.once('error', error => finish(false, error.message));
    child.once('close', (code, signal) => finish(code === 0, signal ? `信号：${signal}` : '', code));
  } catch (error) { finish(false, error.message); }
  return rec;
}

export function controlL1(record, type) {
  const child = activeChildren.get(record);
  if (!record || record.done || record.type !== 'login' || !child?.connected || typeof child.send !== 'function') {
    throw new Error('没有正在进行的登录，请刷新后重试');
  }
  const command={'show-login':'l1:show-window','cancel-login':'l1:cancel-login','confirm-login':'l1:confirm-login'}[type];
  if (!command) throw new Error('不支持的登录操作');
  if (type==='confirm-login'&&record.progress?.stage!=='waiting_manual_login')throw new Error('当前没有等待确认的手动 X 登录');
  child.send({ type: command }, () => {});
  if (type === 'cancel-login') record.progress = { stage: 'cancelling', message: progressMessages.cancelling };
}
