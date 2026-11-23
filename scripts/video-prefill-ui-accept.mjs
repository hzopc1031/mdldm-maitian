import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';

const folder=fs.mkdtempSync(path.join(os.tmpdir(),'maitian-prefill-ui-'));
process.env.MAITIAN_HOME=folder;
process.env.MAITIAN_DB=path.join(folder,'hub.db');
process.env.MAITIAN_CONFIG=path.join(folder,'config.json');
fs.writeFileSync(process.env.MAITIAN_CONFIG,JSON.stringify({web:{requireLocalToken:false},publishPrep:{browserExecution:false},
  l1:{x:{browserExecution:false},xhs:{browserExecution:false},wechat:{browserExecution:false},
    bilibili:{account:'FixtureBili'},youtube:{account:'FixtureYT'}}}));
const {db,saveObservation,transaction}=await import('../src/l1-store.mjs');
const {handle}=await import('../src/web.mjs');
const extension='chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
let works=0;
const server=http.createServer(async(req,res)=>{
  try{
    if(req.url==='/fixture/video-worker'&&req.method==='POST'){
      let body='';for await(const chunk of req)body+=chunk;
      const reply=await fetch(`http://127.0.0.1:${server.address().port}/api/video-prefill/worker`,{method:'POST',
        headers:{origin:extension,'content-type':'application/json'},body});
      if(reply.ok&&JSON.parse(body).action==='claim'){
        const postId=`BV123456789${++works}`,at=new Date().toISOString();
        transaction(()=>saveObservation({platform:'bilibili',account:'FixtureBili',captured_at:at,source:'native/isolated-browser',
          posts:[{id:postId,url:`https://www.bilibili.com/video/${postId}`,text:'离线作品 '+works,created_at:at,views:7,publicationId:postId}]}));
      }
      res.writeHead(reply.status,{'content-type':'application/json'});res.end(await reply.text());return;
    }
    await handle(req,res);
  }catch(error){res.writeHead(500);res.end(error.message);}
});
server.listen(0,'127.0.0.1');await once(server,'listening');
try{
  const base='http://127.0.0.1:'+server.address().port;
  const toggle=origin=>fetch(base+'/api/age-sampling',{method:'POST',headers:{origin,'content-type':'application/json'},body:'{"enabled":true}'});
  assert.equal((await toggle('https://example.com')).status,403);
  assert.equal((await (await toggle(base)).json()).enabled,true);
  assert.equal((await (await fetch(base+'/api/overview')).json()).health.ageSampling.enabled,true);
  const wrongOrigin=await fetch(base+'/api/video-prefill/worker',{method:'POST',headers:{origin:base,'content-type':'application/json'},body:'{}'});
  assert.equal(wrongOrigin.status,403);
  const run=spawn(process.execPath,['scripts/l1-layout-ui-accept.mjs','video'],{windowsHide:true,stdio:'inherit',
    env:{...process.env,MAITIAN_QA_BASE:base,MAITIAN_QA_VIDEO_PREFILL:'1'}});
  const [code]=await once(run,'close');
  assert.equal(code,0,'video UI acceptance');
  const {job}=await (await fetch(base+'/api/video-prefill/receipt')).json();
  assert.deepEqual(job.states.map(s=>s.id),['bilibili','youtube']);
  assert(job.states.every(s=>s.status==='待你发布'&&s.message==='本机验收回执'));
  assert.equal(job.states[0].publication.title,'离线作品 2');
  assert.equal((await (await fetch(base+'/api/video-prefill/history')).json()).jobs.length,2);
  console.log('WORKBENCH UI PASS: auto-sampling control; normal video page, mock extension progress and persisted receipt at two viewport sizes.');
}finally{await new Promise(resolve=>server.close(resolve));db.close();}
