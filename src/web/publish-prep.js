// 检查和填写都由用户显式点击；没有最终发布动作。
async function vPrepare() {
  const data = await api('/api/prep'), params = new URLSearchParams(location.hash.split('?')[1] || '');
  const episodeId = params.get('episode') || '';
  if(data.records.some(r=>r.state==='running'))pollPreparations();
  let initial = {};
  if (episodeId) {
    const ep = await api('/api/episode?id=' + encodeURIComponent(episodeId));
    const t = ep.tasks.find(t => t.platform === params.get('platform'));
    if (t) initial = { platform: t.platform, title: t.copy.title, content: t.copy.body };
  }
  const states = { prepared: '本地任务已生成', checked: '离线检查通过', check_failed: '离线检查失败', failed: '执行失败，先核对平台', running: '正在运行，请勿重复操作', unknown: '结果未确认，先核对平台，禁止重跑', awaiting_user: '已填待手动发布', draft_saved: '已保存公众号草稿',published:'公开链接已核验' };
  return `<a class="back" href="#/system">‹ 系统</a><div class="h1">准备发布</div>
    <p class="lead">X 可下载已验收的文图包。编辑器填写通道已接入但尚未真实验收，默认关闭；小红书仅填写图文；公众号只存草稿。</p>
    <div class="grid g3">${Object.entries(data.capabilities).map(([p,c]) => `<div class="panel"><h3>${esc(PN[p])}</h3><p>${esc(c.mode)}</p><p class="note">${esc(c.reason)}</p></div>`).join('')}</div>
    ${sec('新建准备任务', episodeId ? '从作品文案带入；请核对' : '不会自动读取或复用浏览器登录态')}
    <form id="prep-form" class="panel">
      <input type="hidden" name="episodeId" value="${esc(episodeId)}">
      <label>平台 <select name="platform">${['x','xhs','wechat'].map(p => `<option value="${p}" ${initial.platform === p ? 'selected' : ''}>${esc(PN[p])}</option>`).join('')}</select></label>
      <p class="note">小红书账号固定：ai / TwoPeanuts。填写上传只在你显式点击后运行；不会点击平台发布。</p>
      <label style="display:block;margin-top:14px">标题（X 可空）<input name="title" style="width:100%" value="${esc(initial.title || '')}"></label>
      <label style="display:block;margin-top:14px">正文<textarea name="content" rows="8" style="width:100%" required>${esc(initial.content || '')}</textarea></label>
      <label style="display:block;margin-top:14px">公众号摘要（最多120字，可空）<textarea name="caption" rows="2" style="width:100%"></textarea></label>
      <label style="display:block;margin-top:14px">选择本机图片（保持选择顺序）<input id="prep-files" type="file" accept="image/png,image/jpeg,image/webp" multiple></label>
      <div id="prep-image-review"></div>
      <details><summary>或填写本机图片绝对路径</summary><textarea name="images" rows="3" style="width:100%" aria-label="本机图片绝对路径"></textarea></details>
      <p class="note">单张不超过32MB，整组不超过64MB。X 下载包保留图片顺序和完整正文。</p>
      <label style="display:block;margin-top:14px">话题（逗号分隔，最多10个）<input name="topics" style="width:100%" placeholder="AI,科技"></label>
      <details><summary>小红书图片 / 文本审阅记录</summary><p class="note">粘贴本地 skill 的 promotionReview JSON。必须实际逐张审阅后填写；缺失会由 skill 阻止上传，本页不会自动生成已审声明。</p><textarea name="promotionReview" rows="4" style="width:100%" placeholder="{}"></textarea></details>
      <p><label><input type="checkbox" name="test"> 明确标为测试稿（标题、正文都加标记；仍勿发表）</label></p>
      <button class="btn pri" type="submit">生成准备任务</button><p id="prep-message" role="status"></p>
    </form>
    ${sec('准备记录', '本地任务 / 离线检查不等于平台已填好')}
    <div class="panel">${data.records.map(r => {
      const cap = data.capabilities[r.platform], terminal = ['running','unknown','awaiting_user','draft_saved','published','failed'].includes(r.state);
      const receipt = r.evidence ? `<details open><summary>填写回执 · ${esc(r.id)}</summary><p>submitted: ${r.evidence.submitted === false ? 'false（未最终发布）' : '未确认'}${r.evidence.dryRun === true ? ' · dryRun: true' : ''} · ${esc(r.finishedAt || '')}</p>${r.readOnlyReceipt ? '<p>隔离库历史真实上传回执（只读）；不是正式网页新上传成功。</p>' : ''}${r.evidence.screenshot ? `<p>本机回执截图：${esc(r.evidence.screenshot)}</p>` : ''}${r.windowEvidence?.verified ? `<p>留窗已核实：ai 专用 9333 / PID ${esc(r.windowEvidence.pid)} · ${esc(r.windowEvidence.checkedAt)}；${r.windowEvidence.titleMatched ? "标题已匹配，正文图片需本人确认。" : "仅核实窗口，当前表单内容需本人确认。"}</p>` : ''}</details>` : '';
      const links=`<p>${r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">打开已核验公开链接</a>` : '本人发布后，可在此核对公开链接。'}</p><label>实际发表日期 <input type="date" data-link-date="${r.id}" value="${new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai'}).format(new Date())}"></label> <button class="btn" data-prep="links" data-platform="${r.platform}" data-id="${r.id}" ${!cap.inspectEnabled||r.state==='running'?'disabled':''}>从已发布列表取链接</button>`;
      const xControls = r.platform === 'x' ? `<a class="btn" href="/api/prep/bundle?id=${r.id}" download="x-draft.zip">下载 X 文图包（${r.imageCount || 0} 图）</a><a class="btn" href="/api/prep/x?id=${r.id}" target="_blank" rel="noopener noreferrer">打开 X 文字草稿</a><button class="btn pri" data-prep="execute" data-platform="x" data-id="${r.id}" ${r.state !== 'prepared' || !cap.browserEnabled ? 'disabled' : ''}>填写 X 文图编辑器</button>` : '';
      const skillControls = r.platform !== 'x' && !r.readOnlyReceipt ? `<button class="btn" data-prep="check" data-id="${r.id}" ${terminal ? 'disabled' : ''}>运行本地 skill 离线检查</button><button class="btn pri" data-prep="execute" data-id="${r.id}" ${r.state !== 'checked' || !cap.browserEnabled ? 'disabled' : ''}>${r.platform === 'wechat' ? '保存公众号草稿' : '填写上传（不发布）'}</button>` : '';
      return `<div data-prep-record="${r.id}" style="padding:16px 0;border-bottom:1px solid var(--line)"><h3>${esc(PN[r.platform])} · ${esc(r.title || '文字草稿')}${r.test ? ' · 测试稿' : ''}</h3><p>${esc(states[r.state] || r.state)} · ${esc(r.note || '')}</p>${r.error ? `<p role="alert">${esc(r.error)}</p>` : ''}${receipt}<div class="btns">${r.readOnlyReceipt ? '' : `<a class="btn" href="/api/prep/job?id=${r.id}" download="job.json">下载本地任务</a>`}${xControls}${skillControls}${r.platform==='xhs' && !r.windowReleased && ['awaiting_user','unknown'].includes(r.state) ? `<button class="btn" data-prep="window" data-id="${r.id}">切到 ai 专用编辑窗口</button>` : ''}${r.platform==='xhs' && r.state==='awaiting_user' && !r.windowReleased ? `<button class="btn" data-prep="release-window" data-id="${r.id}">我已手动处理现稿，解除占用</button>` : r.windowReleased ? '<p>本人已确认现稿不再占用窗口；这不代表已发布。</p>' : ''}</div>${!cap.browserEnabled || r.platform === 'x' ? `<p class="note">${esc(r.platform === 'x' ? (cap.browserEnabled ? '仅在显式配置专用 Chrome 后可点填写；真实 9336 会话填写尚未验收。' : cap.reason) : cap.reason)}</p>` : ''}${links}</div>`;
    }).join('') || '<p>还没有准备任务。</p>'}</div><p class="note">无平台ID时需要完整匹配文字与发表日期；缺少信息、匹配不唯一或没有真实公开链接均不回写。其他平台未适配；不启用定时或后台自动运行。</p>`;
}
document.addEventListener('submit', async event => {
  if (event.target.id !== 'prep-form') return;
  event.preventDefault(); const form = event.target, button = form.querySelector('button[type=submit]'); button.disabled = true;
  try {
    const f = new FormData(form), platform = f.get('platform');
    const files=[...document.querySelector('#prep-files').files], paths=f.get('images').split(/\r?\n/).map(x=>x.trim()).filter(Boolean), review=JSON.parse(f.get('promotionReview') || '{}');
    if(files.length && paths.length) throw new Error('选图和绝对路径请只用一种方式');
    if(files.length>(platform==='x'?4:9) || files.reduce((n,file)=>n+file.size,0)>64*1024*1024) throw new Error('图片数量或总大小超限');
    const uploaded=[], reviews=[];
    for(const [i,file] of files.entries()) {
      const card=document.querySelector(`[data-image-review="${i}"]`);
      if(platform==='xhs' && (!card.querySelector('[name=visualChecked]').checked || !card.querySelector('[name=reviewer]').value.trim() || !card.querySelector('[name=rationale]').value.trim())) throw new Error('请逐张查看图片并填写审阅人、说明和实际可见文字');
      const res=await fetch('/api/prep/image?name='+encodeURIComponent(file.name),{method:'POST',headers:{'content-type':'application/octet-stream'},body:file}), image=await res.json();
      if(!res.ok)throw new Error(image.error || '图片保存失败'); uploaded.push(image.path);
      if(platform==='xhs')reviews.push({sha256:image.sha256,visualChecked:true,visibleText:card.querySelector('[name=visibleText]').value,reviewer:card.querySelector('[name=reviewer]').value.trim(),rationale:card.querySelector('[name=rationale]').value.trim(),conclusion:'no-outbound-promotion'});
    }
    if(reviews.length)review.images=reviews;
    const input = { platform, title: f.get('title'), content: f.get('content'), images: uploaded.length?uploaded:paths, topics: (f.get('topics') || '').split(/[,，]/).map(x=>x.trim()).filter(Boolean), test: f.has('test'),
      ...(platform === 'wechat' ? {caption:f.get('caption')} : {}),
      ...(f.get('episodeId') ? {episodeId:f.get('episodeId')} : {}), ...(platform === 'xhs' ? {promotionReview:review} : {}) };
    const res = await fetch('/api/prep', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({type:'create',input}) }), j = await res.json();
    if (!res.ok) throw new Error(j.error || '生成失败');
    await render(); toast('本地准备任务已生成；尚未操作平台');
  } catch (error) { form.querySelector('#prep-message').textContent = error.message; button.disabled = false; }
});
document.addEventListener('click', async event => {
  const b = event.target.closest('[data-prep]'); if (!b) return;
  const type = b.dataset.prep;
  if(type==='release-window' && !confirm('请先亲自处理专用窗口中的现稿。确认现稿不再占用编辑页后，才解除本地占用；不会操作平台，不代表已发布。结果未知不能解除。'))return;
  if(type==='window'||type==='release-window') {
    b.disabled=true;
    try {const res=await fetch('/api/prep',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type,id:b.dataset.id})}),j=await res.json();if(!res.ok)throw new Error(j.error);toast(j.window?.note || '已解除本地窗口占用；未操作平台');await render();}catch(e){toast(e.message);}finally{b.disabled=false;}
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
      const timer=setInterval(async()=>{try{const d=(await api('/api/l1/status')).platforms;if(d[b.dataset.platform].state!=='running'){clearInterval(timer);await render();toast(d[b.dataset.platform].last?.ok?'公开链接已核验':d[b.dataset.platform].last?.error||'未取得链接，未回写');}}catch(e){clearInterval(timer);toast(e.message);}},3000);
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
    await render();
    pollPreparations();
  } catch (error) { toast(error.message); b.disabled = false; }
});
let prepPoll;
function pollPreparations() {
  clearInterval(prepPoll);
  prepPoll=setInterval(async()=>{if(!location.hash.startsWith('#/prepare'))return clearInterval(prepPoll);try{const d=await api('/api/prep');if(!d.records.some(r=>r.state==='running')){clearInterval(prepPoll);await render();}}catch(e){clearInterval(prepPoll);toast(e.message);}},3000);
}
document.addEventListener('change',event=>{
  if(event.target.id!=='prep-files')return;
  const target=document.querySelector('#prep-image-review');
  for(const img of target.querySelectorAll('img'))URL.revokeObjectURL(img.src);
  target.innerHTML=[...event.target.files].map((file,i)=>`<div class="panel" data-image-review="${i}"><p>${i+1}. ${esc(file.name)}</p><img alt="第${i+1}张待审图片" style="max-width:240px;max-height:240px"><p class="note">小红书需实际查看每张图片后审阅；无文字可留空，不能借转图保留站外推广。</p><label>完整可见文字<textarea name="visibleText" style="width:100%"></textarea></label><label>审阅人<input name="reviewer"></label><label>具体审阅说明<input name="rationale" style="width:100%"></label><label><input type="checkbox" name="visualChecked"> 我已查看本图，确认无站外推广引导</label></div>`).join('');
  [...target.querySelectorAll('img')].forEach((img,i)=>img.src=URL.createObjectURL(event.target.files[i]));
});
