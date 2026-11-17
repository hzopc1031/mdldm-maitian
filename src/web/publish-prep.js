// 只生成本地任务。检查/执行都由用户显式点击；没有最终发布动作。
async function vPrepare() {
  const data = await api('/api/prep'), params = new URLSearchParams(location.hash.split('?')[1] || '');
  const episodeId = params.get('episode') || '';
  let initial = {};
  if (episodeId) {
    const ep = await api('/api/episode?id=' + encodeURIComponent(episodeId));
    const t = ep.tasks.find(t => t.platform === params.get('platform'));
    if (t) initial = { platform: t.platform, title: t.copy.title, content: t.copy.body };
  }
  const states = { prepared: '本地任务已生成', checked: '离线检查通过', check_failed: '离线检查失败', running: '正在操作', unknown: '结果未确认，先核对平台', awaiting_user: '已填好，等你在窗口确认', draft_saved: '已保存公众号草稿' };
  return `<a class="back" href="#/system">‹ 系统</a><div class="h1">准备发布</div>
    <p class="lead">X 下载文图草稿包，由你手工附图核对；小红书图文填好留给你发布；公众号只存草稿。不会自动发布。</p>
    <div class="grid g3">${Object.entries(data.capabilities).map(([p,c]) => `<div class="panel"><h3>${esc(PN[p])}</h3><p>${esc(c.mode)}</p><p class="note">${esc(c.reason)}</p></div>`).join('')}</div>
    ${sec('新建准备任务', episodeId ? '从作品文案带入；请核对' : '不会自动读取或复用浏览器登录态')}
    <form id="prep-form" class="panel">
      <input type="hidden" name="episodeId" value="${esc(episodeId)}">
      <label>平台 <select name="platform">${['x','xhs','wechat'].map(p => `<option value="${p}" ${initial.platform === p ? 'selected' : ''}>${esc(PN[p])}</option>`).join('')}</select></label>
      <label style="display:block;margin-top:14px">标题（X 可空）<input name="title" style="width:100%" value="${esc(initial.title || '')}"></label>
      <label style="display:block;margin-top:14px">正文<textarea name="content" rows="8" style="width:100%" required>${esc(initial.content || '')}</textarea></label>
      <label style="display:block;margin-top:14px">公众号摘要（最多120字，可空）<textarea name="caption" rows="2" style="width:100%"></textarea></label>
      <label style="display:block;margin-top:14px">本机图片绝对路径，每行一张（X 最多4张；小红书必填1–9张；公众号最多9张）<textarea name="images" rows="3" style="width:100%"></textarea></label>
      <p class="note">单张不超过32MB，整组不超过64MB。X 会复制图片到本地任务，下载包保留顺序与完整正文；不会上传或保存到 X。</p>
      <details><summary>小红书图片 / 文本审阅记录</summary><p class="note">粘贴本地 skill 的 promotionReview JSON。必须实际逐张审阅后填写；缺失会由 skill 阻止上传，本页不会自动生成已审声明。</p><textarea name="promotionReview" rows="4" style="width:100%" placeholder="{}"></textarea></details>
      <p><label><input type="checkbox" name="test"> 明确标为测试稿（标题、正文都加标记；仍勿发表）</label></p>
      <button class="btn pri" type="submit">生成准备任务</button><p id="prep-message" role="status"></p>
    </form>
    ${sec('准备记录', '本地任务 / 离线检查不等于平台已填好')}
    <div class="panel">${data.records.map(r => {
      const cap = data.capabilities[r.platform], terminal = ['running','unknown','awaiting_user','draft_saved','failed'].includes(r.state);
      return `<div style="padding:16px 0;border-bottom:1px solid var(--line)"><h3>${esc(PN[r.platform])} · ${esc(r.title || '文字草稿')}${r.test ? ' · 测试稿' : ''}</h3><p>${esc(states[r.state] || r.state)} · ${esc(r.note || '')}</p>${r.error ? `<p role="alert">${esc(r.error)}</p>` : ''}<div class="btns"><a class="btn" href="/api/prep/job?id=${r.id}" download="job.json">下载本地任务</a>${r.platform === 'x' ? `<a class="btn pri" href="/api/prep/bundle?id=${r.id}" download="x-draft.zip">下载 X 文图包（${r.imageCount || 0} 图）</a><a class="btn" href="/api/prep/x?id=${r.id}" target="_blank" rel="noopener noreferrer">打开 X 文字草稿</a>` : `<button class="btn" data-prep="check" data-id="${r.id}" ${terminal ? 'disabled' : ''}>运行本地 skill 离线检查</button><button class="btn" data-prep="execute" data-id="${r.id}" ${r.state !== 'checked' || !cap.browserEnabled ? 'disabled' : ''}>${r.platform === 'wechat' ? '保存公众号草稿' : '填写并上传，留在窗口'}</button>`}</div>${r.platform !== 'x' && !cap.browserEnabled ? `<p class="note">${esc(cap.reason)}</p>` : ''}${r.platform === 'x' ? '<p class="note">由你点击打开平台页面并登录 / 核对；本地未读取页面，不能标成 filled。文图包只在本机生成；文字链接不附图。请下载包后手工附图，长文权限与平台草稿保存仍需本人确认。</p>' : ''}</div>`;
    }).join('') || '<p>还没有准备任务。</p>'}</div><p class="note">体检和取链接在系统页 / 作品详情。新稿没有稳定平台 ID 时自动取链接未适配。其他平台未适配；不启用定时或后台自动运行。</p>`;
}
document.addEventListener('submit', async event => {
  if (event.target.id !== 'prep-form') return;
  event.preventDefault(); const form = event.target, button = form.querySelector('button[type=submit]'); button.disabled = true;
  try {
    const f = new FormData(form), platform = f.get('platform');
    const input = { platform, title: f.get('title'), content: f.get('content'), images: f.get('images').split(/\r?\n/).map(x => x.trim()).filter(Boolean), test: f.has('test'),
      ...(platform === 'wechat' ? {caption:f.get('caption')} : {}),
      ...(f.get('episodeId') ? {episodeId:f.get('episodeId')} : {}), ...(platform === 'xhs' ? {promotionReview:JSON.parse(f.get('promotionReview') || '{}')} : {}) };
    const res = await fetch('/api/prep', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({type:'create',input}) }), j = await res.json();
    if (!res.ok) throw new Error(j.error || '生成失败');
    await render(); toast('本地准备任务已生成；尚未操作平台');
  } catch (error) { form.querySelector('#prep-message').textContent = error.message; button.disabled = false; }
});
document.addEventListener('click', async event => {
  const b = event.target.closest('[data-prep]'); if (!b) return;
  const type = b.dataset.prep;
  if (!confirm(type === 'check' ? '将运行已有本地 DSH skill 的离线检查，不连接浏览器。继续？' : '将通过已获准通道操作专用窗口。小红书固定 ai，仅填好保留窗口；公众号只存草稿。结果不明时先人工核对，不直接重跑。继续？')) return;
  b.disabled = true;
  try {
    const res = await fetch('/api/prep', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type,id:b.dataset.id})}), j = await res.json();
    if (!res.ok) throw new Error(j.error || '操作失败');
    await render();
    const timer = setInterval(async () => { if (!location.hash.startsWith('#/prepare')) return clearInterval(timer); const d = await api('/api/prep'); if (!d.records.some(r => r.state === 'running')) { clearInterval(timer); await render(); } }, 3000);
  } catch (error) { toast(error.message); b.disabled = false; }
});
