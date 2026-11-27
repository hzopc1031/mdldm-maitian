// Prepare the audited upstream publisher, with a loopback workbench entry in --workbench mode.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {parseArgs} from 'node:util';
import {fileURLToPath} from 'node:url';
import {creatorIdentityModule} from '../src/publisher-identity.mjs';
import {nativeVisibleIdentity} from '../src/l1-native.mjs';
import {visibleXIdentity} from '../src/l1-x-dom.mjs';
import {visibleIdentity as visibleXhsIdentity} from '../src/l1-xhs-dom.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
const {values}=parseArgs({options:{workbench:{type:'boolean'},'plugin-dir':{type:'string'}}});
const workbench=values.workbench;
const supported=['bilibili','xhs','douyin','channels','youtube','x','instagram'];
const platforms=workbench?supported:['bilibili'];
const pluginDir=values['plugin-dir']||process.env.MAITIAN_PUBLISHER_DIR;
const upstream=pluginDir?path.resolve(pluginDir):path.resolve(here,'../../related/maitian-publisher');
const manifest=JSON.parse(fs.readFileSync(path.join(upstream,'manifest.json'),'utf8'));
if(manifest.version!=='0.4.0' || manifest.background?.service_worker!=='background.js'){
  throw new Error('该验收适配仅针对已核对的发布助手 0.4.0');
}

const stage=fs.mkdtempSync(path.join(os.tmpdir(),'maitian-bilibili-prefill-'));
const asset=rel=>path.join(stage,rel);
for(const file of [...(workbench?[]:['background.js','video.js']),'sidepanel.css','LICENSE','icons','lib']){
  fs.cpSync(path.join(upstream,file),asset(file),{recursive:true,errorOnExist:true,force:false});
}
const read=rel=>fs.readFileSync(asset(rel),'utf8').replace(/\r\n/g,'\n');
const write=(rel,value)=>fs.writeFileSync(asset(rel),value,'utf8');
function replace(source,anchor,insertion){
  if(source.split(anchor).length!==2)throw new Error('上游源码已变更，请先核对相应入口');
  return source.replace(anchor,()=>insertion);
}

const name=workbench?'麦田视频预填助手':'麦田 B站预填验收';
write('manifest.json',JSON.stringify({...manifest,name,
  ...(workbench?{version:'0.4.1',permissions:manifest.permissions.filter(permission=>permission!=='notifications')}:{}),
  description:workbench?'从麦田准备视频、封面和各平台文案':'在独立窗口验收 B站视频、封面和文案预填',
  host_permissions:workbench?[...manifest.host_permissions.filter(host=>host.startsWith('https:')),'http://127.0.0.1/*']:['https://member.bilibili.com/*'],
  ...(workbench?{content_scripts:[{matches:['http://127.0.0.1/*'],js:['workbench-content.js'],run_at:'document_start'}]}:{}),
  action:{default_title:name},
},null,2)+'\n');

if(workbench){
  write('sidepanel.html',`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${name}</title>
  <link rel="stylesheet" href="sidepanel.css"></head><body><header><h1>${name}</h1>
  <p class="sub">在麦田选择视频工程并核对目标账号。任务进度和回执保存在麦田。</p></header>
  <main><p><a href="http://127.0.0.1:8787/p#/prepare?format=video" target="_blank" rel="noopener noreferrer">打开麦田视频准备</a></p></main></body></html>`);
}else{
  const original=fs.readFileSync(path.join(upstream,'sidepanel.html'),'utf8');
  const videoMain=original.match(/<main id="view-video">[\s\S]*?<\/main>/)?.[0];
  if(!videoMain)throw new Error('未找到上游视频侧边栏');
  write('sidepanel.html',`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${name}</title>
  <link rel="stylesheet" href="sidepanel.css"></head><body><header><h1>${name}</h1>
  <p class="sub">核对成片、封面和文案，完成后在平台确认。</p></header>
  ${videoMain.replace('NAS 发布目录','视频工程目录').replace('一键填写所选平台','预填创作页').replace('id="btnLinks" class="ghost"','id="btnLinks" class="hidden"')}
  <script type="module" src="sidepanel.js"></script></body></html>`);
  write('sidepanel.js',"import {initVideo} from './video.js';\ninitVideo().catch(error=>{document.getElementById('statusList').textContent=error.message;});\n");

  let video=read('video.js');
  video=replace(video,"import { PLATFORMS } from './lib/bundle.js';","import { PLATFORMS } from './lib/bundle.js';\nimport {validPublisherRoot} from './lib/media-path.js';");
  video=replace(video,"const DEFAULT_PATH = '/Volumes/sata11-176XXXX6901/视频导出';","const DEFAULT_PATH = '';");
  video=replace(video,"if (!rootPath.startsWith('/')) { alert('请先填 NAS 目录在本机的绝对路径'); return; }","if (!validPublisherRoot(rootPath)) { alert('请填写所选工程目录的本机绝对路径'); return; }");
  video=video.replaceAll("mode: 'readwrite'","mode: 'read'");
  const developerApi=video.indexOf('  // 开发接口（仅供本机开发桥接调用）');
  if(developerApi<0)throw new Error('未找到上游开发接口边界');
  write('video.js',video.slice(0,developerApi)+'}\n');
}
fs.copyFileSync(path.resolve(here,'../src/publisher-media-path.mjs'),asset('lib/media-path.js'));

let publisher=read('lib/publish.js');
publisher=replace(publisher,"import { bjTime } from './platforms/common.js';","import { bjTime } from './platforms/common.js';\nimport {publisherMediaPath} from './media-path.js';");
for(const platform of supported.filter(platform=>!platforms.includes(platform))){
  publisher=replace(publisher,`import ${platform} from './platforms/${platform}.js';`,'');
}
publisher=replace(publisher,"import { adapters as extraAdapters } from './platforms/extra.js';",'');
publisher=replace(publisher,"export const ADAPTERS = { bilibili, xhs, douyin, channels, youtube, x, instagram, ...extraAdapters };",`export const ADAPTERS = { ${platforms.join(', ')} };`);
publisher=replace(publisher,"export const ORDER = ['bilibili', 'xhs', 'douyin', 'channels', 'youtube', 'x', 'instagram', ...Object.keys(extraAdapters)];",`export const ORDER = ${JSON.stringify(platforms)};`);
publisher=replace(publisher,"  const abs = (rel) => `${opts.rootPath.replace(/\\/$/, '')}/${project.dir}/${rel}`;","  const abs = rel => publisherMediaPath(opts.rootPath,project.dir,rel);");
write('lib/publish.js',publisher);

if(!workbench){
let worker=read('background.js');
worker=replace(worker,"import { run, preflight, collectLinks } from './lib/publish.js';",`import { run, preflight, ORDER } from './lib/publish.js';
import {publisherMediaPath} from './lib/media-path.js';`);
worker=replace(worker,"async function start({ project, rootPath, platforms, windowId }) {",`async function start({ project, rootPath, platforms, windowId, requestId }) {
  if (!Array.isArray(platforms)||!platforms.length||platforms.some(id=>!ORDER.includes(id)||!project?.data?.platforms?.[id]||project.data.platforms[id].skip)||
      project.data.schedule) throw new Error('请选择支持的无定时视频稿');
  publisherMediaPath(rootPath,project.dir,project.data.video);
  for(const id of platforms){
    const draft=project.data.platforms[id];
    if(draft.mode)throw new Error('此入口只接受普通视频稿');
    if(draft.video)publisherMediaPath(rootPath,project.dir,draft.video);
    for(const cover of draft.covers??[])publisherMediaPath(rootPath,project.dir,project.data.covers?.[cover]);
  }`);
worker=replace(worker,"  if (msg.type === 'publish:check') {",`  if (msg.type === 'publish:check') {
    if (!Array.isArray(msg.platforms)||!msg.platforms.length||msg.platforms.some(id=>!ORDER.includes(id))) {reply({ok:false,error:'平台不受支持'});return;}`);
const linkRoute=worker.indexOf("  if (msg.type === 'publish:links') {");
const stopRoute=worker.indexOf("  if (msg.type === 'publish:stop') {");
if (linkRoute<0 || stopRoute<linkRoute) throw new Error('未找到上游回填入口');
worker=worker.slice(0,linkRoute)+"  if (msg.type === 'publish:links') { reply({ok:false,error:'验收只覆盖预填'}); return; }\n"+worker.slice(stopRoute);
write('background.js',worker);
}
if(workbench){
  publisher=replace(publisher,"import {publisherMediaPath} from './media-path.js';","import {publisherMediaPath} from './media-path.js';\nimport {verifyCreator} from './creator-identity.js';");
  publisher=replace(publisher,"    if (opts.shouldStop()) { st.set('已停止'); continue; }",`    if (opts.shouldStop()) { st.set('已停止'); continue; }
    if (opts.accounts) {
      let confirmed=false;
      for(let i=0;i<3&&!confirmed;i++){
        confirmed=await verifyCreator(evaluate,pre[id].tabId,id,opts.accounts[id]).catch(()=>false);
        if(!confirmed&&i<2)await sleep(700);
      }
      if(!confirmed) {
        st.tabId=pre[id].tabId;
        st.fail('创作页可见身份不唯一、未显示或与麦田设定不符');
        st.set('账号待确认');
        continue;
      }
    }`);
  write('lib/publish.js',publisher);
  write('lib/creator-identity.js',creatorIdentityModule({x:visibleXIdentity,xhs:visibleXhsIdentity,native:nativeVisibleIdentity}));
  fs.copyFileSync(path.resolve(here,'../src/publisher-workbench-worker.js'),asset('background.js'));
  fs.copyFileSync(path.resolve(here,'../src/publisher-workbench-content.js'),asset('workbench-content.js'));
}

let adapter=read('lib/platforms/bilibili.js');
adapter=replace(adapter,"return ed.innerText.length})()", "return q.getText()})()");
adapter=replace(adapter,"else ctx.log(`简介：${p.desc.length} 字`);",`else if (desc.trim() !== p.desc.trim()) ctx.fail('简介读回与工程不一致');
    else ctx.log(\`简介：\${p.desc.length} 字已读回\`);`);
write('lib/platforms/bilibili.js',adapter);
console.log(JSON.stringify({ready:true,directory:stage,sourceVersion:manifest.version,platforms,browserStarted:false}));
