// First-party offline temporal/cohort/scheduler acceptance; temporary SQLite only.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const folder=fs.mkdtempSync(path.join(os.tmpdir(),'l1-daily-'));
process.env.MAITIAN_HOME=folder;process.env.MAITIAN_DB=path.join(folder,'hub.db');process.env.MAITIAN_CONFIG=path.join(folder,'config.json');
fs.writeFileSync(process.env.MAITIAN_CONFIG,JSON.stringify({xHandle:'Fixture',l1:{xhs:{account:'FixtureXhs'},wechat:{account:'FixtureWechat'}}}));
const {dayWindow,inDayWindow,previousBeijingDay}=await import('../src/l1-collection-window.mjs');
const {selectXPosts}=await import('../src/l1-x-dom.mjs');
const {db,saveObservation,transaction}=await import('../src/l1-store.mjs');
db.prepare('INSERT OR REPLACE INTO meta(key,value) VALUES (?,?)').run('l1:platform-selection',JSON.stringify(['x','xhs','wechat']));
const {accountSummary}=await import('../src/l1-summary.mjs');
const {writeLocalReport}=await import('../src/local-report.mjs');
const {runMidnight}=await import('./l1-midnight.mjs');
try{
  const w=dayWindow('2026-11-17','2026-11-17T03:00:00Z');
  assert.equal(w.start,'2026-11-16T16:00:00.000Z');
  assert.equal(inDayWindow('2026-11-16T15:59:59.999Z',w),false);
  assert.equal(inDayWindow(w.start,w),true);assert.equal(inDayWindow(w.until,w),false);
  assert.equal(inDayWindow('2026-11-17T02:59:59Z',w),true);
  assert.equal(previousBeijingDay('2026-12-31T16:01:00Z'),'2026-12-31');
  assert.equal(previousBeijingDay('2026-02-28T16:01:00Z'),'2026-02-28');
  assert.throws(()=>dayWindow('2026-11-18','2026-11-17T00:00:00Z'));
  const card={author:'Fixture',permalinkAuthor:'Fixture',kind:'original',id:'1',created_at:w.start};
  const selected=selectXPosts([card,{...card,id:'2',pinned:true,created_at:'2020-01-01T00:00:00Z'},{...card,id:'3',created_at:w.until},{...card,id:'4',created_at:null}],new Date('2026-11-17T05:00:00Z'),'Fixture',w);
  assert.deepEqual(selected.posts.map(p=>p.id),['1']);assert.equal(selected.skipped.unknownTime,1);
  const daily=dayWindow('2026-11-17','2026-11-17T16:00:00Z');
  const post={id:'100',text:'离线昨日作品',url:'https://x.com/Fixture/status/100',created_at:'2026-11-17T15:59:00Z',views:100,likes:2,comments:0,favorites:null,shares:0};
  const save=value=>transaction(()=>saveObservation(value));
  const observation={platform:'x',account:'Fixture',source:'offline-test',captured_at:'2026-11-17T16:03:00Z',posts:[post],collection:{...daily,complete:true,unknownDates:0}};
  save(observation);save(observation);
  assert.equal(db.prepare('SELECT count(*) n FROM episodes').get().n,1);
  const summary=accountSummary(db,'x','Fixture','2026-11-17');
  assert.equal(summary.publishedToday.count,1);assert.equal(summary.publishedToday.metrics.views,100);
  assert.equal(summary.publishedToday.metrics.favorites,null);
  assert.equal(summary.collection.capturedAt,'2026-11-17T16:03:00Z');
  assert.equal(db.prepare('SELECT day FROM metrics').get().day,'2026-11-18','observation is not backdated');
  const manual=dayWindow('2026-11-18','2026-11-18T02:00:00Z');
  save({...observation,captured_at:'2026-11-18T02:03:00Z',posts:[{...post,id:'101',created_at:'2026-11-18T01:00:00Z',views:25}],collection:{...manual,complete:true}});
  assert.equal(accountSummary(db,'x','Fixture','2026-11-18').publishedToday.metrics.views,25,'yesterday cohort is not added to today');
  assert.equal(accountSummary(db,'x','Fixture','2026-11-17').publishedToday.metrics.views,100);
  const empty=dayWindow('2026-11-19','2026-11-19T20:00:00Z');
  save({...observation,captured_at:'2026-11-19T20:00:01Z',posts:[],collection:{...empty,complete:true}});
  assert.equal(accountSummary(db,'x','Fixture','2026-11-19').publishedToday.metrics.views,0,'confirmed empty day differs from missing collection');
  assert.equal(accountSummary(db,'x','Fixture','2026-11-20').publishedToday.metrics.views,null);
  assert.throws(()=>save({...observation,posts:[{...post,created_at:'2026-11-18T01:00:00Z'}]}),/范围/);
  const report=await writeLocalReport({date:'2026-11-17',reportDir:path.join(folder,'reports')}),body=fs.readFileSync(report,'utf8');
  assert.ok(report.startsWith(folder+path.sep));
  assert.match(body,/实际采集完成于 2026-11-17T16:03:00Z/);assert.match(body,/离线昨日作品/);
  let record=null,posts=0;
  const request=async(url,options={})=>{
    if(options.method==='POST') {const a=JSON.parse(options.body);posts++;assert.equal(a.date,'2026-11-17');assert.equal(a.type,'collect');assert.equal(options.headers.origin,'http://127.0.0.1:8787');record={type:'collect',date:a.date,platform:a.platform,startedAt:'2026-11-17T16:01:00Z',done:true,ok:true};return {ok:true,status:200};}
    return {ok:true,json:async()=>({platforms:{x:{identity:{confirmedAt:'checked',account:'Fixture',profile:'fixture-profile'},last:record},xhs:{},wechat:{}},actions:[]})};
  };
  const result=await runMidnight({now:new Date('2026-11-17T16:01:00Z'),request,sleep:async()=>{}});
  assert.equal(result.date,'2026-11-17');assert.equal(result.platforms.x.ok,true);assert.equal(posts,1);
  assert.equal(result.platforms.wechat.skipped,true);
  await runMidnight({now:new Date('2026-11-17T16:02:00Z'),request,previous:result,sleep:async()=>{}});
  assert.equal(posts,1,'successful scheduled run is not repeated');
  const failedRequest=async(url,options={})=>{
    const response=await request(url,options);
    if(options.method==='POST')record.ok=false;
    return response;
  };
  const failed=await runMidnight({now:new Date('2026-11-17T16:03:00Z'),request:failedRequest,sleep:async()=>{}});
  assert.equal(failed.ok,false);assert.match(failed.platforms.x.error,/采集失败/);
  const skipped=await runMidnight({request:async()=>({ok:true,json:async()=>({platforms:{x:{selected:false},bilibili:{selected:false}},actions:[]})})});
  assert.equal(skipped.ok,true);assert.equal(skipped.skipped,true);
  const loggedOut=await runMidnight({request:async(_url,options={})=>{
    assert.notEqual(options.method,'POST','Do not collect after explicit login expiry');
    return {ok:true,json:async()=>({platforms:{x:{selected:true,identity:{confirmedAt:'2026-11-17T00:00:00Z'},loginStatus:{state:'logged_out'}}},actions:[]})};
  }});
  assert.equal(loggedOut.platforms.x.skipped,true);
  console.log('DAILY PASS: Beijing range/cutoff, pinned/future/unknown exclusion, midnight attribution, manual today isolation, empty-vs-missing, report timestamp, scheduler identity/Origin/idempotence.');
}finally{db.close();}
