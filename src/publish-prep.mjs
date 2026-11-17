// L1 发布准备隔离层。绝不加载 hub/发布助手，不提供 submit 动作。
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { redactL1 } from './l1-web.mjs';

export const BROWSER_BLOCK = '浏览器执行未启用：上一轮独立 profile + 远程调试启动仅返回 blocked by policy，没有更细原因；native pipe 另报 os error 2。本轮不换入口重试。等待用户认可的可用通道后由维护者配置，不代表已获批准。';
export function prepCapabilities(config = {}, env = process.env) {
  const root = env.MAITIAN_LOCAL_SKILLS || path.join(os.homedir(), '.dsh', 'skills');
  return Object.fromEntries(['x', 'xhs', 'wechat'].map(platform => {
    const script = platform === 'x' ? null : path.join(root, platform === 'xhs' ? 'xhs-publish' : 'wechat-publish', 'scripts', `${platform}.mjs`);
    const installed = script ? fs.existsSync(script) : true;
    // 安装检查只读脚本，不读取 accounts.json、profile 或凭据。
    const keepWindow = platform !== 'xhs' || (installed && fs.readFileSync(script, 'utf8').includes("opts['keep-browser']"));
    const enabled = config.publishPrep?.browserExecution === true && installed && keepWindow;
    return [platform, { script, installed, browserEnabled: enabled,
      mode: platform === 'x' ? '文字草稿链接；用户自行打开并核对，不自动提交' : platform === 'xhs' ? '本地 xhs-publish，固定 --account ai，填图文后保留窗口' : '本地 wechat-publish，只保存草稿并核对成功提示',
      reason: !installed ? '本地 DSH skill 未安装；不回退旧 hub' : !keepWindow ? '本地 skill 不支持保留窗口，未适配' : enabled ? '执行通道由维护者启用；仍未代表真实验收通过' : BROWSER_BLOCK }];
  }));
}
function text(value, name, max, required = false) {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) throw new Error(`${name} 必须为${required ? '非空' : ''}文字，最多 ${max} 字符`);
  return value.trim();
}
export function normalizePrep(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || !['x', 'xhs', 'wechat'].includes(input.platform)) throw new Error('仅支持 X、小红书图文、公众号');
  if (Object.keys(input).some(k => !['platform', 'title', 'content', 'images', 'topics', 'promotionReview', 'episodeId', 'test'].includes(k))) throw new Error('发布准备包含不支持的字段（不接受 submit、命令或凭据）');
  const platform = input.platform;
  const title = text(input.title ?? '', '标题', platform === 'wechat' ? 64 : 100, platform !== 'x');
  const content = text(input.content, '正文', platform === 'xhs' ? 1000 : platform === 'x' ? 2000 : 50000, true);
  const images = input.images ?? [], topics = input.topics ?? [];
  if (!Array.isArray(images) || images.length > (platform === 'x' ? 0 : 9) || (platform === 'xhs' && !images.length)) throw new Error('小红书需要 1–9 张本地图；X 本入口仅文字草稿；公众号最多 9 图');
  const files = images.map(file => {
    if (typeof file !== 'string' || !path.isAbsolute(file) || !/\.(png|jpe?g|webp)$/i.test(file)) throw new Error('图片必须为本机绝对路径 PNG/JPEG/WebP');
    if (!fs.statSync(file).isFile()) throw new Error('图片文件不存在');
    return path.resolve(file);
  });
  if (!Array.isArray(topics) || topics.length > 10 || topics.some(t => typeof t !== 'string' || t.length > 40)) throw new Error('话题格式不对');
  if (input.test != null && typeof input.test !== 'boolean') throw new Error('test 必须为布尔值');
  if (input.episodeId != null && (typeof input.episodeId !== 'string' || input.episodeId.length > 200)) throw new Error('作品 ID 无效');
  // 审阅声明原样交给本地 skill 验证，不补造“已看图”记录。
  if (input.promotionReview != null && (typeof input.promotionReview !== 'object' || Array.isArray(input.promotionReview))) throw new Error('promotionReview 格式不对');
  const job = { title, content, images: files, topics, submit: false,
    ...(platform === 'xhs' ? { account: 'ai', promotionReview: input.promotionReview ?? {} } : {}) };
  if (input.test && !/^【测试稿】/.test(job.title)) job.title = `【测试稿】${job.title}`;
  if (input.test) job.content = `【测试稿，勿发表】\n${content}`;
  if (platform === 'wechat' && job.title.length > 64) throw new Error('测试标记后标题超过 64 字符');
  return { platform, job, episodeId: input.episodeId || null, test: input.test === true };
}
export function prepCommand(platform, kind, { script, jobFile }) {
  if (!['xhs', 'wechat'].includes(platform) || !['check', 'execute'].includes(kind)) throw new Error('该平台 / 动作无本地 skill 命令');
  return [script, kind === 'check' ? platform === 'xhs' ? 'preflight' : 'check' : 'post', '--job', jobFile,
    ...(platform === 'xhs' ? kind === 'check' ? ['--kind', 'post'] : ['--account', 'ai', '--keep-browser'] : [])];
}
export function acceptPrepResult(platform, kind, code, result) {
  if (code !== 0 || result?.ok !== true || result?.submitted === true) throw new Error('本地 skill 失败或回执不符合只准备约束；先人工核对页面，勿直接重跑');
  if (kind === 'check') {
    if (!(platform === 'xhs' ? result.offlineOnly === true : result.offline === true)) throw new Error('缺少离线检查证明');
    return 'checked';
  }
  if (platform === 'wechat' && result.savedAsDraft === true && result.submitted === false) return 'draft_saved';
  if (platform === 'xhs' && result.dryRun === true && result.submitted === false) return 'awaiting_user';
  throw new Error('缺少填好 / 草稿保存证明，状态保持未确认');
}
export function createPrepService({ db, home, root, config, secrets = [], spawnChild = spawn, env = process.env }) {
  // 单独表不改变原 hub 的 tasks 状态约定；准备完成绝不等于 published。
  db.exec('CREATE TABLE IF NOT EXISTS publish_preparations (id TEXT PRIMARY KEY, record TEXT NOT NULL)');
  const save = r => db.prepare('INSERT OR REPLACE INTO publish_preparations VALUES (?,?)').run(r.id, JSON.stringify(r));
  const get = id => { const row = db.prepare('SELECT record FROM publish_preparations WHERE id=?').get(id); if (!row) throw new Error('准备任务不存在'); return JSON.parse(row.record); };
  const list = () => db.prepare('SELECT record FROM publish_preparations ORDER BY rowid DESC LIMIT 30').all().map(row => JSON.parse(row.record));
  // 重启时无法证明子进程已结束，标 unknown，禁止盲目重复上传 / 新建草稿。
  for (const r of list()) if (r.state === 'running') { r.state = 'unknown'; r.error = '服务重启，执行结果未确认；请人工核对平台后处理'; save(r); }
  function create(input) {
    if (db.prepare("SELECT 1 FROM publish_preparations WHERE json_extract(record,'$.state')='running'").get()) throw new Error('已有准备操作在运行');
    const data = normalizePrep(input);
    if (data.episodeId) {
      const task = db.prepare('SELECT state FROM tasks WHERE episode_id=? AND platform=?').get(data.episodeId, data.platform);
      if (!task) throw new Error('该作品没有此平台任务');
      if (['published', 'scheduled', 'filled', 'awaiting_user', 'draft_saved'].includes(task.state)) throw new Error('此作品已发布 / 已准备，禁止重复准备');
      if (db.prepare("SELECT 1 FROM publish_preparations WHERE json_extract(record,'$.episodeId')=? AND json_extract(record,'$.platform')=?").get(data.episodeId, data.platform)) throw new Error('该作品已有准备记录，请先核对原任务');
    }
    const id = crypto.randomUUID(), folder = path.join(home, 'data', 'publish-prep', id);
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, 'job.json'), JSON.stringify(data.job, null, 2));
    const r = { id, platform: data.platform, episodeId: data.episodeId, test: data.test, title: data.job.title,
      state: 'prepared', createdAt: new Date().toISOString(), note: '本地任务已生成；未操作平台、未上传、未存平台草稿' };
    save(r); return r;
  }
  const jobFile = id => { get(id); return path.join(home, 'data', 'publish-prep', id, 'job.json'); };
  function start(id, kind) {
    if (db.prepare("SELECT 1 FROM publish_preparations WHERE json_extract(record,'$.state')='running'").get()) throw new Error('已有准备操作在运行');
    if (!['check', 'execute'].includes(kind)) throw new Error('不支持此动作');
    const r = get(id), cap = prepCapabilities(config, env)[r.platform];
    if (r.platform === 'x') throw new Error('X 请使用文字草稿链接，由用户打开，不运行自动化');
    if (['running', 'unknown', 'awaiting_user', 'draft_saved', 'failed'].includes(r.state)) throw new Error('结果未确认或已到位；请人工核对，禁止直接重跑');
    if (kind === 'execute' && !cap.browserEnabled) throw new Error(cap.reason);
    if (kind === 'execute' && r.state !== 'checked') throw new Error('必须先通过本地 skill 离线检查');
    if (!cap.installed) throw new Error(cap.reason);
    const file = jobFile(id), job = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (job.submit !== false || (r.platform === 'xhs' && job.account !== 'ai')) throw new Error('任务安全约束已改变，拒绝执行');
    const digest = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    if (kind === 'execute' && r.checkedDigest !== digest) throw new Error('任务已变化，必须重新检查');
    let output = '', done = false;
    r.state = 'running'; r.kind = kind; r.error = ''; save(r);
    const finish = (code, error) => {
      if (done) return; done = true;
      try {
        if (error) throw error;
        let result;
        try { result = JSON.parse(output); } catch { throw new Error('本地 skill 回执不是有效 JSON；结果未确认'); }
        if (kind === 'check' && result?.ok !== true) throw new Error('本地 skill 离线检查未通过；请检查素材、逐图审阅记录和图片哈希，不代表可上传');
        r.state = acceptPrepResult(r.platform, kind, code, result);
        if (kind === 'check') r.checkedDigest = digest;
        r.note = kind === 'check' ? '本地 skill 离线检查通过；不代表平台验收' : r.platform === 'wechat' ? '已读到本次显式草稿保存成功回执；未发表' : '已填好，专用窗口留给你核对并亲自发布';
        if (kind === 'execute' && r.episodeId) {
          db.prepare('UPDATE tasks SET state=?,detail=?,updated_at=? WHERE episode_id=? AND platform=?').run(r.platform === 'wechat' ? 'draft_saved' : 'awaiting_user', r.note, new Date().toISOString(), r.episodeId, r.platform);
        }
      } catch (e) { r.state = kind === 'execute' ? 'unknown' : 'check_failed'; r.error = redactL1(e.message, secrets); }
      // 不保存 skill 原始 stdout/stderr：其中可能含认证 URL、会话或无界 DOM。
      r.finishedAt = new Date().toISOString(); save(r);
    };
    try {
      const child = spawnChild(process.execPath, prepCommand(r.platform, kind, { script: cap.script, jobFile: file }),
        { cwd: root, env: { ...env, HUB_NO_WEB: '1' }, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      child.stdout?.on('data', d => { output += d; if (output.length > 2e6) { output = ''; finish(null, new Error('回执过大，结果未确认')); } });
      child.stderr?.on('data', () => {});
      child.once('error', () => finish(null, new Error('本地 skill 进程启动失败，未确认平台结果')));
      child.once('close', code => finish(code));
    } catch { finish(null, new Error('本地 skill 进程启动失败，未确认平台结果')); }
    return get(id);
  }
  return { create, get, list, start, jobFile, busy: () => list().some(r => r.state === 'running'),
    publicCapabilities: () => Object.fromEntries(Object.entries(prepCapabilities(config, env)).map(([p, { script, ...cap }]) => [p, cap])) };
}
