// Check and platform preparation remain explicit actions on each saved draft.

async function preparationData() {
  const data = await api('/api/prep');
  const id = new URLSearchParams(location.hash.split('?')[1] || '').get('record');
  if (id && !data.records.some(record => record.id===id)) {
    const result = await api('/api/prep/record?id='+encodeURIComponent(id));
    data.records.unshift(result.record);
  }
  return data;
}

async function loadPreparePage(){return import('/static/prepare-page.js');}
async function vPrepare() {
  const params=new URLSearchParams(location.hash.split('?')[1]||'');
  if(params.get('format')==='video') {const {videoProjectPage,initVideoProject}=await import('/static/video-project.js');after=initVideoProject;return videoProjectPage(esc,logo);}
  const data=await preparationData(),page=await loadPreparePage();
  const episode=params.get('episode')?await api('/api/episode?id='+encodeURIComponent(params.get('episode'))):null;
  after=()=>{void page.initPreparePage({esc,config:data,postId:params.get('post'),initial:episode?.tasks.find(t=>t.platform===params.get('platform'))});};
  return page.preparePage(esc,preparationRecords(data));
}

function preparationRecords(data, filters = {}) {
  const isTest=r=>r.test===true||r.readOnlyReceipt===true||/^【测试(?:稿)?】/.test(r.title||'');
  const regular=data.records.filter(r=>!isTest(r)), tests=data.records.filter(isTest);
  const states = { prepared: '本地任务已生成', checked: '离线检查通过', check_failed: '离线检查失败', failed: '执行失败，先核对平台', running: '正在运行，请勿重复操作', unknown: '结果未确认，先核对平台，禁止重跑', awaiting_user: '已填待手动发布', draft_saved: '已保存公众号草稿',submitted:'已提交小红书，公开状态待核对',already_exists:'平台已有稿，本次未重复提交',published:'公开链接已核验' };
  const filter = (key, label) => {
    const choices = [...new Set(regular.map(r => r.source?.[key]).filter(Boolean))].sort((a,b) => a.localeCompare(b,'zh-CN'));
    return `<label>${label}<select data-prep-filter="${key}"><option value="">全部</option>${choices.map(value => `<option value="${esc(value)}" ${filters[key]===value?'selected':''}>${esc(value)}</option>`).join('')}</select></label>`;
  };
  const toolbar = regular.some(r => r.source) ? `<div class="prep-record-filters">${filter('column','栏目')}</div>` : '';
  const renderRecords=records=>records.map(r => {
      const cap = data.capabilities[r.platform], terminal = ['running','unknown','awaiting_user','draft_saved','published','submitted','already_exists','failed'].includes(r.state);
      const hasReceipt=r.evidence && (r.state!=='unknown' || r.evidence.savedAsDraft===true || r.evidence.editorFilled===true || r.evidence.dryRun===true);
      const receipt = hasReceipt ? `<details open><summary>${r.kind==='publish'?'发布':'填写'}回执 · ${esc(r.id)}</summary><p>submitted: ${r.evidence.submitted === true ? 'true（已提交平台，公开状态另行核对）' : r.evidence.submitted === false ? 'false（本次未最终发布）' : '未确认'}${r.evidence.dryRun === true ? ' · dryRun: true' : ''} · ${esc(r.finishedAt || '')}</p>${r.readOnlyReceipt ? '<p>隔离库历史真实上传回执（只读）；不是正式网页新上传成功。</p>' : ''}${r.evidence.screenshot ? `<p>本机回执截图：${esc(r.evidence.screenshot)}</p>` : ''}${r.windowEvidence?.verified ? `<p>留窗已核实：ai 专用 9333 / PID ${esc(r.windowEvidence.pid)} · ${esc(r.windowEvidence.checkedAt)}；${r.windowEvidence.titleMatched ? "标题已匹配，正文图片需本人确认。" : "仅核实窗口，当前表单内容需本人确认。"}</p>` : ''}</details>` : '';
      const failure=r.platform==='wechat' && r.state==='unknown' ? `<p class="note">${r.failureEvidence?.saveConfirmed===true ? '保存证明已收到；整个任务尚未完整成功，请核对浏览器收尾。' : '保存结果未确认；草稿箱中出现同名稿不等于已经读到显式保存成功提示。'}禁止重复建稿。${r.failureEvidence ? ` 诊断：退出码 ${esc(r.failureEvidence.exitCode ?? '未知')}；回执${r.failureEvidence.receiptParsed?'已解析':'未解析'}；操作错误码 ${esc(r.failureEvidence.operationCode || r.failureEvidence.skillCode || '未知')}。` : ' 旧任务未保留底层回执，无法追溯具体失败阶段。'}</p>` : '';
      const links=`<p>${r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">打开已核验公开链接</a>` : '本人发布后，可在此核对公开链接。'}</p><label>实际发表日期 <input type="date" data-link-date="${r.id}" value="${new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai'}).format(new Date())}"></label> <button class="btn" data-prep="links" data-platform="${r.platform}" data-id="${r.id}" ${!cap.inspectEnabled||r.state==='running'?'disabled':''}>从已发布列表取链接</button>`;
      const xControls = r.platform === 'x' && !r.publication ? `<a class="btn" href="/api/prep/bundle?id=${r.id}" download="x-draft.zip">下载 X 文图包（${r.imageCount || 0} 图）</a><a class="btn" href="/api/prep/x?id=${r.id}" target="_blank" rel="noopener noreferrer">打开 X 文字草稿</a>` : '';
      const skillControls = r.platform !== 'x' && !r.readOnlyReceipt ? `<button class="btn" data-prep="check" data-id="${r.id}" ${terminal ? 'disabled' : ''}>检查稿件</button><button class="btn pri" data-prep="execute" data-id="${r.id}" ${r.state !== 'checked' || !cap.browserEnabled ? 'disabled' : ''}>${r.platform === 'wechat' ? '存为公众号草稿（不发表）' : '填入小红书（不发布）'}</button>` : '';
      const publishControls='';
      const origin = r.source ? `<p class="note prep-record-origin">栏目：${esc(r.source.column)} <span>来自 ${esc(r.source.project)}</span></p>` : '';
      const agent=r.source?.agent;
      const attribution=`<p class="note">交稿 AI：${agent?esc(agent.name)+'（'+(agent.basis==='environment'?'客户端运行环境上报':'调用方声明')+'）':'未记录'}${r.publication?' · 外部发布回执，发布 AI 未记录':''}</p>`;
      const provenance=agent?`<p class="note">交稿会话：${esc(agent.sessionId)}。来源为客户端上报，不是平台身份认证。</p>`:'';
      const operations=(r.operations??[]).map(op=>`<p class="note">${op.kind==='publish'?'发布':op.kind==='check'?'检查':'填写 / 存草稿'}：${op.actor?esc(op.actor.name):'AI未记录（网页或旧客户端）'} · ${esc(when(op.startedAt))} · ${esc(states[op.state]||op.state||'进行中')}${op.actor?` · 会话 ${esc(op.actor.sessionId)}`:''}${op.authorization?` · 授权引用 ${esc(op.authorization.reference)}`:''}</p>`).join('');
      const state = r.publication ? '已登记外部发布回执' : r.source && r.state==='prepared' ? '项目交稿，待核对' : states[r.state] || r.state;
      const published = r.publication ? `<p><a class="text-link" href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">打开原帖 ↗</a> <span class="note">${esc(when(r.publishedAt))} 发布</span></p>` : '';
      return `<article class="prep-record" data-prep-record="${r.id}" data-column="${esc(r.source?.column || '')}"><div class="prep-record-head">${logo(r.platform)}<div><h3>${esc(r.title || (r.platform === 'x' ? 'X 帖文' : PN[r.platform]))}${isTest(r) ? ' · 测试稿' : ''}</h3><p class="note">${esc(PN[r.platform])} · ${esc(state)}</p>${origin}${attribution}${published}</div></div>${r.error ? `<p role="alert">${esc(r.error)}</p>` : ''}${failure}<div class="btns">${xControls}${skillControls}${publishControls}${r.platform==='xhs' && !r.windowReleased && ['awaiting_user','unknown'].includes(r.state) ? `<button class="btn" data-prep="window" data-id="${r.id}">切到 ai 专用编辑窗口</button>` : ''}${r.platform==='xhs' && r.state==='awaiting_user' && !r.windowReleased ? `<button class="btn" data-prep="release-window" data-id="${r.id}">我已手动处理现稿，解除占用</button>` : r.windowReleased ? '<p>本人已确认现稿不再占用窗口；这不代表已发布。</p>' : ''}</div>${!r.publication && (!cap.browserEnabled || r.platform === 'x') ? `<p class="note">${esc(cap.reason)}</p>` : ''}<details class="prep-record-details"><summary>AI来源、回执与作品链接</summary>${provenance}${operations}${receipt}${r.note ? `<p class="note">${esc(r.note)}</p>` : ''}${links}${r.readOnlyReceipt ? '' : `<p><a class="text-link" href="/api/prep/job?id=${r.id}" download="job.json">下载本地任务</a></p>`}</details></article>`;
    }).join('');
  return `${toolbar}<p class="note prep-filter-empty" hidden>没有符合筛选的稿件。</p>${renderRecords(regular)||'<p class="note prep-empty">暂无正式稿件记录。</p>'}${tests.length?`<details class="prep-tests"><summary>测试与验收记录（${tests.length}）</summary><p class="note">历史测试记录单独保留，不作为正式发布成果。</p>${renderRecords(tests)}</details>`:''}`;
}

async function refreshPreparationRecords() {
  const data = await preparationData();
  const records = document.querySelector('#prep-records');
  if (records) {
    const filters = Object.fromEntries(Array.from(records.querySelectorAll('[data-prep-filter]'), select => [select.dataset.prepFilter, select.value]));
    records.innerHTML = preparationRecords(data, filters);
    applyPreparationFilters(records);
  }
  return data;
}

function applyPreparationFilters(records) {
  const filters = Array.from(records.querySelectorAll('[data-prep-filter]')).filter(select => select.value);
  let visible = 0;
  for (const row of records.querySelectorAll('[data-prep-record]')) {
    if(row.closest('.prep-tests')) { row.hidden=false; continue; }
    row.hidden = !filters.every(select => row.dataset[select.dataset.prepFilter] === select.value);
    if (!row.hidden) visible++;
  }
  records.querySelector('.prep-filter-empty').hidden = visible>0 || filters.length===0;
}

document.addEventListener('change', event => {
  if (event.target.matches('[data-prep-filter]')) applyPreparationFilters(event.target.closest('#prep-records'));
});
document.addEventListener('click', async event => {
  if (event.target.closest('[data-prep-preview]')) {
    document.querySelector('.prep-preview')?.focus();
    return;
  }
  if (event.target.closest('[data-prep-history]')) {
    document.querySelector('#prep-history')?.focus();
    return;
  }
  const b = event.target.closest('[data-prep]'); if (!b) return;
  const type = b.dataset.prep;
  if(type==='release-window' && !confirm('请先亲自处理专用窗口中的现稿。确认现稿不再占用编辑页后，才解除本地占用；不会操作平台，不代表已发布。结果未知不能解除。'))return;
  if(type==='window'||type==='release-window') {
    b.disabled=true;
    try {const res=await fetch('/api/prep',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type,id:b.dataset.id})}),j=await res.json();if(!res.ok)throw new Error(j.error);toast(j.window?.note || '已解除本地窗口占用；未操作平台');await refreshPreparationRecords();}catch(e){toast(e.message);}finally{b.disabled=false;}
    return;
  }
  if(type==='links') {
    const date=document.querySelector(`[data-link-date="${b.dataset.id}"]`).value;
    if(!date)return toast('请选择实际发表日期');
    if(!confirm(`将只读核对 ${date} 的可见已发布列表；不会发布或重发。继续？`))return;
    b.disabled=true;
    try {
      const res=await fetch('/api/action',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'sync',platform:b.dataset.platform,preparationId:b.dataset.id,date})}),j=await res.json();
      if(!res.ok)throw new Error(j.error||'取链接失败');
      const timer=setInterval(async()=>{try{const d=(await api('/api/l1/status')).platforms;if(d[b.dataset.platform].state!=='running'){clearInterval(timer);await refreshPreparationRecords();toast(d[b.dataset.platform].last?.ok?'公开链接已核验':d[b.dataset.platform].last?.error||'未取得链接，未回写');}}catch(e){clearInterval(timer);toast(e.message);}},3000);
    }catch(e){toast(e.message);b.disabled=false;}
    return;
  }
  const prompt = type === 'check' ? '运行已有本地 DSH skill 的离线检查？'
    : b.dataset.platform === 'x' ? '在获准的 X 专用 Chrome 另开空白编辑页并填写文图？填好后保留编辑页供你核对。'
    : '通过已获准的专用窗口填写小红书 ai 或保存公众号草稿？';
  if (!confirm(prompt)) return;
  b.disabled = true;
  try {
    const res = await fetch('/api/prep', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type,id:b.dataset.id})}), j = await res.json();
    if (!res.ok) throw new Error(j.error || '操作失败');
    await refreshPreparationRecords();
    pollPreparations();
  } catch (error) { toast(error.message); b.disabled = false; }
});
let prepPoll;
function pollPreparations() {
  clearInterval(prepPoll);
  prepPoll=setInterval(async()=>{if(!location.hash.startsWith('#/prepare'))return clearInterval(prepPoll);try{const d=await preparationData();if(!d.records.some(r=>r.state==='running')){clearInterval(prepPoll);await refreshPreparationRecords();}}catch(e){clearInterval(prepPoll);toast(e.message);}},3000);
}
