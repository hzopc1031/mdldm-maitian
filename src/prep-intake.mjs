import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { normalizePrep } from './publish-prep.mjs';
import { normalizePrepAgent } from './prep-agent.mjs';

export const prepRequestLimit = 131072;
const inboxAt = home => path.join(home, 'data', 'publish-prep', 'inbox');

function localBase(base) {
  if (!/^http:\/\/127\.0\.0\.1:[1-9]\d{0,4}$/.test(base) || !new URL(base).port) throw new Error('只允许向麦田本机地址交稿');
  return base;
}

export async function projectDraftContract({base='http://127.0.0.1:8787',request=fetch}={}) {
  localBase(base);
  const response=await request(base+'/api/prep/contract',{redirect:'error',signal:AbortSignal.timeout(4000)});
  if(response.status===404)return {version:1};
  const result=await response.json();
  if(!response.ok||![2,3,4].includes(result.version))throw Error('麦田接入版本未确认，未提交');
  return result;
}

export function projectDraftReceipt(record, base='http://127.0.0.1:8787') {
  const reviewPath = `/p#/prepare?record=${encodeURIComponent(record.id)}`;
  return {state:'accepted', id:record.id, draftState:record.state, platform:record.platform, title:record.title,
    ...(record.source ? {source:record.source} : {}), reviewPath, reviewUrl:localBase(base)+reviewPath,
    ...(record.operations ? {operations:record.operations} : {}),
    ...(record.checkedDigest ? {checkedDigest:record.checkedDigest} : {}),
    ...(record.submission ? {submission:record.submission} : {}),
    ...(record.note ? {note:record.note} : {}), ...(record.error ? {error:record.error} : {}),
    ...(record.evidence ? {evidence:record.evidence} : {}), ...(record.url ? {url:record.url} : {})};
}

export async function readProjectDraft({id, base='http://127.0.0.1:8787', request=fetch}) {
  localBase(base);
  if (typeof id !== 'string' || !/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(id)) throw new Error('请提供交稿回执中的记录 ID');
  const response = await request(`${base}/api/prep/record?id=${encodeURIComponent(id)}`, {redirect:'error',signal:AbortSignal.timeout(4000)});
  const result = await response.json();
  if (!response.ok || result.ok!==true || result.record?.id!==id) throw new Error(result.error || `麦田未确认稿件状态（${response.status}）`);
  return projectDraftReceipt(result.record, base);
}

export async function continueProjectDraft({id, action, actor, authorizationRef, base='http://127.0.0.1:8787', request=fetch}) {
  if (!['check','prepare'].includes(action)) throw new Error('仅支持检查稿件和填写/保存草稿；PUBLISH_DISABLED，不能发布');
  const current = await readProjectDraft({id, base, request});
  if (!current.source) throw new Error('此入口只继续带来源项目的交稿记录');
  if (!['xhs','wechat'].includes(current.platform)) throw new Error('X 在此仅交稿、下载文图包或登记已核验回执；不由此命令操作平台');
  if ((action==='check' && !['prepared','check_failed','checked'].includes(current.draftState)) || (action!=='check' && current.draftState!=='checked')) {
    throw new Error(`稿件当前状态为 ${current.draftState}；填写前须检查通过，结果未确认或已完成的稿件不重跑`);
  }
  const attributed=actor?normalizePrepAgent(actor):null;
  let response;
  try {
    response = await request(`${base}/api/prep`, {method:'POST',headers:{'content-type':'application/json',origin:base},
      body:JSON.stringify({type:action==='prepare'?'execute':action,id,...(attributed?{actor:attributed}:{})}),redirect:'error',signal:AbortSignal.timeout(4000)});
  } catch (error) { throw new Error('操作响应未确认；先用 --status 查询原记录，不重复执行', {cause:error}); }
  const result = await response.json();
  if (!response.ok || result.ok!==true || result.record?.id!==id) throw new Error(result.error || `麦田未确认操作（${response.status}）；先查原记录，不重发操作`);
  return projectDraftReceipt(result.record, base);
}

function draftRequest(input) {
  // Local CLI only checks the broad supported envelope; server applies its actual tier.
  const {source} = normalizePrep(input,{publishPrep:{x:{premium:true}}});
  if (!source) throw new Error('项目交稿需要来源项目、栏目和运行编号');
  const body = JSON.stringify({type:'create', input});
  if (Buffer.byteLength(body) > prepRequestLimit) throw new Error('稿件请求过大');
  return body;
}

export async function submitProjectDraft({home, input, base='http://127.0.0.1:8787', request=fetch}) {
  localBase(base);
  const body = draftRequest(input);
  let response;
  try {
    response = await request(`${base}/api/prep`, {
      method:'POST', headers:{'content-type':'application/json', origin:base},
      body, redirect:'error', signal:AbortSignal.timeout(4000),
    });
  } catch (error) {
    if (error.name !== 'TimeoutError' && error.cause?.code !== 'ECONNREFUSED') throw error;
  }
  if (response && response.status !== 409) {
    const result = await response.json();
    if (!response.ok || !result.ok || !result.record?.id) throw new Error(result.error || `麦田未确认收稿（${response.status}）`);
    return projectDraftReceipt(result.record, base);
  }

  const inbox = inboxAt(home);
  fs.mkdirSync(inbox, {recursive:true});
  const id = randomUUID();
  const pending = path.join(inbox, `${id}.tmp`);
  fs.writeFileSync(pending, body, {flag:'wx'});
  fs.renameSync(pending, path.join(inbox, `${id}.json`));
  return {state:'queued', id};
}

export function drainProjectDrafts(home, prep) {
  const inbox = inboxAt(home);
  if (prep.busy() || !fs.existsSync(inbox)) return;
  const files = fs.readdirSync(inbox, {withFileTypes:true})
    .filter(entry => entry.isFile() && /^[0-9a-f-]{36}\.json$/.test(entry.name)).slice(0,20);
  for (const entry of files) {
    const file = path.join(inbox, entry.name);
    let payload;
    try {
      if (fs.lstatSync(file).size > prepRequestLimit) throw new Error('稿件请求过大');
      payload = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (payload.type !== 'create' || !payload.input?.source || Object.keys(payload).some(key => !['type','input'].includes(key))) throw new Error('不是项目交稿');
      prep.create(payload.input);
    } catch (error) {
      // Temporary filesystem/database errors stay queued for a later attempt.
      if (error.code && !['ENOENT','ENOTDIR'].includes(error.code)) throw error;
      const rejected = path.join(inbox, 'rejected');
      fs.mkdirSync(rejected, {recursive:true});
      fs.renameSync(file, path.join(rejected, entry.name));
      continue;
    }
    // If interrupted here, the same run key is safe to import again.
    fs.unlinkSync(file);
  }
}
