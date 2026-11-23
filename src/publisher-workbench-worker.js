import {run,ORDER} from './lib/publish.js';
import {publisherMediaPath} from './lib/media-path.js';

const origin='http://127.0.0.1:8787';
const isId=value=>typeof value==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
let job,starting=false,writes=null,queued=null,last=null;

chrome.sidePanel.setPanelBehavior({openPanelOnActionClick:true}).catch(()=>{});

async function request(data){
  const response=await fetch(origin+'/api/video-prefill/worker',{method:'POST',credentials:'omit',headers:{'content-type':'application/json'},
    body:JSON.stringify(data),signal:AbortSignal.timeout(3000)});
  const result=await response.json();
  if(!response.ok)throw new Error(result.error||'无法连接麦田预填服务');
  return result;
}

function snapshot(){
  const {name,requestId,lease,revision,running,startedAt,finishedAt,states}=job;
  return {name,requestId,lease,revision,running,startedAt,finishedAt,states:Object.values(states).map(item=>({
    id:item.id,name:item.name,status:item.status,tabId:item.tabId,message:item.logs?.slice(-2).map(log=>String(log.msg).slice(0,250)).join(' · '),
  }))};
}

function save(result){
  last=result;
  queued=result;
  writes??=(async()=>{
    while(queued){
      const current=queued;
      queued=null;
      await chrome.storage.local.set({workbenchPrefill:current}).catch(()=>{});
      await request({...current,action:'receipt'}).catch(()=>{});
    }
  })().finally(()=>{writes=null;if(queued)void save(queued);});
  return writes;
}

function update(){
  job.revision++;
  const result=snapshot();
  const total=job.platforms.length,ready=result.states.filter(item=>['待你发布','已填写','跳过'].includes(item.status)).length;
  chrome.action.setBadgeText({text:result.running?`${ready}/${total}`:ready===total?'✓':'!'});
  return save(result);
}

function validate(rootPath,data){
  if(data?.version!==1||typeof data?.name!=='string'||!data.name.trim()||!data.platforms||data.schedule)
    throw new Error('请选择已校验的无定时视频稿');
  const platforms=Object.keys(data.platforms).filter(id=>!data.platforms[id]?.skip);
  if(!platforms.length||platforms.some(id=>!ORDER.includes(id)||!data.platforms[id]||data.platforms[id].mode))
    throw new Error('预填平台或视频稿不受支持');
  publisherMediaPath(rootPath,'',data.video);
  for(const id of platforms){
    const draft=data.platforms[id];
    if(draft.video)publisherMediaPath(rootPath,'',draft.video);
    for(const cover of draft.covers??[])publisherMediaPath(rootPath,'',data.covers?.[cover]);
  }
  return platforms;
}

async function getStatus(){
  if(job)return snapshot();
  if(last)return last;
  const {workbenchPrefill:saved}=await chrome.storage.local.get('workbenchPrefill');
  if(!job&&!starting&&saved?.running){
    const interrupted={...saved,running:false,interrupted:true,revision:(saved.revision??0)+1};
    void save(interrupted);
    return interrupted;
  }
  return job?snapshot():saved??null;
}

async function start({requestId,lease,rootPath,data}={},windowId){
  if(!isId(requestId)||!isId(lease))throw new Error('预填任务凭据无效');
  if(starting||job?.running)throw new Error('已有预填任务正在运行');
  const saved=await getStatus();
  if(saved?.requestId===requestId)return saved;
  const platforms=validate(rootPath,data);
  if(starting||job?.running)throw new Error('已有预填任务正在运行');
  starting=true;
  try{
    const {accounts}=await request({action:'claim',requestId,lease});
    if(!accounts||platforms.length!==Object.keys(accounts).length||platforms.some(id=>!accounts[id]))
      throw new Error('所选平台与麦田确认的平台不符');
    await chrome.storage.local.set({workbenchPrefill:{name:data.name,requestId,lease,revision:0,running:true,startedAt:Date.now(),states:[]}});
    job={name:data.name,requestId,lease,platforms,revision:0,running:true,startedAt:Date.now(),states:{},stop:false};
    const heartbeat=setInterval(()=>void update(),20000);
    let pending=null;
    const onChange=item=>{
      job.states[item.id]=item;
      if(!pending)pending=setTimeout(()=>{pending=null;void update();},150);
    };
    void Promise.resolve().then(()=>run({dir:'',data},{rootPath,platforms,accounts,windowId,onChange,shouldStop:()=>job.stop}))
      .catch(error=>{onChange({id:'_err',name:'整体',status:'异常',logs:[{msg:error.message}]});})
      .finally(async()=>{
        clearInterval(heartbeat);clearTimeout(pending);
        job.running=false;
        job.finishedAt=Date.now();
        await update();
      });
    return snapshot();
  }finally{starting=false;}
}

chrome.runtime.onMessage.addListener((msg,sender,reply)=>{
  if(msg.type==='publish:get'){
    getStatus().then(reply,()=>reply(null));
    return true;
  }
  if(msg.type==='publish:stop'){
    if(job?.running)job.stop=true;
    reply({ok:true});
    return;
  }
  if(msg.type!=='workbench:prefill'){
    reply({ok:false,error:'请从麦田发起预填'});
    return;
  }
  if(!sender.url?.startsWith(origin+'/')){
    reply({ok:false,error:'请从麦田本机页面操作'});
    return;
  }
  const action=msg.action==='status'?getStatus():msg.action==='start'?start(msg.payload,sender.tab?.windowId):Promise.reject(new Error('未知预填操作'));
  action.then(result=>reply({ok:true,job:result}),error=>reply({ok:false,error:error.message}));
  return true;
});
