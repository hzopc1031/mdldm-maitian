import {beijingDay} from './l1-config.mjs';
import {publicationTime} from './l1-age-review.mjs';
import {prefillPlatforms,prefillId} from './video-prefill-jobs.mjs';

export function stablePublication(platform,link){
  let url;try{url=new URL(link);}catch{return null;}
  if(url.protocol!=='https:'||url.username||url.password||url.port)return null;
  const host=url.hostname,path=url.pathname.replace(/\/$/,'');
  let id,account=null,canonical;
  if(platform==='x'&&['x.com','twitter.com','www.x.com','www.twitter.com'].includes(host)){
    [ ,account,id]=/^\/([a-z\d_]{1,15})\/status\/(\d{1,25})$/i.exec(path)??[];
    if(id)canonical=`https://x.com/${account}/status/${id}`;
  }
  if(platform==='bilibili'&&['bilibili.com','www.bilibili.com'].includes(host)){
    id=/^\/video\/(BV[a-z\d]{10})$/i.exec(path)?.[1];
    if(id)canonical=`https://www.bilibili.com/video/${id}`;
  }
  if(platform==='xhs'&&['xiaohongshu.com','www.xiaohongshu.com'].includes(host)){
    id=/^\/explore\/([a-z\d_-]{6,50})$/i.exec(path)?.[1];
    if(id)canonical=`https://www.xiaohongshu.com/explore/${id}`;
  }
  if(platform==='douyin'&&['douyin.com','www.douyin.com'].includes(host)){
    id=/^\/video\/(\d{1,25})$/.exec(path)?.[1];
    if(id)canonical=`https://www.douyin.com/video/${id}`;
  }
  if(platform==='youtube'){
    if(host==='youtu.be')id=/^\/([\w-]{11})$/.exec(path)?.[1];
    if(['youtube.com','www.youtube.com','m.youtube.com'].includes(host))id=path==='/watch' ? url.searchParams.get('v') : /^\/shorts\/([\w-]{11})$/.exec(path)?.[1];
    if(/^[\w-]{11}$/.test(id??''))canonical=`https://youtu.be/${id}`;
  }
  if(platform==='instagram'&&['www.instagram.com','instagram.com'].includes(host)){
    id=/^\/reel\/([\w-]{5,40})$/.exec(path)?.[1];
    if(id)canonical=`https://www.instagram.com/reel/${id}/`;
  }
  return canonical ? {id,url:canonical,account} : null;
}

const unpack=value=>{try{return JSON.parse(value)??{};}catch{return {};}};
const registeredSource=new Set(['chrome/page','xhs-visible-dom','native/isolated-browser']);
const proofRequired=new Set(['bilibili','douyin','youtube','instagram']);
const sameAccount=(platform,a,b)=>typeof a==='string'&&typeof b==='string'&&(platform==='x'?
  a.replace(/^@/,'').toLowerCase()===b.replace(/^@/,'').toLowerCase() : a===b);

export function videoPrefillPublications(db,videoJobs){
  db.exec(`CREATE TABLE IF NOT EXISTS video_prefill_publications (
    job_id TEXT NOT NULL, platform TEXT NOT NULL, post_id TEXT NOT NULL, episode_id TEXT NOT NULL, record TEXT NOT NULL,
    PRIMARY KEY(job_id,platform), UNIQUE(platform,post_id));`);
  const list=db.prepare(`SELECT e.id,e.name,t.url,s.project,m.collected_at,m.extra FROM tasks t JOIN episodes e ON e.id=t.episode_id
    JOIN snapshots s ON s.episode_id=t.episode_id JOIN metrics m ON m.episode_id=t.episode_id AND m.platform=t.platform
    WHERE t.platform=? AND t.state='published' AND julianday(m.collected_at)>=julianday(?) ORDER BY m.collected_at DESC`);
  const existing=db.prepare('SELECT record FROM video_prefill_publications WHERE job_id=? AND platform=?');
  const byPost=db.prepare('SELECT job_id FROM video_prefill_publications WHERE platform=? AND post_id=?');
  const insert=db.prepare('INSERT INTO video_prefill_publications VALUES (?,?,?,?,?)');

  function eligible(requestId,platform){
    const job=videoJobs.get(requestId),target=job?.states.find(item=>item.id===platform);
    if(!prefillId(requestId)||!prefillPlatforms.includes(platform)||!target?.account)throw new Error('这份预填任务没有目标账号');
    return {job,target};
  }

  function candidates(requestId,platform){
    const {job,target}=eligible(requestId,platform);
    const values=new Map();
    for(const row of list.all(platform,new Date(job.startedAt).toISOString())){
      if(values.has(row.id))continue;
      const project=unpack(row.project),metric=unpack(row.extra),link=stablePublication(platform,row.url);
      if(!link||project.example||metric.example||!registeredSource.has(metric.source)||!sameAccount(platform,project.account,target.account)||
        !sameAccount(platform,metric.account,target.account)||link.account&&!sameAccount(platform,link.account,target.account))continue;
      if(String(project.postId)!==link.id)continue;
      if(proofRequired.has(platform)&&metric.publicationId!==link.id)continue;
      const publishedAt=publicationTime(project,platform);
      let publishedDay=null;
      try{publishedDay=beijingDay(publishedAt??project.created_at);}catch{}
      if(!publishedDay||publishedDay<beijingDay(job.startedAt)||publishedAt&&Date.parse(publishedAt)<job.startedAt)continue;
      values.set(row.id,{episodeId:row.id,title:row.name,platform,account:target.account,postId:link.id,url:link.url,
        publishedAt,publishedDay,observedAt:row.collected_at});
      if(values.size===30)break;
    }
    return [...values.values()];
  }

  return {
    candidates,
    verify({requestId,platform,episodeId}={}){
      eligible(requestId,platform);
      const old=existing.get(requestId,platform);
      if(old){
        const record=unpack(old.record);
        if(record.episodeId===episodeId)return record;
        throw new Error('该平台已有作品关联，需要先核对原记录');
      }
      const record=candidates(requestId,platform).find(value=>value.episodeId===episodeId);
      if(!record)throw new Error('该作品尚无同账号、带稳定链接的发布实测');
      if(byPost.get(platform,record.postId))throw new Error('这条平台作品已经关联另一任务');
      const verified={...record,verifiedAt:new Date().toISOString()};
      insert.run(requestId,platform,record.postId,episodeId,JSON.stringify(verified));
      return verified;
    },
    annotate(job){
      return job ? {...job,states:job.states.map(item=>{
        const stored=existing.get(job.requestId,item.id);
        return {...item,publication:stored?unpack(stored.record):null,canReconcile:item.id!=='channels'&&!!item.account};
      })} : null;
    }
  };
}
