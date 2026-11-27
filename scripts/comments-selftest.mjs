// Temporary SQLite and fully injected browser execution. Never visits X or sends comments.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {once} from 'node:events';
import {DatabaseSync} from 'node:sqlite';
import {setImmediate as nextTurn} from 'node:timers/promises';
const home=fs.mkdtempSync(path.join(os.tmpdir(),'maitian-comments-'));
process.env.MAITIAN_HOME=home;process.env.MAITIAN_CONFIG=path.join(home,'config.json');
fs.writeFileSync(process.env.MAITIAN_CONFIG,'{}');
const {createCommentService,normalizeComment,commentUrl}=await import('../src/comment-service.mjs');
const {executeXComment,verifyCommentContext}=await import('../src/x-comment-executor.mjs');
const {createCommentsHttp}=await import('../src/comments-http.mjs');
const {createXAccount,bindXAccount,initXAccounts}=await import('../src/x-accounts.mjs');
const {commentPage}=await import('../src/web/comment-page.js');
const db=new DatabaseSync(path.join(home,'comments.db')),config={xHandle:'WorkDemo',publishPrep:{x:{browserExecution:true}},l1:{x:{browserExecution:true}}};
initXAccounts(db);const extra=createXAccount(db,{label:'旅行账户'});bindXAccount(db,extra.id,'TravelDemo',config.xHandle);
const actor={runtime:'codex',sessionId:'offline-comment-test'},other={runtime:'dsh',sessionId:'offline-second-agent'};
let externalBusy=true,signed=true,calls=[],mode='success';
const options={db,config,home,canUseAccount:()=>signed,isExternalBusy:()=>externalBusy,execute:async(r,ctx)=>{
 calls.push(r.id);ctx.onStage('checking_target');
 if(mode==='before')throw Object.assign(Error('target unavailable'),{safeBeforeSubmit:true});
 await ctx.beforeSubmit();if(mode==='after')throw Error('response lost');
 return {verified:true,account:mode==='wrong'?'WrongUser':r.account,content:r.content,url:`https://x.com/${r.account}/status/${1000+calls.length}`,rootId:r.root.id,parentId:r.target.id,verifiedAt:new Date().toISOString()};
}};
let service=createCommentService(options);
const input=(requestId,content='离线评论正文',accountId='default')=>({platform:'x',accountId,rootUrl:'https://x.com/Author/status/100',targetUrl:'https://x.com/Other/status/200',content,requestId});
try{
 for(const url of ['http://x.com/a/status/1','https://x.com/a/status/1?token=x','https://x.com/a/status/1#x','https://evil.test/a/status/1','https://x.com:443/a/status/1','file:///a','https://u:p@x.com/a/status/1'])assert.throws(()=>commentUrl(url));
 assert.throws(()=>normalizeComment({...input('bad'),accountId:undefined},config,db),/明确选择/);
 assert.throws(()=>normalizeComment({...input('bad'),submit:true},config,db),/不接受/);
 assert.throws(()=>normalizeComment({...input('bad'),rootUrl:'https://x.com/Author/status/200'},config,db),/作者不一致/);
 assert.throws(()=>service.enqueue(input('bad'),undefined));signed=false;assert.throws(()=>service.enqueue(input('loggedout'),actor),/登录/);signed=true;
 const first=service.enqueue(input('one'),actor),same=service.enqueue(input('one'),other),alias=service.enqueue(input('two'),other);
 assert.equal(first.id,same.id);assert.equal(first.id,alias.id);assert.equal(alias.actor.runtime,'codex');assert.equal(alias.deduplicated,true);assert.equal(calls.length,0);
 assert.throws(()=>service.enqueue(input('two','different'),actor),/requestId/);
 const second=service.enqueue(input('other-account','离线评论正文',extra.id),actor);assert.notEqual(second.id,first.id);
 externalBusy=false;await service.drain();await service.drain();assert.equal(service.get(first.id).state,'sent');assert.equal(service.get(second.id).state,'sent');assert.equal(calls.length,2);
 assert.throws(()=>service.resume(first.id,actor),/禁止重跑/);
 externalBusy=true;const failed=service.enqueue(input('safe-retry','未提交失败样本'),actor);mode='before';externalBusy=false;await service.drain();assert.equal(service.get(failed.id).state,'failed');
 mode='success';service.resume(failed.id,other);await nextTurn();assert.equal(service.get(failed.id).state,'sent');assert.equal(service.get(failed.id).attempts.length,2);
 externalBusy=true;const unknown=service.enqueue(input('unknown','提交后失联样本'),actor);mode='after';externalBusy=false;await service.drain();assert.equal(service.get(unknown.id).state,'unknown');assert.equal(service.get(unknown.id).mayHaveSent,true);
 const count=calls.length;assert.equal(service.enqueue(input('unknown-new-id','提交后失联样本'),other).id,unknown.id);assert.equal(calls.length,count);assert.throws(()=>service.resume(unknown.id,actor));
 externalBusy=true;const wrong=service.enqueue(input('wrong','错误作者回执'),actor);mode='wrong';externalBusy=false;await service.drain();assert.equal(service.get(wrong.id).state,'unknown');
 externalBusy=true;const cancelled=service.enqueue(input('cancel','取消样本'),actor);service.cancel(cancelled.id);assert.equal(service.get(cancelled.id).state,'cancelled');assert.throws(()=>service.cancel(first.id));
 const queued=service.enqueue(input('restart','重启前排队样本'),actor);
 const interrupted=service.enqueue(input('interrupted','重启前执行样本'),actor),raw=service.get(interrupted.id);raw.state='running';raw.submissionIntentAt=new Date().toISOString();raw.mayHaveSent=true;
 db.prepare('UPDATE comment_jobs SET state=?,record=? WHERE id=?').run(raw.state,JSON.stringify(raw),raw.id);
 service=createCommentService(options);assert.equal(service.get(queued.id).state,'paused');assert.equal(service.get(interrupted.id).state,'unknown');assert.equal(calls.length,count+1);
 assert.equal(service.list({accountId:extra.id}).total,1);assert.throws(()=>service.list({limit:1000}));assert.throws(()=>service.list({state:'fake'}));
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const html=commentPage(esc,service.list());assert.match(html,/原帖/);assert.match(html,/直接回复的评论/);assert.match(html,/查看发出的评论/);assert.match(html,/codex|Codex/);assert.match(html,/结果未知/);
 // HTTP layer rejects unsafe inputs and maintains the original task ID.
 const send=(res,status,data,type='application/json')=>{res.writeHead(status,{'content-type':type});res.end(type.startsWith('application/json')?JSON.stringify(data):data);};
 const route=createCommentsHttp({service,home,accounts:()=>[{id:'default',handle:'WorkDemo'}],send});
 const server=http.createServer((req,res)=>route(req,res,new URL(req.url,'http://localhost')).catch(e=>{res.writeHead(500);res.end(e.message);}));server.listen(0,'127.0.0.1');await once(server,'listening');
 try{
  const base='http://127.0.0.1:'+server.address().port;
  const request=async(p,body,headers={})=>{const r=await fetch(base+p,{...(body?{method:'POST',body:JSON.stringify(body)}:{}),headers:{...(body?{'content-type':'application/json',origin:base}:{}),...headers}});return {status:r.status,data:await r.json()};};
  assert.equal((await request('/api/comments/contract')).data.enqueueMeansSend,true);
  assert.equal((await request('/api/comments',{type:'enqueue',input:input('http'),actor},{origin:'https://evil.test'})).status,403);
  assert.equal((await request('/api/comments/contract',null,{'x-forwarded-for':'127.0.0.1'})).status,403);
  assert.equal((await request('/api/comments',{type:'enqueue',input:input('http'),actor,command:'no'})).status,400);
  const accepted=await request('/api/comments',{type:'enqueue',input:input('http','HTTP队列样本'),actor});assert.equal(accepted.status,202);
  const id=accepted.data.record.id;assert.equal((await request('/api/comments/record?id='+id)).data.record.id,id);
  assert.equal((await request('/api/comments',{type:'cancel',id})).data.record.state,'cancelled');
  assert.equal((await request('/api/comments',{type:'resume',id:unknown.id,actor})).status,409);
  assert.equal((await request('/api/comments/shot?id='+id+'&name=../../config')).status,400);
 }finally{await new Promise(r=>server.close(r));}
 // Browser orchestration is injected: verify one submit and exact root/parent/new reply.
 const task={...normalizeComment(input('flow','浏览器流程正文'),config,db),id:'fixture',startedAt:new Date().toISOString()};
 const card=(url,content='public context')=>({...commentUrl(url),content,createdAt:new Date().toISOString()});
 const root=card(task.root.url),parent=card(task.target.url),reply=card('https://x.com/WorkDemo/status/999',task.content);
 let submits=0,intents=0,typed='',currentUrl='',opened=false,afterSubmit=false,identityHandle=task.account;
 const page={goto:async url=>{currentUrl=url;},type:async text=>{typed=text;},screenshot:async()=>{},evaluate:async(fn,...args)=>{
  if(fn.name==='visibleXIdentity')return {handle:identityHandle,url:currentUrl,login:false};
  if(fn.name==='commentPageView')return {url:currentUrl,cards:[root,parent,...(afterSubmit?[reply]:[])],toastUrls:afterSubmit?[reply.url]:[]};
  if(fn.name==='openCommentTarget'){opened=true;return true;}
  if(fn.name==='commentComposer'){assert.equal(opened,true);const action=args.at(-1);if(action==='focus')return true;if(action==='submit'){assert.equal(typed,task.content);submits++;afterSubmit=true;return true;}return {ready:typed===task.content};}
  throw Error('Unexpected DOM function '+fn.name);
 }};
 const opts={config,db,withPage:async(r,c,fn)=>fn(page),wait:async()=>{}};
 const ctx={folder:home,beforeSubmit:()=>{intents++;},onStage:()=>{}};
 const proof=await executeXComment(task,ctx,opts);assert.equal(proof.verified,true);assert.equal(proof.parentId,'200');assert.equal(proof.rootId,'100');assert.equal(submits,1);assert.equal(intents,1);
 identityHandle='OtherAccount';await assert.rejects(executeXComment(task,ctx,opts),/账户不符/);assert.equal(submits,1);
 assert.throws(()=>verifyCommentContext({url:reply.url,cards:[root,reply]},task,reply.url),/直接回复/);
 assert.throws(()=>verifyCommentContext({url:task.target.url,cards:[parent]},task),/原帖关系/);
 assert.throws(()=>verifyCommentContext({url:reply.url,cards:[root,parent,{...reply,content:'wrong'}]},task,reply.url),/全文/);
 console.log('COMMENTS PASS: persistent queue, per-account/id and semantic dedup, alias provenance, login/busy checks, cancellation/restart pause, unknown locks, safe same-ID resume/history, HTTP origin/schema/path guards, UI relations, single browser submit and receipt verification. Mock browser only; no platform actions.');
}finally{db.close();}
