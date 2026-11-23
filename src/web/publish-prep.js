// Check and platform preparation remain explicit actions on each saved draft.
const prepPlatforms = ['x', 'xhs', 'wechat'];
const prepStyles = {x:'帖文', xhs:'图文笔记', wechat:'公众号文章'};
const prepContentLimits = {x:2000, xhs:1000, wechat:50000};

async function preparationData() {
  const data = await api('/api/prep');
  const id = new URLSearchParams(location.hash.split('?')[1] || '').get('record');
  if (id && !data.records.some(record => record.id===id)) {
    const result = await api('/api/prep/record?id='+encodeURIComponent(id));
    data.records.unshift(result.record);
  }
  return data;
}

async function vPrepare() {
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  if (params.get('format') === 'video') {
    const {videoProjectPage,initVideoProject} = await import('/static/video-project.js');
    after = initVideoProject;
    return videoProjectPage(esc,logo);
  }
  const data = await preparationData();
  const episodeId = params.get('episode') || '';
  if (data.records.some(r => r.state==='running')) pollPreparations();
  const episode = episodeId ? await api('/api/episode?id=' + encodeURIComponent(episodeId)) : null;
  const initial = episode?.tasks.find(t => t.platform === params.get('platform'));
  const selected = prepPlatforms.includes(initial?.platform) ? initial.platform : '';
  after = () => {
    initComposer(data.capabilities, episode);
    const id=params.get('record');
    const record=Array.from(document.querySelectorAll('[data-prep-record]')).find(row=>row.dataset.prepRecord===id);
    if(record) { const tests=record.closest?.('.prep-tests');if(tests)tests.open=true;record.tabIndex=-1; record.focus(); record.scrollIntoView({block:'start'}); }
  };
  return `<main class="publish-page">
    <header class="publish-heading"><div><h1 class="h1">发布</h1><p class="lead">写一份原稿，为不同平台分别调整。</p></div><div class="publish-jumps"><a class="btn" href="#/prepare?format=video">视频工程</a><button class="btn prep-mobile-preview" type="button" data-prep-preview hidden>预览</button><button class="btn" type="button" data-prep-history>发布记录</button></div></header>
    <form id="prep-form" class="prep-composer" data-platform="${selected}">
      <section class="panel prep-editor" aria-label="编辑内容">
        <section class="prep-source" aria-labelledby="prep-source-title">
          <h2 id="prep-source-title">原稿</h2>
          <label class="prep-field">原稿标题 <span class="note">可留空</span><input name="sourceTitle" placeholder="给内容起个标题" value="${esc(initial?.copy.title || '')}"></label>
          <label class="prep-field">原稿正文<textarea name="sourceContent" rows="5" placeholder="粘贴或写下要分享的内容…">${esc(initial?.copy.body || '')}</textarea></label>
        </section>
        <fieldset class="prep-platforms"><legend>发布平台 <span class="note">可多选</span></legend>${prepPlatforms.map(p => `<label class="prep-platform"><input type="checkbox" name="target" value="${p}" ${selected===p?'checked':''}><span>${logo(p)}${esc(PN[p])}</span></label>`).join('')}</fieldset>
        <section class="prep-variants" hidden>
          <h2>平台稿</h2><div class="prep-edition-tabs" role="group" aria-label="切换编辑平台">${prepPlatforms.map(p=>`<button type="button" class="btn" data-prep-edition="${p}" aria-pressed="false" hidden>${esc(PN[p])}</button>`).join('')}</div>
          ${prepPlatforms.map(platform => prepEdition(platform, episode)).join('')}
          <div class="prep-footer"><p id="prep-message" role="status"></p><button class="btn pri" type="submit">保存本地草稿</button></div>
        </section>
      </section>
      <aside class="panel prep-preview" tabindex="-1" aria-label="内容预览" hidden>
        <div class="prep-preview-heading"><h2>内容预览</h2><span class="note" id="prep-preview-platform"></span></div>
        <div class="prep-preview-card"><h3 id="prep-preview-title" hidden></h3><div id="prep-preview-media" class="prep-preview-media"></div><p id="prep-preview-content" class="prep-preview-content"></p><p id="prep-preview-extra" class="note" hidden></p></div>
        <div class="prep-preview-next"><h3 id="prep-next-heading"></h3><p id="prep-next-copy" class="note"></p></div>
      </aside>
    </form>
    <section class="prep-history" id="prep-history" tabindex="-1" aria-labelledby="prep-history-label"><h2 id="prep-history-label">发布记录</h2><div id="prep-records" class="panel">${preparationRecords(data)}</div></section>
  </main>`;
}

function prepEdition(platform, episode) {
  const task = episode?.tasks.find(t => t.platform === platform);
  const previewFields = {
    x: '',
    xhs: '<label class="prep-field prep-topics">话题<input data-draft-topics placeholder="如 AI，科技"></label>',
    wechat: '<label class="prep-field prep-caption">摘要 <span class="note">可留空</span><textarea data-draft-caption rows="2" maxlength="120" placeholder="概括文章内容"></textarea></label>',
  };
  return `<section class="prep-edition" data-edition="${platform}" hidden aria-label="${esc(PN[platform])}稿">
    <div class="prep-edition-heading"><span class="note" data-edition-origin>${task ? '已带入作品文案' : '沿用原稿'}</span><button type="button" class="text-link prep-use-source" data-use-source hidden>恢复为原稿</button></div>
    ${platform==='x' ? '' : `<label class="prep-field prep-title">标题<input data-draft-title ${task?.copy.title?'data-custom="true"':''} placeholder="给${prepStyles[platform]}起个标题" value="${esc(task?.copy.title || '')}"></label>`}
    <div class="prep-media"><div class="prep-media-head"><label class="btn" for="prep-files-${platform}">选择图片</label><span class="note" data-media-limit></span></div><input id="prep-files-${platform}" data-draft-files type="file" aria-label="为${esc(PN[platform])}选择图片" accept="image/png,image/jpeg,image/webp" multiple><div class="prep-thumbnails"></div>${platform==='xhs'?'<div data-image-reviews></div>':''}</div>
    <label class="prep-field prep-content">${esc(PN[platform])}正文<textarea data-draft-content ${task?.copy.body?'data-custom="true"':''} rows="5" placeholder="可单独修改这一版">${esc(task?.copy.body || '')}</textarea></label>
    ${previewFields[platform]}
    <details class="prep-options"><summary>更多选项</summary>
      <label class="prep-field">本机图片路径 <span class="note">每行一条，和选图二选一</span><textarea data-draft-paths rows="2"></textarea></label>
      ${platform==='xhs'?'<label class="prep-field">导入现有审阅记录<textarea data-draft-review rows="3" placeholder="粘贴现有审阅记录"></textarea></label>':''}
      <label class="prep-test"><input type="checkbox" data-draft-test> 标为测试稿</label>
    </details>
  </section>`;
}

function preparationRecords(data, filters = {}) {
  const isTest=r=>r.test===true||r.readOnlyReceipt===true||/^【测试稿】/.test(r.title||'');
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
      const xControls = r.platform === 'x' && !r.publication ? `<a class="btn" href="/api/prep/bundle?id=${r.id}" download="x-draft.zip">下载 X 文图包（${r.imageCount || 0} 图）</a><a class="btn" href="/api/prep/x?id=${r.id}" target="_blank" rel="noopener noreferrer">打开 X 文字草稿</a><button class="btn pri" data-prep="execute" data-platform="x" data-id="${r.id}" ${r.state !== 'prepared' || !cap.browserEnabled ? 'disabled' : ''}>填写 X 文图编辑器</button>` : '';
      const skillControls = r.platform !== 'x' && !r.readOnlyReceipt ? `<button class="btn" data-prep="check" data-id="${r.id}" ${terminal ? 'disabled' : ''}>检查稿件</button><button class="btn pri" data-prep="execute" data-id="${r.id}" ${r.state !== 'checked' || !cap.browserEnabled ? 'disabled' : ''}>${r.platform === 'wechat' ? '保存公众号草稿' : '填入小红书'}</button>` : '';
      const publishControls=r.platform==='xhs'&&cap.publishEnabled&&!isTest(r)?`<button class="btn pri" data-prep="publish" data-id="${r.id}" data-checked-digest="${esc(r.checkedDigest||'')}" ${r.state!=='checked'?'disabled':''}>发布小红书</button>`:'';
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

let releaseComposerImages = () => {};
addEventListener('hashchange', () => releaseComposerImages());

function initComposer(capabilities, episode) {
  const form = document.querySelector('#prep-form');
  releaseComposerImages();
  const editions = Object.fromEntries(prepPlatforms.map(p => [p, form.querySelector(`[data-edition="${p}"]`)]));
  const tabs = Array.from(form.querySelectorAll('[data-prep-edition]'));
  const selectedTargets = () => Array.from(form.querySelectorAll('[name=target]:checked'), input => input.value);
  const imageUrls = new Map();
  releaseComposerImages = () => {for (const urls of imageUrls.values()) urls.forEach(url => URL.revokeObjectURL(url));};
  let active = form.dataset.platform;
  const image = (url, i) => {
    const el = document.createElement('img');
    el.src = url;
    el.alt = `第 ${i+1} 张图片`;
    return el;
  };

  function updatePreview(preferred = active) {
    const selected = selectedTargets();
    active = selected.includes(preferred) ? preferred : selected[0] || '';
    form.dataset.platform = active;
    form.querySelector('.prep-variants').hidden = !active;
    form.querySelector('.prep-preview').hidden = !active;
    document.querySelector('[data-prep-preview]').hidden = !active;
    for (const platform of prepPlatforms) {
      const edition = editions[platform];
      edition.hidden = platform !== active;
      for (const [selector, source] of [['[data-draft-title]','sourceTitle'], ['[data-draft-content]','sourceContent']]) {
        const field = edition.querySelector(selector);
        if (field && !field.dataset.custom) field.value = form.elements[source].value;
      }
      const tailored = !!edition.querySelector('[data-custom]');
      edition.querySelector('[data-edition-origin]').textContent = tailored ? '已单独调整' : '沿用原稿';
      edition.querySelector('[data-use-source]').hidden = !tailored;
    }
    for (const tab of tabs) {
      tab.hidden = !selected.includes(tab.dataset.prepEdition);
      tab.setAttribute('aria-pressed', String(tab.dataset.prepEdition===active));
    }
    form.querySelector('button[type=submit]').textContent = selected.length>1 ? `保存 ${selected.length} 份本地草稿` : '保存本地草稿';
    if (!active) return;

    const edition = editions[active], cap = capabilities[active];
    const title = edition.querySelector('[data-draft-title]')?.value.trim() || '';
    const content = edition.querySelector('[data-draft-content]').value.trim();
    const previewTitle = form.querySelector('#prep-preview-title');
    previewTitle.hidden = !title;
    previewTitle.textContent = title;
    form.querySelector('#prep-preview-content').textContent = content || '等你填入正文。';
    const extra = form.querySelector('#prep-preview-extra');
    const topics = edition.querySelector('[data-draft-topics]')?.value || '';
    extra.textContent = active==='wechat' ? edition.querySelector('[data-draft-caption]').value.trim() : splitTopics(topics).map(topic => `#${topic}`).join(' ');
    extra.hidden = !extra.textContent;
    form.querySelector('#prep-preview-platform').textContent = `${PN[active]} · ${prepStyles[active]}`;
    const urls = imageUrls.get(active) || [];
    const limit = active==='x' ? 4 : 9;
    const count = urls.length ? `${urls.length} / ${limit} 张` : `最多 ${limit} 张`;
    edition.querySelector('[data-media-limit]').textContent = `${count}${active==='xhs'?' · 第一张为首图':''}`;
    const media = form.querySelector('#prep-preview-media');
    const shown = active==='x' ? urls.slice(0,4) : urls.slice(0,1);
    media.hidden = !shown.length;
    if (media.dataset.source !== shown.join(' ')) {
      media.dataset.source = shown.join(' ');
      media.replaceChildren(...shown.map(image));
    }
    const nextLabels = {x:'可填写 X 编辑器', xhs:'可填入小红书编辑器', wechat:'可存入公众号草稿箱'};
    form.querySelector('#prep-next-heading').textContent = cap.browserEnabled ? nextLabels[active] : active==='x' ? '可下载 X 文图包' : '保存本地草稿';
    const nextSteps = {x:'在发布记录中下载文图包或打开 X。', xhs:'填入 TwoPeanuts 后，在小红书确认发布。', wechat:'在发布记录中检查稿件，再存入公众号草稿箱。'};
    form.querySelector('#prep-next-copy').textContent = !cap.browserEnabled && active!=='x' ? '此平台当前未启用填写。' : nextSteps[active];
  }

  form.addEventListener('input', event => {
    if (event.target.matches('[data-draft-title], [data-draft-content]')) event.target.dataset.custom = 'true';
    if (event.target.name !== 'target' && !event.target.matches('[data-draft-files]')) updatePreview();
  });
  form.addEventListener('click', event => {
    const tab = event.target.closest('[data-prep-edition]');
    if (tab) updatePreview(tab.dataset.prepEdition);
    if (event.target.closest('[data-use-source]')) {
      editions[active].querySelectorAll('[data-custom]').forEach(field => { delete field.dataset.custom; });
      updatePreview();
    }
  });
  form.addEventListener('change', event => {
    if (event.target.name==='target') {
      updatePreview(event.target.checked ? event.target.value : active);
      return;
    }
    if (!event.target.matches('[data-draft-files]')) return;
    const edition = event.target.closest('[data-edition]');
    const platform = edition.dataset.edition;
    (imageUrls.get(platform) || []).forEach(url => URL.revokeObjectURL(url));
    const urls = Array.from(event.target.files, file => URL.createObjectURL(file));
    imageUrls.set(platform, urls);
    edition.querySelector('.prep-thumbnails').replaceChildren(...urls.map(image));
    if (platform==='xhs') {
      const target = edition.querySelector('[data-image-reviews]');
      target.innerHTML = Array.from(event.target.files, (file, i) => `<details class="prep-image-review" data-image-review="${i}"><summary>审阅第 ${i+1} 张 · ${esc(file.name)}</summary><label class="prep-field">可见文字（无文字可留空）<textarea name="visibleText" rows="2"></textarea></label><label class="prep-field">审阅人<input name="reviewer"></label><label class="prep-field">审阅说明<input name="rationale"></label><label class="prep-test"><input type="checkbox" name="visualChecked"> 已查看图片，确认无站外推广引导</label></details>`).join('');
      Array.from(target.children).forEach((review, i) => review.querySelector('summary').after(image(urls[i], i)));
    }
    updatePreview();
  });
  form.addEventListener('submit', event => {
    event.preventDefault();
    void saveEditions(form, selectedTargets(), editions, episode, updatePreview);
  });
  updatePreview();
}

function splitTopics(value) {
  return value.split(/[,，]/).map(item => item.trim()).filter(Boolean);
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
function readEdition(edition, platform, episode) {
  const title = edition.querySelector('[data-draft-title]')?.value.trim() || '';
  const content = edition.querySelector('[data-draft-content]').value.trim();
  const test = edition.querySelector('[data-draft-test]').checked;
  const titleLimit = platform === 'wechat' ? 64 : 100;
  const testTitleLength = title.length + (platform==='wechat' && test && !title.startsWith('【测试稿】') ? 5 : 0);
  if (platform!=='x' && (!title || testTitleLength>titleLimit)) throw new Error(`填写标题，最多 ${titleLimit} 字（含测试标记）`);
  const contentLimit = prepContentLimits[platform];
  if (!content || content.length>contentLimit) throw new Error(`填写正文，麦田当前支持最多 ${contentLimit} 字符`);
  const caption = edition.querySelector('[data-draft-caption]')?.value || '';
  const topics = splitTopics(edition.querySelector('[data-draft-topics]')?.value || '');
  if (topics.length>10 || topics.some(topic => topic.length>40)) throw new Error('最多 10 个话题，每个不超过 40 字符');
  const files = Array.from(edition.querySelector('[data-draft-files]').files);
  const paths = edition.querySelector('[data-draft-paths]').value.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (files.length && paths.length) throw new Error('选图和绝对路径请只用一种方式');
  const imageLimit = platform==='x' ? 4 : 9;
  const count = files.length + paths.length;
  if ((platform==='xhs' && !count) || count>imageLimit) throw new Error(platform==='xhs' ? '选择 1–9 张图片' : `最多选择 ${imageLimit} 张图片`);
  if (files.some(file => !file.size || file.size>32*1024*1024) || files.reduce((n,file)=>n+file.size,0)>64*1024*1024) throw new Error('单图不超过 32 MB，整组不超过 64 MB');
  const review = JSON.parse(edition.querySelector('[data-draft-review]')?.value || '{}');
  if (!review || typeof review!=='object' || Array.isArray(review)) throw new Error('审阅记录格式不对');
  const reviews = platform==='xhs' ? files.map((_, i) => {
    const card = edition.querySelector(`[data-image-review="${i}"]`);
    const reviewer = card.querySelector('[name=reviewer]').value.trim();
    const rationale = card.querySelector('[name=rationale]').value.trim();
    if (!card.querySelector('[name=visualChecked]').checked || !reviewer || !rationale) {
      card.open = true;
      throw new Error(`先审阅第 ${i+1} 张图片，并填写审阅人和说明`);
    }
    return {visualChecked:true, visibleText:card.querySelector('[name=visibleText]').value, reviewer, rationale, conclusion:'no-outbound-promotion'};
  }) : [];
  const input = {platform, title, content, topics, test, images:paths};
  if (platform==='wechat') input.caption = caption;
  if (platform==='xhs') input.promotionReview = review;
  if (episode?.tasks.some(task => task.platform===platform)) input.episodeId = episode.id;
  return {input, files, reviews};
}

async function saveEdition({input, files, reviews}) {
  if (files.length) {
    const uploaded = [];
    for (const file of files) {
      const response = await fetch('/api/prep/image?name=' + encodeURIComponent(file.name), {method:'POST', headers:{'content-type':'application/octet-stream'}, body:file});
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '图片保存失败');
      uploaded.push(result);
    }
    input.images = uploaded.map(image => image.path);
    if (reviews.length) input.promotionReview.images = reviews.map((review,i) => ({sha256:uploaded[i].sha256, ...review}));
  }
  const response = await fetch('/api/prep', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'create',input})});
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '草稿保存失败');
}

async function saveEditions(form, selected, editions, episode, showEdition) {
  const button = form.querySelector('button[type=submit]');
  if (button.disabled || !selected.length) return;
  const message = form.querySelector('#prep-message');
  const drafts = [];
  for (const platform of selected) {
    try { drafts.push(readEdition(editions[platform], platform, episode)); }
    catch (error) {
      showEdition(platform);
      message.textContent = `${PN[platform]}：${error.message}`;
      return;
    }
  }

  button.disabled = true;
  message.textContent = '正在保存本地草稿…';
  const saved = [], failed = [];
  try {
    for (const draft of drafts) {
      const platform = draft.input.platform;
      try { await saveEdition(draft); saved.push(PN[platform]); }
      catch (error) { failed.push({platform, message:`${PN[platform]}：${error.message}`}); }
    }
    if (saved.length) {
      try { await refreshPreparationRecords(); }
      catch (error) { failed.push({message:`刷新记录失败：${error.message}`}); }
    }
    message.textContent = [...(saved.length ? [`已保存 ${saved.join('、')} 草稿`] : []), ...failed.map(item => item.message)].join('。');
    if (failed[0]?.platform) showEdition(failed[0].platform);
    if (!failed.length) document.querySelector('#prep-history')?.focus();
  } finally { button.disabled = false; }
}
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
  const prompt = type === 'publish' ? '将这篇检查通过的稿件正式发布到小红书 AI 号 TwoPeanuts？只提交一次；平台审核及公开状态另行核对。'
    : type === 'check' ? '运行已有本地 DSH skill 的离线检查？'
    : b.dataset.platform === 'x' ? '在获准的 X 专用 Chrome 另开空白编辑页并填写文图？填好后保留编辑页供你核对。'
    : '通过已获准的专用窗口填写小红书 ai 或保存公众号草稿？';
  if (!confirm(prompt)) return;
  b.disabled = true;
  try {
    const approval=type==='publish'?{reference:'web-confirmation:'+new Date().toISOString(),checkedDigest:b.dataset.checkedDigest}:undefined;
    const res = await fetch('/api/prep', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type,id:b.dataset.id,...(approval?{approval}:{})})}), j = await res.json();
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
