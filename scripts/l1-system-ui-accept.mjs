// Actual system page and handler; action responses are fixtures. No platform operations.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import assert from 'node:assert/strict';
const folder=fs.mkdtempSync(path.join(os.tmpdir(),'l1-system-ui-'));
const output=path.resolve(process.env.MAITIAN_QA_OUT || '_local-system-ui');fs.mkdirSync(output,{recursive:true});
process.env.MAITIAN_HOME=folder;process.env.MAITIAN_DB=path.join(folder,'hub.db');process.env.MAITIAN_CONFIG=path.join(folder,'config.json');
fs.writeFileSync(process.env.MAITIAN_CONFIG,JSON.stringify({xHandle:'UIFixture',web:{requireLocalToken:false},publishPrep:{browserExecution:false},l1:{x:{browserExecution:false},xhs:{account:'测试账号',browserExecution:false},wechat:{account:'测试公众号',browserExecution:false}}}));
const {saveObservation}=await import('../src/l1-store.mjs');const {handle}=await import('../src/web.mjs');const {db}=await import('../src/db.mjs');
db.prepare('INSERT OR REPLACE INTO meta(key,value) VALUES (?,?)').run('l1:platform-selection',JSON.stringify(['x','xhs','wechat']));
saveObservation({platform:'x',account:'UIFixture',captured_at:new Date().toISOString(),source:'isolated UI fixture',posts:[
  {id:'dated-fixture',text:'置顶样本测试：这是已入库的一篇作品，长标题用于检查换行和相邻说明是否清楚可读',created_at:new Date().toISOString(),url:'https://x.com/UIFixture/status/123',views:310,likes:7},
  {id:'unknown-fixture',text:'没有发布时间的样本',created_at:null,views:8}
]});
let record=null,identity=null,failNext=false;const requests=[];
const server=http.createServer(async(req,res)=>{
  if(req.url==='/api/action'){
    let body='';for await(const chunk of req)body+=chunk;const action=JSON.parse(body);requests.push(action.type);
    if(failNext){failNext=false;res.writeHead(503,{'content-type':'application/json'});res.end(JSON.stringify({error:'测试：服务暂不可用，请重试'}));return;}
    if(action.type==='login')record={type:'login',platform:'x',startedAt:new Date().toISOString(),done:false,ok:null,progress:{message:'测试：请在专用窗口完成登录',deadline:new Date(Date.now()+600000).toISOString()}};
    else if(action.type==='show-login')record.progress.message='测试：已请求显示登录窗口';
    else if(action.type==='cancel-login')Object.assign(record,{done:true,ok:false,error:'已取消登录',endedAt:new Date().toISOString()});
    else {res.writeHead(403);res.end();return;}
    res.writeHead(200,{'content-type':'application/json'});res.end('{"ok":true}');return;
  }
  if(req.method!=='GET'){res.writeHead(403);res.end();return;}
  const end=res.end.bind(res);res.end=(body,...args)=>{
    if(req.url==='/api/overview' && record){const payload=JSON.parse(body);payload.actions=[record];payload.health.platforms.x={...payload.health.platforms.x,state:record.done?'idle':'running',last:record,identity,loginStatus:{state:record.loginState || (!record.done?'checking':identity?'logged_in':'unknown')}};body=JSON.stringify(payload);}
    return end(body,...args);
  };
  try{await handle(req,res);}catch(error){res.writeHead(500);res.end(error.message);}
});
server.listen(0,'127.0.0.1');await once(server,'listening');
const chrome=process.env.CHROME_PATH || path.join(process.env.PROGRAMFILES,'Google/Chrome/Application/chrome.exe');
const profile=path.join(folder,'fresh-browser');
const child=spawn(chrome,['--headless=new','--no-first-run','--no-default-browser-check','--disable-extensions','--disable-background-networking','--remote-debugging-port=0','--remote-debugging-address=127.0.0.1','--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:'ignore'});
const exited=once(child,'close');let ws;const results=[];
const delay=ms=>new Promise(r=>setTimeout(r,ms));
try{
  const portFile=path.join(profile,'DevToolsActivePort');for(let i=0;!fs.existsSync(portFile)&&i<100;i++)await delay(100);
  const [port,endpoint]=fs.readFileSync(portFile,'utf8').trim().split(/\r?\n/);ws=new WebSocket(`ws://127.0.0.1:${port}${endpoint}`);await once(ws,'open');
  let seq=0;const pending=new Map();ws.onmessage=event=>{const m=JSON.parse(event.data),p=pending.get(m.id);if(!p)return;pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(new Error(m.error.message)):p.resolve(m.result);};
  const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const id=++seq;const timer=setTimeout(()=>{pending.delete(id);reject(new Error('QA timeout: '+method));},10000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));});
  const {targetId}=await send('Target.createTarget',{url:'about:blank'});const {sessionId}=await send('Target.attachToTarget',{targetId,flatten:true});
  const evalJS=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true},sessionId);if(r.exceptionDetails)throw new Error('QA page exception: '+r.exceptionDetails.text);return r.result.value;};
  const waitJS=async expression=>{for(let i=0;i<100;i++){if(await evalJS(expression))return;await delay(100);}throw new Error('QA condition: '+expression);};
  const click=type=>evalJS(`document.querySelector('[data-system-platform="x"] [data-act*=\"${type}\"]').click()`);
  for(const width of [1440,390]){
    record=null;identity=null;
    await send('Emulation.setDeviceMetricsOverride',{width,height:1100,deviceScaleFactor:1,mobile:width===390},sessionId);
    await send('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/p?qa=${width}#/system`},sessionId);await waitJS('!!document.querySelector(".system-accounts") && O.actions.length===0 && pendingAction===null');
    const capture=async state=>{
      if(width===390)await evalJS('document.querySelector(".system-accounts [data-system-platform=x]")?.scrollIntoView({block:"start"})');
      const geometry=await evalJS('({width:innerWidth,clientWidth:document.documentElement.clientWidth,scrollWidth:document.documentElement.scrollWidth})');
      assert.equal(geometry.width,width);assert.ok(geometry.scrollWidth<=geometry.clientWidth+1);
      const {data}=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false},sessionId);const file=path.join(output,`${width}-${state}.png`);fs.writeFileSync(file,Buffer.from(data,'base64'));results.push({width,state,geometry,screenshot:file});
    };
    await capture('idle');await click('login');await waitJS('!!document.querySelector(".system-progress")');
    assert.equal(await evalJS('document.querySelector("[data-system-platform=x] [data-act*=login]").disabled'),true);
    assert.equal(await evalJS('document.querySelector("[data-act*=show-login]").disabled'),false);
    await capture('running');
    record.loginState='logged_out';record.progress.message='当前未登录，请在专用窗口完成登录';
    await evalJS('load()');assert.equal(await evalJS('document.querySelector("[data-system-platform=x] .platform-login").innerText'),'未登录');await capture('logged-out');
    await evalJS('location.reload()');await waitJS('!!document.querySelector(".system-progress") && timer!==null');
    await click('show-login');await waitJS('document.body.innerText.includes("已请求显示登录窗口")');
    await click('cancel-login');await waitJS('document.body.innerText.includes("登录已取消")');await capture('cancelled');
    failNext=true;await click('login');await waitJS('!!document.querySelector("[role=alert]")');
    assert.equal(await evalJS('pendingAction===null'),true);await capture('request-error');
    await click('login');await waitJS('!!document.querySelector(".system-progress")');
    Object.assign(record,{done:true,ok:true,endedAt:new Date().toISOString()});identity={confirmedAt:record.endedAt};
    await evalJS('load()');await waitJS('document.body.innerText.includes("最近确认登录：")');
    assert.equal(await evalJS('document.querySelector("[data-system-platform=x] .platform-login").innerText'),'已登录');
    await capture('confirmed');
    const requestCount=requests.length;
    await evalJS('location.reload()');await waitJS('document.body.innerText.includes("登录账号")');
    assert.equal(requests.length,requestCount,'refresh does not start login');
    record={type:'collect',platform:'x',done:true,ok:false,endedAt:new Date().toISOString(),error:'测试：网络连接超时'};
    await evalJS('load()');await waitJS('document.body.innerText.includes("登录账号")');await capture('confirmed-after-collect-error');
    identity=null;record={type:'login',platform:'x',done:true,ok:false,endedAt:new Date().toISOString(),error:'专用窗口已关闭，未完成账号确认'};
    await evalJS('load()');await waitJS('document.body.innerText.includes("窗口已关闭，未完成登录确认")');
    assert.equal(await evalJS('document.querySelector("[data-system-platform=x] .platform-login").innerText'),'登录待确认');
    assert.equal(await evalJS('document.querySelectorAll(".system-progress").length'),0);await capture('window-closed');
    await send('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/`},sessionId);
    await waitJS('!!document.querySelector(".hero .sample-note")');
    assert.equal(await evalJS('document.querySelector(".hero .eyebrow").innerText'), '已入库作品');
    assert.equal(await evalJS('!!document.querySelector(".hero .cmp")'),false);await capture('sample-home');
    await send('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/p#/calendar`},sessionId);
    await waitJS('!!document.querySelector(".cal-g")');
    assert.equal(await evalJS('document.body.innerText.includes("1 篇作品缺少发布时间")'),true);
    assert.equal(await evalJS('document.querySelectorAll(".cal-e").length'),1);
    await capture('calendar');
  }
  await send('Browser.close');await exited;
  fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({ok:true,scope:'actual page; fixture action responses; fresh headless Chrome, true 390px emulation; no platform requests',requests,results},null,2));
  console.log(JSON.stringify({ok:true,captures:results.length,viewports:[1440,390],requests}));
}finally{ws?.close();if(child.exitCode===null)child.kill();await new Promise(r=>server.close(r));db.close();}
