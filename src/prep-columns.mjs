// Platform-owned editorial columns. The submitting AI selects by the main reader benefit.
import {normalizePrepAgent} from './prep-agent.mjs';
export const prepColumns=Object.freeze([
  Object.freeze({name:'AI热点新闻',description:'报道AI新消息、模型或产品更新、人物与公司动向及影响；主要回答发生了什么、为什么值得关注。'}),
  Object.freeze({name:'AI实战详解',description:'讲解AI工具用法、教程、实践案例、排错和方法取舍；主要回答能做什么、怎样做、有哪些限制。'}),
]);
export function prepColumn(value) {
  if(typeof value!=='string'||!prepColumns.some(c=>c.name===value))throw Object.assign(Error('栏目只能选择「AI热点新闻」或「AI实战详解」；按内容主要目的选择，不另起名称'),{code:'INVALID_INPUT'});
  return value;
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
      const column=prepColumn(a.column),table=a.kind==='post'?'publish_posts':'publish_preparations',key=table+':'+a.id;
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
