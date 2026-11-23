import { randomUUID } from 'node:crypto';
import { platformById } from './platform-registry.mjs';

export const prefillPlatforms=['bilibili','xhs','douyin','channels','youtube','x','instagram'];
export const prefillId=value=>typeof value==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
const terminal=new Set(['已填写','待你发布','跳过','异常','未登录','账号待确认','已停止','上传超时','状态待确认']);
const active=new Set(['等待','检查登录','填写中','上传中','处理中']);
const tidy=(value,limit)=>String(value??'').replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,limit);
const stateLabel=value=>terminal.has(value)||active.has(value) ? value : /^上传中/.test(value||'') ? '上传中' : '处理中';

export function videoPrefillJobs(db,{now=Date.now,redact=value=>value}={}){
  db.exec(`CREATE TABLE IF NOT EXISTS video_prefill_jobs (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
    lease TEXT NOT NULL, running INTEGER NOT NULL, interrupted INTEGER NOT NULL, finished_at INTEGER);
    CREATE TABLE IF NOT EXISTS video_prefill_targets (
      job_id TEXT NOT NULL, platform TEXT NOT NULL, account TEXT NOT NULL,
      status TEXT NOT NULL, message TEXT NOT NULL DEFAULT '', PRIMARY KEY(job_id,platform));`);
  const columns=new Set(db.prepare('PRAGMA table_info(video_prefill_jobs)').all().map(column=>column.name));
  if(!columns.has('claimed'))db.exec('ALTER TABLE video_prefill_jobs ADD COLUMN claimed INTEGER NOT NULL DEFAULT 0');
  if(!columns.has('revision'))db.exec('ALTER TABLE video_prefill_jobs ADD COLUMN revision INTEGER NOT NULL DEFAULT 0');
  const read=db.prepare('SELECT * FROM video_prefill_jobs WHERE id=?');
  const targets=db.prepare('SELECT * FROM video_prefill_targets WHERE job_id=? ORDER BY rowid');
  const last=db.prepare('SELECT id FROM video_prefill_jobs ORDER BY created_at DESC,rowid DESC LIMIT 1');
  const recent=db.prepare('SELECT id FROM video_prefill_jobs ORDER BY created_at DESC,rowid DESC LIMIT 20');
  const insert=db.prepare('INSERT INTO video_prefill_jobs(id,name,created_at,updated_at,lease,running,interrupted,finished_at) VALUES (?,?,?,?,?,1,0,NULL)');
  const target=db.prepare('INSERT INTO video_prefill_targets(job_id,platform,account,status) VALUES (?,?,?,?)');
  const updateTarget=db.prepare('UPDATE video_prefill_targets SET status=?,message=? WHERE job_id=? AND platform=?');
  const update=db.prepare('UPDATE video_prefill_jobs SET updated_at=?,running=?,interrupted=?,finished_at=? WHERE id=?');
  const claim=db.prepare('UPDATE video_prefill_jobs SET claimed=1 WHERE id=?');
  const renew=db.prepare('UPDATE video_prefill_jobs SET updated_at=?,lease=? WHERE id=?');
  const revise=db.prepare('UPDATE video_prefill_jobs SET revision=? WHERE id=?');
  const migrate=db.prepare("SELECT value FROM meta WHERE key='video-prefill:last'");

  const atomic=fn=>{
    db.exec('BEGIN IMMEDIATE');
    try{const value=fn();db.exec('COMMIT');return value;}catch(error){db.exec('ROLLBACK');throw error;}
  };
  const job=id=>{
    if(!prefillId(id))return null;
    const row=read.get(id);
    if(!row)return null;
    const stale=row.running&&now()-row.updated_at>=60_000;
    return {requestId:row.id,name:row.name,startedAt:row.created_at,finishedAt:row.finished_at,
      running:!!row.running&&!stale,interrupted:!!row.interrupted||!!stale,
      states:targets.all(id).map(item=>({id:item.platform,account:item.account,
        status:stale&&!terminal.has(item.status)?'状态待确认':item.status,message:item.message}))};
  };

  // Preserve a browser's last locally saved result from the previous single-record storage.
  if(!last.get()){
    let old;try {old=JSON.parse(migrate.get()?.value??'null');} catch {}
    if(prefillId(old?.requestId)&&Number.isFinite(old.startedAt)){
      atomic(()=>{
        insert.run(old.requestId,tidy(old.name,160)||'原预填任务',old.startedAt,old.startedAt,randomUUID());
        const seen=new Set();
        for(const item of Array.isArray(old.states)?old.states:[]){
          if(!prefillPlatforms.includes(item?.id))continue;
          if(seen.has(item.id))continue;
          seen.add(item.id);
          const status=stateLabel(item.status);
          target.run(old.requestId,item.id,'',terminal.has(status)?status:'状态待确认');
        }
        update.run(old.startedAt,0,old.running||old.interrupted?1:0,old.finishedAt??old.startedAt,old.requestId);
      });
    }
  }

  return {
    get:job,
    latest:()=>job(last.get()?.id),
    history:()=>recent.all().map(({id})=>job(id)),
    claim({requestId,lease}={}){
      if(!prefillId(requestId)||!prefillId(lease))throw new Error('预填任务凭据无效');
      return atomic(()=>{
        const row=read.get(requestId);
        if(!row||row.lease!==lease||!row.running||row.claimed||now()-row.updated_at>=60_000)throw new Error('预填任务已经启动或凭据过期');
        claim.run(requestId);
        return Object.fromEntries(targets.all(requestId).map(item=>[item.platform,item.account]));
      });
    },
    reserve(input,accountFor){
      const id=input?.requestId,name=tidy(input?.name,160),ids=input?.platforms;
      if(!prefillId(id)||!name||!Array.isArray(ids)||!ids.length||new Set(ids).size!==ids.length||
        ids.some(platform=>!prefillPlatforms.includes(platform)))throw new Error('预填任务信息不完整');
      return atomic(()=>{
        const existing=job(id);
        if(existing){
          const row=read.get(id);
          if(row.claimed||!row.running||now()-row.updated_at<60_000)return {start:false,job:existing};
          const retained=Object.fromEntries(existing.states.map(item=>[item.id,item.account]));
          if(ids.length!==existing.states.length||ids.some(platform=>!retained[platform]||retained[platform]!==accountFor(platform)))
            throw new Error('预填任务的平台或预期账号已变更，请重新校验工程');
          const lease=randomUUID();
          renew.run(now(),lease,id);
          return {start:true,lease,job:job(id)};
        }
        const accounts=Object.fromEntries(ids.map(platform=>{
          let expected;try {expected=accountFor(platform);}catch {}
          if(!expected)throw new Error(`请先在麦田确认${platformById(platform).name}的预期账号`);
          return [platform,tidy(expected,150)];
        }));
        const at=now(),lease=randomUUID();
        insert.run(id,name,at,at,lease);
        for(const platform of ids)target.run(id,platform,accounts[platform],'等待');
        return {start:true,lease,job:job(id)};
      });
    },
    record(input){
      const id=input?.requestId;
      if(!prefillId(id)||typeof input?.running!=='boolean'||!Array.isArray(input?.states)||input.states.length>8)
        throw new Error('预填回执格式不对');
      return atomic(()=>{
        const old=read.get(id);
        if(!old||old.lease!==input.lease||!old.claimed)throw new Error('预填回执与原任务不匹配');
        // Late snapshots cannot resurrect a finished job. A state that was read
        // as stale can still receive the worker's final evidence with the original lease.
        if(!old.running)return job(id);
        if(!Number.isSafeInteger(input.revision)||input.revision<=old.revision)return job(id);
        const current=targets.all(id),incoming=new Map(input.states.filter(item=>item?.id).map(item=>[item.id,item]));
        for(const row of current){
          if(terminal.has(row.status))continue;
          const item=incoming.get(row.platform),next=stateLabel(item?.status);
          const status=terminal.has(next) ? next : input.running ? (item?next:row.status) : '状态待确认';
          updateTarget.run(status,redact(tidy(item?.message??row.message,600)),id,row.platform);
        }
        const at=now();
        update.run(at,input.running?1:0,input.interrupted?1:0,input.running?null:at,id);
        revise.run(input.revision,id);
        return job(id);
      });
    },
  };
}
