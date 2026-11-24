// One-off, reviewed editorial plan; apply ONLY through the workbench metadata API.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import crypto from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {callerPrepAgent} from '../src/prep-agent.mjs';
const tools=process.argv.includes('--tools');
const project=fileURLToPath(new URL('../../',import.meta.url)),out=path.join(project,'evidence',tools?'columns-tools-20261124':'columns-20261124');
const base='http://127.0.0.1:8787',planFile=path.join(out,'plan.json');
const get=async route=>{const response=await fetch(base+route);if(!response.ok)throw Error('读取失败 '+response.status);return response.json();};
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
function invariants(database){const db=new DatabaseSync(database,{readOnly:true});try{return Object.fromEntries(['publish_posts','publish_preparations'].flatMap(table=>db.prepare(`SELECT id,record FROM ${table}`).all().map(row=>{const r=JSON.parse(row.record);delete r.column;delete r.operations;delete r.revision;if(r.source){r.source={...r.source};delete r.source.column;}return [table+':'+row.id,hash(r)];})));}finally{db.close();}}
fs.mkdirSync(out,{recursive:true});
if(process.argv[2]==='--plan'){
  const state=await get('/api/prep/status');
  const news=new Set(['cb8ce144-165e-43f5-bd32-ab1ce95f866f','65dbca9d-75ec-4f67-ac9a-81f8db227fd0']);
  const practice=new Set(['058d2569-d15a-4271-9b4f-e9ca19686913','5a18a6eb-a3ac-450f-9a56-e882c1279d75']);
  const assignments=state.rows.map(r=>({id:r.id,kind:r.kind,expectedColumn:r.column??null,column:news.has(r.id)?'AI热点新闻':tools&&!practice.has(r.id)?'AI工具分享':'AI实战详解'}));
  const plan={at:new Date().toISOString(),actor:callerPrepAgent(),assignments,review:state.rows.map(r=>({id:r.id,title:r.title,before:r.column??null,column:assignments.find(a=>a.id===r.id).column,reason:news.has(r.id)?'公司或人物新动向及影响':tools&&!practice.has(r.id)?'GitHub、Skill、工具或插件的用途、能力与限制介绍':'完整教程或技术草稿验收'}))};
  fs.writeFileSync(planFile,JSON.stringify(plan,null,2));fs.writeFileSync(path.join(out,'before-status.json'),JSON.stringify(state,null,2));console.log(JSON.stringify(plan.review));
}else if(process.argv[2]==='--apply'){
  const backup=process.argv[3];if(!backup||!fs.existsSync(backup))throw Error('必须提供本次维护生成的一致性备份');
  const before=invariants(backup),plan=JSON.parse(fs.readFileSync(planFile,'utf8')),contract=await get('/api/prep/contract');
  if(contract.columns?.map(c=>c.name).join(',')!==(tools?'AI热点新闻,AI实战详解,AI工具分享':'AI热点新闻,AI实战详解'))throw Error('运行版栏目契约尚未加载');
  const response=await fetch(base+'/api/prep/posts',{method:'POST',headers:{origin:base,'content-type':'application/json'},body:JSON.stringify({type:'columns',actor:callerPrepAgent(),assignments:plan.assignments})});
  const result=await response.json();fs.writeFileSync(path.join(out,'apply-result.json'),JSON.stringify({backup,status:response.status,result},null,2));if(!response.ok)throw Error(result.error);
  const state=await get('/api/prep/status'),after=invariants(path.join(project,'repo','data','hub.db'));
  const preserved=JSON.stringify(before)===JSON.stringify(after);
  const counts=Object.fromEntries(contract.columns.map(c=>[c.name,state.rows.filter(r=>r.column===c.name).length]));
  const invalid=state.rows.filter(r=>!Object.hasOwn(counts,r.column));
  const verified={at:new Date().toISOString(),preserved,counts,rows:state.rows.length,invalid:invalid.map(r=>r.id),backup,updates:result.updates};
  fs.writeFileSync(path.join(out,'after-status.json'),JSON.stringify(state,null,2));fs.writeFileSync(path.join(out,'verification.json'),JSON.stringify(verified,null,2));
  console.log(JSON.stringify(verified));if(!preserved||invalid.length)throw Error('整理后的数据核对未通过，不重跑，先查证据');
}else throw Error('用法：--plan；或 --apply <本次维护备份绝对路径>');
