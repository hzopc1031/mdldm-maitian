// Exercise the prepared publisher through its worker using a local CDP fixture.
// No browser, account, outbound fetch or platform operation is used.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const stage=path.resolve(process.argv[2] || '.');
const manifest=JSON.parse(fs.readFileSync(path.join(stage,'manifest.json'),'utf8'));
assert.equal(manifest.name,'麦田 B站预填验收');
assert.deepEqual(manifest.host_permissions,['https://member.bilibili.com/*']);
const fixture=fs.mkdtempSync(path.join(os.tmpdir(),'maitian-prefill-fixture-'));
for(const file of ['lib','background.js'])fs.cpSync(path.join(stage,file),path.join(fixture,file),{recursive:true});
fs.writeFileSync(path.join(fixture,'package.json'),'{"type":"module"}');
fs.writeFileSync(path.join(fixture,'lib/cdp.js'),`
  export const media = {files:[],tags:[],clicks:[]};
  export async function evaluate(tab, expr) {
    if (expr.includes('/扫码登录/')) return false;
    if (expr.includes('上传完成')) return media.files.length === 2;
    if (expr.includes('video-human-type')) return '人工智能';
    if (expr.includes('q.setText(')) {
      media.description = JSON.parse(expr.match(/q\\.setText\\((.*?)\\); return/s)[1]);
      return media.description+'\\n';
    }
    if (expr.includes('请输入稿件标题') && expr.endsWith('.value')) return media.title;
    if (expr.includes('.cover-empty') && expr.includes('offsetParent')) return media.files.length===2;
    if (expr.includes('svg.close')) return 0;
    if (expr.includes('.label-item-v2-content')) return [...media.tags];
    if (expr.includes('getClientRects')) return false;
    return true;
  }
  export async function setFiles(tab, selector, files) {media.files.push(...files);}
  export async function setValue(tab, field, value) {if(field.includes('请输入稿件标题'))media.title=value;}
  export async function insertText(tab, text) {media.tag=text;}
  export async function pressKey(tab, key) {if(key==='Enter')media.tags.push(media.tag);}
  export async function click(tab, label) {media.clicks.push(label);}
  export const byText = label => label;
  export const sleep = async () => {};
  export const waitFor = async () => true;
  export const detach = async () => {};
  export const fire = async () => {};
`);

globalThis.fetch=()=>{throw new Error('isolated fixture must not send requests');};
const platform='https://member.bilibili.com/platform/upload/video/frame';
const tabs=[];
let handler;
globalThis.chrome={
  sidePanel:{setPanelBehavior:async()=>{}},action:{setBadgeText(){},setBadgeBackgroundColor(){}},
  storage:{session:{set:async()=>{},get:async()=>({}),remove:async()=>{}}},
  runtime:{sendMessage:async()=>{},onMessage:{addListener:fn=>{handler=fn;}}},
  notifications:{onClicked:{addListener(){}},create(){}},
  tabs:{
    create:async ({url})=>{assert.equal(url,platform);tabs.push(url);return {id:1};},
    get:async()=>({id:1,url:platform,windowId:1}),query:async()=>[{id:1}],update:async()=>{},
  },
};
await import(pathToFileURL(path.join(fixture,'background.js')).href);
const call=msg=>new Promise(resolve=>handler(msg,{},resolve));
const project={dir:'第 1 期',data:{id:'bili-fixture',name:'离线验收',video:'成片.mp4',durationSec:4,
  covers:{'4x3':'封面/cover-4x3.png'},platforms:{bilibili:{title:'麦田 Windows 预填验收',desc:'离线简介。\n保留下一行。',tags:['AI'],covers:['4x3']}}}};
const args={type:'publish:start',project,rootPath:'D:\\Ai 项目\\视频工程',platforms:['bilibili']};
assert.equal((await call({...args,platforms:['x']})).ok,false);
assert.equal((await call({...args,project:{...project,data:{...project.data,schedule:'2026-11-22T10:00:00+08:00'}}})).ok,false);
assert.equal((await call({type:'publish:links',project,platforms:['bilibili']})).ok,false);
assert.equal(tabs.length,0);
assert.equal((await call(args)).ok,true);
let report;
for(let i=0;i<50;i++) {
  report=await call({type:'publish:get'});
  if(report?.running===false)break;
  await new Promise(resolve=>setTimeout(resolve,10));
}
assert.equal(report.running,false);
assert.equal(report.states[0].status,'待你发布',JSON.stringify(report.states[0]));
const {media}=await import(pathToFileURL(path.join(fixture,'lib/cdp.js')).href);
assert.deepEqual(media.files,[
  'D:\\Ai 项目\\视频工程\\第 1 期\\成片.mp4',
  'D:\\Ai 项目\\视频工程\\第 1 期\\封面\\cover-4x3.png',
]);
assert.equal(media.title,project.data.platforms.bilibili.title);
assert.equal(media.description,project.data.platforms.bilibili.desc);
assert.deepEqual(media.tags,['AI']);
assert.deepEqual(media.clicks,['完成']);
assert.deepEqual(tabs,[platform]);
console.log('BILIBILI PREFILL PASS: worker guard, Windows media paths, video and cover, title and description readback, tags, no final submit. Local CDP fixture.');
