import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {runInNewContext} from 'node:vm';
import {matchesCreator} from '../src/publisher-identity.mjs';

const bundle=path.resolve(process.argv[2]||'.');
const manifest=JSON.parse(fs.readFileSync(path.join(bundle,'manifest.json'),'utf8'));
assert.equal(manifest.name,'麦田视频预填助手');
assert.deepEqual(manifest.content_scripts[0].matches,['http://127.0.0.1/*']);
const platforms=['bilibili','xhs','douyin','channels','youtube','x','instagram'];
const accounts=Object.fromEntries(platforms.map(id=>[id,'Fixture']));
const isolated=fs.mkdtempSync(path.join(os.tmpdir(),'maitian-workbench-bridge-'));
fs.mkdirSync(path.join(isolated,'lib'));
fs.writeFileSync(path.join(isolated,'package.json'),'{"type":"module"}');
for(const file of ['background.js','lib/media-path.js'])fs.copyFileSync(path.join(bundle,file),path.join(isolated,file));
fs.writeFileSync(path.join(isolated,'lib/publish.js'),`
  export const ORDER=${JSON.stringify(platforms)};
  export const executed=[];
  export function preflight(){}
  export async function run(project,opts){
    if(project.data.schedule)throw new Error('Fixture must never receive a scheduled draft');
    executed.push({platforms:opts.platforms,accounts:opts.accounts});
    for(const id of opts.platforms)opts.onChange({id,status:'待你发布',logs:[]});
  }
`);
let handler;
let saved;
const requests=[];
globalThis.fetch=async(url,options)=>{
  assert.equal(url,'http://127.0.0.1:8787/api/video-prefill/worker');
  const input=JSON.parse(options.body);requests.push(input);
  return new Response(JSON.stringify(input.action==='claim'?{accounts}:{}),{status:200});
};
globalThis.chrome={sidePanel:{setPanelBehavior:async()=>{}},action:{setBadgeText(){},setBadgeBackgroundColor(){}},
  storage:{local:{set:async values=>{saved=structuredClone(values);},get:async()=>saved??{}}},
  runtime:{sendMessage:async()=>{},onMessage:{addListener:fn=>{handler=fn;}}},
  notifications:{onClicked:{addListener(){}},create(){}}};
await import(pathToFileURL(path.join(isolated,'background.js')).href);
const call=(msg,url='http://127.0.0.1:8787/p')=>new Promise(resolve=>handler(msg,{url,tab:{windowId:1}},resolve));
const requestId='00000000-1000-4000-8000-000000000001';
const lease='10000000-1000-4000-8000-000000000002';
const project={version:1,name:'预填离线验收',video:'成片.mp4',covers:{'4x3':'封面/cover-4x3.png'},
  platforms:Object.fromEntries(platforms.map(id=>[id,{covers:['4x3']}]))};
const msg={type:'workbench:prefill',action:'start',payload:{requestId,lease,rootPath:'D:/视频工程',data:project}};
assert.equal((await call(msg,'https://example.com')).ok,false);
assert.equal((await call({...msg,payload:{...msg.payload,data:{...project,schedule:new Date().toISOString()}}})).ok,false);
assert.equal((await call({...msg,payload:{...msg.payload,data:{...project,video:'../别处.mp4'}}})).ok,false);
assert.equal((await call(msg)).ok,true);
await new Promise(resolve=>setImmediate(resolve));
assert.equal((await call(msg)).ok,true);
const job=(await call({type:'workbench:prefill',action:'status'})).job;
assert.equal(job.requestId,requestId);
assert.equal(job.running,false);
assert.deepEqual(job.states.map(item=>item.id),platforms);
const {executed}=await import(pathToFileURL(path.join(isolated,'lib/publish.js')).href);
assert.deepEqual(executed,[{platforms,accounts}]);
assert.equal(requests.filter(input=>input.action==='claim').length,1);
assert(requests.some(input=>input.action==='receipt'&&input.running===false&&input.states.length===7));

const worker=pathToFileURL(path.join(isolated,'background.js')).href;
await import(worker+'?restart=completed');
assert.equal((await call({type:'workbench:prefill',action:'status'})).job.running,false);
assert.equal((await call(msg)).job.requestId,requestId);
saved.workbenchPrefill.running=true;
await import(worker+'?restart=interrupted');
const recovered=(await call({type:'workbench:prefill',action:'status'})).job;
assert.equal(recovered.running,false);
assert.equal(recovered.interrupted,true);
assert.equal(recovered.revision,job.revision+1);
assert.equal(requests.filter(input=>input.action==='claim').length,1);
assert(matchesCreator('x',{url:'https://x.com/compose/post',handle:'Fixture'},'@fixture'));
assert(!matchesCreator('x',{url:'https://x.com.example.test/compose/post',handle:'Fixture'},'Fixture'));
assert(matchesCreator('bilibili',{url:'https://member.bilibili.com/platform/upload/',names:['Fixture']},'Fixture'));
assert(!matchesCreator('bilibili',{url:'https://member.bilibili.com/platform/upload/',names:['Fixture','Other']},'Fixture'));
assert(!matchesCreator('xhs',{url:'https://creator.xiaohongshu.com/',nickname:'Other'},'Fixture'));

const replies=[];
let relay;
const fakeWindow={addEventListener:(type,fn)=>{if(type==='message')relay=fn;},postMessage:(response,origin)=>replies.push({response,origin})};
const origin='http://127.0.0.1:8787';
runInNewContext(fs.readFileSync(path.join(bundle,'workbench-content.js'),'utf8'),{
  location:{origin},window:fakeWindow,chrome:{runtime:{sendMessage:message=>call(message)}},
});
await relay({source:fakeWindow,origin,data:{channel:'maitian.video.prefill.v1',direction:'request',id:'test',action:'status'}});
assert.equal(replies[0].response.result.job.requestId,requestId);
assert.equal(replies[0].origin,origin);
await relay({source:fakeWindow,origin:'http://127.0.0.1:8788',data:{channel:'maitian.video.prefill.v1',direction:'request',id:'test',action:'status'}});
assert.equal(replies.length,1);
console.log('VIDEO BRIDGE PASS: seven routes, exact identity, loopback/path guards, no schedules, duplicate reservation and persisted worker recovery.');
