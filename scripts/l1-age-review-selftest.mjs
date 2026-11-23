import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {ageMilestones,createAgeReviewReader,publicationTime} from '../src/l1-age-review.mjs';
import {ageSamplingSchema,dueAgeSamples,saveAgeAttempt,saveAgeObservation,collectAgeSamples} from '../src/l1-age-sampling.mjs';

const now=Date.parse('2026-11-21T12:00:00Z');
const published='2026-11-19T12:00:00Z';
const observations=[
  {views:500,likes:50,collected_at:'2026-11-20T12:01:00Z',extra:'{}'},
  {views:600,collected_at:'2026-11-20T11:59:00Z',extra:'{"example":true}'},
  {views:42,likes:0,comments:7,collected_at:'2026-11-20T11:00:00Z',extra:'{"field_observed_at":{"comments":"2026-11-19T14:00:00Z"}}'},
  {views:3,collected_at:'2026-11-19T14:00:00Z'},
];
const [day1,day3,day7]=ageMilestones(published,observations,now);
assert.deepEqual([day1.state,day3.state,day7.state],['observed','pending','pending']);
assert.deepEqual(day1.values.views,{value:42,ageHours:23,observedAt:'2026-11-20T11:00:00.000Z'});
assert.equal(day1.values.likes.value,0);
assert.equal(day1.values.comments,undefined);
assert.equal(ageMilestones(published,observations,Date.parse('2026-11-23T12:00:00Z'))[1].state,'missing');
assert.equal(ageMilestones('2026-11-19T12:00:00',observations,now)[0].state,'unknown-date');
assert.equal(publicationTime({created_at:published,source:'xhs-visible-dom'},'xhs'),null);
assert.equal(publicationTime({source:'wechat-visible-dom',platforms:{wechat:{created_at:published,dateAccuracy:'time'}}},'wechat'),published);

const db=new DatabaseSync(':memory:');
try{
  db.exec(ageSamplingSchema);
  db.exec(`CREATE TABLE tasks (episode_id TEXT,platform TEXT,url TEXT,state TEXT);
  CREATE TABLE snapshots (episode_id TEXT,project TEXT);
  CREATE TABLE metrics (episode_id TEXT,platform TEXT,views INTEGER,likes INTEGER,comments INTEGER,extra TEXT,collected_at TEXT);
  CREATE TABLE publish_preparations (record TEXT);`);
  const insert=(id,publishedAt,project='发帖助手',column='每日精选',account='Example')=>{
    const url=`https://x.com/${account}/status/${id}`,title='第'+id+'篇';
    const record={id,title,platform:'x',state:'published',source:{project,column},publication:{account,url,publishedAt}};
    db.prepare('INSERT INTO publish_preparations VALUES (?)').run(JSON.stringify(record));
    return record;
  };
  insert('1','2026-11-17T12:00:00Z');
  insert('2','2026-11-18T12:00:00Z','别的项目');
  insert('3','2026-11-18T13:00:00Z','发帖助手','别的栏目');
  insert('4','2026-11-18T14:00:00Z','发帖助手','每日精选','Another');
  const current=insert('5',published);
  const task=db.prepare("INSERT INTO tasks VALUES (?,'x',?,'published')");
  task.run('previous','https://twitter.com/Example/status/1?from=fixture'); task.run('current',current.publication.url);
  db.prepare('INSERT INTO snapshots VALUES (?,?)').run('current',JSON.stringify({created_at:'2026-11-20T12:00:00Z'}));
  const metric=db.prepare("INSERT INTO metrics VALUES (?,'x',?,?,?,?,?)");
  metric.run('previous',30,2,3,'{}','2026-11-18T10:00:00Z');
  metric.run('current',42,0,7,observations[2].extra,observations[2].collected_at);
  const reader=createAgeReviewReader(db),[review]=reader.forEpisode('current',now);
  assert.equal(review.publishedAt,published);
  assert.equal(review.previous.episodeId,'previous');
  assert.deepEqual(review.milestones[0].delta,{views:12,likes:-2});
  assert.deepEqual(reader.forRecords([current],now)[0].ageReview,review);
  insert('6','2026-11-19T10:30:00Z');
  const [missing]=reader.forEpisode('current',now);
  assert.equal(missing.previous.episodeId,null);
  assert.deepEqual(missing.milestones[0].delta,{});

  const lead=Date.parse('2026-11-22T10:55:00Z');
  db.prepare('UPDATE snapshots SET project=? WHERE episode_id=?').run(JSON.stringify({postId:'5',account:'Example',created_at:published}),'current');
  const settings={now:lead,accounts:{x:'Example'}};
  const plan=dueAgeSamples(db,settings);
  assert.equal(plan.length,1);
  assert.equal(plan[0].day,3);
  assert.equal(dueAgeSamples(db,{...settings,accounts:{x:'Other'}}).length,0);
  saveAgeAttempt(db,plan,new Date(lead).toISOString());
  assert.equal(dueAgeSamples(db,settings).length,0);
  assert.equal(saveAgeObservation(db,plan,{platform:'x',captured_at:'2026-11-22T11:01:00Z',posts:[{id:'5',views:94,likes:0}]}),1);
  assert.equal(reader.forEpisode('current',lead+2*3600000)[0].milestones[1].values.views.value,94);
  assert.equal(await collectAgeSamples({db,config:{},account:'Example',plan,collectX:async(_config,{targets,persist})=>{
    assert.deepEqual(targets.map(target=>target.id),['5']);
    return persist({platform:'x',account:'Example',captured_at:'2026-11-22T11:30:00Z',posts:[{id:'5',views:96}]});
  }}),1);
  assert.equal(reader.forEpisode('current',lead+2*3600000)[0].milestones[1].values.views.value,96);

  db.prepare("INSERT INTO tasks VALUES ('red','xhs',NULL,'published')").run();
  db.prepare('INSERT INTO snapshots VALUES (?,?)').run('red',JSON.stringify({postId:'fixture-red',account:'FixtureRed',created_at:published,
    source:'xhs-visible-dom',platforms:{xhs:{created_at:published,dateAccuracy:'time'}}}));
  const red={accounts:{xhs:'FixtureRed'},now:Date.parse('2026-11-20T11:30:00Z')};
  const redPlan=dueAgeSamples(db,red);
  assert.equal(redPlan.length,1);
  saveAgeAttempt(db,redPlan,new Date(red.now).toISOString());
  const lateNow=Date.parse('2026-11-20T12:30:00Z');
  assert.equal(reader.forEpisode('red',lateNow)[0].milestones[0].coverage,'attempted');
  const latePlan=dueAgeSamples(db,{...red,now:lateNow});
  assert.equal(latePlan[0].late,true);
  saveAgeAttempt(db,latePlan,new Date(lateNow).toISOString());
  assert.equal(dueAgeSamples(db,{...red,now:lateNow}).length,0);
  assert.equal(await collectAgeSamples({db,config:{},account:'FixtureRed',plan:latePlan,collectXhs:async(_config,date,{targets,persist})=>{
    assert.equal(date,'2026-11-19');
    assert.deepEqual([...targets],['fixture-red']);
    return persist({platform:'xhs',account:'FixtureRed',captured_at:'2026-11-20T12:35:00Z',posts:[{id:'fixture-red',views:123}]});
  }}),1);
  const lateReview=reader.forEpisode('red',lateNow+3600000)[0].milestones[0];
  assert.equal(lateReview.state,'missing');
  assert.equal(lateReview.values,null);
  assert.equal(lateReview.late.views.value,123);
  assert.deepEqual(lateReview.delta,{});
}finally{db.close();}
console.log('AGE REVIEW PASS: verified publication time, exact same column and account, observation window, zero vs missing, no substitution for previous post.');
