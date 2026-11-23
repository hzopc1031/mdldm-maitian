// First-party isolated acceptance: platform selection + original collector wiring.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {runInNewContext} from 'node:vm';
const folder=fs.mkdtempSync(path.join(os.tmpdir(),'l1-platforms-'));
process.env.MAITIAN_HOME=folder;process.env.MAITIAN_DB=path.join(folder,'hub.db');process.env.MAITIAN_CONFIG=path.join(folder,'config.json');
fs.writeFileSync(process.env.MAITIAN_CONFIG,JSON.stringify({xHandle:'FixtureX',web:{requireLocalToken:false},l1:{xhs:{account:'FixtureXhs'},wechat:{account:'FixtureWechat'}}}));
const {db}=await import('../src/l1-store.mjs');const {handle}=await import('../src/web.mjs');
const {PLATFORM_CATALOG,selectedPlatforms}=await import('../src/platform-registry.mjs');
const {browserSettings,allowedPage}=await import('../src/l1-browser.mjs');
const {planL1Action}=await import('../src/l1-web.mjs');
const {originalMetricCollectors,originalFollowerCollectors}=await import('../src/native-collectors.mjs');
const {collectNative,loginNative,nativeVisibleIdentity,registeredNativePosts}=await import('../src/l1-native.mjs');
const server=http.createServer((req,res)=>handle(req,res).catch(e=>{res.writeHead(500);res.end(e.message);}));server.listen(0,'127.0.0.1');await once(server,'listening');const base='http://127.0.0.1:'+server.address().port;
const request=async(route,body,origin=base)=>{const r=await fetch(base+route,body===undefined?{}:{method:'POST',headers:{'content-type':'application/json',origin},body:JSON.stringify(body)});return {status:r.status,json:await r.json()};};
try {
  const initial=await request('/api/overview');assert.equal(initial.json.platforms.length,8);assert.deepEqual(selectedPlatforms(db),[]);assert.ok(initial.json.platforms.every(p=>!p.selected));
  assert.equal((await request('/api/platforms',{platform:'bilibili',selected:true},'http://evil.invalid')).status,403);
  assert.equal((await request('/api/platforms',{platform:'bilibili',selected:true,account:'FixtureBili'})).status,200);
  const selected=(await request('/api/overview')).json;assert.equal(selected.platforms.find(p=>p.id==='bilibili').selected,true);
  assert.ok(selected.accountSummaries.some(s=>s.platform==='bilibili'));
  assert.equal((await request('/api/platforms',{platform:'bilibili',selected:false})).status,200);
  assert.equal((await request('/api/overview')).json.platforms.length,8,'unselected platforms remain visible');
  assert.equal((await request('/api/platforms',{platform:'not-real',selected:true})).status,400);
  assert.equal((await request('/api/platforms',{platform:'bilibili',account:'Cookie: secret'})).status,400);
  const registered=await request('/api/native-work',{platform:'bilibili',title:'离线登记B站作品',publishedAt:'2026-11-21T00:00:00Z',url:'https://www.bilibili.com/video/BV1234567890'});
  assert.equal(registered.status,200,JSON.stringify(registered));
  assert.equal(db.prepare("select count(*) n from episodes where id like 'external:bilibili:%'").get().n,1);
  assert.equal((await request('/api/native-work',{platform:'bilibili',title:'bad',publishedAt:'2026-11-21T00:00:00Z',url:'https://evil.invalid/video/BV1234567890'})).status,400);
  for(const p of PLATFORM_CATALOG.filter(p=>p.native)) {
    const settings=browserSettings({chromeBinary:process.execPath},p.id);assert.equal(settings.port,p.port);
    assert.equal(allowedPage(p.home,p.id),true);assert.equal(allowedPage('https://evil.invalid/',p.id),false);
    assert.deepEqual(planL1Action({type:'login',platform:p.id}),['--login-native',p.id,'--wait-login']);
    let visited=0;const deps={config:{},num:Number,sleep:async()=>{},withTab:async(url,fn)=>{assert.ok(allowedPage(url,p.id),url);visited++;return fn(1);},evaluate:async()=>null};
    const metrics=originalMetricCollectors(deps),fans=originalFollowerCollectors(deps);
    assert.equal(typeof metrics[p.id],'function');assert.equal(typeof fans[p.id],'function');
    // Null platform result stays unknown; no original bridge/publisher is loaded.
    await metrics[p.id]({url:p.id==='instagram'?'https://www.instagram.com/reel/testid/':'https://youtu.be/abcdefghijk',p:{title:'fixture',body:'fixture'}});assert.ok(visited>0);
  }
  const card=text=>({innerText:text,querySelectorAll:()=>[{innerHTML:'eyes',innerText:'1.2万'},{innerHTML:'outlined-like',innerText:'0'}]});
  let cards=[card('别人的作品'),card('真实描述\n公开')],channelVisits=0;
  const channels=originalMetricCollectors({
    withTab:async(url,fn)=>{assert.equal(url,'https://channels.weixin.qq.com/platform/post/list');channelVisits++;return fn(1);},
    evaluate:async(_tab,source)=>runInNewContext(source,{document:{querySelector:()=>({shadowRoot:{querySelectorAll:()=>cards}})}}),
  }).channels;
  const actual=await channels({p:{body:' \r\n ',desc:'真实描述\r\n下一行',shortTitle:'无关短标题'}});
  assert.equal(actual.views,12000);assert.equal(actual.likes,0);assert.equal(actual.comments,null);
  assert.equal(await channels({p:{shortTitle:'真实描述'}}).then(m=>m.views),12000);
  assert.equal(await channels({p:{title:'真实描述'}}).then(m=>m.views),12000);
  assert.equal(await channels({p:{desc:' ',shortTitle:'\n'}}),null);
  assert.equal(channelVisits,3,'empty text does not open a page');
  cards.push(card('真实描述\n另一期'));
  assert.equal(await channels({p:{desc:'真实描述'}}),null,'duplicate prefix must not select the first work');
  const channelId='channel-fixture';
  db.prepare('INSERT INTO episodes(id,name,dir,created_at) VALUES (?,?,?,?)').run(channelId,'视频标题','','2026-11-21T00:00:00Z');
  db.prepare('INSERT INTO tasks(episode_id,platform,state,url) VALUES (?,?,?,?)').run(channelId,'channels','published','https://channels.weixin.qq.com/');
  db.prepare('INSERT INTO snapshots(episode_id,taken_at,project) VALUES (?,?,?)').run(channelId,'2026-11-21T00:00:00Z',JSON.stringify({
    account:'FixtureChannel',postId:channelId,created_at:'2026-11-21T00:00:00Z',text:'视频标题',
    platforms:{channels:{title:'视频标题',desc:'真实描述'}},
  }));
  const [channelWork]=await registeredNativePosts('channels','FixtureChannel');
  assert.equal(channelWork.p.body,undefined);
  assert.equal(channelWork.p.desc,'真实描述','saved description is preserved for matching');
  let persisted=0,closed=0;
  const observations=await collectNative({l1:{bilibili:{account:'FixtureBili'}}},'bilibili','2026-11-21',{
    until:'2026-11-21T01:00:00Z',now:()=>new Date('2026-11-21T02:00:00Z'),wait:async()=>{},
    readRegistered:async()=>[{id:'BV1234567890',url:'https://www.bilibili.com/video/BV1234567890',text:'fixture',created_at:'2026-11-21T00:00:00Z',p:{title:'fixture',body:'fixture'}}],
    withBrowser:async(_c,fn,platform)=>{assert.equal(platform,'bilibili');try{return await fn({goto:async()=>{},evaluate:async(fn,arg)=>fn===nativeVisibleIdentity?{names:['FixtureBili'],url:'https://member.bilibili.com/platform/home',login:false}:String(arg).includes('/x/web/index/stat')?{total:12,tend:[]}: {view:42,like:2,reply:1,favorite:0,share:0}});}finally{closed++;}},
    persist:async value=>{persisted++;return value;}
  });
  assert.equal(persisted,1);assert.equal(closed,1);assert.equal(observations.posts[0].views,42);assert.equal(observations.followers,12);
  assert.equal(observations.collection.coverage,'registered-only');assert.equal(observations.collection.complete,false);
  let loginClosed=false;
  await loginNative({},'douyin',{timeoutMs:100,withBrowser:async(_c,fn,p)=>{assert.equal(p,'douyin');try{return await fn({goto:async()=>{},bringToFront:async()=>{},evaluate:async()=>({names:['AutoBoundCreator'],url:'https://creator.douyin.com/creator-micro/home',login:false})});}finally{loginClosed=true;}}});
  assert.equal(loginClosed,true);assert.equal(JSON.parse(fs.readFileSync(path.join(folder,'l1-accounts.local.json'),'utf8')).douyin,'AutoBoundCreator');
  await assert.rejects(collectNative({l1:{bilibili:{account:'Expected'}}},'bilibili','2026-11-21',{until:'2026-11-21T01:00:00Z',withBrowser:async(_c,fn)=>fn({goto:async()=>{},evaluate:async()=>({names:['Wrong'],url:'https://member.bilibili.com/platform/home',login:false})}),persist:async()=>{throw new Error('must not persist');}}),/账号.*不符/);
  console.log('PLATFORMS PASS: eight visible platforms, persistent choice, public account config, same-origin validation, work registration, isolated ports/URLs, original collector factories, account mismatch/unknown safety. No real platform access.');
}finally{await new Promise(r=>server.close(r));db.close();}
