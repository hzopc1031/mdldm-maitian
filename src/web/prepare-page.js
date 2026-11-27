import {xPublishControls,bindXPublishControls} from './x-publish-controls.js';
const time=at=>at&&Number.isFinite(Date.parse(at))?new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',dateStyle:'short',timeStyle:'short'}).format(new Date(at)):'时间未记录';
const short=id=>String(id).slice(0,8);
const tag=(esc,item)=>`<span class="status-tag" data-state="${esc(item.state)}" data-record-id="${esc(item.recordId??'')}">${esc(item.name)}${item.platform==='x'&&item.account?' @'+esc(item.account):''} · ${esc(item.label)}</span>`;
const reference=(esc,item)=>`<span class="note">${esc(short(item.rowId))}${item.recordId?' / '+esc(short(item.recordId)):''}</span>`;
let activeColumn='全部',lastData=null;
// The page shell also invokes initialization on resize. Bind each DOM root once;
// a newly rendered page still gets its own listeners and polling timer.
const initializedPages=new WeakSet();
export function columnManager(esc,columns=[]) {
 return `<div class="column-manager-heading"><div><h2 class="h2">栏目管理</h2><p class="note">AI 根据栏目说明选择。修改名称会同步已有记录，稿件内容和发布状态保持不变。</p></div><button class="btn" type="button" data-column-close>收起</button></div><div class="column-manager-grid"><div class="column-list">${columns.map(c=>`<article class="column-definition"><div><h3>${esc(c.name)}</h3><p class="note">${esc(c.description)}</p></div><button class="btn" type="button" data-column-edit="${esc(c.id)}" aria-label="编辑${esc(c.name)}">编辑</button></article>`).join('')}</div><form data-column-form class="column-form"><h3 data-column-form-title>新建栏目</h3><label>栏目名称<input name="name" required maxlength="40" placeholder="如：AI工具分享"></label><label>栏目说明<textarea name="description" required maxlength="500" rows="4" placeholder="说明适合哪些内容，帮助 AI 选择"></textarea></label><p data-column-message class="note" role="status" aria-live="polite"></p><div class="btns"><button class="btn pri" type="submit">保存栏目</button><button class="btn" type="button" data-column-new>取消编辑</button></div></form></div>`;
}
export function prepareSections(esc,data) {
  lastData=data;
  const columns=[...new Set([...(data.columns??[]).map(c=>c.name),...data.rows.map(row=>row.column)].filter(Boolean))];
  if(activeColumn!=='全部'&&!columns.includes(activeColumn))activeColumn='全部';
  const shown=activeColumn==='全部'?data.rows:data.rows.filter(row=>row.column===activeColumn);
  const filters=columns.length>1?`<div class="status-filters" role="group" aria-label="按栏目筛选">${['全部',...columns].map(column=>`<button class="btn" type="button" data-column-filter="${esc(column)}" aria-pressed="${column===activeColumn}">${esc(column)}</button>`).join('')}</div>`:'';
  return `<section class="panel status-section" aria-labelledby="status-records-heading"><h2 class="h2" id="status-records-heading">发布记录</h2><p class="note">每份原稿保留一行；未关联原稿的旧准备记录单独列出。定时时间只是计划，不会自动发布。</p>${filters}<div class="status-records">${shown.map(row=>`<article class="status-row" tabindex="-1" data-status-row="${esc(row.id)}"><div class="status-title"><h3>${esc(row.title)}</h3><p class="note"><time>${esc(time(row.at))}</time> · ${row.kind==='post'?'原稿':'旧记录'} ${esc(short(row.id))}${row.actor?` · 来自 ${esc(row.actor.name||row.actor.runtime)}${row.actor.session?' / '+esc(short(row.actor.session)):''}`:''}${row.column?` · ${esc(row.column)}`:''}${row.scheduledAt?` · 计划 <time>${esc(time(row.scheduledAt))}</time>`:''}</p>${row.note?`<p class="note" title="${esc(row.note)}">备注：${esc(row.note.replace(/\s+/g,' ').slice(0,80))}${row.note.replace(/\s+/g,' ').length>80?'…':''}</p>`:''}</div><div class="status-tags" aria-label="平台状态">${row.items.map(item=>tag(esc,item)).join('')||'<span class="note">暂无平台版本</span>'}</div>${xPublishControls(esc,row,data.xPublishAccounts)}</article>`).join('')||'<p class="note">暂无发布记录。</p>'}</div></section>
  <section class="panel status-section" aria-labelledby="status-pending-heading"><h2 class="h2" id="status-pending-heading">待你处理</h2><p class="note">已填好的稿件等待你核对并点最终发布。切到窗口仅置前，不填写、不刷新。</p>${data.pending.map(item=>`<article class="status-pending" data-pending-record="${esc(item.recordId??'')}"><div><h3>${esc(item.title)}</h3>${tag(esc,item)} ${reference(esc,item)}</div>${item.canActivate?`<button class="btn" data-status-window="${esc(item.recordId)}">切到窗口</button>`:'<span class="note">请手动核对原窗口</span>'}</article>`).join('')||'<p class="note">暂无待你处理的稿件。</p>'}</section>
  <section class="panel status-section" aria-labelledby="status-failures-heading"><h2 class="h2" id="status-failures-heading">失败详情</h2><p class="note">未知结果请先核对原平台，避免重复执行。旧记录缺少的报错字段不补造。</p>${data.failures.map(item=>`<details class="status-failure" data-failure-record="${esc(item.recordId??'')}"><summary>${esc(item.title)} · ${esc(item.name)} · ${esc(item.label)} ${reference(esc,item)}</summary><dl>${Object.entries(item.detail).map(([key,value])=>`<dt>${esc(key)}</dt><dd><pre>${esc(value||'未记录')}</pre></dd>`).join('')}</dl></details>`).join('')||'<p class="note">暂无失败或未知记录。</p>'}</section>`;
}
export function preparePage(esc,data) {
 return `<main class="publish-page status-page"><header class="publish-heading"><div><h1 class="h1">发布状态</h1><p class="lead">内容由 AI 提交，这里查看进度和待办。</p></div><div class="btns"><button class="btn" type="button" data-column-manage aria-expanded="false" aria-controls="column-manager">管理栏目</button><button class="btn" type="button" data-copy-prompt>复制 AI 接入指令</button></div></header><section id="column-manager" class="panel status-section column-manager" hidden>${columnManager(esc,data.columns)}</section><p id="status-message" class="note" role="status" aria-live="polite">公众号仅存草稿；X 和小红书可按稿件设置直接发布，发布后核对公开链接。</p><div id="status-sections">${prepareSections(esc,data)}</div></main>`;
}
export function initPreparePage({esc,api,toast}) {
 const root=document.querySelector('.status-page');if(!root||initializedPages.has(root))return;
 initializedPages.add(root);
 bindXPublishControls(root,{toast,refresh:async()=>location.reload()});
 const focusRecord=()=>{const params=new URLSearchParams(location.hash.split('?')[1]||''),id=params.get('post')||params.get('record');if(!id)return;const node=[...root.querySelectorAll('[data-status-row],[data-record-id]')].find(el=>el.dataset.statusRow===id||el.dataset.recordId===id);if(node){node.scrollIntoView({block:'center'});(node.closest('[data-status-row]')||node).focus();}};
 focusRecord();
 root.addEventListener('click',async event=>{
   const panel=root.querySelector('#column-manager');
   const manage=event.target.closest('[data-column-manage]');
   if(manage?.dataset.columnManage!==undefined){panel.hidden=!panel.hidden;manage.setAttribute('aria-expanded',String(!panel.hidden));if(!panel.hidden)panel.querySelector('input').focus();return;}
   const close=event.target.closest('[data-column-close]');
   if(close?.dataset.columnClose!==undefined){panel.hidden=true;root.querySelector('[data-column-manage]').setAttribute('aria-expanded','false');root.querySelector('[data-column-manage]').focus();return;}
   const edit=event.target.closest('[data-column-edit]');
   if(edit?.dataset.columnEdit!==undefined){const column=lastData?.columns?.find(c=>c.id===edit.dataset.columnEdit);if(!column)return;const form=panel.querySelector('form');form.dataset.editId=column.id;form.dataset.revision=column.revision;form.elements.namedItem('name').value=column.name;form.elements.namedItem('description').value=column.description;form.querySelector('[data-column-form-title]').textContent='编辑栏目';form.querySelector('[data-column-message]').textContent='';form.elements.namedItem('name').focus();return;}
   const reset=event.target.closest('[data-column-new]');
   if(reset?.dataset.columnNew!==undefined){panel.innerHTML=columnManager(esc,lastData?.columns);panel.querySelector('input').focus();return;}
   const button=event.target.closest('[data-status-window]');if(!button||!root.contains(button))return;
   if(!button.dataset.statusWindow)return;
   button.disabled=true;
   try{const response=await fetch('/api/prep',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'window',id:button.dataset.statusWindow})}),result=await response.json();if(!response.ok)throw Error(result.error);toast(result.window?.note||'已切到窗口');}catch(error){toast(error.message);}finally{button.disabled=false;}
 });
 root.addEventListener('submit',async event=>{
   const form=event.target;if(!form.matches('[data-column-form]'))return;event.preventDefault();
   const button=form.querySelector('[type=submit]'),message=form.querySelector('[data-column-message]');button.disabled=true;message.textContent='正在保存栏目…';
   const editing=!!form.dataset.editId;
   try{
     const input={name:form.elements.namedItem('name').value,description:form.elements.namedItem('description').value};
     const response=await fetch('/api/prep/columns',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:editing?'edit':'create',input,...(editing?{id:form.dataset.editId,revision:Number(form.dataset.revision)}:{})})}),result=await response.json();
     if(!response.ok)throw Error(result.error||'栏目保存失败');
     const data=await api('/api/prep/status');lastData=data;root.querySelector('#status-sections').innerHTML=prepareSections(esc,data);
     const panel=root.querySelector('#column-manager');panel.innerHTML=columnManager(esc,data.columns);panel.querySelector('[data-column-message]').textContent=editing?`栏目已更新，同步 ${result.updatedRecords} 条记录。`:'栏目已创建，AI 交稿时即可选择。';toast(editing?'栏目已更新':'栏目已创建');
   }catch(error){message.textContent=error.message;}finally{button.disabled=false;}
 });
 root.addEventListener('click',event=>{
   const chip=event.target.closest('[data-column-filter]');if(!chip)return;
   activeColumn=chip.dataset.columnFilter;
   const sections=root.querySelector('#status-sections');
   if(lastData&&sections)sections.innerHTML=prepareSections(esc,lastData);
 });
 root.addEventListener('click',async event=>{
   const button=event.target.closest('[data-copy-prompt]');if(!button)return;
   button.disabled=true;
   try{const response=await fetch('/api/prep/ai-prompt');if(!response.ok)throw Error('暂未取得接入指令');
     await navigator.clipboard.writeText(await response.text());
     toast('已复制 AI 接入指令，可直接粘贴');}
   catch(error){toast('复制失败：'+error.message);}
   finally{button.disabled=false;}
 });
 let refreshing=false;
 const timer=setInterval(async()=>{
   if(!root.isConnected){clearInterval(timer);return;}if(document.hidden||refreshing)return;
   refreshing=true;
   try{const data=await api('/api/prep/status');if(!root.isConnected)return;
     // 不打断已展开的诊断、键盘焦点或正在置前的按钮。
     if(!root.querySelector('details[open],button:disabled')&&!root.contains(document.activeElement)&&root.querySelector('#column-manager')?.hidden!==false){lastData=data;root.querySelector('#status-sections').innerHTML=prepareSections(esc,data);const panel=root.querySelector('#column-manager');if(panel)panel.innerHTML=columnManager(esc,data.columns);}
     root.querySelector('#status-message').textContent='公众号仅存草稿；X 和小红书可按稿件设置直接发布，发布后核对公开链接。状态更新于 '+time(new Date().toISOString());
   }catch{if(root.isConnected)root.querySelector('#status-message').textContent='暂未取得新状态，保留上次记录。';}finally{refreshing=false;}
 },5000);
}
