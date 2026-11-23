import {beijingDay} from './l1-config.mjs';
import {ageMilestones,lateAgeHours,publicationTime} from './l1-age-review.mjs';

export const ageSamplingSchema=`CREATE TABLE IF NOT EXISTS age_observations (
  episode_id TEXT NOT NULL, platform TEXT NOT NULL, observed_at TEXT NOT NULL,
  views INTEGER, likes INTEGER, comments INTEGER, PRIMARY KEY (episode_id,platform,observed_at));
  CREATE TABLE IF NOT EXISTS age_attempts (
  episode_id TEXT NOT NULL, platform TEXT NOT NULL, day INTEGER NOT NULL,
  attempted_at TEXT NOT NULL, attempts INTEGER NOT NULL, PRIMARY KEY (episode_id,platform,day));
  CREATE TABLE IF NOT EXISTS age_late_attempts (
  episode_id TEXT NOT NULL, platform TEXT NOT NULL, day INTEGER NOT NULL,
  attempted_at TEXT NOT NULL, attempts INTEGER NOT NULL, PRIMARY KEY (episode_id,platform,day));`;
const hour=3600000, days=[1,3,7], native=['bilibili','douyin','channels','youtube','instagram'];
export const agePlatforms=['x','xhs','wechat',...native];
const object=value=>{try{return JSON.parse(value)??{};}catch{return {};}};
const metric=value=>Number.isFinite(value)&&value>=0 ? value : null;
const hasViews=value=>metric(value)!==null;

export function dueAgeSamples(db,{now=Date.now(),accounts={},limit=5}={}) {
  const {rows,observed,metrics,attempts,lateAttempts}=ageTables(db);
  const due=[];
  for(const {episode_id,platform,url,project} of rows.all()){
    if(!accounts[platform])continue;
    const saved=object(project),publishedAt=publicationTime(saved,platform);
    const sameAccount=platform==='x'?saved.account?.toLowerCase()===accounts[platform].toLowerCase():saved.account===accounts[platform];
    if(saved.example||!publishedAt||!saved.postId||!sameAccount||!url&&!(platform==='xhs'||platform==='wechat'))continue;
    const published=Date.parse(publishedAt);
    for(const day of days){
      const deadline=published+day*24*hour;
      const remaining=deadline-now;
      const late=remaining<0;
      if(late? remaining< -lateAgeHours*hour : remaining<5*60000||remaining>90*60000)continue;
      if(observed.get(episode_id,platform,new Date(deadline-6*hour).toISOString(),new Date(deadline).toISOString()))continue;
      const point=ageMilestones(publishedAt,metrics.all(episode_id,platform),Math.max(now,deadline)).find(point=>point.day===day);
      if(point?.values?.views||late&&point?.late?.views)continue;
      if(late&&observed.get(episode_id,platform,new Date(deadline+1).toISOString(),new Date(now).toISOString()))continue;
      const old=(late?lateAttempts:attempts).get(episode_id,platform,day);
      if(old&&(old.attempts>=(late?1:2) || now-Date.parse(old.attempted_at)<30*60000))continue;
      due.push({episodeId:episode_id,platform,url,postId:saved.postId,publishedAt,day,deadline,...(late?{late:true}:{})});
    }
  }
  due.sort((a,b)=>Number(!!a.late)-Number(!!b.late)||a.deadline-b.deadline);
  const first=due[0];
  if(!first)return [];
  // The native collector reads one publication date in each round. X opens exact URLs.
  return due.filter(item=>item.platform===first.platform && (first.platform==='x'||beijingDay(item.publishedAt)===beijingDay(first.publishedAt))).slice(0,limit);
}

function ageTables(db) {
  return {
    rows: db.prepare(`SELECT t.episode_id,t.platform,t.url,s.project FROM tasks t JOIN snapshots s USING (episode_id) WHERE t.state='published'`),
    observed: db.prepare(`SELECT 1 FROM age_observations WHERE episode_id=? AND platform=? AND observed_at BETWEEN ? AND ? AND views IS NOT NULL LIMIT 1`),
    metrics: db.prepare(`SELECT views,likes,comments,extra,collected_at FROM metrics WHERE episode_id=? AND platform=?`),
    attempts: db.prepare(`SELECT attempts,attempted_at FROM age_attempts WHERE episode_id=? AND platform=? AND day=?`),
    lateAttempts: db.prepare(`SELECT attempts,attempted_at FROM age_late_attempts WHERE episode_id=? AND platform=? AND day=?`),
  };
}

export function saveAgeAttempt(db,plan,at=new Date().toISOString()){
  for(const late of [false,true]){
    const table=late?'age_late_attempts':'age_attempts';
    const insert=db.prepare(`INSERT INTO ${table} VALUES (?,?,?,?,1) ON CONFLICT(episode_id,platform,day)
      DO UPDATE SET attempted_at=excluded.attempted_at, attempts=${table}.attempts+1`);
    for(const row of plan.filter(value=>!!value.late===late))insert.run(row.episodeId,row.platform,row.day,at);
  }
}

export function saveAgeObservation(db,plan,observation){
  const insert=db.prepare(`INSERT OR IGNORE INTO age_observations VALUES (?,?,?,?,?,?)`);
  const at=Date.parse(observation.captured_at);
  if(!Number.isFinite(at))throw new Error('无有效观测时间');
  let saved=0;
  for(const row of plan){
    const post=observation.posts.find(item=>String(item.id)===String(row.postId)&&(!item.state||item.state==='published'));
    if(observation.platform!==row.platform||at>row.deadline+lateAgeHours*hour||at<row.deadline-6*hour||!post||
      (!hasViews(post.views)&&metric(post.likes)===null&&metric(post.comments)===null))continue;
    saved+=Number(insert.run(row.episodeId,row.platform,new Date(at).toISOString(),metric(post.views),metric(post.likes),metric(post.comments)).changes);
  }
  return saved;
}

export async function collectAgeSamples({db,config,account,plan,collectX,collectNative,collectXhs,collectWechat}){
  const platform=plan[0]?.platform;
  if(!agePlatforms.includes(platform)||plan.some(row=>row.platform!==platform))throw new Error('同龄采样的作品平台不一致');
  const date=beijingDay(plan[0].publishedAt);
  const only=rows=>rows.filter(item=>plan.some(candidate=>String(candidate.postId)===String(item.id)));
  const posts=plan.map(row=>({id:row.postId,url:row.url,created_at:row.publishedAt}));
  const persist=observation=>{
    const accountMatches=platform==='x'?observation.account?.toLowerCase()===account.toLowerCase():observation.account===account;
    if(!accountMatches)throw new Error('同龄采样身份不符');
    return saveAgeObservation(db,plan,observation);
  };
  if(platform==='x')return collectX(config,{targets:posts,persist});
  const creator=platform==='xhs'?collectXhs:platform==='wechat'?collectWechat:null;
  if(creator)return creator(config,date,{targets:new Set(posts.map(post=>String(post.id))),persist});
  return collectNative(config,platform,date,{filterRegistered:only,persist});
}
