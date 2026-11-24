// 完全离线；模拟数据、临时内存库，无平台或浏览器动作。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {prepStatus,readPrepStatus,STATUS_LABELS,statusLabel} from '../src/prep-status.mjs';
import {preparePage,initPreparePage} from '../src/web/prepare-page.js';
const expected={prepared:'已生成',generated:'已生成',checked:'检查通过',awaiting_user:'已填好待你点',draft_saved:'已存草稿',failed:'失败',check_failed:'失败',unknown:'未知',published:'已发布',submitted:'未知',already_exists:'平台已有同稿',editing:'未生成',idle:'未生成',running:'处理中'};
assert.deepEqual(STATUS_LABELS,expected);assert.equal(statusLabel('new-state'),'未知');
const catalog=Array.from({length:20},(_,i)=>({id:'mock'+i,name:'模拟平台'+i}));
const records=[{id:'linked',platform:'mock0',state:'draft_saved'},{id:'pending',platform:'xhs',state:'awaiting_user',title:'待办'},
 {id:'released',platform:'xhs',state:'awaiting_user',windowReleased:true},{id:'no-click',platform:'mock2',state:'awaiting_user'},
 {id:'old',platform:'wechat',state:'unknown',title:'旧单',error:'旧错误'},
 {id:'bad',platform:'mock1',state:'failed',failureEvidence:{code:'ORIGINAL',message:'token=hidden-message',hint:'Cookie: hidden-cookie',stderrTail:'Authorization: Bearer hidden-bearer\n'+'尾'.repeat(4000),screenshot:'D:/shot.png?ticket=hidden-ticket&token=hidden-token'}},
 {id:'unknown-error',platform:'mock3',state:'alien',error:'secret=hidden-secret'},
 {id:'success',platform:'wechat',state:'published'}];
const post={id:'post',master:{title:'模拟原稿'},createdAt:'2026-11-23T01:00:00Z',generation:{state:'done',platforms:catalog.map(p=>p.id)},editions:Object.fromEntries(catalog.map((p,i)=>[p.id,i===0?{preparationId:'linked'}:{}]))};
const data=prepStatus({catalog,posts:[post],records,config:{l1:{configured:{}}},capabilities:{capability:{}},selected:['mock19']});
assert.equal(data.rows.find(r=>r.id==='post').items.length,20);
assert.equal(data.rows.filter(r=>r.id==='linked').length,0);assert.equal(data.rows.find(r=>r.id==='post').items[0].label,'已存草稿');
assert.equal(data.rows.find(r=>r.id==='post').items[1].label,'已生成');
assert.equal(data.rows.find(r=>r.id==='old').kind,'legacy');
assert.deepEqual(data.pending.map(r=>r.recordId),['pending','released','no-click']);
assert.deepEqual(data.pending.filter(r=>r.canActivate).map(r=>r.recordId),['pending']);
assert.ok(data.platforms.some(p=>p.id==='configured'));assert.ok(data.platforms.some(p=>p.id==='capability'));
assert.equal(data.failures.find(r=>r.recordId==='bad').detail.code,'ORIGINAL');
assert.ok(Buffer.byteLength(data.failures.find(r=>r.recordId==='bad').detail.stderrTail)<=4096);
assert.doesNotMatch(JSON.stringify(data),/hidden-(?:message|cookie|bearer|ticket|token|secret)/);
const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE publish_posts(id TEXT,record TEXT);CREATE TABLE publish_preparations(id TEXT,record TEXT)');
for(let i=0;i<65;i++)db.prepare('INSERT INTO publish_preparations VALUES (?,?)').run(String(i),JSON.stringify({id:String(i),platform:'mock0',state:'unknown'}));
assert.equal(readPrepStatus(db,{catalog}).rows.length,65,'旧列表截断以外的记录仍显示');db.close();
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const html=preparePage(esc,data);
assert.match(html,/发布记录/);assert.match(html,/待你处理/);assert.match(html,/失败详情/);
assert.equal((html.match(/data-status-window=/g)||[]).length,1);
assert.match(html,/data-column-form/);assert.match(html,/栏目说明/);
assert.doesNotMatch(html,/<select|data-action=|data-prep=|新建原稿|生成各平台版本|platform-card-grid/);
assert.match(preparePage(esc,prepStatus()),/暂无发布记录/);
assert.doesNotMatch(preparePage(esc,prepStatus({records:[{id:'x',platform:'wechat',state:'unknown',title:'<script>unsafe</script>'}]})),/<script>unsafe/);
for(const file of ['src/web/publish-prep.js','src/web/prepare-page.js','src/prep-status.mjs','src/web/mt.css','docs/publish-api.md'])assert.doesNotMatch(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),/三种表达|三端|三个平台|三张卡片|three independent/);
// 用失败即抛出的fetch保证初始化/刷新不写入；仅显式点击才允许window。
let interval,click,intervalCount=0,listenerCount=0;const calls=[];globalThis.document={hidden:false,activeElement:null,querySelector:()=>root};globalThis.location={hash:'#/prepare'};
globalThis.setInterval=fn=>{interval=fn;intervalCount++;return intervalCount;};globalThis.clearInterval=()=>{};
const message={},section={},root={isConnected:true,contains:()=>false,querySelector:selector=>selector==='#status-message'?message:selector==='#status-sections'?section:null,addEventListener:(type,fn)=>{click=fn;listenerCount++;}};
globalThis.fetch=()=>{throw Error('初始化和轮询不应写入');};
initPreparePage({esc,api:async route=>{calls.push(route);return data;},toast:()=>{}});await interval();assert.deepEqual(calls,['/api/prep/status']);
const firstListenerCount=listenerCount;
for(let i=0;i<3;i++)initPreparePage({esc,api:async()=>{throw Error('重复初始化不应创建轮询');},toast:()=>{}});
assert.equal(listenerCount,firstListenerCount,'尺寸变化后同一页面不重复绑定事件');assert.equal(intervalCount,1,'同一页面仅一个轮询');
root.isConnected=false;await interval();assert.equal(calls.length,1);
root.isConnected=true;root.contains=()=>true;globalThis.fetch=async(route,options)=>{assert.equal(route,'/api/prep');assert.deepEqual(JSON.parse(options.body),{type:'window',id:'pending'});return {ok:true,json:async()=>({window:{note:'模拟'}})};};
await click({target:{closest:()=>({dataset:{statusWindow:'pending'}})}});
const nextRoot={...root};globalThis.document.querySelector=()=>nextRoot;
initPreparePage({esc,api:async()=>data,toast:()=>{}});
assert.equal(listenerCount,firstListenerCount*2,'重新渲染的新页面正常绑定');assert.equal(intervalCount,2,'新页面正常开始轮询');
console.log('只读发布状态自测通过：状态映射、动态平台20项、旧单全量、待办、脱敏、只读初始化/轮询、唯一window动作及文案扫描。');
