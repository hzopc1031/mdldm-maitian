import fs from 'node:fs';
import path from 'node:path';
import {isLoopback,localRequestAllowed} from './web-auth.mjs';
import {COMMENT_STATES} from './comment-service.mjs';
import {redactL1} from './l1-web.mjs';

export function createCommentsHttp({service,accounts,home,send,secrets=[]}){
 const contract=()=>({version:1,platform:'x',plainTextOnly:true,browserReadiness:'reuse_or_start_dedicated',enqueueMeansSend:true,accountSelectionRequired:true,accounts:accounts(),states:COMMENT_STATES,
  requiredInput:['platform','accountId','rootUrl','targetUrl','content','requestId'],actorRequired:true,idempotency:['accountId+requestId','actualAccount+targetStatusId+content'],unknownRetry:false,restartQueue:'paused',maxPageSize:200});
 const prompt=()=>`你负责决定X评论目标、正文和账号，麦田只执行。先GET /api/comments/contract，从accounts选择已登录账号。POST /api/comments，头Origin为本机工作台地址，Content-Type: application/json。\n请求：${JSON.stringify({type:'enqueue',input:{platform:'x',accountId:'实际账户ID',rootUrl:'https://x.com/author/status/原帖ID',targetUrl:'https://x.com/author/status/直接回复对象ID',content:'你决定的完整评论',requestId:'稳定任务编号'},actor:{runtime:'codex',sessionId:'本次真实会话ID'}})}\nenqueue会立即请求发送，并非草稿。回复主帖时rootUrl=targetUrl；回复评论时targetUrl是该评论，rootUrl是原帖。记录actor只能上报真实AI身份，不冒充认证。返回ID后GET /api/comments/record?id=ID轮询；sent才是已核验公开评论，读取url。unknown禁止重发、改requestId或换账户重建；paused/明确未提交的failed只能以原ID和actor调用type:resume。排队任务可type:cancel。不要直接操作浏览器或绕过工作台补发。工作台不自动选帖/改稿。\n本次可选账号：${JSON.stringify(accounts())}`;
 return async(req,res,u)=>{
  if(!isLoopback(req.socket.remoteAddress)||!localRequestAllowed(req))return send(res,403,{code:'LOCAL_ONLY',error:'只允许同源本机直连评论接口'});
  try{
   if(req.method==='GET'){
    if(u.pathname==='/api/comments/contract')return send(res,200,contract());
    if(u.pathname==='/api/comments/ai-prompt')return send(res,200,prompt(),'text/plain; charset=utf-8');
    if(u.pathname==='/api/comments/record')return send(res,200,{ok:true,record:service.get(u.searchParams.get('id'))});
    if(u.pathname==='/api/comments/shot'){
     const r=service.get(u.searchParams.get('id')),name=u.searchParams.get('name');if(!['before','after'].includes(name))throw Error('未知截图');
     const file=path.join(home,'data','comments',r.id,name+'.png');if(!fs.existsSync(file))return send(res,404,{error:'尚无此截图'});
     return send(res,200,fs.readFileSync(file),'image/png');
    }
    if(u.pathname==='/api/comments')return send(res,200,{ok:true,...service.list({accountId:u.searchParams.get('accountId')??undefined,state:u.searchParams.get('state')||undefined,limit:Number(u.searchParams.get('limit')||50),offset:Number(u.searchParams.get('offset')||0)}),accounts:accounts()});
   }
   if(req.method==='POST'&&u.pathname==='/api/comments'){
    if(req.headers.origin!==`http://${req.headers.host}`||!req.headers['content-type']?.startsWith('application/json'))return send(res,403,{error:'评论操作须带同源Origin和JSON类型'});
    let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>131072)return send(res,413,{error:'评论请求过大'});}
    const a=JSON.parse(body),allowed={enqueue:['type','input','actor'],resume:['type','id','actor'],cancel:['type','id']};
    if(!a||!Object.hasOwn(allowed,a.type)||Object.keys(a).some(k=>!allowed[a.type].includes(k)))throw Error('不支持的评论操作或字段');
    const record=a.type==='enqueue'?service.enqueue(a.input,a.actor):a.type==='resume'?service.resume(a.id,a.actor):service.cancel(a.id);
    return send(res,a.type==='cancel'?200:202,{ok:true,record});
   }
   return send(res,405,{error:'不支持此评论路径或方法'});
  }catch(error){return send(res,error.code==='NOT_FOUND'?404:['IDEMPOTENCY_CONFLICT','REPEAT_BLOCKED'].includes(error.code)?409:400,{code:error.code||'INVALID_INPUT',error:redactL1(error.message,secrets)});}
 };
}
