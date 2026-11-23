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
const width=Number(process.env.MAITIAN_QA_WIDTH || 1440);
// 本机 Chrome CLI 会把更窄的窗口钳到 504px，截图却裁成请求尺寸，不能冒充手机验收。
if(!Number.isInteger(width) || width<540 || width>3840)throw new Error('QA width must be an integer between 540 and 3840; narrower mobile viewports need device emulation');
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
db.prepare('INSERT OR REPLACE INTO meta(key,value) VALUES (?,?)').run('l1:platform-selection',JSON.stringify(['x','xhs','wechat']));
saveObservation({platform:'x',account:'PeanutPair',captured_at:new Date().toISOString(),source:'isolated-test',followers:42,example:true,
  posts:[{id:'123',text:'隔离浏览器验收样本（假数据）',url:'https://x.com/PeanutPair/status/123',created_at:new Date().toISOString(),views:100}]});
const oldObservation=new Date(Date.now()-2*864e5).toISOString();
saveObservation({platform:'xhs',account:'TwoPeanuts',captured_at:oldObservation,source:'isolated-test',example:true,
  posts:[{id:'stale-fixture',text:'旧观测（假数据）',created_at:oldObservation,views:12}]});
const {handle}=await import('../src/web.mjs');
let current, report, violations=[];
// Added only to test responses; the production HTML and handler are unchanged.
function browserChecks(test, image) {
  const options=JSON.stringify({test,image,width});
  return `<script>(${async function({test,image,width}) {
    addEventListener('error',()=>sessionStorage.setItem('qa-error','page exception'));
    addEventListener('unhandledrejection',()=>sessionStorage.setItem('qa-error','unhandled rejection'));
    const check=(ok,name)=>{if(!ok)throw new Error(name);};
    const wait=async fn=>{for(let i=0;i<100;i++){if(fn())return;await new Promise(r=>setTimeout(r,100));}throw new Error('render wait');};
    const finish=async(ok,detail)=>{document.documentElement.dataset.qa=ok?'PASS':'FAIL';await fetch('/__qa/report',{method:'POST',body:JSON.stringify({ok,detail,viewport:{innerWidth,clientWidth:document.documentElement.clientWidth,scrollWidth:document.documentElement.scrollWidth}})});};
    try {
      check(innerWidth<=width && innerWidth>=width-24,'actual viewport fits screenshot; native window borders may reduce client width');
      check(document.documentElement.scrollWidth<=document.documentElement.clientWidth+1,'no page-level horizontal overflow');
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
        check(summary.innerText.includes('今日发布作品'),'daily cohort heading');
        if(test==='home')check(summary.querySelectorAll('.summary-account-card').length===3,'three configured platforms');
        else {
          for(const label of ['当日发文累计','当前作品累计','跨日快照增量','未证明全账号完整历史'])check(summary.textContent.includes(label),label);
          check(summary.querySelectorAll('tbody tr').length===9,'three platforms and preserved advanced scopes');
        }
        for(const label of ['当日未更新','尚无采集数据','当日已观测'])check(summary.innerText.includes(label),'freshness: '+label);
        check(summary.scrollHeight<=summary.clientHeight+2,'summary not vertically clipped');
      }
      if(test==='prepare') {
        check(document.body.innerText.includes('旧任务未保留底层回执'),'legacy WeChat receipt diagnosis');
        check(!document.body.innerText.includes('尚未真实验收'),'no outdated X acceptance claim');
        const record=document.querySelector('[data-prep-record="legacy-wechat-fixture"]');
        check(record && record.querySelector('[data-prep="execute"]').disabled,'unknown remains non-retryable');
        const published=document.querySelector('[data-prep-record="project-x-fixture"]');
        check(published.innerText.includes('每日 AI 精选') && published.innerText.includes('AI 工具') && published.innerText.includes('AI 精选项目'),'project provenance rendered');
        check(published.querySelector('a[href="https://x.com/PeanutPair/status/456"]').textContent.includes('打开原帖'),'direct original link');
        for (const [key, value] of [['category','AI 工具'], ['column','每日 AI 精选']]) {
          const filter=document.querySelector(`[data-prep-filter="${key}"]`);
          filter.value=value;filter.dispatchEvent(new Event('change',{bubbles:true}));
          check(record.hidden && !published.hidden,`${key} filter applied`);
          filter.value='';filter.dispatchEvent(new Event('change',{bubbles:true}));
          check(!record.hidden,`${key} filter cleared`);
        }
      }
      if(test.endsWith('system')) {
        for(const label of ['账号与采集','更新今日作品数据','采集范围与运行说明'])check(document.body.innerText.includes(label),label);
        const wechat=[...document.querySelectorAll('[data-act]')].find(button=>button.dataset.act.includes('"platform":"wechat"')&&button.textContent.trim()==='登录账号');
        check(!!wechat,'WeChat login entry');
        check(document.querySelectorAll('[data-act]').length===(test==='enabled-system'?9:6),'one login and one collection entry per platform; advanced checks retained');
        const a=document.querySelector('a[href="#/prepare"]');check(!!a,'prepare link');a.click();
        await wait(()=>!!document.querySelector('#prep-form'));check(location.hash==='#/prepare','button navigation');
        location.hash='#/system';await wait(()=>document.querySelector('.h1')?.textContent==='账号与采集');
      }
      if(test==='prepare-flow') {
        const form=document.querySelector('#prep-form');
        check(!form.querySelector('[name=target]:checked'),'no platform chosen by default');
        form.elements.sourceTitle.value='隔离原稿标题';form.elements.sourceContent.value='隔离文图草稿\n完整第二段';
        for(const target of form.querySelectorAll('[name=target]'))target.click();
        const edition=p=>form.querySelector('[data-edition="'+p+'"]');
        edition('x').querySelector('[data-draft-paths]').value=image;
        edition('x').querySelector('[data-draft-test]').checked=true;
        const article=edition('wechat').querySelector('[data-draft-content]');
        article.value='公众号独立文章';article.dispatchEvent(new Event('input',{bubbles:true}));
        edition('wechat').querySelector('[data-draft-caption]').value='独立摘要';
        form.requestSubmit();await wait(()=>document.querySelector('#prep-message')?.textContent.includes('选择 1–9 张图片'));
        check((await (await fetch('/api/prep')).json()).records.length===0,'validate all drafts before saving');
        edition('xhs').querySelector('[data-draft-paths]').value=image;
        edition('xhs').querySelector('[data-draft-topics]').value='测试，编辑';
        form.requestSubmit();await wait(()=>!!document.querySelector('a[href^="/api/prep/bundle"]'));
        const b=document.querySelector('a[href^="/api/prep/bundle"]'),r=await fetch(b.getAttribute('href'));
        check(r.ok && r.headers.get('content-type')==='application/zip','bundle download');
        check(new DataView(await r.arrayBuffer()).getUint32(0,true)===0x04034b50,'ZIP signature');
        const data=await (await fetch('/api/prep')).json();check(data.records.length===3,'three selected drafts');
        check(data.records.every(record=>record.state==='prepared'),'no platform writes');
        const getJob=async platform=>await (await fetch('/api/prep/job?id='+data.records.find(record=>record.platform===platform).id)).json();
        const [x,xhs,wechat]=await Promise.all(['x','xhs','wechat'].map(getJob));
        check(x.images.length===1 && x.content.includes('完整第二段'),'X inherits original and uses its own image');
        check(xhs.images.length===1 && xhs.topics.join('、')==='测试、编辑','XHS has its own topics and images');
        check(wechat.content==='公众号独立文章' && wechat.caption==='独立摘要' && !wechat.images.length,'WeChat has its own copy and abstract');
        form.requestSubmit();await wait(()=>!form.querySelector('button[type=submit]').disabled);
        check((await (await fetch('/api/prep')).json()).records.length===3,'repeated save deduplicates');
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
    try {const value=JSON.parse(body); report={ok:value.ok===true,detail:String(value.detail).slice(0,300),viewport:value.viewport};}catch{report={ok:false,detail:'invalid QA report'};}
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
    if(test==='prepare') {
      const insert=db.prepare('INSERT INTO publish_preparations VALUES (?,?)');
      insert.run('legacy-wechat-fixture',JSON.stringify({id:'legacy-wechat-fixture',platform:'wechat',title:'旧草稿回执（假数据）',state:'unknown',kind:'execute',evidence:{submitted:null,savedAsDraft:false}}));
      insert.run('project-x-fixture',JSON.stringify({id:'project-x-fixture',platform:'x',title:'已发布回执（假数据）',state:'published',source:{project:'AI 精选项目',column:'每日 AI 精选',category:'AI 工具',runId:'fixture-run'},publishedAt:'2026-11-21T01:00:05Z',url:'https://x.com/PeanutPair/status/456',publication:{postId:'456'}}));
    }
    const target=test==='home'?'/':test==='traffic'?'/p#/traffic':test==='unauth'||test.endsWith('system')?'/p#/system':'/p#/prepare';
    const shot=path.join(output,test+'.png');
    const child=spawn(binary,['--headless=new','--incognito','--no-first-run','--no-default-browser-check','--disable-extensions','--disable-background-networking',
      `--window-size=${width},1800`,'--user-data-dir='+path.join(folder,'profile-'+test),'--screenshot='+shot,'--dump-dom','--timeout=18000',
      '--virtual-time-budget=12000','http://127.0.0.1:'+server.address().port+target],{windowsHide:true,stdio:['ignore','pipe','pipe']});
    // DOM may contain fixture authentication fields. Consume without logging/writing it.
    child.stdout.resume();child.stderr.resume();let timedOut=false;
    const timer=setTimeout(()=>{timedOut=true;child.kill();},25000);
    const [code]=await once(child,'close');clearTimeout(timer);
    if(test==='prepare')db.prepare('DELETE FROM publish_preparations WHERE id IN (?,?)').run('legacy-wechat-fixture','project-x-fixture');
    const result={test,ok:code===0&&!timedOut&&report?.ok===true&&fs.existsSync(shot),code,detail:report?.detail || 'browser did not confirm assertions',viewport:report?.viewport,screenshot:shot};
    evidence.results.push(result);console.log(JSON.stringify(result));
  }
  if(violations.length)throw new Error('test attempted forbidden operations');
}catch(e){evidence.results.push({test:'environment',ok:false,detail:e.code || e.message});}
finally {
  await new Promise(r=>server.close(r));db.close();
  fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(evidence,null,2));
}
process.exitCode=evidence.results.some(r=>!r.ok)?1:0;
