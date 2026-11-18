// First-party rendered acceptance. Chrome CLI only: no remote debugging port/pipe,
// extensions, existing browser/profile, platform URL or real account credentials.
// Isolated real HTTP handler/SQLite. Authentication fixture stays in memory.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {once} from 'node:events';
import {spawn} from 'node:child_process';
const supportedTests = ['unauth','invalid','home','traffic','system','prepare','prepare-flow','enabled-system'];
const tests = process.argv.length > 2 ? process.argv.slice(2) : supportedTests;
if (tests.some(test => !supportedTests.includes(test))) throw new Error('Unknown browser acceptance scenario');
const output=path.resolve(process.env.MAITIAN_QA_OUT || '_local-headless-accept');
fs.mkdirSync(output,{recursive:true});
const folder=fs.mkdtempSync(path.join(os.tmpdir(),'maitian-render-'));
const fixtureImage=path.join(folder,'draft-fixture.png');
fs.writeFileSync(fixtureImage,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6WQAAAABJRU5ErkJggg==','base64'));
process.env.MAITIAN_HOME=folder; process.env.MAITIAN_DB=path.join(folder,'hub.db');
process.env.MAITIAN_CONFIG=path.join(folder,'config.json');
fs.writeFileSync(process.env.MAITIAN_CONFIG,'{}');
const {config}=await import('../src/feishu.mjs');
config.web={key:'isolated-render-fixture'}; // Public test fixture, never read the user's configuration.
config.xHandle='PeanutPair';config.publishPrep={browserExecution:false};config.l1={x:{browserExecution:false},xhs:{account:'TwoPeanuts',browserExecution:false},wechat:{browserExecution:false}};
const {db,saveObservation}=await import('../src/l1-store.mjs');
saveObservation({platform:'x',account:'PeanutPair',captured_at:new Date().toISOString(),source:'isolated-test',followers:42,example:true,
  posts:[{id:'123',text:'隔离浏览器验收样本（假数据）',url:'https://x.com/PeanutPair/status/123',created_at:new Date().toISOString(),views:100}]});
const {handle}=await import('../src/web.mjs');
let current, report, violations=[];
// Added only to test responses; the production HTML and handler are unchanged.
function browserChecks(test, image) {
  const options=JSON.stringify({test,image});
  return `<script>(${async function({test,image}) {
    addEventListener('error',()=>sessionStorage.setItem('qa-error','page exception'));
    addEventListener('unhandledrejection',()=>sessionStorage.setItem('qa-error','unhandled rejection'));
    const check=(ok,name)=>{if(!ok)throw new Error(name);};
    const wait=async fn=>{for(let i=0;i<100;i++){if(fn())return;await new Promise(r=>setTimeout(r,100));}throw new Error('render wait');};
    const finish=async(ok,detail)=>{document.documentElement.dataset.qa=ok?'PASS':'FAIL';await fetch('/__qa/report',{method:'POST',body:JSON.stringify({ok,detail})});};
    try {
      const login=document.querySelector('input[type=password]');
      if(test==='unauth') {check(!!login,'login visible');check(document.querySelector('#returnTo').value==='/p#/system','hash retained');await finish(true,'未登录表单与系统深链');return;}
      if(test==='invalid') {
        if(document.querySelector('[role=alert]')) {check(!!login,'error does not authenticate');check(document.querySelector('#returnTo').value==='/p#/prepare','prepare deep link');await finish(true,'错误口令可见且保留准备页深链');return;}
        login.value='invalid-test-fixture';document.querySelector('form').requestSubmit();return;
      }
      if(login) {login.value='isolated-render-fixture';document.querySelector('form').requestSubmit();return;}
      await wait(()=>test==='home'?!!document.querySelector('.hero'):!!document.querySelector('.h1'));
      check(!document.body.innerText.includes('出错了：'),'no render error');
      const expected=test==='home'?'/':test==='traffic'?'/p#/traffic':test.endsWith('system')?'/p#/system':'/p#/prepare';
      check(location.pathname+location.hash===expected,'POST preserved route');
      if(!sessionStorage.getItem('qa-reloaded')){sessionStorage.setItem('qa-reloaded','1');location.reload();return;}
      if(test==='home'||test==='traffic') {
        const summary=document.querySelector('.account-summary');check(!!summary,'account summary visible');
        for(const label of ['当日发文累计','当前作品累计','跨日快照增量','暂无','未证明全账号完整历史'])check(summary.innerText.includes(label),label);
        check(summary.querySelectorAll('tbody tr').length===9,'three platforms, three scopes');
        check(summary.scrollHeight<=summary.clientHeight+2,'summary not vertically clipped');
      }
      if(test.endsWith('system')) {
        for(const label of ['手动操作','采流量','采粉丝','体检','取链接','最近动态','平台登录与校验'])check(document.body.innerText.includes(label),label);
        const wechat=[...document.querySelectorAll('[data-act]')].find(button=>button.dataset.act.includes('"platform":"wechat"')&&button.textContent.trim()==='登录 / 校验');
        check(!!wechat,'WeChat login entry');
        check(document.querySelectorAll('[data-act]').length===(test==='enabled-system'?15:12),'manual actions retained');
        const a=document.querySelector('a[href="#/prepare"]');check(!!a,'prepare link');a.click();
        await wait(()=>!!document.querySelector('#prep-form'));check(location.hash==='#/prepare','button navigation');
        location.hash='#/system';await wait(()=>document.querySelector('.h1')?.textContent==='系统');
      }
      if(test==='prepare-flow') {
        const form=document.querySelector('#prep-form');
        form.elements.platform.value='x';form.elements.content.value='隔离文图草稿\n完整第二段';form.elements.images.value=image;form.elements.test.checked=true;
        form.requestSubmit();await wait(()=>!!document.querySelector('a[href^="/api/prep/bundle"]'));
        const b=document.querySelector('a[href^="/api/prep/bundle"]'),r=await fetch(b.getAttribute('href'));
        check(r.ok && r.headers.get('content-type')==='application/zip','bundle download');
        check(new DataView(await r.arrayBuffer()).getUint32(0,true)===0x04034b50,'ZIP signature');
        const data=await (await fetch('/api/prep')).json();check(data.records.length===1 && data.records[0].imageCount===1,'one image draft');
        check(data.records[0].state==='prepared','not platform filled');
        check(Object.values(data.capabilities).every(c=>!c.browserEnabled),'platform execution stays disabled');
        const xButton=document.querySelector('[data-prep="execute"][data-platform="x"]');
        check(xButton?.disabled&&xButton.textContent==='填写 X 文图编辑器','X editor requires configured authorization');
      }
      check(!sessionStorage.getItem('qa-error'),'no uncaught JS errors');
      await finish(true,test+'：真实Chrome渲染、表单POST、cookie登录保持、刷新与交互');
    }catch(e){await finish(false,e.message);}
  }.toString()})(${options});</script>`;
}
const server=http.createServer(async(req,res)=>{
  if(req.url==='/__qa/report') {
    let body='';for await(const d of req)body+=d;
    try {const value=JSON.parse(body); report={ok:value.ok===true,detail:String(value.detail).slice(0,300)};}catch{report={ok:false,detail:'invalid QA report'};}
    res.end('ok');return;
  }
  if(req.url.startsWith('/api/action') || (req.method==='POST' && req.url!=='/auth' && req.url!=='/api/prep')) {
    violations.push('unexpected mutation');res.writeHead(403);res.end();return;
  }
  if(req.url==='/api/prep' && req.method==='POST') {
    // Only local create is allowed in rendered acceptance; never invoke a skill.
    let body='';for await(const d of req)body+=d;
    if(JSON.parse(body).type!=='create'){violations.push('unexpected skill');res.writeHead(403);res.end();return;}
    req=Object.assign(Object.create(req),{[Symbol.asyncIterator]:async function*(){yield Buffer.from(body);}});
  }
  const end=res.end.bind(res);
  res.end=(body,...args)=>{
    if((typeof body==='string'||Buffer.isBuffer(body)) && /^<!doctype html/i.test(String(body)))body=String(body).replace('</body>',browserChecks(current,fixtureImage)+'</body>');
    return end(body,...args);
  };
  try{await handle(req,res);}catch{res.writeHead(500);res.end('test handler failure');}
});
server.listen(0,'127.0.0.1');await once(server,'listening');
const binary=process.env.CHROME_PATH || [
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES,'Google/Chrome/Application/chrome.exe'),
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/usr/bin/google-chrome',
].filter(Boolean).find(p=>fs.existsSync(p));
const evidence={at:new Date().toISOString(),mode:'Chrome headless CLI; isolated real handler and test data; no platform access or remote debugging',results:[]};
try {
  if(!binary)throw new Error('Chrome not found');
  for(const test of tests) {
    current=test;report=null;
    config.publishPrep.browserExecution=test==='enabled-system';
    for(const p of ['x','xhs','wechat'])config.l1[p].browserExecution=test==='enabled-system';
    const target=test==='home'?'/':test==='traffic'?'/p#/traffic':test==='unauth'||test.endsWith('system')?'/p#/system':'/p#/prepare';
    const shot=path.join(output,test+'.png');
    const child=spawn(binary,['--headless=new','--incognito','--no-first-run','--no-default-browser-check','--disable-extensions','--disable-background-networking',
      '--window-size=1440,1800','--user-data-dir='+path.join(folder,'profile-'+test),'--screenshot='+shot,'--dump-dom','--timeout=18000',
      '--virtual-time-budget=12000','http://127.0.0.1:'+server.address().port+target],{windowsHide:true,stdio:['ignore','pipe','pipe']});
    // DOM may contain fixture authentication fields. Consume without logging/writing it.
    child.stdout.resume();child.stderr.resume();let timedOut=false;
    const timer=setTimeout(()=>{timedOut=true;child.kill();},25000);
    const [code]=await once(child,'close');clearTimeout(timer);
    const result={test,ok:code===0&&!timedOut&&report?.ok===true&&fs.existsSync(shot),code,detail:report?.detail || 'browser did not confirm assertions',screenshot:shot};
    evidence.results.push(result);console.log(JSON.stringify(result));
  }
  if(violations.length)throw new Error('test attempted forbidden operations');
}catch(e){evidence.results.push({test:'environment',ok:false,detail:e.code || e.message});}
finally {
  await new Promise(r=>server.close(r));db.close();
  fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(evidence,null,2));
}
process.exitCode=evidence.results.some(r=>!r.ok)?1:0;
