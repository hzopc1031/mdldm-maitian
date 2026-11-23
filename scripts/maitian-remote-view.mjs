import {spawn} from 'node:child_process';
import {createHmac,randomBytes,scrypt as derive,timingSafeEqual} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {promisify} from 'node:util';

const upstream='http://127.0.0.1:8787';
const agentsUpstream='http://127.0.0.1:3351';
const agentsPath='/agents';
const publicOrigin=process.env.MAITIAN_REMOTE_ORIGIN || 'https://110.40.227.27:80';
const setupOrigin='http://127.0.0.1:18791';
const config=process.env.MAITIAN_REMOTE_SETTINGS || path.join(process.env.LOCALAPPDATA||os.homedir(),'MaitianRemote','access.json');
const cookieName='__Host-maitian-view';
const deriveKey=promisify(derive);
const signing=randomBytes(32);
const hex=(value,length)=>typeof value==='string'&&value.length===length&&/^[a-f\d]+$/.test(value);
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const lifetime=14*24*3600;
const minimumPasswordLength=6;
const font='system-ui,"Microsoft YaHei",sans-serif';
const workbenchPages=new Set(['/','/p','/board',agentsPath,agentsPath+'/']);

function reply(res,status,html,headers={}){
  res.writeHead(status,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'same-origin',
    'X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",...headers});
  res.end(html);
}

function page(title,body){
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)} · 麦田</title><style>
  *{box-sizing:border-box}body{margin:0;background:#f4f6f9;color:#19202b;font:16px/1.5 ${font}}main{width:min(920px,100%);margin:auto;padding:32px 20px}header{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:24px}h1,h2,p{margin:0}h1{font-size:27px}h2{font-size:18px;margin-bottom:12px}.muted{color:#535d69;font-size:14px}.panel{background:#fff;border:1px solid #e3e7ed;border-radius:16px;padding:20px;margin-bottom:16px}.login{max-width:420px;margin:10vh auto}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}.platform{background:#f4f7fc;border-radius:10px;padding:10px 12px}.platform strong{display:block}ul{padding:0;margin:0;list-style:none}li{padding:12px 0;border-top:1px solid #e7eaf0;overflow-wrap:anywhere}li:first-child{border:0}label{display:block;margin:18px 0 10px}input{display:block;width:100%;margin-top:6px;border:1px solid #aeb7c4;border-radius:8px;padding:10px;font:inherit}button{border:0;border-radius:8px;padding:8px 13px;color:#fff;background:#1362cc;font:inherit;cursor:pointer}a{color:#0b58b7;text-decoration:underline}:focus-visible{outline:2px solid #195eb4;outline-offset:3px}.notice{margin-top:8px;color:#8a291b}
  </style><main>${body}</main></html>`;
}

function passwordForm({setup=false,notice='',configured=false,returnTo='/',samePage=false}={}){
  const title=setup?'设置麦田远程访问':'登录麦田';
  const hint=setup?`设置一个至少 ${minimumPasswordLength} 个字符的访问密码。以后在外网地址用这个密码登录。`:'登录后进入麦田工作台。';
  const action=setup?'/setup':samePage?'':`/login?next=${encodeURIComponent(returnTo)}`;
  return page(title,`<section class="panel login"><h1>${title}</h1><p class="muted">${hint}</p>${notice?`<p class="notice" role="alert">${escape(notice)}</p>`:''}
  ${setup&&configured?'<p>远程访问密码已设置。</p>':`<form action="${action}" method="post"><label>${setup?'新密码':'访问密码'}<input type="password" name="password" autocomplete="${setup?'new-password':'current-password'}" required ${setup?`minlength="${minimumPasswordLength}"`:''} maxlength="128"></label><button>${setup?'保存密码':'登录'}</button></form>`}</section>`);
}

async function loadAuth(){
  try{
    const value=JSON.parse(await readFile(config,'utf8'));
    if(!hex(value.salt,32)||!hex(value.digest,128))throw new Error('Invalid local access settings');
    return value;
  }catch(error){if(error.code==='ENOENT')return null;throw error;}
}

function sessionMac(auth,value){return createHmac('sha256',signing).update(auth.salt).update(value).digest('hex');}
function validSession(req,auth){
  const raw=(req.headers.cookie||'').split(/; */).find(value=>value.startsWith(cookieName+'='))?.slice(cookieName.length+1);
  const [expires,nonce,proof,extra]=(raw??'').split('.');
  if(extra!==undefined||!/^\d{10}$/.test(expires)||Number(expires)<=Math.floor(Date.now()/1000)||!hex(nonce,32)||!hex(proof,64))return false;
  return timingSafeEqual(Buffer.from(proof,'hex'),Buffer.from(sessionMac(auth,`${expires}.${nonce}`),'hex'));
}

async function formPassword(req){
  if(!req.headers['content-type']?.startsWith('application/x-www-form-urlencoded'))return '';
  let raw='';
  for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>2300)throw new Error('Request too large');}
  const values=new URLSearchParams(raw).getAll('password');
  return values.length===1&&values[0].length<=128?values[0]:'';
}

const rate=new Map();
const interval=600_000;
let checking=0;
function canAttempt(req){
  const key=String(req.headers['x-maitian-client-ip']||'').slice(0,64)||'local';
  const now=Date.now();
  for(const [id,value] of rate)if(value.expires<=now)rate.delete(id);
  let record=rate.get(key);
  if(!record&&rate.size<500){record={count:0,expires:now+interval};rate.set(key,record);}
  return record&&record.count++<8&&checking<2;
}

function forwardApplication(req,res,url){
  const agentPage=url.pathname===agentsPath||url.pathname.startsWith(agentsPath+'/');
  if(url.pathname===agentsPath)return reply(res,308,'',{Location:agentsPath+'/'});
  if(url.pathname.startsWith(agentsPath+'//'))return reply(res,400,'访问地址不符');
  const target=agentPage?agentsUpstream:upstream;
  const prefix=agentPage?agentsPath:'';
  const headers={};
  for(const name of ['accept','content-type','content-length','range']){
    if(req.headers[name])headers[name]=req.headers[name];
  }
  // The browser's real Origin was checked at the HTTPS entrance before this
  // request gains the localhost origin used by its desktop application.
  if(req.method==='POST')headers.origin=target;
  url.searchParams.delete('key');
  const relay=http.request(target+url.pathname.slice(prefix.length)+url.search,{method:req.method,headers},response=>{
    const safeHeaders={'cache-control':'no-store','referrer-policy':'same-origin','x-content-type-options':'nosniff'};
    for(const name of ['content-type','content-length','content-disposition','content-security-policy','cross-origin-resource-policy','referrer-policy','accept-ranges','content-range']){
      if(response.headers[name])safeHeaders[name]=response.headers[name];
    }
    if(agentPage)safeHeaders['referrer-policy']='same-origin';
    if(response.headers.location){
      try{
        const destination=new URL(response.headers.location,target);
        if(destination.origin===target)safeHeaders.location=prefix+destination.pathname+destination.search+destination.hash;
        else if(destination.protocol==='https:'&&!destination.username&&!destination.password)safeHeaders.location=destination.href;
      }catch{}
    }
    res.writeHead(response.statusCode,safeHeaders);
    response.on('error',()=>res.destroy());
    response.pipe(res);
  });
  relay.setTimeout(300000,()=>relay.destroy());
  relay.on('error',()=>{if(!res.headersSent)reply(res,502,agentPage?'家里的项目调度台暂时无法连接':'家里的麦田工作台暂时无法连接');else res.destroy();});
  res.once('close',()=>{if(!res.writableFinished)relay.destroy();});
  req.pipe(relay);
}

async function serve(req,res,setup){
  const origin=setup?setupOrigin:publicOrigin;
  if(req.headers.host!==new URL(origin).host)return reply(res,403,'访问地址不符');
  if(!req.url.startsWith('/')||req.url.startsWith('//')||req.url.includes('\\'))return reply(res,400,'访问地址不符');
  const url=new URL(req.url,origin), route=url.pathname;
  const samePage=workbenchPages.has(route);
  const providedPage=url.searchParams.get('next');
  const returnTo=samePage?route:workbenchPages.has(providedPage)?providedPage:'/';
  const auth=await loadAuth();
  const signedIn=auth&&validSession(req,auth);
  if(req.method==='GET'){
    if(setup&&route==='/')return reply(res,200,passwordForm({setup:true,configured:!!auth}));
    if(!setup&&(samePage||route==='/login')){
      if(!auth)return reply(res,503,page('等待设置','<section class="panel login"><h1>等待设置访问密码</h1><p class="muted">请先在家里电脑完成一次设置。</p></section>'));
      if(route==='/login'||!signedIn)return reply(res,200,passwordForm({returnTo,samePage}));
    }
  }
  if(!['GET','HEAD','POST'].includes(req.method))return reply(res,405,'请求方法不支持');
  if((req.method==='POST'||req.headers.origin!==undefined)&&req.headers.origin!==origin)return reply(res,403,'请求来源不符');
  if(setup&&req.method==='POST'&&route==='/setup'){
    if(auth)return reply(res,409,passwordForm({setup:true,configured:true}));
    const password=await formPassword(req);
    if(password.length<minimumPasswordLength)return reply(res,400,passwordForm({setup:true,notice:`请输入至少 ${minimumPasswordLength} 个字符的密码。`}));
    const salt=randomBytes(16).toString('hex'),digest=(await deriveKey(password,salt,64)).toString('hex');
    try{
      await mkdir(path.dirname(config),{recursive:true,mode:0o700});
      await writeFile(config,JSON.stringify({salt,digest})+'\n',{flag:'wx',mode:0o600});
    }
    catch(error){if(error.code!=='EEXIST')throw error;}
    return reply(res,303,'',{Location:'/'});
  }
  if(setup)return reply(res,404,'地址不存在');
  if(!auth)return reply(res,503,'等待本机设置访问密码');
  const attributes='Path=/; Secure; HttpOnly; SameSite=Strict';
  if(req.method==='POST'&&route==='/logout')return reply(res,303,'',{Location:'/','Set-Cookie':`${cookieName}=; Max-Age=0; ${attributes}`});
  const login=req.method==='POST'&&(route==='/login'||samePage&&!signedIn);
  if(!login){
    if(!signedIn)return reply(res,401,JSON.stringify({error:'请重新登录麦田'}),{'Content-Type':'application/json; charset=utf-8'});
    return forwardApplication(req,res,url);
  }
  if(!canAttempt(req))return reply(res,429,passwordForm({returnTo,samePage,notice:'尝试次数较多，请稍后再试。'}));
  checking++;
  let digest;
  try{digest=await deriveKey(await formPassword(req),auth.salt,64);}finally{checking--;}
  if(!timingSafeEqual(digest,Buffer.from(auth.digest,'hex')))return reply(res,401,passwordForm({returnTo,samePage,notice:'访问密码不正确。'}));
  const token=`${Math.floor(Date.now()/1000)+lifetime}.${randomBytes(16).toString('hex')}`;
  reply(res,303,'',{Location:returnTo,'Set-Cookie':`${cookieName}=${token}.${sessionMac(auth,token)}; Max-Age=${lifetime}; ${attributes}`});
}

for(const [port,setup] of [[18790,false],[18791,true]]){
  const server=http.createServer({requestTimeout:setup?8000:300000,headersTimeout:5000,maxHeaderSize:12000},(req,res)=>{
    serve(req,res,setup).catch(()=>{if(!res.headersSent)reply(res,500,'请求处理失败');else res.destroy();});
  });
  server.once('error',()=>process.exit(1));
  server.listen(port,'127.0.0.1');
}

if(!process.argv.includes('--no-tunnel')){
  let generation=0;
  let child;
  const run=()=>{
    const attempt=++generation;
    child=spawn('ssh.exe',['-NT','-o','BatchMode=yes','-o','ExitOnForwardFailure=yes','-o','ForwardAgent=no',
      '-o','ConnectTimeout=8','-o','ServerAliveInterval=20','-o','ServerAliveCountMax=3','-R','127.0.0.1:18787:127.0.0.1:18790','tencent'],
      {stdio:'ignore',windowsHide:true});
    child.on('error',()=>{});
    child.once('close',()=>{if(attempt===generation)setTimeout(run,12000);});
  };
  run();
  for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>{generation++;child?.kill();process.exit(0);});
  process.once('exit',()=>child?.kill());
}
