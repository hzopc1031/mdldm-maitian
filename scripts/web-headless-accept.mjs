// First-party rendered acceptance. Chrome CLI only: no remote debugging port/pipe,
// extensions, existing browser/profile, platform URL or real account credentials.
// Isolated real HTTP handler/SQLite. Authentication fixture stays in memory.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {once} from 'node:events';
import {spawn} from 'node:child_process';
const supportedTests = ['unauth','invalid','home','traffic','system','prepare','prepare-flow','enabled-system','columns','columns-resize','x-accounts','x-publish-accounts','comments'];
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
let current, report, columnWrites=0, accountWrites=0, publishWrites=0, fixturePost, fixtureTarget, commentWrites=0, violations=[];
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
      await wait(()=>test==='home'||test==='x-accounts'&&location.pathname==='/'?!!document.querySelector('.hero'):!!document.querySelector('.h1'));
      check(!document.body.innerText.includes('出错了：'),'no render error');
      const expected=test==='home'||test==='x-accounts'&&sessionStorage.getItem('qa-account-home')?'/':test==='traffic'?'/p#/traffic':test==='comments'?'/p#/comments':test.endsWith('system')||test==='x-accounts'?'/p#/system':'/p#/prepare';
      check(location.pathname+location.hash===expected,'POST preserved route');
      if(!sessionStorage.getItem('qa-reloaded')){sessionStorage.setItem('qa-reloaded','1');location.reload();return;}
      if(test==='comments'){
        await wait(()=>document.querySelectorAll('[data-comment-record]').length===3);
        check(!!document.querySelector('a[href="/p#/comments"]'),'comment navigation present');
        check(document.body.innerText.includes('直接回复的评论')&&document.body.innerText.includes('查看发出的评论'),'public parent and reply links');
        check(document.body.innerText.includes('<'+'script>unsafe<'+'/script>'),'untrusted content escaped');
        const unknown=document.querySelector('[data-comment-record^="22222222"]');check(!unknown.querySelector('button'),'unknown has no resend action');
        if(!sessionStorage.getItem('qa-comments-done')){
          const dom=await import('/__qa/comment-dom');
          const fixture=document.createElement('section');
          fixture.innerHTML='<div data-testid="SideNav_AccountSwitcher_Button">@PeanutPair<span data-testid="UserAvatar-Container-PeanutPair"></span></div><main data-testid="primaryColumn"><article><a href="https://x.com/author/status/100"><time datetime="2026-11-27T00:00:00Z">time</time></a><div data-testid="tweetText">root</div></article><article><a href="https://x.com/other/status/200"><time datetime="2026-11-27T00:00:00Z">time</time></a><div data-testid="tweetText">target</div><div data-testid="quoteTweet"><a href="https://x.com/quote/status/999"><time>quote</time></a><div data-testid="tweetText">quoted text</div><button data-testid="reply">quoted reply</button></div><button data-testid="reply" id="fixture-open">reply</button></article></main><div role="dialog"><article><a href="https://x.com/other/status/200"><time>target</time></a></article><div data-testid="tweetTextarea_0" contenteditable="true"></div><button data-testid="tweetButton">send</button></div>';
          document.body.append(fixture);let opened=0,submitted=0;fixture.querySelector('#fixture-open').onclick=()=>opened++;fixture.querySelector('[data-testid=tweetButton]').onclick=()=>submitted++;
          const view=dom.commentPageView();check(view.cards.map(c=>c.id).join(',')==='100,200','quoted card excluded from main identities');check(view.cards[1].content==='target','quoted text excluded');
          check(dom.openCommentTarget('200','other')&&opened===1,'reply chooses target own button once');
          check(dom.commentComposer('200','other','PeanutPair','exact body','focus')===true,'empty matching reply editor focused');
          fixture.querySelector('[contenteditable]').innerText='exact body';check(dom.commentComposer('200','other','PeanutPair','exact body','read').ready,'full text read back');
          check(dom.commentComposer('300','other','PeanutPair','exact body','submit')===null&&submitted===0,'wrong parent never submits');
          check(dom.commentComposer('200','other','WrongUser','exact body','submit')===null&&submitted===0,'wrong account never submits');
          check(dom.commentComposer('200','other','PeanutPair','exact body','submit')===true&&submitted===1,'single scoped submit');
          fixture.querySelector('[role=dialog]').remove();
          const targetArticle=fixture.querySelector('#fixture-open').closest('article');
          targetArticle.insertAdjacentHTML('afterbegin','<a href="https://x.com/other"><span data-testid="UserAvatar-Container-other">avatar</span></a>');
          const snapshot={id:'200',handle:'other',content:'target',createdAt:'2026-11-27T00:00:00Z'};
          const shell=document.createElement('div');shell.setAttribute('role','dialog');shell.innerHTML='<div role="dialog"><article><a href="https://x.com/other"><span data-testid="UserAvatar-Container-other">avatar</span></a><div data-testid="User-Name">@other</div><time datetime="2026-11-27T00:00:00Z">time without anchor</time><div data-testid="tweetText">target</div></article><section id="delayed-editor"></section><button data-testid="tweetButton">send</button></div>';fixture.append(shell);
          check(dom.commentComposer('200','other','PeanutPair','exact body','focus',snapshot)===null,'loading composer never passes');
          await new Promise(r=>setTimeout(()=>{shell.querySelector('#delayed-editor').innerHTML='<div data-testid="tweetTextarea_0" contenteditable="true"></div>';r();},30));
          check(dom.commentComposer('200','other','PeanutPair','exact body','focus',snapshot)===true,'nested dialogs and unlinked delayed preview accepted');
          for(const bad of [{...snapshot,content:'wrong'}, {...snapshot,createdAt:'2026-11-27T00:01:00Z'}, {...snapshot,id:'201'}, {...snapshot,handle:'wrong'}])check(dom.commentComposer('200','other','PeanutPair','exact body','focus',bad)===null,'wrong snapshot never passes');
          const preview=shell.querySelector('article'),avatar=preview.querySelector('[data-testid^="UserAvatar"]');avatar.setAttribute('data-testid','UserAvatar-Container-wrong');check(dom.commentComposer('200','other','PeanutPair','exact body','focus',snapshot)===null,'wrong preview author rejected');avatar.setAttribute('data-testid','UserAvatar-Container-other');
          targetArticle.querySelector('time').closest('a').href='https://x.com/other/status/201';check(dom.commentComposer('200','other','PeanutPair','exact body','focus',snapshot)===null,'changed background target rejected');targetArticle.querySelector('time').closest('a').href='https://x.com/other/status/200';
          const duplicate=shell.cloneNode(true);fixture.append(duplicate);check(dom.commentComposer('200','other','PeanutPair','exact body','focus',snapshot)===null,'two actual composers rejected');duplicate.remove();
          shell.querySelector('[contenteditable]').innerText='existing draft';check(dom.commentComposer('200','other','PeanutPair','exact body','focus',snapshot)===null,'nonempty draft preserved');
          shell.querySelector('[contenteditable]').innerText='exact body';check(dom.commentComposer('200','other','PeanutPair','exact body','read',snapshot).ready,'unlinked preview checked during readback');
          shell.querySelector('button').onclick=()=>submitted++;preview.querySelector('[data-testid="tweetText"]').innerText='changed target';check(dom.commentComposer('200','other','PeanutPair','exact body','submit',snapshot)===null&&submitted===1,'changed preview prevents submit');
          preview.querySelector('[data-testid="tweetText"]').innerText='target';check(dom.commentComposer('200','other','PeanutPair','exact body','submit',snapshot)===true&&submitted===2,'verified nested composer submits once in fixture');fixture.remove();
          document.querySelector('[data-comment-cancel]').click();await wait(()=>!document.querySelector('[data-comment-cancel]'));
          const select=document.querySelector('[data-comment-state]');select.value='unknown';select.dispatchEvent(new Event('change',{bubbles:true}));await wait(()=>document.querySelectorAll('[data-comment-record]').length===1);check(document.body.innerText.includes('未知结果样本'),'state filter');
          sessionStorage.setItem('qa-comments-done','1');location.reload();return;
        }
        check(!document.querySelector('[data-comment-cancel]'),'cancel persisted after refresh');
        check(document.documentElement.scrollWidth<=document.documentElement.clientWidth+1,'comment page fits viewport');
        await finish(true,'评论关系/来源/状态、正文转义、取消/筛选/刷新和真实DOM定位/错对象错账号拒绝均通过；无平台动作');return;
      }
      if(test==='x-publish-accounts') {
        if(!sessionStorage.getItem('qa-publish-submitted')){
          await wait(()=>!!document.querySelector('[data-x-publish]'));
          const form=document.querySelector('[data-x-publish]'),select=form.elements.namedItem('accountId');
          const choices=[...select.options].filter(o=>o.value);
          check(choices.length===2,'only the two confirmed signed-in accounts are selectable');
          check(choices.every(o=>/@DemoWork|@DemoTrip/.test(o.textContent)),'no legacy/unbound account in choices');
          check(select.required&&!select.value&&!form.checkValidity(),'explicit choice is required, no automatic default');
          select.value=choices.find(o=>o.textContent.includes('@DemoTrip')).value;
          sessionStorage.setItem('qa-publish-target',select.value);sessionStorage.setItem('qa-publish-submitted','1');
          form.querySelector('[data-x-mode="draft"]').click();return;
        }
        await wait(()=>!document.querySelector('[data-x-publish]'));
        check(document.querySelector('[data-x-account-select]').value===sessionStorage.getItem('qa-publish-target'),'view follows explicit target after execution');
        check(document.body.innerText.includes('已存草稿'),'mock receipt displayed after reload');
        await finish(true,'仅已登录账号可选、必选目标、选择→检查→执行及回执刷新；平台执行完全mock');return;
      }
      if(test==='x-accounts'&&location.pathname==='/'){
        check(document.querySelector('[data-x-account-select]').value===sessionStorage.getItem('qa-selected-account'),'independent homepage loads the same account context');
        check(!document.body.innerText.includes('页面加载失败'),'homepage has no context ReferenceError');
        const overview=await (await fetch('/api/overview?xAccount='+sessionStorage.getItem('qa-selected-account'))).json();
        check(!overview.episodes.some(e=>e.tasks.some(t=>t.platform==='x')),'homepage account does not inherit legacy X posts');
        await finish(true,'新增两账户→系统页选择/刷新→独立首页沿用选择与隔离数据，全程无平台动作');return;
      }
      if(test==='x-accounts') {
        await wait(()=>!!document.querySelector('[data-add-x-account]'));
        if(!sessionStorage.getItem('qa-accounts-done')) {
          for(const label of ['工作账户','旅行账户']) {
            const count=document.querySelectorAll('[data-x-account]').length;
            const form=document.querySelector('[data-add-x-account]');form.elements.namedItem('label').value=label;form.requestSubmit();
            await wait(()=>document.querySelectorAll('[data-x-account]').length===count+1);
          }
          const cards=[...document.querySelectorAll('[data-x-account]')];check(cards.length===3,'two user-created slots plus legacy account');
          for(const card of cards.slice(1))check(card.querySelector('[data-act*=collect]').disabled,'unbound account cannot collect');
          const picker=document.querySelector('[data-x-account-select]');check(picker.options.length===3,'account selector includes user accounts');
          sessionStorage.setItem('qa-selected-account',picker.options[2].value);sessionStorage.setItem('qa-accounts-done','1');
          picker.value=picker.options[2].value;picker.dispatchEvent(new Event('change',{bubbles:true}));return;
        }
        const selected=sessionStorage.getItem('qa-selected-account');
        check(document.querySelector('[data-x-account-select]').value===selected,'selection persisted after real reload');
        const overview=await (await fetch('/api/overview?xAccount='+selected)).json();
        check(overview.xAccountId===selected&&overview.xAccounts.length===3,'scoped API and slots persisted');
        check(!overview.episodes.some(e=>e.tasks.some(t=>t.platform==='x')),'new account does not display legacy X posts');
        check(document.querySelectorAll('[data-x-account]').length===3,'no duplicate form handlers');
        check(document.documentElement.scrollWidth<=document.documentElement.clientWidth+1,'no overflow with account selector');
        sessionStorage.setItem('qa-account-home','1');location.href='/';return;
      }
      if(test.startsWith('columns')) {
        await wait(()=>!!document.querySelector('[data-column-manage]'));
        if(test==='columns-resize')dispatchEvent(new Event('resize'));
        document.querySelector('[data-column-manage]').click();
        const panel=document.querySelector('#column-manager');check(!panel.hidden,'manager opens');
        if(!sessionStorage.getItem('qa-columns-done')){
          let form=panel.querySelector('form');form.elements.namedItem('name').value='AI验收栏目';form.elements.namedItem('description').value='隔离界面验收，不涉及平台操作';
          if(test==='columns-resize'){dispatchEvent(new Event('resize'));dispatchEvent(new Event('resize'));}
          form.requestSubmit();await wait(()=>panel.textContent.includes('栏目已创建'));
          const column=(await (await fetch('/api/prep/columns')).json()).columns.find(c=>c.name==='AI验收栏目');check(!!column,'created via page');
          panel.querySelector('[data-column-edit="'+column.id+'"]').click();form=panel.querySelector('form');check(form.elements.namedItem('name').value===column.name,'edit prefilled');
          form.elements.namedItem('name').value='AI案例库';form.elements.namedItem('description').value='更新后的栏目说明，验证改名与说明保存';
          form.requestSubmit();await wait(()=>panel.textContent.includes('栏目已更新'));
          sessionStorage.setItem('qa-columns-done','1');location.reload();return;
        }
        const columns=(await (await fetch('/api/prep/contract')).json()).columns;
        check(columns.some(c=>c.name==='AI案例库'&&c.description.includes('更新后')),'rename persisted after reload');
        check(!columns.some(c=>c.name==='AI验收栏目'),'old name removed');
        check(columns.length===4,'three defaults plus UI-created column');
        check(document.querySelectorAll('[data-column-filter]').length===5,'empty columns available in filter');
        const form=panel.querySelector('form');form.elements.namedItem('name').value='轮询时保留';
        await new Promise(r=>setTimeout(r,5500));check(panel.querySelector('input[name=name]').value==='轮询时保留','poll does not erase open form');form.reset();
        const input=panel.querySelector('input');check(input.getBoundingClientRect().right<=innerWidth,'form fits viewport');
        check(document.documentElement.scrollWidth<=document.documentElement.clientWidth+1,'manager has no horizontal overflow');
      }
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
  if(req.url==='/__qa/comment-dom'&&current==='comments'){res.writeHead(200,{'content-type':'text/javascript'});res.end(fs.readFileSync(path.resolve('src/x-comment-dom.mjs')));return;}
  if(req.url==='/__qa/report') {
    let body='';for await(const d of req)body+=d;
    try {const value=JSON.parse(body); report={ok:value.ok===true,detail:String(value.detail).slice(0,300),viewport:value.viewport};}catch{report={ok:false,detail:'invalid QA report'};}
    res.end('ok');return;
  }
  if(req.url.startsWith('/api/action') || (req.method==='POST' && req.url!=='/auth' && req.url!=='/api/prep' && !(current==='comments'&&req.url==='/api/comments') && !(current==='x-publish-accounts'&&req.url==='/api/prep/posts') && !(current==='x-accounts'&&req.url==='/api/l1/x-accounts') && !(current.startsWith('columns')&&req.url==='/api/prep/columns'))) {
    violations.push('unexpected mutation');res.writeHead(403);res.end();return;
  }
  if(current==='comments'&&req.url==='/api/comments'&&req.method==='POST'){let raw='';for await(const chunk of req)raw+=chunk;const a=JSON.parse(raw);if(a.type!=='cancel'){violations.push('unexpected comment execution');res.writeHead(403);res.end();return;}commentWrites++;req=Object.assign(Object.create(req),{[Symbol.asyncIterator]:async function*(){yield Buffer.from(raw);}});}
  if(req.url==='/api/prep' && req.method==='POST') {
    // Only local create is allowed in rendered acceptance; never invoke a skill.
    let body='';for await(const d of req)body+=d;
    if(JSON.parse(body).type!=='create'){violations.push('unexpected skill');res.writeHead(403);res.end();return;}
    req=Object.assign(Object.create(req),{[Symbol.asyncIterator]:async function*(){yield Buffer.from(body);}});
  }
  if(req.url==='/api/prep/columns'&&req.method==='POST')columnWrites++;
  if(req.url==='/api/l1/x-accounts'&&req.method==='POST')accountWrites++;
  if(current==='x-publish-accounts'&&req.url==='/api/prep/posts'&&req.method==='POST'){
    let raw='';for await(const chunk of req)raw+=chunk;const action=JSON.parse(raw);
    if(!['select-x-account','check','fill'].includes(action.type)||action.id!==fixturePost)throw Error('Unexpected account selection action');
    if(action.type==='fill'){
      if(action.mode!=='draft'||action.accountId!==fixtureTarget)throw Error('Wrong publishing target');
      const post=JSON.parse(db.prepare('SELECT record FROM publish_posts WHERE id=?').get(fixturePost).record);
      const row=db.prepare('SELECT record FROM publish_preparations WHERE id=?').get(post.editions.x.preparationId),record=JSON.parse(row.record);
      if(record.accountId!==fixtureTarget)throw Error('Prepared target differs from selection');
      record.state='draft_saved';record.note='isolated fixture: mocked draft receipt, no platform operation';
      db.prepare('UPDATE publish_preparations SET record=? WHERE id=?').run(JSON.stringify(record),record.id);publishWrites++;
      res.writeHead(202,{'content-type':'application/json'});res.end(JSON.stringify({ok:true}));return;
    }
    req=Object.assign(Object.create(req),{[Symbol.asyncIterator]:async function*(){yield Buffer.from(raw);}});
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
    current=test;report=null;columnWrites=0;accountWrites=0;publishWrites=0;commentWrites=0;
    config.publishPrep.browserExecution=test==='enabled-system';
    for(const p of ['x','xhs','wechat'])config.l1[p].browserExecution=test==='enabled-system';
    if(test==='comments'){
      const at=new Date().toISOString(),actor={runtime:'codex',name:'Codex',sessionId:'offline-comments-ui'};
      for(const [n,state] of [['1','sent'],['2','unknown'],['3','queued']]){
        const id=n.repeat(8)+'-'+n.repeat(4)+'-'+n.repeat(4)+'-'+n.repeat(4)+'-'+n.repeat(12);
        const r={id,platform:'x',accountId:'default',account:'PeanutPair',state,requestId:'fixture-'+n,createdAt:at,actor,root:{id:'100',handle:'author',url:'https://x.com/author/status/100'},target:{id:'200',handle:'other',url:'https://x.com/other/status/200'},content:state==='unknown'?'<script>unsafe</script>未知结果样本':'隔离评论样本'+n,...(state==='sent'?{url:'https://x.com/PeanutPair/status/901',verifiedAt:at}:{}),...(state==='unknown'?{error:'发送结果未确认，禁止重发'}:{})};
        db.prepare('INSERT INTO comment_jobs VALUES (?,?,?,?)').run(id,'ui-fixture-'+n,state,JSON.stringify(r));
      }
    }

    if(test==='x-publish-accounts'){
      const {createXAccount,bindXAccount}=await import('../src/x-accounts.mjs');
      for(const [label,handle] of [['工作登录样本','DemoWork'],['出行登录样本','DemoTrip'],['未登录样本',null]]){
        const a=createXAccount(db,{label});if(!handle)continue;bindXAccount(db,a.id,handle,config.xHandle);
        db.prepare('INSERT OR REPLACE INTO meta VALUES (?,?)').run('l1:web:identity:x:'+a.id,JSON.stringify({account:'@'+handle,profile:a.profile,status:'logged_in',confirmedAt:new Date().toISOString()}));
        if(handle==='DemoTrip')fixtureTarget=a.id;
      }
      const {createPostService}=await import('../src/publish-posts.mjs');const service=createPostService({db,config,home:folder,prep:{get(){throw Error('No preparation should exist yet');}}});
      fixturePost=service.create({title:'账户选择隔离验收',content:'仅临时数据库验收，不会操作任何平台。'},{runtime:'codex',sessionId:'isolated-browser-fixture'},{column:'AI工具分享',scheduledAt:new Date(Date.now()+36e5).toISOString()}).id;
    }
    if(test==='prepare') {
      const insert=db.prepare('INSERT INTO publish_preparations VALUES (?,?)');
      insert.run('legacy-wechat-fixture',JSON.stringify({id:'legacy-wechat-fixture',platform:'wechat',title:'旧草稿回执（假数据）',state:'unknown',kind:'execute',evidence:{submitted:null,savedAsDraft:false}}));
      insert.run('project-x-fixture',JSON.stringify({id:'project-x-fixture',platform:'x',title:'已发布回执（假数据）',state:'published',source:{project:'AI 精选项目',column:'每日 AI 精选',category:'AI 工具',runId:'fixture-run'},publishedAt:'2026-11-21T01:00:05Z',url:'https://x.com/PeanutPair/status/456',publication:{postId:'456'}}));
    }
    const target=test==='home'?'/':test==='traffic'?'/p#/traffic':test==='comments'?'/p#/comments':test==='unauth'||test.endsWith('system')||test==='x-accounts'?'/p#/system':'/p#/prepare';
    const shot=path.join(output,test+'.png');
    const child=spawn(binary,['--headless=new','--incognito','--no-first-run','--no-default-browser-check','--disable-extensions','--disable-background-networking',
      `--window-size=${width},1800`,'--user-data-dir='+path.join(folder,'profile-'+test),'--screenshot='+shot,'--dump-dom','--timeout=18000',
      '--virtual-time-budget=12000','http://127.0.0.1:'+server.address().port+target],{windowsHide:true,stdio:['ignore','pipe','pipe']});
    // DOM may contain fixture authentication fields. Consume without logging/writing it.
    child.stdout.resume();child.stderr.resume();let timedOut=false;
    const timer=setTimeout(()=>{timedOut=true;child.kill();},25000);
    const [code]=await once(child,'close');clearTimeout(timer);
    if(test==='prepare')db.prepare('DELETE FROM publish_preparations WHERE id IN (?,?)').run('legacy-wechat-fixture','project-x-fixture');
    const writesOk=(!test.startsWith('columns')||columnWrites===2)&&(test!=='x-accounts'||accountWrites===2)&&(test!=='x-publish-accounts'||publishWrites===1)&&(test!=='comments'||commentWrites===1);
    const result={test,ok:code===0&&!timedOut&&report?.ok===true&&fs.existsSync(shot)&&writesOk,code,detail:!writesOk?`Unexpected write counts columns=${columnWrites}, accounts=${accountWrites}, comments=${commentWrites}; ${report?.detail||'no browser report'}`:report?.detail || 'browser did not confirm assertions',...(test.startsWith('columns')?{columnWrites}:{}),viewport:report?.viewport,screenshot:shot};
    evidence.results.push(result);console.log(JSON.stringify(result));
    if(test.startsWith('columns'))db.prepare('DELETE FROM publish_columns WHERE name IN (?,?)').run('AI验收栏目','AI案例库');
  }
  if(violations.length)throw new Error('test attempted forbidden operations');
}catch(e){evidence.results.push({test:'environment',ok:false,detail:e.code || e.message});}
finally {
  await new Promise(r=>server.close(r));db.close();
  fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(evidence,null,2));
}
process.exitCode=evidence.results.some(r=>!r.ok)?1:0;
