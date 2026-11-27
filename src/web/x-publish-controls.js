// Explicit per-manuscript target. Choices are server-confirmed signed-in accounts.
export function xPublishControls(esc,row,accounts=[]){
 if(!row.xTarget?.canStart)return '';
 const choices=accounts.filter(a=>!row.xTarget.pinned||a.id===row.xTarget.accountId);
 return `<form class="x-publish-form" data-x-publish="${esc(row.id)}"><label>X发布账户<select name="accountId" required ${choices.length?'':'disabled'}><option value="">请选择已登录账户</option>${choices.map(a=>`<option value="${esc(a.id)}">@${esc(a.handle)} · ${esc(a.label)}</option>`).join('')}</select></label><div class="btns"><button class="btn" type="submit" data-x-mode="draft" ${choices.length?'':'disabled'}>存X草稿</button><button class="btn pri" type="submit" data-x-mode="publish" ${choices.length?'':'disabled'}>发布到X</button></div><p class="note" role="status" data-x-publish-message>${choices.length?(row.xTarget.pinned?'稿件目标账户已固定，请明确选择后执行。':'先选择账户；检查通过后目标账户固定。'):'暂无可用的已登录账户，请先到「账号与采集」登录。'}</p></form>`;
}
export function bindXPublishControls(root,{refresh,toast}){
 root.addEventListener('submit',async event=>{
  const form=event.target;if(!form.matches('[data-x-publish]'))return;event.preventDefault();
  if(form.dataset.busy==='true')return;
  const accountId=form.elements.namedItem('accountId').value,mode=event.submitter?.dataset.xMode,id=form.dataset.xPublish;
  const message=form.querySelector('[data-x-publish-message]');
  if(!accountId||!['draft','publish'].includes(mode)){message.textContent='请先选择已登录账户和操作。';return;}
  form.dataset.busy='true';for(const b of form.querySelectorAll('button,select'))b.disabled=true;
  const send=async action=>{
   let response;try{response=await fetch('/api/prep/posts',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id,...action})});}
   catch{throw Error('请求结果未确认，请先查原记录，勿重复发布。');}
   const result=await response.json();if(!response.ok)throw Error(result.error||'操作未完成');return result;
  };
  try{
   message.textContent='正在核对所选账户与稿件…';
   await send({type:'select-x-account',accountId});
   const checked=await send({type:'check',platform:'x'});
   if(!checked.validation?.ok)throw Error('稿件检查未通过，请让交稿AI查看具体问题后修改。');
   await send({type:'fill',platform:'x',mode,accountId});
   toast(mode==='publish'?'X发布已开始，请等待核验回执':'X草稿保存已开始，请等待结果');
   try{localStorage.setItem('maitian:x-account',accountId);}catch{}
   await refresh(accountId);
  }catch(error){message.textContent=error.message;}
  finally{delete form.dataset.busy;for(const b of form.querySelectorAll('button,select'))b.disabled=false;}
 });
}
