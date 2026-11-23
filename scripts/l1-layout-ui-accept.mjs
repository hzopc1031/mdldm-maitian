// First-party read-only UI acceptance, existing local app + new empty Chrome profile.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
const stage=process.argv[2] || 'after';
const base=process.env.MAITIAN_QA_BASE||'http://127.0.0.1:8787',interactive=process.env.MAITIAN_QA_INTERACTIVE_PLATFORMS==='1';
const prefill=process.env.MAITIAN_QA_VIDEO_PREFILL==='1';
if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(base)||interactive&&base.endsWith(':8787'))throw new Error('Platform mutations are allowed only on the isolated fixture server');
if(prefill&&base.endsWith(':8787'))throw new Error('Video prefill fixture requires an isolated workbench');
const out=path.resolve(process.env.MAITIAN_QA_OUT || '_local-layout-ui',stage);fs.mkdirSync(out,{recursive:true});
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'l1-layout-ui-'));
const child=spawn(path.join(process.env.PROGRAMFILES,'Google/Chrome/Application/chrome.exe'),['--headless=new','--no-first-run','--no-default-browser-check','--disable-extensions','--disable-background-networking','--remote-debugging-port=0','--remote-debugging-address=127.0.0.1','--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:'ignore'});
const exited=once(child,'close'),delay=ms=>new Promise(r=>setTimeout(r,ms));let ws;const results=[],mutations=[];
try {
  const portFile=path.join(profile,'DevToolsActivePort');
  let port,endpoint;
  for(let i=0;i<100&&!endpoint;i++){
    try {[port,endpoint]=fs.readFileSync(portFile,'utf8').trim().split(/\r?\n/);}
    catch(error){if(!['ENOENT','EBUSY'].includes(error.code))throw error;}
    if(!endpoint)await delay(100);
  }
  if(!port||!endpoint)throw new Error('隔离 Chrome 未生成可读的 DevToolsActivePort');
  ws=new WebSocket(`ws://127.0.0.1:${port}${endpoint}`);await once(ws,'open');
  let seq=0;const pending=new Map();ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.method==='Network.requestWillBeSent'&&m.params.request.url.startsWith(base)&&m.params.request.method!=='GET')mutations.push(m.params.request.url.slice(base.length));const p=pending.get(m.id);if(!p)return;pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(new Error(m.error.message)):p.resolve(m.result);};
  const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const id=++seq;const timer=setTimeout(()=>{pending.delete(id);reject(new Error(method+' timeout'));},10000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));});
  const {targetId}=await send('Target.createTarget',{url:'about:blank'});const {sessionId}=await send('Target.attachToTarget',{targetId,flatten:true});await send('Network.enable',{},sessionId);
  const js=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true},sessionId);if(r.exceptionDetails)throw new Error((r.exceptionDetails.exception?.description||r.exceptionDetails.text)+'; expression='+expression.slice(0,180));return r.result.value;};
  const wait=async expression=>{for(let i=0;i<100;i++){try{if(await js(expression))return;}catch(error){if(!/ReferenceError|context.*destroyed|Cannot read properties of null/i.test(error.message))throw error;}await delay(100);}throw new Error('Condition: '+expression);};
  const capture=async(width,page)=>{
    const geometry=await js('({width:innerWidth,client:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight})');
    assert.equal(geometry.width,width);assert.ok(geometry.scroll<=geometry.client+1,JSON.stringify({page,geometry}));
    if(stage==='after'){
      const nav=await js('[...document.querySelectorAll(".nav a")].map(a=>({text:a.innerText,current:a.getAttribute("aria-current"),left:a.getBoundingClientRect().left,right:a.getBoundingClientRect().right}))');
      assert.deepEqual(nav.map(n=>n.text),['总览','发布','数据统计','发布日历','作品库','账号与采集']);
      assert.equal(nav.filter(n=>n.current==='page').length,1);
      assert.ok(nav.every(n=>n.left>=0&&n.right<=width));
    }
    const {data}=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false},sessionId);const screenshot=path.join(out,`${width}-${page}.png`);fs.writeFileSync(screenshot,Buffer.from(data,'base64'));results.push({width,page,geometry,screenshot});
  };
  if(stage==='video') {
    const fixtureDir=path.resolve(process.env.MAITIAN_QA_VIDEO_FIXTURES || '_local-video-fixtures');
    const assets=Object.fromEntries(['fast.mp4','slow.mp4','cover-16x9.png'].map(name=>[name,fs.readFileSync(path.join(fixtureDir,name)).toString('base64')]));
    for(const width of [1440,390]) {
      const downloadPath=fs.mkdtempSync(path.join(os.tmpdir(),'video-download-'));
      await send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath});
      await send('Emulation.setDeviceMetricsOverride',{width,height:1100,deviceScaleFactor:1,mobile:width===390},sessionId);
      await send('Page.navigate',{url:base+'/p#/prepare'},sessionId);
      await wait('!!document.querySelector(".prep-composer")');
      await js(`document.querySelector('a[href="#/prepare?format=video"]').click()`);
      await wait('!!document.querySelector("#video-project")');
      await js(`(() => {
        const form=document.querySelector('#video-project'), assets=${JSON.stringify(assets)}, list=new DataTransfer();
        for (const [name,data] of Object.entries(assets)) {
          const file=new File([Uint8Array.from(atob(data),c=>c.charCodeAt(0))],name);
          Object.defineProperty(file,'webkitRelativePath',{value:'验收工程/'+(name.endsWith('.png')?'封面/':'')+name});
          list.items.add(file);
        }
        const existing=new File([JSON.stringify({version:1,id:'fixture-video',name:'离线验收视频',video:'fast.mp4',covers:{'16x9':'封面\\\\cover-16x9.png'},platforms:{youtube:{title:'实测视频',desc:'YouTube 平台简介',tags:['验收']},bilibili:{title:'B站视频',desc:'B站平台简介',tags:['样例']}}})],'publish.json');
        Object.defineProperty(existing,'webkitRelativePath',{value:'验收工程/publish.json'});
        list.items.add(existing);form.elements.directory.files=list.files;form.elements.directory.dispatchEvent(new Event('change',{bubbles:true}));
      })()`);
      await wait('!document.querySelector(".video-project-fields").hidden');
      assert.equal(await js('document.querySelectorAll("[name=video-target]:checked").length'),2);
      await js('document.querySelector("#video-project").requestSubmit()');
      await wait('!document.querySelector("[data-save-video]").disabled');
      assert.equal(await js('document.querySelectorAll("#video-project-handoff a").length'),2);
      const copied=await js(`(async()=> {
        const clipboard={writeText:async value=>{clipboard.value=value;}};
        Object.defineProperty(navigator,'clipboard',{value:clipboard,configurable:true});
        try {
          await [...document.querySelectorAll('.video-handoff-row')].at(-1).querySelector('button:nth-child(2)').onclick();
          return clipboard.value;
        } finally { delete navigator.clipboard; }
      })()`);
      assert.equal(copied,'YouTube 平台简介');
      await js('document.querySelector("#video-project-handoff").scrollIntoView({block:"center"})');
      await capture(width,'video-approved');
      await js('document.querySelector("[data-save-video]").click()');
      const download=path.join(downloadPath,'publish.json');
      for(let i=0;i<60&&!fs.existsSync(download);i++)await delay(100);
      const exported=JSON.parse(fs.readFileSync(download,'utf8'));
      assert.deepEqual(Object.keys(exported.platforms),['bilibili','youtube']);
      assert.equal(exported.platforms.youtube.desc,'YouTube 平台简介');
      assert.equal(exported.id,'fixture-video');
      assert.equal(exported.covers['16x9'],'封面/cover-16x9.png');
      assert(exported.durationSec>0);
      await js('(()=>{const f=document.querySelector("#video-project");f.elements.video.value="slow.mp4";f.elements.video.dispatchEvent(new Event("input",{bubbles:true}));f.requestSubmit();})()');
      await wait('document.querySelector("#video-project-result").textContent.includes("faststart")');
      assert.equal(await js('document.querySelector("[data-save-video]").disabled'),true);
      assert.equal(await js('document.querySelector("#video-project-handoff").hidden'),true);
      if(prefill){
        const fixtureRoot=width===390?'D:/另一目录/验收工程':'D:/视频/验收工程';
        const before=await js(`(async()=>{const r=await (await fetch('/api/video-prefill/receipt')).json();return r.job?.startedAt??0;})()`);
        await js(`(() => {
          let job=null;
          addEventListener('message',async event=>{
            const d=event.data;
            if(d?.channel!=='maitian.video.prefill.v1'||d.direction!=='request')return;
            if(d.action==='start'){
              const {requestId,data,rootPath,lease}=d.payload;
              if(rootPath!==${JSON.stringify(fixtureRoot)}||data.covers['16x9']!=='封面/cover-16x9.png')throw new Error('工程交接数据错误');
              const response=await fetch('/fixture/video-worker',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'claim',requestId,lease})});
              const {accounts}=await response.json();
              if(!response.ok||accounts.bilibili!=='FixtureBili'||accounts.youtube!=='FixtureYT')throw new Error('预填账号错误');
              job={requestId,lease,revision:1,name:data.name,running:false,startedAt:Date.now(),finishedAt:Date.now(),
                states:Object.keys(data.platforms).map(id=>({id,status:'待你发布',logs:[{msg:'本机验收回执'}]}))};
            }
            window.postMessage({channel:d.channel,id:d.id,direction:'response',result:{ok:true,job}},location.origin);
          });
          const f=document.querySelector('#video-project');
          f.elements.video.value='fast.mp4';f.elements.video.dispatchEvent(new Event('input',{bubbles:true}));f.requestSubmit();
        })()`);
        await wait('!document.querySelector("[data-save-video]").disabled');
        await js(`(() => {
          const host=document.querySelector('#video-project-handoff');
          const input=host.querySelector('input');
          input.value=${JSON.stringify(fixtureRoot)};input.dispatchEvent(new Event('input',{bubbles:true}));
          host.querySelector('button').click();
        })()`);
        await wait('document.querySelectorAll("#video-prefill-status li").length===2');
        await wait(`(async()=>{const r=await (await fetch('/api/video-prefill/receipt')).json();return r.job?.states.length===2&&r.job.startedAt>${before}&&r.job.states.every(s=>s.status==='待你发布');})()`);
        await js('location.reload()');
        await wait('document.querySelectorAll("#video-prefill-status li").length===2');
        await js('document.querySelector("#video-prefill-status li button").click()');
        await wait('document.querySelector("#video-prefill-status select")?.options.length===2');
        await js(`(() => {const host=document.querySelector('#video-prefill-status li'),select=host.querySelector('select');
          select.selectedIndex=1;select.dispatchEvent(new Event('change'));[...host.querySelectorAll('button')].find(button=>button.textContent==='确认关联').click();})()`);
        await wait('document.querySelector("#video-prefill-status a")?.textContent.includes("查看已关联作品")');
        await js('document.querySelector("#video-prefill-status").scrollIntoView()');
        await capture(width,'video-prefill-receipt');
      }
    }
  }
  if(stage==='age-review')for(const width of [1440,390]) {
    const sample=process.env.MAITIAN_QA_AGE_SAMPLE;
    if(!sample)throw new Error('请指定经接口核对的真实样本 ID');
    await send('Emulation.setDeviceMetricsOverride',{width,height:1100,deviceScaleFactor:1,mobile:width===390},sessionId);
    await send('Page.navigate',{url:base+'/p#/ep/'+encodeURIComponent(sample)},sessionId);
    await wait('!!document.querySelector(".age-review")');
    assert.ok(await js('document.querySelector(".age-review").textContent.includes("发布后")'));
    assert.ok(await js('document.querySelector(".age-review").textContent.includes("窗口内未采到数据")'));
    await js('document.querySelector(".age-review").scrollIntoView({block:"center"})');
    await capture(width,'age-review');
  }
  if(!['video','age-review'].includes(stage))for(const width of [1440,390]) {
    await send('Emulation.setDeviceMetricsOverride',{width,height:1100,deviceScaleFactor:1,mobile:width===390},sessionId);
    for(const [page,route,ready] of [['home','/','!!document.querySelector(".top") && !!O'],['traffic','/p#/traffic','!!document.querySelector(".h1")'],['calendar','/p#/calendar','!!document.querySelector(".cal-g")'],['archive','/p#/archive','!!document.querySelector(".h1")'],['system','/p#/system','!!document.querySelector(".system-accounts")']]) {
      await send('Page.navigate',{url:base+route},sessionId);await wait(ready);await delay(1300);await capture(width,page);
      if(stage==='after'&&page==='home') {
        await js('document.querySelector(".nav-publish").click()');
        await wait('!!document.querySelector(".prep-composer")');
        assert.equal(await js('document.querySelector(".nav-publish").getAttribute("aria-current")'),'page');
        assert.equal(await js('document.querySelectorAll("[name=target]:checked").length'),0);
        await capture(width,'publish-source');
        await js(`(()=>{const f=document.querySelector('#prep-form');f.elements.sourceTitle.value='一稿多发预览';f.elements.sourceContent.value='这是通用原稿。';f.querySelector('[name=target][value=x]').click();})()`);
        assert.equal(await js('document.querySelector("#prep-preview-content").innerText'),'这是通用原稿。');
        await capture(width,'publish-x');
        await js(`(()=>{const f=document.querySelector('#prep-form');f.querySelector('[name=target][value=xhs]').click();const files=new DataTransfer();files.items.add(new File([Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR0sAAAAASUVORK5CYII='),c=>c.charCodeAt(0))],'preview.png',{type:'image/png'}));const input=f.querySelector('#prep-files-xhs');input.files=files.files;input.dispatchEvent(new Event('change',{bubbles:true}));const text=f.querySelector('[data-edition=xhs] [data-draft-content]');text.value='这是小红书单独编辑的文案。';text.dispatchEvent(new Event('input',{bubbles:true}));})()`);
        assert.ok(await js('document.querySelector("[data-edition=xhs] [data-media-limit]").innerText.includes("第一张为首图") && document.querySelectorAll("[data-edition=xhs] .prep-thumbnails img").length===1'));
        assert.equal(await js('document.querySelector("#prep-preview-content").innerText'),'这是小红书单独编辑的文案。');
        await capture(width,'publish-xhs');
        await js(`(()=>{const f=document.querySelector('#prep-form');f.querySelector('[name=target][value=wechat]').click();const caption=f.querySelector('[data-draft-caption]');caption.value='文章摘要预览';caption.dispatchEvent(new Event('input',{bubbles:true}));})()`);
        assert.equal(await js('document.querySelector("#prep-preview-extra").innerText'),'文章摘要预览');
        assert.ok(await js('document.querySelector("[data-edition=xhs]").hidden && !document.querySelector("[data-edition=wechat]").hidden && document.querySelectorAll("[name=target]:checked").length===3'));
        assert.equal(await js('document.querySelector("#prep-preview-content").innerText'),'这是通用原稿。');
        await capture(width,'publish-wechat');
        await js('document.querySelector("[data-prep-edition=xhs]").click()');
        assert.equal(await js('document.querySelector("#prep-preview-content").innerText'),'这是小红书单独编辑的文案。');
        await js('document.querySelector("[data-edition=xhs] [data-use-source]").click()');
        assert.equal(await js('document.querySelector("#prep-preview-content").innerText'),'这是通用原稿。');
        await js('document.querySelector("[data-prep-edition=wechat]").click()');
        if(width===390) {
          await js('document.querySelector("[data-prep-preview]").click()');
          assert.equal(await js('document.activeElement.classList.contains("prep-preview")'),true);
          await capture(width,'publish-preview');
        }
        await js('document.querySelector("[data-prep-history]").click()');
        assert.equal(await js('document.activeElement.id'),'prep-history');
        if (await js('!!document.querySelector(".prep-record-origin")')) {
          await js('document.querySelector("#prep-history").scrollIntoView({block:"start"})');
          await capture(width,'publish-project-records');
        }
        await send('Page.navigate',{url:base+'/'},sessionId);await wait('!!document.querySelector("[data-platform-management]")');
        assert.equal(await js('document.querySelectorAll(".platform-option, [data-platform-toggle]").length'),0);
        assert.equal(await js('document.querySelector("[data-platform-management]").getAttribute("href")'),'/p#/system/platforms');
        await js('document.querySelector("[data-platform-management]").click()');
        await wait('!!document.querySelector("#all-platforms") && document.querySelectorAll(".platform-option").length===8');
        assert.ok(await js('document.querySelector("#all-platforms").getBoundingClientRect().top < innerHeight'));
        await capture(width,'platform-management-entry');
      }
      if(stage==='after'&&page==='system') {
        assert.equal(await js('document.querySelectorAll(".platform-option").length'),8);
        assert.equal(await js('[...document.querySelectorAll(".platform-option")].some(e=>!!e.closest("details"))'),false);
      }
      if(stage==='after'&&page==='archive') {
        assert.equal(await js('document.querySelectorAll(".work-row").length'),20);
        assert.equal(await js('!!document.querySelector(".poster .im")'),false);
        await js('document.querySelector("#work-search").value="Codex"; document.querySelector("#work-filter").requestSubmit()');
        await wait('document.querySelector(".work-count").innerText.includes("筛选")');
        assert.ok(await js('[...document.querySelectorAll(".work-row h3")].every(e=>e.innerText.toLowerCase().includes("codex"))'));
        await capture(width,'archive-search');
        await js('document.querySelector("#work-filter").reset()');await wait('document.querySelectorAll(".work-row").length===20');
        await js('document.querySelector("#work-platform").value="xhs";document.querySelector("#work-filter").requestSubmit()');await wait('libraryPlatform==="xhs"');
        assert.ok(await js('[...document.querySelectorAll(".work-row .work-title p")].every(p=>p.innerText.includes("小红书"))'));
        await js('document.querySelector("#work-search").value="__no_matching_work_qa__";document.querySelector("#work-filter").requestSubmit()');await wait('!!document.querySelector(".work-empty")');
        assert.equal(await js('document.querySelectorAll(".work-row").length'),0);
        await js('document.querySelector("#work-filter").reset()');await wait('document.querySelectorAll(".work-row").length===20');
        const first=await js('document.querySelector(".work-row").getAttribute("href")');
        await js('document.querySelector(".work-pagination button:last-child").click()');await wait('libraryPage===1');
        assert.notEqual(await js('document.querySelector(".work-row").getAttribute("href")'),first);
        await js('document.querySelector(".work-row").click()');await wait('!!document.querySelector(".ephero")');await capture(width,'work-detail');
      }
      if(stage==='after'&&page==='calendar') {
        const label=await js('document.querySelector(".calendar-tools strong").innerText');
        await js('document.querySelector(".calendar-tools button:first-child").click()');await wait('calendarOffset===-1');
        assert.notEqual(await js('document.querySelector(".calendar-tools strong").innerText'),label);
        await js('document.querySelector("[data-calendar-reset]").click()');await wait('calendarOffset===0');
        assert.equal(await js('document.querySelector(".calendar-tools strong").innerText'),label);
      }
      if(interactive&&page==='system') {
        await js('document.querySelector("[data-platform-toggle=bilibili]").click()');await wait('PL.includes("bilibili")');
        await js('location.reload()');await wait('PL.includes("bilibili") && !!document.querySelector("[data-system-platform=bilibili]")');
        const hasForm=await js('!!document.querySelector("[data-platform-account=bilibili]")');
        if(hasForm){await js('(()=>{const f=document.querySelector("[data-platform-account=bilibili]");f.elements.account.value="FixtureBili";f.requestSubmit()})()');await wait('document.querySelector("[data-system-platform=bilibili]").innerText.includes("FixtureBili")');}
        await capture(width,'bilibili-enabled');
        await js('document.querySelector("[data-system-platform=bilibili]").querySelectorAll("[data-act]")[1].click()');await wait('document.body.innerText.includes("隔离验收阻止真实平台动作")');
        assert.equal(await js('pendingAction===null'),true);
        await js('(()=>{const f=document.querySelector("[data-native-work=bilibili]");f.closest("details").open=true;f.elements.title.value="FixtureBili registered work";f.elements.url.value="https://www.bilibili.com/video/BV1234567890";f.elements.publishedAt.value=new Date(Date.now()-3600000+8*3600000).toISOString().slice(0,16);f.requestSubmit()})()');
        await wait('O.episodes.some(e=>e.id==="external:bilibili:BV1234567890")');
        await js('document.querySelector("[data-platform-toggle=bilibili]").click()');await wait('!PL.includes("bilibili")');
        assert.equal(await js('document.querySelectorAll(".platform-option").length'),8);
      }
      if(stage==='after'&&!interactive&&page==='system') {
        await send('Page.navigate',{url:base+'/p#/system/bilibili'},sessionId);await wait('!!document.querySelector("#platform-bilibili")');
        assert.equal(await js('!!document.querySelector("[data-system-platform=bilibili] [data-act]")'),true);
        await capture(width,'bilibili-entry');
      }
    }
  }
  if(stage==='after')for(const width of [1100,1101]) {
    await send('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false},sessionId);
    await send('Page.navigate',{url:base+'/p#/system'},sessionId);await wait('!!document.querySelector(".system-accounts")');await capture(width,'system-breakpoint');
  }
  if(prefill)assert.ok(mutations.filter(p=>p==='/api/video-prefill/reserve').length===2&&mutations.filter(p=>p==='/fixture/video-worker').length===2&&mutations.filter(p=>p==='/api/video-prefill/publication').length===2&&mutations.every(p=>['/api/video-prefill/reserve','/api/video-prefill/receipt','/api/video-prefill/publication','/fixture/video-worker'].includes(p)),JSON.stringify(mutations));
  else if(interactive)assert.ok(mutations.every(p=>['/api/platforms','/api/native-work','/api/action'].includes(p)));else assert.deepEqual(mutations,[],'UI acceptance sends no mutation requests');
  await send('Browser.close');await exited;fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({ok:true,stage,scope:prefill?'isolated app; new empty Chrome profile; extension mocked; local receipt persisted':interactive?'isolated app; new empty Chrome profile; selection/registration exercised; platform actions mocked':'real app; new empty Chrome profile; local GET only; no platform actions',results},null,2));console.log(JSON.stringify({ok:true,stage,captures:results.length}));
}finally{ws?.close();if(child.exitCode===null)child.kill();}
