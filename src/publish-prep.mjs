// L1 发布层：独立的准备与显式小红书发布，公众号始终仅草稿。
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import { spawn } from 'node:child_process';
import { redactL1 } from './l1-web.mjs';
import { xDraftBundle } from './prep-bundle.mjs';
import { xhsWindow } from './prep-window.mjs';
import { l1Account } from './l1-account.mjs';
import { fillXEditor, isDedicatedXProfile } from './x-draft-editor.mjs';
import { normalizePrepAgent } from './prep-agent.mjs';
import {validateEdition,xEditionText} from './platform-rules.mjs';
import {wechatRichJob} from './prep-wechat.mjs';
import {skillText,skillError,stderrTail} from './prep-skill-errors.mjs';

export const BROWSER_BLOCK = '此平台的专用浏览器操作已由本地配置停用；不会改用其它账号、profile 或旧发布引擎。';
export function prepCapabilities(config = {}, env = process.env) {
  const root = env.MAITIAN_LOCAL_SKILLS || path.join(os.homedir(), '.dsh', 'skills');
  return Object.fromEntries(['x', 'xhs', 'wechat'].map(platform => {
    const script = platform === 'x' ? null : path.join(root, platform === 'xhs' ? 'xhs-publish' : 'wechat-publish', 'scripts', `${platform}.mjs`);
    const installed = script ? fs.existsSync(script) : true;
    // 安装检查只读脚本，不读取 accounts.json、profile 或凭据。
    const keepWindow = platform !== 'xhs' || (installed && fs.readFileSync(script, 'utf8').includes("opts['keep-browser']"));
    // 原compare/9368审批拒绝不是这些已授权专用通道的通用禁令。
    // 显式false仍由维护者控制；身份核验是独立的只读通道。
    const settings = config.publishPrep?.[platform];
    const enabled = config.publishPrep?.browserExecution !== false && (platform === 'x'
      ? settings?.browserExecution === true && isDedicatedXProfile(settings.browserProfile)
      : settings?.browserExecution !== false && installed && keepWindow);
    const inspectEnabled = config.l1?.[platform]?.browserExecution !== false;
    return [platform, { script, installed, browserEnabled: enabled, inspectEnabled, publishEnabled:false,
      mode: platform === 'x' ? '正文和最多4张图可下载为文图包；编辑器填写须显式启用专用 Chrome，仅填写不发布' : platform === 'xhs' ? '本地 xhs-publish，固定 --account ai；只填写留窗，由本人点击发布' : '本地 wechat-publish，只保存草稿并核对成功提示',
      reason: platform === 'x' ? enabled ? '已启用专用 Chrome 填写；执行时重新核验账号、空白编辑页和完整文图，填好后由本人处理。' : 'X 编辑器填写未启用；需在本地配置启用并指定专用 Chrome，仍可下载文图包。' : !installed ? '本地 DSH skill 未安装；不回退旧 hub' : !keepWindow ? '本地 skill 不支持保留窗口，未适配' : enabled ? '使用本地技能专用窗口；执行时核验可见账号。登录、素材检查和本次保存回执决定结果。' : BROWSER_BLOCK }];
  }));
}
function text(value, name, max, required = false) {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) throw new Error(`${name} 必须为${required ? '非空' : ''}文字，最多 ${max} 字符`);
  return value.trim();
}

function prepSource(source) {
  if (!source || typeof source !== 'object' || Array.isArray(source) || Object.keys(source).some(key => !['project', 'column', 'category', 'runId','agent'].includes(key))) {
    throw new Error('稿件来源只接受项目、栏目、运行编号和AI来源；兼容历史分类字段');
  }
  const project = text(source.project, '来源项目', 100, true);
  const column = text(source.column, '栏目', 80, true);
  const category = source.category===undefined ? undefined : text(source.category, '历史分类', 60);
  const runId = text(source.runId, '运行编号', 120, true);
  if ([project, column, category??''].some(value => /[\x00-\x1f\x7f]/.test(value)) || !/^[\w.:@-]+$/.test(runId)) throw new Error('来源或运行编号格式不对');
  return {project, column, runId,...(category===undefined?{}:{category}),...(source.agent?{agent:normalizePrepAgent(source.agent)}:{})};
}

function prepPublication(receipt, platform, source, input) {
  if (platform !== 'x' || !source || input.test || input.episodeId || !receipt || typeof receipt !== 'object' || Array.isArray(receipt) || Object.keys(receipt).some(key => !['url','publishedAt','verifiedAt'].includes(key))) {
    throw new Error('仅支持来源项目已读回的 X 普通帖回执');
  }
  const match = typeof receipt.url==='string' && /^https:\/\/x\.com\/([A-Za-z0-9_]{1,15})\/status\/(\d{1,25})$/.exec(receipt.url);
  if (!match) throw new Error('请提供核对过的 X 公开原帖链接');
  const time = value => typeof value==='string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? Date.parse(value) : NaN;
  const published = time(receipt.publishedAt), verified = time(receipt.verifiedAt);
  if (!Number.isFinite(published) || !Number.isFinite(verified) || published>verified || verified>Date.now()) throw new Error('请提供实际发布时间及随后核对原帖的时间');
  return {url:receipt.url, account:match[1], postId:match[2], publishedAt:new Date(published).toISOString(), verifiedAt:new Date(verified).toISOString()};
}
export function normalizePrep(input, config = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || !['x', 'xhs', 'wechat'].includes(input.platform)) throw new Error('仅支持 X、小红书图文、公众号');
  if (Object.keys(input).some(k => !['platform', 'title', 'content', 'caption','digest','author','cover','coverImage','coverFromBody','imagePositions','htmlFile','inlineImages','video','version', 'images', 'topics', 'promotionReview', 'episodeId', 'test', 'source', 'publication'].includes(k))) throw new Error('发布准备包含不支持的字段（不接受 submit、命令或凭据）');
  const source = input.source === undefined ? null : prepSource(input.source);
  const platform = input.platform;
  const publication = input.publication === undefined ? null : prepPublication(input.publication, platform, source, input);
  const title = text(input.title ?? '', '标题', 500, platform !== 'x');
  const content = text(input.content, '正文', 100000, true);
  const images = input.images ?? [], topics = input.topics ?? [];
  if (!Array.isArray(images) || images.length > (platform === 'x' ? 4 : platform==='xhs'?18:20) || (platform === 'xhs' && !images.length)) throw new Error('小红书需要 1–18 张本地图；X 最多4张；公众号最多20张');
  let totalBytes=0;
  const files = images.map(file => {
    if (typeof file !== 'string' || !path.isAbsolute(file) || /^(?:\\\\|\/\/)/.test(file) || !/\.(png|jpe?g|webp)$/i.test(file)) throw new Error('图片必须为本机绝对路径 PNG/JPEG/WebP，不接受网络共享路径');
    const stat=fs.statSync(file); totalBytes+=stat.size;
    if (!stat.isFile() || !stat.size || stat.size>32*1024*1024 || totalBytes>64*1024*1024) throw new Error('图片必须为非空文件，单图不超过32MB、整组不超过64MB');
    const fd=fs.openSync(file,'r'), head=Buffer.alloc(12);
    try { fs.readSync(fd,head,0,12,0); } finally { fs.closeSync(fd); }
    const ext=path.extname(file).toLowerCase();
    if (!(ext==='.png' ? head.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) : ext==='.webp' ? head.toString('ascii',0,4)==='RIFF' && head.toString('ascii',8,12)==='WEBP' : head[0]===255 && head[1]===216 && head[2]===255)) throw new Error('图片扩展名与文件头不符');
    return path.resolve(file);
  });
  if (!Array.isArray(topics) || topics.length > 10 || topics.some(t => typeof t !== 'string' || t.length > 40)) throw new Error('话题格式不对');
  if (input.test != null && typeof input.test !== 'boolean') throw new Error('test 必须为布尔值');
  if (input.episodeId != null && (typeof input.episodeId !== 'string' || input.episodeId.length > 200)) throw new Error('作品 ID 无效');
  // 审阅声明原样交给本地 skill 验证，不补造“已看图”记录。
  if (input.promotionReview != null && (typeof input.promotionReview !== 'object' || Array.isArray(input.promotionReview))) throw new Error('promotionReview 格式不对');
  const job = { title, content, images: files, topics, submit: false,
    ...(platform === 'wechat' ? {caption:text(input.digest ?? input.caption ?? '', '摘要',1000),author:text(input.author??'','作者',200)} : {}),
    ...(platform === 'xhs' ? { account: 'ai', promotionReview: input.promotionReview ?? {} } : {}) };
  if (input.test && !/^【测试(?:稿)?】/.test(job.title)) job.title = `【测试】${job.title}`;
  if (input.test && !/勿发布|勿发表/.test(job.content)) job.content = `工作台改版测试稿，请勿发布\n${content}`;
  const cover=input.cover??input.coverImage??(platform==='xhs'?files[0]:null);
  if(cover!=null){if(typeof cover!=='string'||!path.isAbsolute(cover)||/^(?:\\\\|\/\/)/.test(cover)||! /\.(png|jpe?g|webp)$/i.test(cover)||!fs.statSync(cover).isFile())throw Error('封面须为本机图片');normalizePrep({platform:'x',content:'封面检查',images:[cover]});job.coverImage=path.resolve(cover);if(platform==='xhs'){const index=files.indexOf(job.coverImage);job.images=index<0?[job.coverImage,...files]:[files[index],...files.slice(0,index),...files.slice(index+1)];}}
  if(platform==='wechat')job.coverFromBody=true;
  if(input.htmlFile!=null){if(platform!=='wechat'||!path.isAbsolute(input.htmlFile)||! /\.html?$/i.test(input.htmlFile)||!fs.statSync(input.htmlFile).isFile())throw Error('HTML须为本机公众号正文文件');job.htmlFile=input.htmlFile;}
  if(input.inlineImages!=null){if(!job.htmlFile||!Array.isArray(input.inlineImages)||input.inlineImages.length>20)throw Error('章节图片需要HTML且最多20张');job.inlineImages=input.inlineImages.map(im=>{if(!im||! /^[\w-]{1,64}$/.test(im.id)||!path.isAbsolute(im.file)||! /\.(png|jpe?g|webp)$/i.test(im.file)||!fs.statSync(im.file).isFile())throw Error('章节图片格式不正确');return {id:im.id,file:im.file};});}
  if(input.imagePositions!=null){if(platform!=='wechat'||!Array.isArray(input.imagePositions)||input.imagePositions.length>20||input.imagePositions.some(p=>!p||!files.includes(p.image)||!Number.isInteger(p.afterParagraph)||p.afterParagraph<0))throw Error('正文图片位置格式不正确');job.imagePositions=input.imagePositions;}
  const validation=validateEdition(platform,{...job,images:[...job.images,...(job.inlineImages??[]).map(im=>im.file)],video:input.video},config);
  if(!publication&&!validation.ok)throw Error(validation.issues.map(i=>i.message).join('；'));
  if(platform==='x')job.content=xEditionText(job);
  const wechatCover=platform==='wechat'?job.coverImage:undefined;
  if(platform==='wechat')delete job.coverImage;
  return { platform, job, ...(wechatCover?{wechatCover}:{}), episodeId: input.episodeId || null, test: input.test === true, ...(source ? {source} : {}), ...(publication ? {publication} : {}) };
}
export function prepCommand(platform, kind, { script, jobFile }) {
  if (!['xhs', 'wechat'].includes(platform) || !['check', 'execute'].includes(kind)) throw new Error('只支持检查和填写，不能发布');
  if(platform==='wechat'&&kind==='execute')return [fileURLToPath(new URL('./prep-wechat-run.mjs',import.meta.url)),script,jobFile];
  return [script, kind === 'check' ? platform === 'xhs' ? 'preflight' : 'check' : 'post', '--job', jobFile,
    ...(platform === 'xhs' ? kind === 'check' ? ['--kind', 'post', '--account', 'ai'] : ['--account', 'ai', '--keep-browser'] : [])];
}
export function acceptPrepResult(platform, kind, code, result) {
  if(!['check','execute'].includes(kind))throw Error('只支持检查和填写，不能发布');
  if (code !== 0 || result?.ok !== true || result?.submitted === true) throw new Error('本地 skill 失败或回执不符合只准备约束；先人工核对页面，勿直接重跑');
  if (kind === 'check') {
    if (!(platform === 'xhs' ? result.offlineOnly === true : result.offline === true)) throw new Error('缺少离线检查证明');
    return 'checked';
  }
  if (platform === 'wechat' && result.savedAsDraft === true && result.submitted === false) return 'draft_saved';
  if (platform === 'xhs' && result.dryRun === true && result.submitted === false) return 'awaiting_user';
  throw new Error('缺少填好 / 草稿保存证明，状态保持未确认');
}

function wechatFailureEvidence(code, result, stderr, error) {
  const bool = value => typeof value === 'boolean' ? value : null;
  const knownCode = value => typeof value==='string' && value ? skillText(value,80) : null;
  const saveConfirmed=result?.savedAsDraft===true && result?.submitted===false;
  const cleanupFailed=result?.code==='BROWSER_FAILED' && (saveConfirmed || knownCode(result?.operationCode)!==null);
  return {
    exitCode: Number.isInteger(code) ? code : null,
    receiptParsed: result !== undefined,
    resultOk: bool(result?.ok),
    submitted: bool(result?.submitted),
    savedAsDraft: bool(result?.savedAsDraft),
    skillCode: knownCode(result?.code) ?? 'UNKNOWN',
    message: skillText(result?.message ?? error?.message),
    hint: skillText(result?.hint),
    screenshot: typeof result?.screenshot==='string' ? skillText(result.screenshot) : null,
    stderrTail: stderr,
    ...(result?.errorName?{errorName:skillText(result.errorName,80)}:{}),
    ...(result?.operationMessage?{operationMessage:skillText(result.operationMessage)}:{}),
    operationCode: knownCode(result?.operationCode),
    saveConfirmed, cleanupFailed,
    draftVerified: bool(result?.draftVerified),
    stage: result===undefined ? 'receipt_unreadable' : result?.submitted===true ? 'unexpected_submission'
      : saveConfirmed ? 'saved_but_incomplete' : cleanupFailed ? 'operation_and_cleanup_failed' : 'save_unconfirmed',
  };
}

const jobDigest = file => {
  const bytes=fs.readFileSync(file), job=JSON.parse(bytes);
  const files=[...job.images,...(job.inlineImages??[]).map(im=>im.file),...(job.coverImage?[job.coverImage]:[]),...(job.htmlFile?[job.htmlFile]:[])];
  return crypto.createHash('sha256').update(bytes).update(JSON.stringify(files.map(f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')))).digest('hex');
};
const contentDigestFor = data => crypto.createHash('sha256').update(JSON.stringify({
  ...data, job: { ...data.job, images: data.job.images.map(file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')) },
})).digest('hex');

export function createPrepService({ db, home, root, config, secrets = [], spawnChild = spawn, runX = fillXEditor, env = process.env }) {
  // 单独表不改变原 hub 的 tasks 状态约定；准备完成绝不等于 published。
  db.exec('CREATE TABLE IF NOT EXISTS publish_preparations (id TEXT PRIMARY KEY, record TEXT NOT NULL)');
  const save = r => db.prepare('INSERT OR REPLACE INTO publish_preparations VALUES (?,?)').run(r.id, JSON.stringify(r));
  const get = id => { const row = db.prepare('SELECT record FROM publish_preparations WHERE id=?').get(id); if (!row) throw new Error('准备任务不存在'); return JSON.parse(row.record); };
  const list = () => db.prepare('SELECT record FROM publish_preparations ORDER BY rowid DESC LIMIT 30').all().map(row => JSON.parse(row.record));
  const findPublication = db.prepare(`SELECT id FROM publish_preparations WHERE json_extract(record,'$.platform')='x'
    AND (json_extract(record,'$.publication.postId')=? OR lower(json_extract(record,'$.url'))=lower(?))`);
  // 重启时无法证明子进程已结束，标 unknown，禁止盲目重复上传 / 新建草稿。
  for (const {record} of db.prepare("SELECT record FROM publish_preparations WHERE json_extract(record,'$.state')='running'").all()) {
    const r=JSON.parse(record);
    r.state = 'unknown'; r.error = '服务重启，执行结果未确认；请人工核对平台后处理';
    const op=r.operations?.at(-1);if(op&&!op.finishedAt)Object.assign(op,{state:'unknown',interruptedAt:new Date().toISOString()});
    save(r);
  }
  function savePublication(record, publication) {
    const {url, publishedAt} = publication;
    if (record.url && record.url.toLowerCase() !== url.toLowerCase()) throw new Error('此稿已经关联另一条公开原帖');
    if (record.publication) {
      if (record.publication.publishedAt !== publishedAt) throw new Error('原帖已有不同的发布时间');
      return record;
    }
    const existing = findPublication.get(publication.postId, url);
    if (existing && existing.id !== record.id) throw new Error('该原帖已关联另一条发布记录');
    Object.assign(record, {state:'published', url, publishedAt, publication, note:'来源项目已核对公开原帖'});
    delete record.error;
    save(record);
    return record;
  }
  function create(input) {
    if (db.prepare("SELECT 1 FROM publish_preparations WHERE json_extract(record,'$.state')='running'").get()) throw new Error('已有准备操作在运行');
    const {source, publication, wechatCover, ...data} = normalizePrep(input, config);
    if (publication && publication.account.toLowerCase() !== l1Account(config,'x').toLowerCase()) throw new Error('原帖账号与工作台 X 账号不符');
    const contentDigest = contentDigestFor(data);
    const same = source
      ? db.prepare(`SELECT record FROM publish_preparations WHERE json_extract(record,'$.platform')=?
          AND json_extract(record,'$.source.project')=? AND json_extract(record,'$.source.column')=? AND json_extract(record,'$.source.runId')=?`)
        .get(data.platform, source.project, source.column, source.runId)
      : db.prepare("SELECT record FROM publish_preparations WHERE json_extract(record,'$.contentDigest')=? AND json_extract(record,'$.source') IS NULL").get(contentDigest);
    if (same) {
      const record = JSON.parse(same.record);
      if (source && record.contentDigest !== contentDigest) {
        throw new Error('同一运行编号已收过不同稿件，请检查任务编号');
      }
      if(source?.agent && record.source?.agent && JSON.stringify(source.agent)!==JSON.stringify(record.source.agent))throw Error('同一交稿记录已有不同AI来源，不能覆盖');
      return publication ? savePublication(record, publication) : record;
    }
    if (data.episodeId) {
      const task = db.prepare('SELECT state FROM tasks WHERE episode_id=? AND platform=?').get(data.episodeId, data.platform);
      if (!task) throw new Error('该作品没有此平台任务');
      if (['published', 'scheduled', 'filled', 'awaiting_user', 'draft_saved','submitted','already_exists','unknown'].includes(task.state)) throw new Error('此作品已发布 / 已准备或结果未确认，禁止重复准备');
      if (db.prepare("SELECT 1 FROM publish_preparations WHERE json_extract(record,'$.episodeId')=? AND json_extract(record,'$.platform')=?").get(data.episodeId, data.platform)) throw new Error('该作品已有准备记录，请先核对原任务');
    }
    const id = crypto.randomUUID(), folder = path.join(home, 'data', 'publish-prep', id);
    if (publication && findPublication.get(publication.postId, publication.url)) throw new Error('该原帖已关联另一条发布记录');
    fs.mkdirSync(folder, { recursive: true });
    if(data.platform==='wechat'){Object.assign(data.job,wechatRichJob(data.job,wechatCover,folder));delete data.job.imagePositions;delete data.job.coverImage;}
    // X 下载包冻结素材，源文件后来改动不会改变已经准备的草稿。
    if (data.platform === 'x') data.job.images = data.job.images.map((file,i) => {
      const target=path.join(folder,`${String(i+1).padStart(2,'0')}${path.extname(file).toLowerCase()}`);
      fs.copyFileSync(file,target); return target;
    });
    fs.writeFileSync(path.join(folder, 'job.json'), JSON.stringify(data.job, null, 2));
    const r = { id, platform: data.platform, episodeId: data.episodeId, test: data.test, title: data.job.title,
      imageCount:data.job.images.length+(data.job.inlineImages?.length??0), contentDigest, state: 'prepared', createdAt: new Date().toISOString(),
      ...(source ? {source} : {}), note: source ? '项目已交稿，可在此核对后继续处理' : '本地任务已生成；未操作平台、未上传、未存平台草稿' };
    if (publication) return savePublication(r, publication);
    save(r); return r;
  }
  const jobFile = id => { get(id); return path.join(home, 'data', 'publish-prep', id, 'job.json'); };
  function startX(r, kind, cap, actor) {
    if (kind !== 'execute') throw new Error('X 文图任务不运行本地 skill 离线检查');
    if (r.state === 'awaiting_user') return r;
    if (r.state !== 'prepared') throw new Error('X 编辑器结果需本人核对，禁止直接重跑');
    if (!cap.browserEnabled) throw new Error(cap.reason);
    const file = jobFile(r.id), job = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (job.submit !== false || contentDigestFor({ platform: r.platform, job, episodeId: r.episodeId, test: r.test }) !== r.contentDigest) {
      throw new Error('X 文图素材已变化，禁止填写');
    }
    const account = l1Account(config, 'x');
    const profile = config.publishPrep.x.browserProfile;
    r.state = 'running';
    r.kind = kind;
    const operation={kind,actor,startedAt:new Date().toISOString()};
    r.operations=[...(r.operations??[]),operation];
    save(r);
    void (async () => {
      try {
        const receipt = await runX({ account, profile, job, folder: path.dirname(file) });
        if (receipt?.submitted !== false || receipt.editorFilled !== true || receipt.imageCount !== job.images.length) {
          throw new Error('缺少 X 编辑器完整文图回执');
        }
        r.state = 'awaiting_user';
        r.evidence = receipt;
        r.note = '完整正文和图片已在 X 新编辑页读回，留给本人核对。';
        if (r.episodeId) db.prepare('UPDATE tasks SET state=?,detail=?,updated_at=? WHERE episode_id=? AND platform=?')
          .run(r.state, r.note, new Date().toISOString(), r.episodeId, r.platform);
      } catch (error) {
        r.state = 'unknown';
        r.error = redactL1(error.message, secrets);
      } finally {
        r.finishedAt = new Date().toISOString();
        Object.assign(operation,{finishedAt:r.finishedAt,state:r.state});
        save(r);
      }
    })();
    return get(r.id);
  }
  function start(id, kind, caller, approval) {
    const actor=caller===undefined?null:normalizePrepAgent(caller);
    if (db.prepare("SELECT 1 FROM publish_preparations WHERE json_extract(record,'$.state')='running'").get()) throw new Error('已有准备操作在运行');
    if (!['check', 'execute'].includes(kind)) throw new Error('PUBLISH_DISABLED：此入口只填写，不发布');
    const r = get(id), cap = prepCapabilities(config, env)[r.platform];
    if (r.readOnlyReceipt) throw new Error('历史回执只读；不能重新检查或上传');
    if (r.platform === 'x') return startX(r, kind, cap, actor);
    if (kind === 'execute' && ['awaiting_user','draft_saved'].includes(r.state)) {
      const current = jobDigest(jobFile(id));
      if (current === r.checkedDigest) return r;
      throw new Error('已填任务摘要变化，禁止重新上传；先核对原窗口');
    }
    if (['running', 'unknown', 'awaiting_user', 'draft_saved', 'published','submitted','already_exists', 'failed'].includes(r.state)) throw new Error('结果未确认或已到位；请人工核对，禁止直接重跑');
    if (kind !== 'check' && !cap.browserEnabled) throw new Error(cap.reason);
    if (kind !== 'check' && r.state !== 'checked') throw new Error('必须先通过本地 skill 离线检查');
    if (kind !== 'check' && r.platform === 'xhs' && db.prepare("SELECT 1 FROM publish_preparations WHERE id<>? AND json_extract(record,'$.platform')='xhs' AND json_extract(record,'$.state') IN ('awaiting_user','unknown') AND COALESCE(json_extract(record,'$.windowReleased'),0)=0").get(id)) throw new Error('ai 专用窗口已有待手动发布或结果未知的任务；先核对现稿，禁止覆盖或新建另一份');
    if (!cap.installed) throw new Error(cap.reason);
    const file = jobFile(id), job = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (job.submit !== false || (r.platform === 'xhs' && job.account !== 'ai')) throw new Error('任务安全约束已改变，拒绝执行');
    const digest = jobDigest(file);
    if (kind !== 'check' && r.checkedDigest !== digest) throw new Error('任务已变化，必须重新检查');
    const executionFile=file;
    let output = '', stderr = Buffer.alloc(0), stderrTruncated=false, done = false;
    const operation={kind,actor,startedAt:new Date().toISOString()};
    r.operations=[...(r.operations??[]),operation];
    r.state = 'running'; r.kind = kind; r.error = ''; save(r);
    const finish = (code, error) => {
      if (done) return; done = true;
      let result;
      try {
        if (error) throw error;
        try { result = JSON.parse(output); } catch { throw new Error('本地 skill 回执不是有效 JSON；结果未确认'); }
        if (kind === 'check' && result?.ok !== true) throw new Error('本地 skill 离线检查未通过；请检查素材、逐图审阅记录和图片哈希，不代表可上传');
        r.state = acceptPrepResult(r.platform, kind, code, result);
        if (kind === 'check') r.checkedDigest = digest;
        r.note = kind === 'check' ? '本地 skill 离线检查通过；不代表平台验收' : r.platform === 'wechat' ? '已读到本次显式草稿保存成功回执；未发表' : '已填好，专用窗口留给你核对并亲自发布';
        if (kind !== 'check' && r.episodeId) {
          db.prepare('UPDATE tasks SET state=?,detail=?,updated_at=? WHERE episode_id=? AND platform=?').run(r.state, r.note, new Date().toISOString(), r.episodeId, r.platform);
        }
        r.evidence = { submitted: result.submitted === false ? false : null,
          ...(Array.isArray(result.browserCleanup)?{browserCleanup:result.browserCleanup.map(item=>({remaining:Number.isInteger(item.remaining)?item.remaining:null,kept:item.kept===true}))}:{}),
          ...(typeof result.titleFinal==='string' ? {titleFinal:result.titleFinal.slice(0,100)} : {}),
          ...(typeof result.screenshot === 'string' && path.isAbsolute(result.screenshot) && !/^(?:\\\\|\/\/)/.test(result.screenshot) ? { screenshot: redactL1(skillText(result.screenshot),secrets) } : {}),
          ...(r.platform === 'xhs' ? { dryRun: result.dryRun === true, account: 'ai', keepBrowser: true } : {}),
          ...(r.platform === 'wechat' ? { savedAsDraft: result.savedAsDraft === true, draftVerified: result.draftVerified === true,
            confirmation:skillText(result.confirmation),bodyImageCount:result.bodyImageCount??null,coverBodyImageIndex:result.coverBodyImageIndex??null,
            skill:{code:skillText(result.code,80),message:redactL1(skillText(result.message),secrets),hint:redactL1(skillText(result.hint),secrets),stderrTail:redactL1(stderrTail(stderr.toString('utf8'),stderrTruncated),secrets)},
            draftListCheck:result.draftListCheck?{verified:result.draftListCheck.verified===true,matches:result.draftListCheck.matches??null,screenshot:skillText(result.draftListCheck.screenshot),error:skillText(result.draftListCheck.error)}:null } : {}) };
      } catch (e) {
        r.state = kind !== 'check' ? 'unknown' : 'check_failed';
        r.error = redactL1(skillText(e.message), secrets);
        if (r.platform === 'wechat') {
          r.failureEvidence = wechatFailureEvidence(code, result,redactL1(stderrTail(stderr.toString('utf8'),stderrTruncated),secrets),e);
          for(const key of ['message','hint','screenshot','operationMessage'])if(r.failureEvidence[key])r.failureEvidence[key]=redactL1(r.failureEvidence[key],secrets);
          if(Array.isArray(result?.browserCleanup))r.failureEvidence.browserCleanup=result.browserCleanup.map(item=>({remaining:Number.isInteger(item.remaining)?item.remaining:null,kept:item.kept===true}));
          // 不把上一步离线检查的证据冒充本次执行回执。
          delete r.evidence;
          if(r.failureEvidence.saveConfirmed) r.evidence={submitted:false,savedAsDraft:true,draftVerified:result.draftVerified===true};
          const messages={receipt_unreadable:'公众号回执无法解析，保存结果未确认；先核对草稿箱，勿重建。',
            unexpected_submission:'公众号回执违反仅草稿约束；停止执行并核对平台，勿重跑。',
            saved_but_incomplete:'已收到显式草稿保存证明，但进程未完整成功；先核对浏览器收尾，勿重复建稿。',
            operation_and_cleanup_failed:'草稿保存未确认，且浏览器收尾失败；先核对草稿箱和专用窗口，勿重跑。',
            save_unconfirmed:'未收到有效的显式草稿保存证明；先核对草稿箱，勿重复建稿。'};
          r.error=(kind==='check'?'公众号离线检查失败；':messages[r.failureEvidence.stage]+' ')+r.failureEvidence.skillCode+'：'+r.failureEvidence.message;
        }
      }
      // 不保存原始stdout/DOM；仅白名单回执及脱敏后的stderr尾部。
      r.finishedAt = new Date().toISOString();
      Object.assign(operation,{finishedAt:r.finishedAt,state:r.state});
      save(r);
    };
    try {
      const child = spawnChild(process.execPath, prepCommand(r.platform, kind, { script: cap.script, jobFile: executionFile }),
        { cwd: root, env: { ...env, HUB_NO_WEB: '1', ...(r.platform==='wechat'?{PUBLISH_SKILL_DATA:'D:/AIInfra/agent-publish'}:{}) }, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      child.stdout?.on('data', d => { output += d; if (output.length > 2e6) { output = ''; finish(null, new Error('回执过大，结果未确认')); } });
      child.stderr?.on('data', d => {stderr=Buffer.concat([stderr,Buffer.from(d)]);if(stderr.length>65536){stderr=stderr.subarray(-65536);stderrTruncated=true;}});
      child.once('error', error => finish(null, Object.assign(new Error('本地 skill 进程启动失败：'+skillError(error).message),{code:error.code})));
      child.once('close', code => finish(code));
    } catch(error) { finish(null, new Error('本地 skill 进程启动失败：'+skillError(error).message)); }
    return get(id);
  }
  function uploadImage(name, bytes) {
    const ext = path.extname(name).toLowerCase();
    if (!['.png','.jpg','.jpeg','.webp'].includes(ext) || !bytes.length || bytes.length > 32*1024*1024) throw new Error('请选择不超过32MB的 PNG/JPEG/WebP 图片');
    const folder = path.join(home,'data','prep-assets'); fs.mkdirSync(folder,{recursive:true});
    const file = path.join(folder,crypto.randomUUID()+ext);
    fs.writeFileSync(file,bytes);
    try { normalizePrep({platform:'xhs',title:'素材校验',content:'素材校验',images:[file]}); }
    catch (e) { fs.unlinkSync(file); throw e; }
    return { path:file, sha256:crypto.createHash('sha256').update(bytes).digest('hex') };
  }
  return { create, get, list, start, jobFile, uploadImage,
    releaseWindow: id => {
      const r=get(id);
      if(r.platform!=='xhs'||r.state!=='awaiting_user')throw new Error('仅已填待手动发布的任务可由本人确认解除占用；未知结果不能解除');
      r.windowReleased=true;r.windowReleasedAt=new Date().toISOString();save(r);return r;
    },
    window: async (id, activate) => {
      const r=get(id);
      if(r.platform!=='xhs' || !['awaiting_user','unknown'].includes(r.state)) throw new Error('仅已有小红书填写回执可核对留窗');
      if(r.windowReleased)throw new Error('此回执已由本人解除占用，不再关联当前窗口');
      const result=await xhsWindow({activate,expectedTitle:r.evidence?.titleFinal || r.title,env});
      r.windowEvidence={...result,checkedAt:new Date().toISOString()}; save(r); return result;
    }, busy: () => !!db.prepare("SELECT 1 FROM publish_preparations WHERE json_extract(record,'$.state')='running'").get(),
    bundle: id => { if (get(id).platform !== 'x') throw new Error('仅 X 提供文图包'); return xDraftBundle(JSON.parse(fs.readFileSync(jobFile(id),'utf8'))); },
    publicCapabilities: () => Object.fromEntries(Object.entries(prepCapabilities(config, env)).map(([p, { script, ...cap }]) => [p, cap])) };
}
