import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {videoPrefillJobs} from '../src/video-prefill-jobs.mjs';
import {videoPrefillPublications,stablePublication} from '../src/video-prefill-publications.mjs';

const db=new DatabaseSync(':memory:');
const start=Date.parse('2026-11-21T12:00:00Z'),id=n=>`00000000-1000-4000-8000-${String(n).padStart(12,'0')}`;
const account=platform=>({bilibili:'FixtureBili',x:'FixtureX',xhs:'FixtureRed',youtube:'FixtureYT'})[platform];
const inputs={requestId:id(1),name:'测试工程',platforms:['bilibili','x','xhs','youtube']};
let time=start;
try{
  db.exec(`CREATE TABLE meta (key TEXT PRIMARY KEY,value TEXT);
    CREATE TABLE episodes (id TEXT PRIMARY KEY,name TEXT);
    CREATE TABLE tasks (episode_id TEXT,platform TEXT,state TEXT,url TEXT);
    CREATE TABLE snapshots (episode_id TEXT,project TEXT);
    CREATE TABLE metrics (episode_id TEXT,platform TEXT,collected_at TEXT,extra TEXT);`);
  db.prepare('INSERT INTO meta VALUES (?,?)').run('video-prefill:last',JSON.stringify({requestId:id(0),name:'旧任务',
    running:false,startedAt:start-1000,states:[{id:'x',status:'待你发布'}]}));
  const open=()=>videoPrefillJobs(db,{now:()=>time});
  let jobs=open();
  assert.equal(jobs.get(id(0)).states[0].status,'待你发布');
  assert.throws(()=>jobs.reserve({...inputs,requestId:id(4),platforms:['instagram']},account),/预期账号/);
  assert.equal(jobs.get(id(4)),null);
  const first=jobs.reserve(inputs,account);
  assert.equal(first.start,true);
  assert.equal(jobs.reserve(inputs,account).start,false);
  assert.equal(jobs.get(inputs.requestId).lease,undefined);
  assert.throws(()=>jobs.record({requestId:id(1),lease:first.lease,revision:1,running:true,states:[]}),/不匹配/);
  assert.throws(()=>jobs.claim({requestId:id(1),lease:id(7)}),/过期/);
  assert.deepEqual(jobs.claim({requestId:id(1),lease:first.lease}),Object.fromEntries(inputs.platforms.map(p=>[p,account(p)])));
  assert.throws(()=>jobs.claim({requestId:id(1),lease:first.lease}),/已经启动/);
  jobs.record({requestId:id(1),lease:first.lease,revision:2,running:true,states:[{id:'bilibili',status:'待你发布'},{id:'x',status:'上传中 15%'}]});
  jobs.record({requestId:id(1),lease:first.lease,revision:1,running:false,states:[]});
  assert.equal(jobs.get(id(1)).running,true);
  assert.equal(jobs.get(id(1)).states[1].status,'上传中');
  time+=61_000;
  jobs=open();
  assert.equal(jobs.get(id(1)).interrupted,true);
  assert.equal(jobs.get(id(1)).states[1].status,'状态待确认');
  assert.equal(jobs.reserve(inputs,account).start,false);
  const completed=jobs.record({requestId:id(1),lease:first.lease,revision:3,running:false,states:[{id:'x',status:'待你发布'}]});
  assert.equal(completed.states[0].status,'待你发布');
  assert.equal(completed.states[1].status,'待你发布');
  assert.equal(completed.states[2].status,'状态待确认');
  assert.equal(jobs.record({requestId:id(1),lease:first.lease,revision:5,running:true,states:[]}).running,false);

  const unclaimed={...inputs,requestId:id(2)};
  const waiting=jobs.reserve(unclaimed,account);
  time+=60_000;
  const renewed=jobs.reserve(unclaimed,account);
  assert(renewed.start&&renewed.lease!==waiting.lease);
  assert.throws(()=>jobs.claim({requestId:id(2),lease:waiting.lease}),/过期/);
  assert.equal(jobs.claim({requestId:id(2),lease:renewed.lease}).bilibili,'FixtureBili');

  const publications=videoPrefillPublications(db,jobs);
  const seed=({episode,postId,platform,url,source,nickname=account(platform),publicationId,publishedAt='2026-11-21T12:04:00Z'})=>{
    db.prepare('INSERT INTO episodes VALUES (?,?)').run(episode,'同名测试作品');
    db.prepare("INSERT INTO tasks VALUES (?,?,'published',?)").run(episode,platform,url);
    db.prepare('INSERT INTO snapshots VALUES (?,?)').run(episode,JSON.stringify({account:nickname,postId,created_at:publishedAt,source}));
    db.prepare('INSERT INTO metrics VALUES (?,?,?,?)').run(episode,platform,'2026-11-21T12:05:00Z',JSON.stringify({account:nickname,source,publicationId}));
  };
  const bv='BV1ab2cd3ef4';
  seed({episode:'bili',postId:bv,platform:'bilibili',source:'native/isolated-browser',publicationId:bv,url:`https://www.bilibili.com/video/${bv}?from=fixture`});
  seed({episode:'x-verified',postId:'123',platform:'x',source:'chrome/page',url:'https://x.com/FIXTUREX/status/123'});
  seed({episode:'x-wrong',postId:'124',platform:'x',source:'chrome/page',url:'https://x.com/Someone/status/124'});
  seed({episode:'red',postId:'fixture-red',platform:'xhs',source:'xhs-visible-dom',url:'https://www.xiaohongshu.com/explore/fixture-red'});
  seed({episode:'yt-no-proof',postId:'AbCdEfGhI01',platform:'youtube',source:'native/isolated-browser',url:'https://youtu.be/AbCdEfGhI01'});
  assert.deepEqual(publications.candidates(id(1),'x').map(record=>record.episodeId),['x-verified']);
  assert.deepEqual(publications.candidates(id(1),'youtube'),[]);
  assert.equal(publications.candidates(id(1),'xhs')[0].publishedAt,null);
  assert.equal(stablePublication('x','https://x.com.example.test/FixtureX/status/123'),null);
  assert.throws(()=>publications.verify({requestId:id(1),platform:'x',episodeId:'x-wrong'}),/无同账号/);
  const linked=publications.verify({requestId:id(1),platform:'bilibili',episodeId:'bili'});
  assert.equal(linked.url,`https://www.bilibili.com/video/${bv}`);
  assert.deepEqual(publications.verify({requestId:id(1),platform:'bilibili',episodeId:'bili'}),linked);
  assert.throws(()=>publications.verify({requestId:id(2),platform:'bilibili',episodeId:'bili'}),/已.*关联另一任务/);
  assert.equal(videoPrefillPublications(db,jobs).annotate(jobs.get(id(1))).states[0].publication.url,linked.url);
}finally{db.close();}
console.log('VIDEO JOBS PASS: migration, exclusive claims, recoverable dispatch, stale receipts, durable history and verified cross-platform links.');
