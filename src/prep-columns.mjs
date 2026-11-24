// Platform-owned editorial columns. The submitting AI selects by the main reader benefit.
import {normalizePrepAgent} from './prep-agent.mjs';
import {randomUUID} from 'node:crypto';
export const prepColumns=Object.freeze([
  Object.freeze({id:'ai-news',name:'AI热点新闻',description:'报道AI新消息、模型或产品更新、人物与公司动向及影响；主要回答发生了什么、为什么值得关注。',revision:1}),
  Object.freeze({id:'ai-practice',name:'AI实战详解',description:'深入讲解完整操作步骤、实践案例、工作流、排错过程和方法取舍；主要回答具体怎样做、怎样验证。',revision:1}),
  Object.freeze({id:'ai-tools',name:'AI工具分享',description:'分享GitHub项目、Skill、AI工具和插件，介绍用途、能力、适用场景与限制；重点帮助发现和选择工具，完整教程归AI实战详解。',revision:1}),
]);
const invalid=message=>Object.assign(Error(message),{code:'INVALID_INPUT'});
export function initPrepColumns(db) {
  const exists=db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='publish_columns'").get();
  if(exists)return;
  db.exec('BEGIN IMMEDIATE');
  try{db.exec('CREATE TABLE publish_columns(id TEXT PRIMARY KEY,name TEXT NOT NULL UNIQUE,record TEXT NOT NULL)');
    for(const c of prepColumns)db.prepare('INSERT INTO publish_columns VALUES (?,?,?)').run(c.id,c.name,JSON.stringify(c));
    db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e;}
}
export function readPrepColumns(db) {
  if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='publish_columns'").get())return prepColumns;
  return db.prepare('SELECT record FROM publish_columns ORDER BY rowid').all().map(r=>JSON.parse(r.record));
}
export function prepColumn(value,columns=prepColumns) {
  if(typeof value!=='string'||!columns.some(c=>c.name===value))throw invalid('栏目须精确选择平台已定义名称：'+columns.map(c=>'「'+c.name+'」').join('、')+'；先读取contract.columns，不另起名称');
  return value;
}
function columnInput(input){
  if(!input||Object.keys(input).some(k=>!['name','description'].includes(k)))throw invalid('栏目只接受名称和说明');
  if(typeof input.name!=='string'||!input.name.trim()||input.name.trim().length>40||/[\x00-\x1f\x7f]/.test(input.name))throw invalid('栏目名称需要1–40字，不含控制字符');
  if(typeof input.description!=='string'||!input.description.trim()||input.description.trim().length>500||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(input.description))throw invalid('请填写1–500字栏目说明，供AI选择');
  return {name:input.name.trim(),description:input.description.trim()};
}
export function managePrepColumn(db,{type,id,input,revision,actor}) {
  const fields=columnInput(input),who=actor===undefined?null:normalizePrepAgent(actor),at=new Date().toISOString();
  if(!['create','edit'].includes(type))throw invalid('栏目操作只支持新建和编辑');
  db.exec('BEGIN IMMEDIATE');
  try{
    const columns=readPrepColumns(db),old=type==='edit'?columns.find(c=>c.id===id):null;
    if(type==='edit'&&!old)throw Object.assign(Error('栏目不存在'),{code:'NOT_FOUND'});
    if(old&&old.revision!==revision)throw Object.assign(Error('栏目已被其他操作修改，请刷新后重试'),{code:'CONFLICT'});
    if(columns.some(c=>c.name===fields.name&&c.id!==old?.id))throw Object.assign(Error('该栏目名称已存在'),{code:'CONFLICT'});
    const column={...(old??{id:randomUUID(),createdAt:at}),...fields,revision:(old?.revision??0)+1,updatedAt:at,operations:[...(old?.operations??[]),{kind:type,actor:who,origin:who?'agent':'page',at,before:old?{name:old.name,description:old.description}:null}]};
    let updatedRecords=0;
    if(old&&old.name!==column.name)for(const table of ['publish_posts','publish_preparations'])for(const row of db.prepare(`SELECT record FROM ${table}`).all()){
      const r=JSON.parse(row.record),previous=table==='publish_posts'?r.column:r.column??r.source?.column;
      if(previous!==old.name)continue;
      r.column=column.name;if(table==='publish_preparations'&&r.source)r.source={...r.source,column:column.name};
      r.operations=[...(r.operations??[]),{kind:'column',before:previous,column:column.name,actor:who,origin:'column_settings',at}];
      if(table==='publish_posts')r.revision=(r.revision??0)+1;
      db.prepare(`UPDATE ${table} SET record=? WHERE id=?`).run(JSON.stringify(r),r.id);updatedRecords++;
    }
    if(old)db.prepare('UPDATE publish_columns SET name=?,record=? WHERE id=?').run(column.name,JSON.stringify(column),column.id);
    else db.prepare('INSERT INTO publish_columns VALUES (?,?,?)').run(column.id,column.name,JSON.stringify(column));
    db.exec('COMMIT');return {ok:true,column,updatedRecords};
  }catch(e){db.exec('ROLLBACK');throw e;}
}

// Editorial metadata only: do not change content, attribution, execution state or unknown locks.
export function reclassifyColumns(db,assignments,caller) {
  const actor=normalizePrepAgent(caller);
  if(!Array.isArray(assignments)||!assignments.length||assignments.length>100)throw Object.assign(Error('栏目整理需要1–100条明确记录'),{code:'INVALID_INPUT'});
  const seen=new Set(),changes=new Map(),at=new Date().toISOString();
  const read=(table,id)=>{const row=db.prepare(`SELECT record FROM ${table} WHERE id=?`).get(id);if(!row)throw Object.assign(Error('待整理记录不存在'),{code:'NOT_FOUND'});return JSON.parse(row.record);};
  const columnOf=(r,table)=>table==='publish_posts'?r.column??null:r.column??r.source?.column??null;
  function stage(table,r,column) {
    const key=table+':'+r.id,prior=changes.get(key);
    if(prior&&prior.column!==column)throw Object.assign(Error('关联记录收到冲突栏目'),{code:'INVALID_INPUT'});
    changes.set(key,{table,record:r,column,before:columnOf(r,table)});
  }
  db.exec('BEGIN IMMEDIATE');
  try {
    for(const a of assignments) {
      if(!a||Object.keys(a).some(k=>!['id','kind','column','expectedColumn'].includes(k))||!['post','legacy'].includes(a.kind)||typeof a.id!=='string'||!Object.hasOwn(a,'expectedColumn'))throw Object.assign(Error('整理项需id、kind、column和expectedColumn'),{code:'INVALID_INPUT'});
      const column=prepColumn(a.column,readPrepColumns(db)),table=a.kind==='post'?'publish_posts':'publish_preparations',key=table+':'+a.id;
      if(seen.has(key))throw Object.assign(Error('整理项不能重复'),{code:'INVALID_INPUT'});seen.add(key);
      const r=read(table,a.id);
      if(columnOf(r,table)!==a.expectedColumn)throw Object.assign(Error('栏目已被其他操作修改，请重读后再整理'),{code:'CONFLICT'});
      stage(table,r,column);
      if(a.kind==='post')for(const e of Object.values(r.editions??{}))if(e.preparationId)stage('publish_preparations',read('publish_preparations',e.preparationId),column);
    }
    const updates=[];
    for(const {table,record:r,column,before} of changes.values()) {
      if(before===column)continue;
      r.column=column;
      if(table==='publish_preparations'&&r.source)r.source={...r.source,column};
      r.operations=[...(r.operations??[]),{kind:'column',before,column,actor,at}];
      if(table==='publish_posts')r.revision=(r.revision??0)+1;
      db.prepare(`UPDATE ${table} SET record=? WHERE id=?`).run(JSON.stringify(r),r.id);
      updates.push({id:r.id,kind:table==='publish_posts'?'post':'legacy',before,column});
    }
    db.exec('COMMIT');return {ok:true,updates,at};
  }catch(error){db.exec('ROLLBACK');throw error;}
}
