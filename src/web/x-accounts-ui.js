// Identity comes from the signed-in account menu, never the user-entered label.
function xAccountCards(O, errorText){
 const busy=!!O.actions?.some(a=>!a.done)||!!pendingAction;
 const accounts=(O.xAccounts||[]).filter(a=>a.id!=='default'||a.handle);
 const cards=accounts.map(a=>{
  const s=(a.id===(O.xAccountId||'default')?O.health?.platforms?.x:a.status)||a.status||{},last=s.last,running=s.state==='running';
  const actionName={login:'登录',doctor:'检查账号',sync:'取链接',collect:'更新数据'}[last?.type]||'操作';
  const action=(type,text,disabled=false)=>`<button class="btn" type="button" ${disabled||busy&&!running?'disabled ':''}data-act='${esc(JSON.stringify({type,platform:'x',accountId:a.id}))}'>${esc(text)}</button>`;
  const remove=a.id!=='default'&&!a.handle&&!a.confirmed_at
    ? `<button class="btn" type="button" data-delete-x-account="${esc(a.id)}" data-account-label="${esc(a.label)}" ${busy||running?'disabled':''}>删除账户</button>` : '';
  const lastResult=last?`<div class="system-result ${last.ok?'success':'error'}"><p>${esc(last.ok?actionName+'已完成':errorText(last))}</p><p class="note">${esc(when(last.endedAt||last.startedAt))}</p>${last.error?`<details><summary>查看错误详情</summary><pre class="copy">${esc(last.error)}</pre></details>`:''}</div>`:'';
  return `<section class="panel system-account" data-x-account="${esc(a.id)}">
    <h3>${logo('x')} ${esc(a.label)} ${platformLoginHTML(s)}</h3>
    <p class="system-account-name">${esc(a.handle?'@'+a.handle:'尚未登录绑定')}</p>
    <p class="note">${a.handle?'已绑定的账号须保持一致。换账号请新增账户。':'在独立窗口完成 X 登录，等麦田确认账号后窗口会自动关闭。'}</p>
    <p class="note account-freshness">${esc(a.summary?.freshness?.label||'尚无采集数据')}</p>
    <p class="note system-login-state">${s.identity?.confirmedAt?`最近确认登录：${esc(when(s.identity.confirmedAt))}`:'尚未确认账号登录'}</p>
    <p class="note system-action-scope">更新今天 00:00 至点击时发布的作品数据，并读取当前粉丝数。</p>
    <div class="btns">${action('login',running?'正在登录…':'登录账号',running)}${action('collect','更新今日作品数据',!a.handle||running)}${remove}</div>
    ${running?`<p role="status">${esc(last?.progress?.message||'操作进行中…')}</p>${last?.type==='login'?`<div class="btns">${action('show-login','显示登录窗口')}${action('cancel-login','取消登录')}</div>`:''}`:lastResult}
  </section>`;
 }).join('');
 return `<section class="panel"><h2 class="h2">X 账户</h2><p class="note">每个账户独立登录、保存数据和选择发布目标，账户数量不固定。备注仅方便区分，不是登录身份。</p><form data-add-x-account class="platform-account-form"><label>账户备注<input name="label" maxlength="60" required placeholder="例如：工作号、生活号"></label><button type="submit" class="btn pri">新增 X 账户</button><p role="status" data-x-account-message></p></form></section><div class="grid g3 system-accounts">${cards}</div>`;
}
document.addEventListener('submit',async event=>{
 const form=event.target;if(!form.matches('[data-add-x-account]'))return;event.preventDefault();
 const button=form.querySelector('button'),message=form.querySelector('[data-x-account-message]');button.disabled=true;message.textContent='正在新增…';
 try{
  const response=await fetch('/api/l1/x-accounts',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({label:form.elements.namedItem('label').value})}),result=await response.json();
  if(!response.ok)throw Error(result.error||'新增失败');
  message.textContent='账户已新增，请点击登录账号。';await load();
 }catch(error){message.textContent=error.message;}finally{button.disabled=false;}
});
document.addEventListener('click',async event=>{
 const button=event.target.closest('[data-delete-x-account]');
 if(!button||button.disabled||pendingAction)return;
 const {deleteXAccount:id,accountLabel:label}=button.dataset;
 if(!confirm(`删除未绑定的 X 账户「${label}」？`))return;
 button.disabled=true;
 pendingAction={type:'delete-x-account'};
 actionError='';
 try {
  const response=await fetch('/api/l1/x-accounts',{method:'DELETE',headers:{'content-type':'application/json'},body:JSON.stringify({id})});
  const result=await response.json();
  if(!response.ok)throw Error(result.error||'删除失败');
  if(selectedXAccount===id)selectXAccount('default');
 } catch(error) {actionError=error.message;}
 finally {pendingAction=null;await load();}
});
