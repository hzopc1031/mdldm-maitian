// Focused first-party rendering checks. Fresh headless profile; never platform input.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {once,EventEmitter} from 'node:events';
import {registerHooks} from 'node:module';
const formal=process.argv.includes('--formal'),out=path.resolve(process.env.MAITIAN_QA_OUT || '_local-webpub-evidence');
fs.mkdirSync(out,{recursive:true});
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'maitian-webpub-'));
let handle,db,key,report,scene;const commands=[],violations=[];
if(formal) key=JSON.parse(fs.readFileSync(process.env.MAITIAN_CONFIG || 'config.json','utf8')).web.key;
else {
  process.env.MAITIAN_HOME=temp;process.env.MAITIAN_DB=path.join(temp,'hub.db');process.env.MAITIAN_CONFIG=path.join(temp,'config.json');
  key='public-isolated-render-fixture';fs.writeFileSync(process.env.MAITIAN_CONFIG,JSON.stringify({web:{key}}));
  globalThis.__prepRenderSpawn=(binary,args,options)=>{
    commands.push(args);const c=new EventEmitter();c.stdout=new EventEmitter();c.stderr=new EventEmitter();
    const receipt = args[1] === 'preflight' ? {ok:true,offlineOnly:true}
      : args[1] === 'check' ? {ok:true,offline:true}
      : args.includes('--keep-browser') ? {ok:true,submitted:false,dryRun:true}
      : {ok:true,submitted:false,savedAsDraft:true};
    queueMicrotask(()=>{c.stdout.emit('data',JSON.stringify(receipt));c.emit('close',0);});
    return c;
  };
  registerHooks({resolve(s,c,n){return s==='node:child_process'?{url:'mock:prep-render',shortCircuit:true}:n(s,c);},load(u,c,n){return u==='mock:prep-render'?{format:'module',shortCircuit:true,source:'export const spawn=globalThis.__prepRenderSpawn;export function execFileSync(){throw Error("forbidden");}'}:n(u,c);}});
  await import('../src/l1-store.mjs');({db}=await import('../src/db.mjs'));({handle}=await import('../src/web.mjs'));
}
function checks(){return `<script>(${async function(scene,formal){
  const check=(v,m)=>{if(!v)throw Error(m);},wait=async f=>{for(let i=0;i<160;i++){if(await f())return;await new Promise(r=>setTimeout(r,100));}throw Error('render wait');};
  const data=async()=>await(await fetch('/api/prep')).json();window.confirm=()=>true;
  try{
    await wait(()=>document.querySelector('#prep-form'));check(!document.querySelector('input[type=password]'),'no credential form');
    const form=document.querySelector('#prep-form');check(!!document.querySelector('#prep-files-xhs'),'image picker');
    if(scene==='prepare-page'){
      form.elements.sourceTitle.value='网页准备任务显式填写上传小红书';form.elements.sourceContent.value='选图、审阅后生成准备任务，再显式点击填写上传。';form.querySelector('[name=target][value=xhs]').click();
      check(form.querySelector('button[type=submit]').disabled===false,'create enabled');
      check(document.body.innerText.includes('保存本地草稿'),'create button');
    }else if(formal){
      const d=await data(),r=d.records.find(r=>r.id==='01d27475-7146-4b2d-8ae6-0a022b45c88e');
      check(r?.state==='awaiting_user'&&r.readOnlyReceipt===true&&r.evidence.submitted===false,'historical real receipt');
      const row=document.querySelector('[data-prep-record="'+r.id+'"]');check(row.innerText.includes('隔离库历史真实上传'),'provenance visible');check(row.innerText.includes('已填待手动发布'),'status rendered');
      const button=row.querySelector('[data-prep=window]');check(button&&!button.disabled,'window button');button.click();
      await wait(async()=>{const q=(await data()).records.find(q=>q.id===r.id);return q.windowEvidence?.activated===true;});
      await wait(()=>document.querySelector('[data-prep-record="'+r.id+'"]').innerText.includes('留窗已核实'));
      document.querySelector('[data-prep-record="'+r.id+'"]').scrollIntoView();
    }else{
      form.elements.sourceTitle.value='一份原稿，三个平台';
      form.elements.sourceContent.value='隔离模拟素材，不连接平台。';
      for(const target of form.querySelectorAll('[name=target]'))target.click();
      const article=form.querySelector('[data-edition=wechat] [data-draft-content]');
      article.value='公众号独立正文（测试稿）';article.dispatchEvent(new Event('input',{bubbles:true}));
      const bytes=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6WQAAAABJRU5ErkJggg=='),c=>c.charCodeAt(0));
      const transfer=new DataTransfer();transfer.items.add(new File([bytes],'fixture.png',{type:'image/png'}));const picker=document.querySelector('#prep-files-xhs');picker.files=transfer.files;picker.dispatchEvent(new Event('change',{bubbles:true}));
      const card=document.querySelector('[data-image-review]');check(card.querySelector('img').src.startsWith('blob:'),'preview');card.querySelector('[name=reviewer]').value='隔离夹具';card.querySelector('[name=rationale]').value='单像素测试夹具，无文字';card.querySelector('[name=visualChecked]').checked=true;
      form.requestSubmit();await wait(()=>document.querySelectorAll('[data-prep-record]').length===3);
      const drafts=(await data()).records;
      check(drafts.length===3&&drafts.every(r=>r.state==='prepared'),'one local draft per selected platform; no implicit execution');
      const row=id=>document.querySelector(`[data-prep-record="${id}"]`);
      const x=drafts.find(r=>r.platform==='x');
      const bundle=await fetch(row(x.id).querySelector('a[href^="/api/prep/bundle"]').href);
      check(bundle.ok&&new DataView(await bundle.arrayBuffer()).getUint32(0,true)===0x04034b50,'downloadable X bundle');
      for(const [platform,state,label] of [['xhs','awaiting_user','已填待手动发布'],['wechat','draft_saved','已保存公众号草稿']]) {
        const {id}=drafts.find(r=>r.platform===platform);
        row(id).querySelector('[data-prep=check]').click();
        await wait(()=>row(id).querySelector('[data-prep=execute]')?.disabled===false);
        row(id).querySelector('[data-prep=execute]').click();
        await wait(()=>row(id).innerText.includes(label) && row(id).querySelector('[data-prep=execute]').disabled);
        const current=(await data()).records.find(r=>r.id===id);
        check(current.state===state&&current.evidence.submitted===false,`${platform} receipt matches and was not published`);
        const retry=await fetch('/api/prep',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'execute',id})});
        check(retry.ok,'idempotent retry');
      }
      await render();
      check(drafts.filter(d=>d.platform!=='x').every(d=>row(d.id).querySelector('[data-prep=execute]').disabled),'repeat disabled after rerender');
      document.querySelector('#prep-history').scrollIntoView();
    }
    await fetch('/__qa/report',{method:'POST',body:JSON.stringify({ok:true,scene,formal})});
  }catch(e){await fetch('/__qa/report',{method:'POST',body:JSON.stringify({ok:false,scene,detail:e.message})});}
}.toString()})(${JSON.stringify(scene)},${formal});</script>`;}
const server=http.createServer(async(req,res)=>{
  if(req.url==='/__qa/report'){let b='';for await(const c of req)b+=c;report=JSON.parse(b);res.end('ok');return;}
  const u=new URL(req.url,'http://localhost');
  if(!['/p','/api/prep','/api/prep/image','/api/prep/bundle','/api/overview','/manifest.webmanifest','/site-logo'].includes(u.pathname)&&!u.pathname.startsWith('/static/')){violations.push(req.method+' '+u.pathname);res.writeHead(403);res.end();return;}
  if(formal){
    let body='';if(req.method==='POST'){for await(const c of req)body+=c;if(u.pathname!=='/api/prep'||JSON.parse(body).type!=='window'){violations.push('forbidden formal write');res.writeHead(403);res.end();return;}}
    const response=await fetch('http://127.0.0.1:8787'+req.url,{method:req.method,headers:{'x-maitian-key':key,...(body?{'content-type':'application/json'}:{})},...(body?{body}:{})});
    let bytes=Buffer.from(await response.arrayBuffer());if(response.headers.get('content-type')?.startsWith('text/html'))bytes=Buffer.from(bytes.toString().replace('</body>',checks()+'</body>'));
    res.writeHead(response.status,{'content-type':response.headers.get('content-type')||'text/plain','cache-control':'no-store'});res.end(bytes);return;
  }
  req.headers['x-maitian-key']=key;
  const end=res.end.bind(res);res.end=(b,...args)=>end((typeof b==='string'||Buffer.isBuffer(b))&&String(b).startsWith('<!doctype html')?String(b).replace('</body>',checks()+'</body>'):b,...args);
  try{await handle(req,res);}catch{res.writeHead(500);res.end('handler failure');}
});
server.listen(0,'127.0.0.1');await once(server,'listening');
const results=[];
try{
  for(scene of ['prepare-page',formal?'xhs-prep-status':'isolated-flow']){
    report=null;const shot=path.join(out,scene+'.png');
    const child=spawn(process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--incognito','--no-first-run','--no-default-browser-check','--disable-extensions','--disable-background-networking','--window-size=1440,'+(scene==='prepare-page'?2200:1000),'--user-data-dir='+path.join(temp,scene),'--screenshot='+shot,'--dump-dom','--timeout=24000','--virtual-time-budget=18000','http://127.0.0.1:'+server.address().port+'/p#/prepare'],{windowsHide:true,stdio:['ignore','pipe','pipe']});
    child.stdout.resume();child.stderr.resume();const timer=setTimeout(()=>child.kill(),35000);const [code]=await once(child,'close');clearTimeout(timer);
    results.push({scene,ok:code===0&&report?.ok===true&&fs.existsSync(shot),report,screenshot:shot});
  }
  if(!formal&&!(commands.map(a=>a[1]).join(',')==='preflight,post,check,post'&&commands[1].includes('--keep-browser')&&commands.slice(0,2).every(a=>a.includes('ai'))&&commands.slice(2).every(a=>!a.includes('--account')&&!a.includes('--keep-browser'))&&commands.every(a=>!a.includes('--submit'))))throw Error('fixed command / idempotence failed');
  if(violations.length)throw Error('unexpected routes');
}catch(e){results.push({ok:false,detail:e.message});}
finally{await new Promise(r=>server.close(r));db?.close();key=null;}
const evidence={mode:formal?'formal 8787 rendered via restricted local proxy; only verified window activation permitted':'isolated real renderer/HTTP/SQLite with mocked skill processes; no platform write',results,commands:formal?undefined:commands.map(a=>a.filter((v,i)=>i!==0&&i!==3)),violations};
fs.writeFileSync(path.join(out,formal?'formal-render.json':'isolated-render.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));process.exitCode=results.some(r=>!r.ok)?1:0;
