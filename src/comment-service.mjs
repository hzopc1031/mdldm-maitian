import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import {normalizePrepAgent} from './prep-agent.mjs';
import {accountId,xAccountConfig} from './x-accounts.mjs';
import {l1Account} from './l1-account.mjs';
import {validateEdition} from './platform-rules.mjs';
import {redactL1} from './l1-web.mjs';

export const COMMENT_STATES=['queued','paused','running','sent','failed','unknown','cancelled'];
const fail=(code,message)=>{throw Object.assign(Error(message),{code});};
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function commentUrl(value){
 const m=typeof value==='string'&&/^https:\/\/x\.com\/([A-Za-z0-9_]{1,15})\/status\/([1-9]\d{0,24})$/.exec(value);
 if(!m)fail('INVALID_INPUT','目标须为不含参数的X公开帖子或评论链接');
 return {url:`https://x.com/${m[1].toLowerCase()}/status/${m[2]}`,handle:m[1].toLowerCase(),id:m[2]};
}
export function normalizeComment(input,config,db){
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['platform','accountId','rootUrl','targetUrl','content','requestId'].includes(k))||input.platform!=='x')fail('INVALID_INPUT','仅接受X账户、原帖、直接回复对象、正文和任务编号，不接受命令/凭据/submit');
 if(typeof input.accountId!=='string')fail('INVALID_INPUT','必须明确选择已登录账户');
 accountId(input.accountId);const scoped=xAccountConfig(config,input.accountId,db),account=l1Account(scoped,'x');
 if(typeof input.content!=='string'||input.content.length>100000||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(input.content))fail('INVALID_INPUT','评论须为纯文字，不含控制字符');
 const content=input.content.replace(/\r\n?/g,'\n').trim(),validation=validateEdition('x',{content},scoped);
 if(!validation.ok)fail('INVALID_INPUT',validation.issues.map(i=>i.message).join('；'));
 if(typeof input.requestId!=='string'||! /^[A-Za-z0-9][A-Za-z0-9_.:@-]{0,159}$/.test(input.requestId))fail('INVALID_INPUT','请提供稳定且唯一的requestId');
 const root=commentUrl(input.rootUrl),target=commentUrl(input.targetUrl);
 if(root.id===target.id&&root.handle!==target.handle)fail('INVALID_INPUT','同一statusId的原帖与回复对象作者不一致');
 return {platform:'x',accountId:input.accountId,account,root,target,content,requestId:input.requestId};
}
export function createCommentService({db,config,home,canUseAccount=()=>false,isExternalBusy=()=>false,execute,secrets=[],clock=()=>new Date()}){
 db.exec(`CREATE TABLE IF NOT EXISTS comment_jobs(id TEXT PRIMARY KEY,semantic_key TEXT UNIQUE NOT NULL,state TEXT NOT NULL,record TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS comment_requests(account_id TEXT NOT NULL,request_id TEXT NOT NULL,job_id TEXT NOT NULL,payload_hash TEXT NOT NULL,actor TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(account_id,request_id));`);
 const at=()=>clock().toISOString();
 const save=r=>db.prepare('UPDATE comment_jobs SET state=?,record=? WHERE id=?').run(r.state,JSON.stringify(r),r.id);
 const get=id=>{if(typeof id!=='string'||! /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(id))fail('INVALID_INPUT','评论记录ID无效');const row=db.prepare('SELECT record FROM comment_jobs WHERE id=?').get(id);if(!row)fail('NOT_FOUND','评论任务不存在');return JSON.parse(row.record);};
 // A restart is never permission to send yesterday's queue or retry a possible submission.
 for(const row of db.prepare("SELECT record FROM comment_jobs WHERE state IN ('running','queued')").all()){
  const r=JSON.parse(row.record);r.state=r.state==='running'?'unknown':'paused';r.error=r.state==='unknown'?'服务重启，发送结果未确认，禁止重发':'服务重启前尚未执行，已暂停；可沿原ID明确恢复';r.updatedAt=at();save(r);
 }
 let pumping=false;
 const busy=()=>pumping||!!db.prepare("SELECT 1 FROM comment_jobs WHERE state='running'").get();
 const preflight=r=>{
  const scoped=xAccountConfig(config,r.accountId,db);
  if(l1Account(scoped,'x').toLowerCase()!==r.account.toLowerCase())fail('ACCOUNT_MISMATCH','任务账户身份已变化，未执行');
  if(!canUseAccount(r.accountId))fail('ACCOUNT_LOGIN_REQUIRED','所选账户尚未确认登录或已失效，请先登录');
  if(scoped.publishPrep?.browserExecution===false||scoped.publishPrep?.x?.browserExecution===false||scoped.l1?.x?.browserExecution===false)fail('BROWSER_DISABLED','此账户浏览器执行已停用');
  return scoped;
 };
 const clean=error=>redactL1(error?.message||'评论执行失败',secrets).slice(0,2400);
 async function drain(){
  if(busy()||isExternalBusy())return;
  let r;db.exec('BEGIN IMMEDIATE');
  try{
   const occupied=db.prepare("SELECT 1 FROM comment_jobs WHERE state='running'").get();
   const row=occupied?null:db.prepare("SELECT record FROM comment_jobs WHERE state='queued' ORDER BY rowid LIMIT 1").get();
   if(!row){db.exec('COMMIT');return;}
   r=JSON.parse(row.record);Object.assign(r,{state:'running',startedAt:at(),updatedAt:at(),progress:'checking_account',executor:{name:'麦田本机X执行器',version:1}});save(r);db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}
  pumping=true;
  try{
   try{preflight(r);}catch(error){Object.assign(r,{state:'failed',code:error.code||'PREFLIGHT_FAILED',error:clean(error),mayHaveSent:false,updatedAt:at()});save(r);return;}
   const folder=path.join(home,'data','comments',r.id);fs.mkdirSync(folder,{recursive:true});
   const receipt=await execute(r,{folder,
    onContext:context=>{
     const cleanCard=(card,expected)=>{if(!card||card.id!==expected.id||card.handle!==expected.handle||typeof card.content!=='string'||card.content.length>100000)fail('INVALID_CONTEXT','评论上下文与目标不符');return {id:card.id,handle:card.handle,url:expected.url,content:card.content,createdAt:card.createdAt||null};};
     r.context={root:cleanCard(context.root,r.root),target:cleanCard(context.target,r.target),observedAt:at()};save(r);
    },
    onStage:stage=>{if(['checking_account','checking_target','writing','submitting','verifying'].includes(stage)){r.progress=stage;r.updatedAt=at();save(r);}},
    beforeSubmit:()=>{if(r.submissionIntentAt)fail('REPEAT_BLOCKED','同一任务只能提交一次');preflight(r);r.submissionIntentAt=at();r.mayHaveSent=true;r.progress='submitting';r.updatedAt=at();save(r);}
   });
   const url=commentUrl(receipt?.url);
   if(!r.submissionIntentAt||receipt?.verified!==true||receipt.account?.toLowerCase()!==r.account.toLowerCase()||url.handle!==r.account.toLowerCase()||url.id===r.target.id||url.id===r.root.id||receipt.parentId!==r.target.id||receipt.rootId!==r.root.id||receipt.content!==r.content||!Number.isFinite(Date.parse(receipt.verifiedAt))||Date.parse(receipt.verifiedAt)<Date.parse(r.startedAt)||Date.parse(receipt.verifiedAt)>clock().getTime()+30000)fail('INVALID_RECEIPT','缺少账号、完整正文、父对象及原帖关系的核验回执；结果未确认');
   Object.assign(r,{state:'sent',url:url.url,replyId:url.id,verifiedAt:receipt.verifiedAt,proof:{basis:'visible_conversation',rootId:receipt.rootId,parentId:receipt.parentId,replyId:url.id},finishedAt:at(),updatedAt:at()});delete r.error;delete r.code;
  }catch(error){Object.assign(r,{state:!r.submissionIntentAt&&error.safeBeforeSubmit===true?'failed':'unknown',mayHaveSent:!!r.submissionIntentAt,code:error.code||'EXECUTION_UNCONFIRMED',error:clean(error),finishedAt:at(),updatedAt:at()});}
  finally{r.attempts=[...(r.attempts||[]),{startedAt:r.startedAt,finishedAt:at(),state:r.state,code:r.code||null,error:r.error||null,submissionIntentAt:r.submissionIntentAt||null,resumedBy:r.resumedBy||null}];try{save(r);}finally{pumping=false;}}
 }
 function enqueue(input,caller){
  const actor=normalizePrepAgent(caller),data=normalizeComment(input,config,db);
  const payloadHash=hash({...data,requestId:undefined}),semantic=hash([data.account.toLowerCase(),data.target.id,data.content]);
  db.exec('BEGIN IMMEDIATE');let r,fresh=false;
  try{
   const alias=db.prepare('SELECT * FROM comment_requests WHERE account_id=? AND request_id=?').get(data.accountId,data.requestId);
   if(alias){if(alias.payload_hash!==payloadHash)fail('IDEMPOTENCY_CONFLICT','同一requestId已提交不同评论，不能覆盖');r=get(alias.job_id);}
   else{
    const existing=db.prepare('SELECT record FROM comment_jobs WHERE semantic_key=?').get(semantic);
    if(existing){r=JSON.parse(existing.record);if(r.payloadHash!==payloadHash)fail('IDEMPOTENCY_CONFLICT',`同一账号/目标/正文已有记录${r.id}，请核对原帖关系`);}
    else{
     r={...data,id:crypto.randomUUID(),payloadHash,state:'queued',actor,actorAttribution:'caller_reported',createdAt:at(),updatedAt:at(),mayHaveSent:false};preflight(r);
     db.prepare('INSERT INTO comment_jobs VALUES (?,?,?,?)').run(r.id,semantic,r.state,JSON.stringify(r));fresh=true;
    }
    db.prepare('INSERT INTO comment_requests VALUES (?,?,?,?,?,?)').run(data.accountId,data.requestId,r.id,payloadHash,JSON.stringify(actor),at());
   }
   db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}
  if(fresh)queueMicrotask(()=>void drain());return {...r,deduplicated:!fresh};
 }
 function resume(id,caller){
  const actor=normalizePrepAgent(caller),r=get(id);
  if(!['paused','failed'].includes(r.state)||r.mayHaveSent||r.submissionIntentAt)fail('REPEAT_BLOCKED','只能恢复尚未发送的原任务；未知/已发送结果禁止重跑');
  preflight(r);r.state='queued';delete r.error;delete r.code;r.resumedBy=actor;r.updatedAt=at();save(r);queueMicrotask(()=>void drain());return r;
 }
 function cancel(id){const r=get(id);if(!['queued','paused'].includes(r.state))fail('REPEAT_BLOCKED','只能取消尚未开始的任务，不能撤销已发送或未知结果');r.state='cancelled';r.updatedAt=at();save(r);return r;}
 function list({accountId:filter,state,limit=50,offset=0}={}){
  if(filter!==undefined)accountId(filter);if(state&&!COMMENT_STATES.includes(state))fail('INVALID_INPUT','未知评论状态');
  if(!Number.isInteger(limit)||limit<1||limit>200||!Number.isInteger(offset)||offset<0||offset>100000)fail('INVALID_INPUT','分页参数无效');
  const rows=db.prepare('SELECT record FROM comment_jobs ORDER BY rowid DESC').all().map(row=>JSON.parse(row.record)).filter(r=>!filter||r.accountId===filter),filtered=rows.filter(r=>!state||r.state===state);
  return {records:filtered.slice(offset,offset+limit),total:filtered.length,limit,offset,counts:Object.fromEntries(COMMENT_STATES.map(s=>[s,rows.filter(r=>r.state===s).length]))};
 }
 return {enqueue,resume,cancel,get,list,drain,busy};
}
