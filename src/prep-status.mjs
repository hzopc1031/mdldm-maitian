// 只读投影：不调用稿件服务、平台检查或浏览器；所有状态文案集中在此。
import {PLATFORM_CATALOG} from './platform-registry.mjs';
import {redactSkillValue,skillText,stderrTail} from './prep-skill-errors.mjs';
import {redactL1} from './l1-web.mjs';
import {prepColumns,readPrepColumns} from './prep-columns.mjs';

export const STATUS_LABELS=Object.freeze({
  prepared:'已生成',generated:'已生成',checked:'检查通过',awaiting_user:'已填好待你点',
  draft_saved:'已存草稿',failed:'失败',check_failed:'失败',unknown:'未知',published:'已发布',
  submitted:'未知',already_exists:'平台已有同稿',editing:'未生成',idle:'未生成',running:'处理中',
});
export const statusLabel=state=>STATUS_LABELS[state]??STATUS_LABELS.unknown;
const problem=state=>['failed','check_failed','unknown','submitted','already_exists'].includes(state)||!Object.hasOwn(STATUS_LABELS,state);

export function prepStatus({posts=[],records=[],xAccountId,columns=prepColumns,catalog=PLATFORM_CATALOG,config={},selected=[],capabilities={},secrets=[]}={}) {
  if(xAccountId){
    records=records.filter(r=>r.platform!=='x'||(r.accountId||'default')===xAccountId);
    posts=posts.map(post=>{if((post.accountId||'default')===xAccountId)return post;const {x,...editions}=post.editions??{};return {...post,editions,_hideX:true};});
  }
  const clean=value=>redactL1(skillText(value,16384),secrets);
  const byRecord=new Map(records.map(r=>[r.id,r])),linked=new Set();
  const configured=[...Object.entries(config.l1??{}),...Object.entries(config.publishPrep??{})].filter(([,v])=>v&&typeof v==='object').map(([id])=>id);
  const ids=[...new Set([...catalog.map(p=>p.id),...configured,...selected,...Object.keys(capabilities),...posts.flatMap(p=>Object.keys(p.editions??{})),...records.map(r=>r.platform)].filter(Boolean))];
  const platforms=ids.map(id=>({id,name:clean(catalog.find(p=>p.id===id)?.name??id)}));
  const names=new Map(platforms.map(p=>[p.id,p.name]));
  function item(platform,state,record,extra={}) {
    const failure=record?.failureEvidence??{};
    const detail=problem(state)?redactSkillValue({
      code:clean(failure.skillCode??failure.code??record?.code??'UNKNOWN'),
      message:clean(failure.message??record?.error??extra.error??'旧记录未保留原始报错'),
      hint:clean(failure.hint),stderrTail:clean(stderrTail(failure.stderrTail)),
      screenshot:clean(failure.screenshot??record?.evidence?.screenshot),
    }):null;
    return {platform,name:names.get(platform)??clean(platform),state,label:statusLabel(state),recordId:record?.id??null,
      accountId:platform==='x'?(record?.accountId||extra.accountId||'default'):null,account:record?.account??record?.publication?.account??null,
      canActivate:platform==='xhs'&&state==='awaiting_user'&&!record?.windowReleased&&!!record?.id,detail};
  }
  const rows=posts.map(post=>({id:post.id,kind:'post',title:clean(post.master?.title||'未命名原稿'),at:post.createdAt??null,
    xTarget:!post._hideX&&post.editions?.x&&post.generation?.state!=='running'&&!/^【测试/.test(post.master?.title||'')?{accountId:post.accountId||'default',pinned:!!post.editions.x.preparationId,canStart:['editing','prepared','checked'].includes(byRecord.get(post.editions.x.preparationId)?.state??post.editions.x.state??'editing')}:null,
    column:post.column?clean(post.column):null,scheduledAt:post.scheduledAt??null,note:post.note?clean(post.note):null,actor:post.actor?{runtime:clean(post.actor.runtime),name:clean(post.actor.name),session:clean(post.actor.sessionId)}:null,
    items:[...new Set([...Object.keys(post.editions??{}),...selected])].filter(p=>p!=='x'||!post._hideX).map(platform=>{
      const edition=post.editions?.[platform],record=byRecord.get(edition?.preparationId);
      if(record)linked.add(record.id);
      const generated=post.generation?.platforms?.includes(platform);
      const state=record?.state??edition?.state??(generated&&post.generation?.state==='done'?'generated':generated&&post.generation?.state==='failed'?'failed':generated&&post.generation?.state==='running'?'running':'editing');
      return item(platform,state,record,{error:post.generation?.error,accountId:post.accountId});
    })}));
  for(const record of records)if(!linked.has(record.id))rows.push({id:record.id,kind:'legacy',title:clean(record.title||'未命名准备记录'),at:record.createdAt??null,column:(record.column??record.source?.column)?clean(record.column??record.source.column):null,scheduledAt:record.scheduledAt??null,note:record.note?clean(record.note):null,actor:record.source?.agent?{runtime:clean(record.source.agent.runtime),name:clean(record.source.agent.name),session:clean(record.source.agent.sessionId)}:null,items:[item(record.platform,record.state,record)]});
  rows.sort((a,b)=>String(b.at??'').localeCompare(String(a.at??'')));
  const entries=rows.flatMap(row=>row.items.map(item=>({...item,rowId:row.id,title:row.title})));
  return {ok:true,readOnly:true,submit:false,finalPublishPlatforms:[],columns,platforms,rows,
    pending:entries.filter(item=>item.state==='awaiting_user'),failures:entries.filter(item=>item.detail)};
}

export function readPrepStatus(db,options={}) {
  const read=table=>db.prepare(`SELECT record FROM ${table} ORDER BY rowid DESC`).all().map(row=>JSON.parse(row.record));
  return prepStatus({...options,columns:readPrepColumns(db),posts:read('publish_posts'),records:read('publish_preparations')});
}
