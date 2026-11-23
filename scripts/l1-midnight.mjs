// First-party scheduler entry: same HTTP mutex/action history as the manual button.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {home} from '../src/l1-config.mjs';
import {previousBeijingDay} from '../src/l1-collection-window.mjs';

export async function runMidnight({base='http://127.0.0.1:8787', now=new Date(), request=fetch, sleep=ms=>new Promise(r=>setTimeout(r,ms)), timeoutMs=1200000, previous={}}={}) {
  const date=previousBeijingDay(now), results={date,timezone:'Asia/Shanghai',startedAt:new Date().toISOString(),platforms:{}};
  const get=async route=>{const r=await request(base+route,{signal:AbortSignal.timeout(10000)});if(!r.ok)throw new Error(`工作台HTTP ${r.status}`);return r.json();};
  const initial=await get('/api/l1/status');
  if(Object.values(initial.platforms).every(p=>p.selected===false))return {...results,ok:true,skipped:true,reason:'未选择使用的平台，本次不采集',endedAt:new Date().toISOString()};
  for(const platform of Object.keys(initial.platforms).filter(p=>initial.platforms[p].selected!==false)) {
    const identity=initial.platforms?.[platform]?.identity;
    if(previous.date===date && previous.platforms?.[platform]?.ok && previous.platforms[platform].account===identity?.account && previous.platforms[platform].profile===identity?.profile) {results.platforms[platform]=previous.platforms[platform];continue;}
    if(!initial.platforms?.[platform]?.identity?.confirmedAt || initial.platforms[platform].loginStatus?.state==='logged_out') {results.platforms[platform]={ok:false,skipped:true,error:'尚无本专用账号有效登录确认；未自动进入登录流程'};continue;}
    const deadline=Date.now()+timeoutMs;
    try {
      let record;
      while(Date.now()<deadline) {
        const status=await get('/api/l1/status');
        if(status.actions?.some(a=>!a.done)) {await sleep(5000);continue;}
        const response=await request(base+'/api/action',{method:'POST',headers:{'content-type':'application/json',origin:base},body:JSON.stringify({type:'collect',platform,date}),signal:AbortSignal.timeout(10000)});
        if(response.status===409) {await sleep(5000);continue;}
        if(!response.ok)throw new Error(`采集启动失败 HTTP ${response.status}`);
        record=(await get('/api/l1/status')).platforms[platform].last;
        if(record?.type!=='collect'||record.date!==date)throw new Error('未取得本次日期采集回执');
        break;
      }
      if(!record)throw new Error('工作台忙，未启动本次采集');
      const startedAt=record.startedAt;
      while(!record.done && Date.now()<deadline) {
        await sleep(4000);record=(await get('/api/l1/status')).platforms[platform].last;
        if(record.startedAt!==startedAt)throw new Error('采集回执已被另一操作替换，请查看系统记录');
      }
      if(!record.done)throw new Error('等待回执超时；现有任务未被终止，请查看工作台');
      const registeredOnly=record.collection?.coverage==='registered-only',incomplete=record.collection?.complete===false&&!registeredOnly;
      results.platforms[platform]={ok:!!record.ok&&!incomplete,account:identity.account,profile:identity.profile,startedAt,endedAt:record.endedAt,coverage:registeredOnly?'registered-only':'discovered-day',warning:registeredOnly?'仅已登记作品，不代表平台当日全量':'',error:incomplete?'存在日期未知作品，未确认当日完整覆盖':record.ok?'':'采集失败，请查看工作台系统页的本次错误'};
    }catch(error){results.platforms[platform]={ok:false,error:error.message};}
  }
  results.endedAt=new Date().toISOString();
  results.ok=Object.values(results.platforms).some(p=>p.ok)&&Object.values(results.platforms).every(p=>p.ok||p.skipped);
  return results;
}

if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const folder=path.join(home,'reports','collections');fs.mkdirSync(folder,{recursive:true});
  const lock=path.join(folder,'midnight.lock');let owned=false;
  try {
    const fd=fs.openSync(lock,'wx');owned=true;fs.writeFileSync(fd,String(process.pid));fs.closeSync(fd);
    const date=previousBeijingDay(),file=path.join(folder,`${date}-midnight.json`);
    let previous={};try{previous=JSON.parse(fs.readFileSync(file,'utf8'));}catch{}
    const result=await runMidnight({previous});fs.writeFileSync(file,JSON.stringify(result,null,2));console.log(JSON.stringify(result));
    if(!result.ok)process.exitCode=1;
  }catch(error){console.error(error.code==='EEXIST'?'已有零点任务锁；未重复采集。请核对reports/collections/midnight.lock对应任务':error.message);process.exitCode=1;}
  finally{if(owned)fs.unlinkSync(lock);}
}
