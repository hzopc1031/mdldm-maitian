const time=at=>at&&Number.isFinite(Date.parse(at))?new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',dateStyle:'short',timeStyle:'short'}).format(new Date(at)):'时间未记录';
const short=id=>String(id).slice(0,8);
const tag=(esc,item)=>`<span class="status-tag" data-state="${esc(item.state)}" data-record-id="${esc(item.recordId??'')}">${esc(item.name)} · ${esc(item.label)}</span>`;
const reference=(esc,item)=>`<span class="note">${esc(short(item.rowId))}${item.recordId?' / '+esc(short(item.recordId)):''}</span>`;
export function prepareSections(esc,data) {
  return `<section class="panel status-section" aria-labelledby="status-records-heading"><h2 class="h2" id="status-records-heading">发布记录</h2><p class="note">每份原稿保留一行；未关联原稿的旧准备记录单独列出。</p><div class="status-records">${data.rows.map(row=>`<article class="status-row" tabindex="-1" data-status-row="${esc(row.id)}"><div class="status-title"><h3>${esc(row.title)}</h3><p class="note"><time>${esc(time(row.at))}</time> · ${row.kind==='post'?'原稿':'旧记录'} ${esc(short(row.id))}</p></div><div class="status-tags" aria-label="平台状态">${row.items.map(item=>tag(esc,item)).join('')||'<span class="note">暂无平台版本</span>'}</div></article>`).join('')||'<p class="note">暂无发布记录。</p>'}</div></section>
  <section class="panel status-section" aria-labelledby="status-pending-heading"><h2 class="h2" id="status-pending-heading">待你处理</h2><p class="note">已填好的稿件等待你核对并点最终发布。切到窗口仅置前，不填写、不刷新。</p>${data.pending.map(item=>`<article class="status-pending" data-pending-record="${esc(item.recordId??'')}"><div><h3>${esc(item.title)}</h3>${tag(esc,item)} ${reference(esc,item)}</div>${item.canActivate?`<button class="btn" data-status-window="${esc(item.recordId)}">切到窗口</button>`:'<span class="note">请手动核对原窗口</span>'}</article>`).join('')||'<p class="note">暂无待你处理的稿件。</p>'}</section>
  <section class="panel status-section" aria-labelledby="status-failures-heading"><h2 class="h2" id="status-failures-heading">失败详情</h2><p class="note">未知结果请先核对原平台，避免重复执行。旧记录缺少的报错字段不补造。</p>${data.failures.map(item=>`<details class="status-failure" data-failure-record="${esc(item.recordId??'')}"><summary>${esc(item.title)} · ${esc(item.name)} · ${esc(item.label)} ${reference(esc,item)}</summary><dl>${Object.entries(item.detail).map(([key,value])=>`<dt>${esc(key)}</dt><dd><pre>${esc(value||'未记录')}</pre></dd>`).join('')}</dl></details>`).join('')||'<p class="note">暂无失败或未知记录。</p>'}</section>`;
}
export function preparePage(esc,data) {
 return `<main class="publish-page status-page"><header class="publish-heading"><div><h1 class="h1">发布状态</h1><p class="lead">内容由 AI 提交，这里查看进度和待办。</p></div><span class="status-readonly">只读</span></header><p id="status-message" class="note" role="status" aria-live="polite">公众号仅存草稿；最终发布由你完成。</p><div id="status-sections">${prepareSections(esc,data)}</div></main>`;
}
export function initPreparePage({esc,api,toast}) {
 const root=document.querySelector('.status-page');if(!root)return;
 const focusRecord=()=>{const params=new URLSearchParams(location.hash.split('?')[1]||''),id=params.get('post')||params.get('record');if(!id)return;const node=[...root.querySelectorAll('[data-status-row],[data-record-id]')].find(el=>el.dataset.statusRow===id||el.dataset.recordId===id);if(node){node.scrollIntoView({block:'center'});(node.closest('[data-status-row]')||node).focus();}};
 focusRecord();
 root.addEventListener('click',async event=>{
   const button=event.target.closest('[data-status-window]');if(!button||!root.contains(button))return;
   button.disabled=true;
   try{const response=await fetch('/api/prep',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'window',id:button.dataset.statusWindow})}),result=await response.json();if(!response.ok)throw Error(result.error);toast(result.window?.note||'已切到窗口');}catch(error){toast(error.message);}finally{button.disabled=false;}
 });
 let refreshing=false;
 const timer=setInterval(async()=>{
   if(!root.isConnected){clearInterval(timer);return;}if(document.hidden||refreshing)return;
   refreshing=true;
   try{const data=await api('/api/prep/status');if(!root.isConnected)return;
     // 不打断已展开的诊断、键盘焦点或正在置前的按钮。
     if(!root.querySelector('details[open],button:disabled')&&!root.contains(document.activeElement))root.querySelector('#status-sections').innerHTML=prepareSections(esc,data);
     root.querySelector('#status-message').textContent='公众号仅存草稿；最终发布由你完成。状态更新于 '+time(new Date().toISOString());
   }catch{if(root.isConnected)root.querySelector('#status-message').textContent='暂未取得新状态，保留上次记录。';}finally{refreshing=false;}
 },5000);
}