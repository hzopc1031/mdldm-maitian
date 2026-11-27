import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {commentUrl} from './comment-service.mjs';
import {xAccountConfig} from './x-accounts.mjs';
import {l1Account} from './l1-account.mjs';
import {visibleXIdentity} from './l1-x-dom.mjs';
import {isDedicatedXProfile} from './x-draft-editor.mjs';
import {commentPageView,openCommentTarget,commentComposer} from './x-comment-dom.mjs';

const mismatch=message=>{throw Error(message);};
const sameProfile=(a,b)=>typeof a==='string'&&typeof b==='string'&&path.resolve(a).toLowerCase()===path.resolve(b).toLowerCase();
export async function withSharedCommentPage(task,{profile,port},fn,driver){
 const routeError=message=>{throw Object.assign(Error(message),{code:'X_BROWSER_ROUTE_MISMATCH'});};
 if(port!==9336||!isDedicatedXProfile(profile,port))routeError('原X账户专用浏览器目录或端口不符');
 const routes=Object.values(driver.listAccounts().accounts).filter(r=>r.port===port&&sameProfile(r.profile,profile)&&r.expectedHandle?.toLowerCase()===task.account.toLowerCase());
 if(routes.length!==1)routeError('工作台与本地x-publish的公开账号路由不一致，未启动浏览器');
 const route=routes[0];
 if(route.proxy){const proxy=new URL(route.proxy);if(!['http:','https:','socks5:'].includes(proxy.protocol)||proxy.username||proxy.password||proxy.search||proxy.hash||!['','/'].includes(proxy.pathname))routeError('X专用代理配置须为无凭据的服务地址');}
 let page,phase='prepare';
 try{
  // Existing x-publish launch verifies an occupied port before reusing it;
  // absent listeners start only this exact dedicated profile. No comment retry.
  const launched=await driver.launch({port,profile,proxy:route.proxy,startUrl:'about:blank'});
  const owner=await driver.verifyBrowserProfile(port,profile);
  if(!Number.isInteger(launched.pid)||owner.pids?.[0]!==launched.pid||!sameProfile(owner.profile,profile))throw Error('启动后浏览器归属变化');
  page=await driver.Page.attach(port,{owned:true,startUrl:'about:blank'});
  if(page._owned!==true||page._port!==port||typeof page.targetId!=='string'||!page.targetId)throw Error('未取得本轮自有标签');
  const again=await driver.verifyBrowserProfile(port,profile);
  if(owner.pids[0]!==again.pids?.[0]||!sameProfile(again.profile,profile))throw Error('连接后浏览器归属变化');
  phase='operation';
  return await fn({goto:url=>page.goto(url),evaluate:(fn,...args)=>page.eval(`(${fn.toString()})(...${JSON.stringify(args)})`),type:content=>page.typeText(content),screenshot:file=>page.screenshot(file),
   withReadOnlyPage:read=>withSharedCommentPage(task,{profile,port},p=>read({goto:p.goto,evaluate:p.evaluate,screenshot:p.screenshot}),driver)});
 }catch(error){
  if(phase==='operation')throw error;
  throw Object.assign(Error(`X专用浏览器启动或连接未就绪：${error.message}；未发送，请检查专用窗口后沿原ID恢复`),{code:'X_BROWSER_UNAVAILABLE'});
 }finally{await page?.closeOwned();}
}
export function verifyCommentContext(view,task,replyUrl){
 const expected=replyUrl?commentUrl(replyUrl):task.target,actual=commentUrl(view.url);
 if(actual.id!==expected.id||actual.handle!==expected.handle)mismatch('当前页面并非指定的公开对象');
 const matches=view.cards.map((c,i)=>({...c,index:i})).filter(c=>c.id===expected.id&&c.handle===expected.handle);
 if(matches.length!==1)mismatch('未找到唯一主对象，不能从引用卡片或其他回复猜测');
 const focus=matches[0],ancestors=view.cards.slice(0,focus.index);
 if(replyUrl){
  if(focus.content!==task.content||focus.handle!==task.account.toLowerCase())mismatch('新评论全文或作者不符');
  if(ancestors.at(-1)?.id!==task.target.id||ancestors.at(-1)?.handle!==task.target.handle)mismatch('未从可见会话确认直接回复对象');
 }
 if(task.root.id!==task.target.id||replyUrl){if(ancestors[0]?.id!==task.root.id||ancestors[0]?.handle!==task.root.handle)mismatch('未从可见会话确认原帖关系');}
 else if(focus.index!==0)mismatch('指定原帖前仍有会话祖先，请核对真正原帖');
 return focus;
}
// Default account reuses the existing local x-publish connection, only its owned tab.
// Managed accounts use the already registered, ownership-verified dedicated browser.
export async function withCommentPage(task,{config,db},fn){
 const scoped=xAccountConfig(config,task.accountId,db);
 if(l1Account(scoped,'x').toLowerCase()!==task.account.toLowerCase())throw Error('任务账户已变化');
 if(scoped._xAccountRoute){
  const {withL1Browser}=await import('./l1-browser.mjs');
  return withL1Browser(scoped,async(_,connection)=>{
   const run=async callback=>{
   const {targetId}=await connection.send('Target.createTarget',{url:'about:blank'});
   const {sessionId}=await connection.send('Target.attachToTarget',{targetId,flatten:true});
   const send=(method,params={})=>connection.send(method,params,sessionId);
   await send('Page.enable');await send('Runtime.enable');
   try{return await callback({
    async goto(url){const r=await send('Page.navigate',{url});if(r.errorText)throw Error('X页面导航失败');await delay(1500);},
    async evaluate(fn,...args){const r=await send('Runtime.evaluate',{expression:`(${fn.toString()})(...${JSON.stringify(args)})`,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error('X页面控件读取失败');return r.result.value;},
    type:content=>send('Input.insertText',{text:content}),
    async screenshot(file){const r=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(file,Buffer.from(r.data,'base64'));},
    withReadOnlyPage:read=>run(p=>read({goto:p.goto,evaluate:p.evaluate,screenshot:p.screenshot}))
   });}finally{await connection.send('Target.closeTarget',{targetId}).catch(()=>{});}
   };
   return run(fn);
  },'x');
 }
 const settings=scoped.publishPrep?.x,profile=settings?.browserProfile,port=settings?.browserPort??9336;
 if(port!==9336||!isDedicatedXProfile(profile,port)||settings?.browserExecution!==true)throw Error('原X账户专用执行浏览器未配置');
 const root=process.env.MAITIAN_LOCAL_SKILLS||path.join(os.homedir(),'.dsh','skills');
 const cdp=await import(pathToFileURL(path.join(root,'x-publish/scripts/lib/cdp.mjs')).href);
 const {listAccounts}=await import(pathToFileURL(path.join(root,'x-publish/scripts/lib/accounts.mjs')).href);
 return withSharedCommentPage(task,{port,profile},fn,{...cdp,listAccounts});
}
async function confirmIdentity(page,task,url,wait){
 for(let i=0;i<20;i++){
  const s=await page.evaluate(visibleXIdentity),handle=s.handle?.replace(/^@/,'').toLowerCase();
  if(s.login||handle&&handle!==task.account.toLowerCase())throw Error('当前可见登录账户不符或已退出');
  if(handle===task.account.toLowerCase()&&(!url||s.url.toLowerCase()===url.toLowerCase()))return;
  await wait(300);
 }
 throw Error('未确认指定页面上的当前登录账户');
}
async function readCommentProof(task,page,url,folder,wait,now){
 const candidate=commentUrl(url);
 if(candidate.handle!==task.account.toLowerCase()||[task.root.id,task.target.id].includes(candidate.id))throw Error('核验链接并非本账号的新评论');
 await page.goto('https://x.com/home');await confirmIdentity(page,task,'https://x.com/home',wait);
 await page.goto(candidate.url);let focus,lastError;
 // X may render the new reply before its conversation ancestors. Wait for the
 // entire parent/root proof, not merely for the new reply card to appear.
 for(let i=0;i<40;i++){
  await confirmIdentity(page,task,candidate.url,wait);
  try{focus=verifyCommentContext(await page.evaluate(commentPageView),task,candidate.url);break;}catch(error){lastError=error;}
  await wait(300);
 }
 if(!focus)throw lastError||Error('完整评论会话未加载');
 const upper=task.state==='unknown'?Date.parse(task.finishedAt)+30000:now().getTime()+30000;
 if(!Number.isFinite(Date.parse(focus.createdAt))||!Number.isFinite(upper)||Date.parse(focus.createdAt)<Date.parse(task.submissionIntentAt||task.startedAt)-30000||Date.parse(focus.createdAt)>upper)throw Error('评论发布时间不属于本次执行，未确认结果');
 await page.screenshot(path.join(folder,'after.png'));
 return {verified:true,account:task.account,content:focus.content,url:candidate.url,rootId:task.root.id,parentId:task.target.id,verifiedAt:now().toISOString()};
}
export async function verifyXComment(task,{folder,url},{config,db,withPage=withCommentPage,wait=delay,now=()=>new Date()}={}){
 return withPage(task,{config,db},page=>readCommentProof(task,page,url,folder,wait,now));
}
export async function executeXComment(task,{folder,beforeSubmit,onStage=()=>{},onContext=()=>{},onCandidate=()=>{}},{config,db,withPage=withCommentPage,wait=delay,now=()=>new Date()}={}){
 let intent=false;
 try{return await withPage(task,{config,db},async page=>{
  const until=async(fn,message)=>{for(let i=0;i<20;i++){const value=await fn();if(value)return value;await wait(300);}throw Error(message);};
  const identity=async expectedUrl=>{
   for(let attempt=0;attempt<20;attempt++){
    const i=await page.evaluate(visibleXIdentity),handle=i.handle?.replace(/^@/,'').toLowerCase();
    if(i.login||handle&&handle!==task.account.toLowerCase())throw Error('当前可见登录账户不符或已退出');
    if(handle===task.account.toLowerCase()&&(!expectedUrl||i.url.toLowerCase()===expectedUrl.toLowerCase()))return;
    await wait(300);
   }
   throw Error('未确认指定页面上的当前登录账户');
  };
  onStage('checking_account');await page.goto('https://x.com/home');await identity('https://x.com/home');
  onStage('checking_target');await page.goto(task.target.url);await identity(task.target.url);
  const initial=await until(async()=>{const v=await page.evaluate(commentPageView);if(v.cards.some(c=>c.id===task.target.id))return v;},'目标页面未提供可核验的主对象');
  const target=verifyCommentContext(initial,task),root=initial.cards.find(c=>c.id===task.root.id&&c.handle===task.root.handle);
  await onContext({root,target});
  if(initial.cards.some(c=>c.handle===task.account.toLowerCase()&&c.content===task.content))throw Object.assign(Error('目标页已有本账号相同正文的评论，请核对原评论，未发送'),{code:'POSSIBLE_EXISTING'});
  const oldIds=new Set(initial.cards.map(c=>c.id)),oldToasts=new Set(initial.toastUrls);
  if(!await page.evaluate(openCommentTarget,task.target.id,task.target.handle))throw Error('未找到指定对象自己的唯一回复按钮');
  const args=[task.target.id,task.target.handle,task.account,task.content];
  await until(()=>page.evaluate(commentComposer,...args,'focus',target),'未核实空白回复框及其目标上下文');
  onStage('writing');await page.type(task.content);
  await until(async()=>{const v=await page.evaluate(commentComposer,...args,'read',target);return v?.ready;},'未读回完整评论正文或发送控件不可用');
  await identity();await page.screenshot(path.join(folder,'before.png'));
  await beforeSubmit();intent=true;onStage('submitting');
  if(!await page.evaluate(commentComposer,...args,'submit',target))throw Error('提交前回复对象、身份或正文变化，结果未确认');
  await page.screenshot(path.join(folder,'submitted.png')).catch(()=>{});
  onStage('verifying');let candidate;
  for(let i=0;i<24&&!candidate;i++){
   await wait(500);await identity();const view=await page.evaluate(commentPageView);
   const urls=view.cards.filter(c=>c.handle===task.account.toLowerCase()&&c.content===task.content&&!oldIds.has(c.id)&&Date.parse(c.createdAt)>=Date.parse(task.startedAt)-30000).map(c=>c.url);
   urls.push(...view.toastUrls.filter(u=>!oldToasts.has(u)));
   try{if(commentUrl(view.url).handle===task.account.toLowerCase())urls.push(view.url);}catch{}
   const candidates=[...new Set(urls.map(u=>{try{const p=commentUrl(u);return p.handle===task.account.toLowerCase()&&!oldIds.has(p.id)?p.url:null;}catch{return null;}}).filter(Boolean))];
   if(candidates.length>1)throw Error('出现多个可能的新评论，无法唯一核验，禁止重发');candidate=candidates[0];
  }
  if(!candidate)throw Error('未取得本次评论公开链接，发送结果未确认，禁止重发');
  await onCandidate(candidate);
  if(!page.withReadOnlyPage)throw Error('缺少独立只读核验标签，禁止导航提交页');
  return page.withReadOnlyPage(reader=>readCommentProof(task,reader,candidate,folder,wait,now));
 });}catch(error){
  if(!intent&&error.code!=='POSSIBLE_EXISTING')error.safeBeforeSubmit=true;
  throw error;
 }
}
