// Version 1 video projects use the same relative paths and copy fields as publish.json.
export const videoPlatforms = {
  bilibili: {name:'B站', url:'https://member.bilibili.com/platform/upload/video/frame', title:['title',1,80], body:['desc',0,2000], tags:'tags', covers:['4x3']},
  xhs: {name:'小红书', url:'https://creator.xiaohongshu.com/publish/publish?source=official&target=video', title:['title',1,20], body:['body',1,1000], tags:'topics', covers:['3x4']},
  douyin: {name:'抖音', url:'https://creator.douyin.com/creator-micro/content/upload', title:['title',1,30], body:['body',0,1000], tags:'topics', covers:['4x3','3x4']},
  channels: {name:'视频号', url:'https://channels.weixin.qq.com/platform/post/create', title:['shortTitle',6,16], body:['body',0,1000], tags:'topics', covers:['4x3','3x4']},
  youtube: {name:'YouTube', url:'https://studio.youtube.com/', title:['title',1,100], body:['desc',0,5000], tags:'tags', covers:['16x9']},
  x: {name:'X', url:'https://x.com/compose/post', body:['text',1,25000], covers:[]},
  instagram: {name:'Instagram', url:'https://www.instagram.com/', body:['caption',1,2200], covers:['16x9','4x3']},
};

export const coverRatios = ['3x4','4x3','16x9'];
const imagePath = /\.(png|jpe?g|webp)$/i;
const mp4Path = /\.mp4$/i;
const chars = value => [...value].length;

export function projectPath(value) {
  if (typeof value !== 'string') return '';
  const normalized = value.replaceAll('\\','/');
  const parts = normalized.split('/');
  return parts.some(part => !part || part === '.' || part === '..' || /[:\x00-\x1f\x7f]/.test(part)) ? '' : normalized;
}

export function projectFiles(files) {
  const index = new Map();
  let folder;
  for (const file of files) {
    const full = projectPath(file.webkitRelativePath), slash = full.indexOf('/');
    if (slash < 1) throw new Error('请选择完整的视频工程文件夹。');
    const current = full.slice(0,slash), relative = full.slice(slash+1);
    if ((folder && current !== folder) || index.has(relative)) throw new Error('请选择一个工程文件夹，文件路径不可重复。');
    folder = current;
    index.set(relative,file);
  }
  if (!folder) throw new Error('文件夹里没有可读取的文件。');
  return {folder,index};
}

export async function readProject({folder,index}) {
  const manifest = index.get('publish.json');
  let saved = {};
  if (manifest) {
    if (manifest.size > 1024*1024) throw new Error('publish.json 超过 1 MB。');
    try { saved = JSON.parse((await manifest.text()).replace(/^\uFEFF/,'')); }
    catch { throw new Error('文件夹里的 publish.json 无法读取为 JSON。'); }
    if (!saved || saved.version !== 1 || typeof saved.platforms !== 'object' || !saved.platforms || Array.isArray(saved.platforms)) {
      throw new Error('当前支持版本 1 的视频 publish.json。');
    }
  }
  const videos = [...index.keys()].filter(file => mp4Path.test(file));
  const video = saved.video == null ? (index.has('成片.mp4') ? '成片.mp4' : videos.length === 1 ? videos[0] : '') : projectPath(saved.video);
  const covers = Object.fromEntries(coverRatios.map(ratio => {
    const matching = [...index.keys()].filter(file => imagePath.test(file) && file.split('/').at(-1).split('.').slice(0,-1).join('.').toLowerCase() === `cover-${ratio}`);
    const file = saved.covers?.[ratio] == null ? (matching.length === 1 ? matching[0] : '') : projectPath(saved.covers[ratio]);
    return [ratio,file];
  }));
  return {saved,video,covers,videos,images:[...index.keys()].filter(file => imagePath.test(file)),name:typeof saved.name === 'string' ? saved.name : folder};
}

export async function checkFaststart(file) {
  if (!file || file.size < 24) throw new Error('请选择有效的 MP4 成片。');
  let offset = 0, branded = false, indexed = false;
  for(let boxes = 0; offset+8 <= file.size && boxes < 4096; boxes++){
    const head = new DataView(await file.slice(offset,offset+16).arrayBuffer());
    let size = head.getUint32(0), headerSize = 8;
    const type = String.fromCharCode(...new Uint8Array(head.buffer,4,4));
    if(size === 1){
      if(head.byteLength < 16) break;
      size = Number(head.getBigUint64(8)); headerSize = 16;
    } else if(size === 0) size = file.size-offset;
    if(!Number.isSafeInteger(size) || size < headerSize || size > file.size-offset) break;
    if(type === 'ftyp') branded = true;
    if(type === 'moov' && size > headerSize) indexed = true;
    if(type === 'mdat' && size > headerSize){
      if(!branded) break;
      if(!indexed) throw new Error('成片的 moov 位于视频数据之后，请用 faststart 重新封装 MP4。');
      return;
    }
    offset += size;
  }
  throw new Error('未读到有效的 MP4 文件结构。');
}

export async function inspectVideo(file) {
  await checkFaststart(file);
  const video = document.createElement('video'), url = URL.createObjectURL(file);
  try {
    return await new Promise((resolve,reject) => {
      const fail = () => reject(new Error('浏览器未能读取成片时长或视频轨道，请确认 MP4 可以正常播放。'));
      const timer = setTimeout(fail,8000);
      video.preload = 'metadata';
      video.onerror = () => { clearTimeout(timer); fail(); };
      video.onloadedmetadata = () => {
        clearTimeout(timer);
        if (Number.isFinite(video.duration) && video.duration > 0 && video.videoWidth && video.videoHeight) resolve(video.duration);
        else fail();
      };
      video.src = url;
    });
  } finally {
    video.onloadedmetadata = null;
    video.onerror = null;
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  }
}

export async function inspectCover(file, ratio) {
  if (!file || !file.size || file.size > 32*1024*1024) throw new Error('封面必须是 32 MB 以内的非空图片。');
  const image = await createImageBitmap(file).catch(() => { throw new Error('封面无法解码，请使用 PNG、JPEG 或 WebP。'); });
  try {
    const [width,height] = ratio.split('x').map(Number);
    if (Math.abs(image.width*height/(image.height*width)-1) > .04) {
      throw new Error(`封面为 ${image.width}×${image.height}，与 ${ratio.replace('x',':')} 不符。`);
    }
  } finally { image.close(); }
}

export async function makeVideoProject({folder,index,saved={},name,video,covers,editions}, {media=inspectVideo, image=inspectCover}={}) {
  const errors = [], notes = [];
  const project = {
    version:1, id:typeof saved.id === 'string' && projectPath(saved.id)===saved.id && !saved.id.includes('/') ? saved.id : folder,
    name:name.trim(), video:projectPath(video),
    ...(Number.isInteger(saved.episode) && saved.episode > 0 ? {episode:saved.episode} : {}),
    ...(index.has('发布素材.md') ? {source_backup:'发布素材.md'} : {}),
    ...(index.has('字幕.srt') ? {subtitle:'字幕.srt'} : {}),
    covers:{}, platforms:{},
  };
  if (!project.name || chars(project.name) > 160) errors.push('工程名称不能为空，最多 160 字。');
  if (!mp4Path.test(project.video) || !index.has(project.video)) errors.push('请选择此文件夹中的 MP4 成片。');
  if (!Object.keys(editions).length) errors.push('至少选择一个目标平台。');
  for(const ratio of coverRatios){
    if (!covers[ratio]) continue;
    const file = projectPath(covers[ratio]);
    if (!imagePath.test(file) || !index.has(file)) errors.push(`${ratio} 封面必须是工程内的 PNG、JPEG 或 WebP。`);
    else project.covers[ratio] = file;
  }
  for(const [id, fields] of Object.entries(editions)){
    if(!Object.hasOwn(videoPlatforms,id)) { errors.push('存在未知的目标平台。'); continue; }
    const spec = videoPlatforms[id], copy = {};
    const previous = saved.platforms?.[id];
    if(typeof previous?.skip === 'string' && previous.skip) {
      project.platforms[id] = {skip:previous.skip,covers:[]};
      continue;
    }
    for(const [key,min,max] of [spec.title,spec.body].filter(Boolean)){
      const value = String(fields[key] ?? '').trim();
      const count = chars(value);
      if (count < min || count > max) errors.push(`${spec.name}的${key === spec.title?.[0] ? '标题' : '文案'}须为 ${min}–${max} 字。`);
      copy[key] = value;
    }
    if (spec.tags) copy[spec.tags] = fields.tags;
    if (id === 'bilibili' && (fields.tags.length > 10 || fields.tags.some(t => chars(t) > 20))) errors.push('B站最多 10 个标签，每个最多 20 字。');
    if (id === 'douyin' && fields.tags.length > 5) errors.push('抖音最多 5 个话题。');
    if (id === 'youtube' && (fields.tags.join(',').length > 500 || /[<>]/.test(copy.title+copy.desc))) errors.push('YouTube 标签总长最多 500 字，标题和简介不能包含尖括号。');
    if (id === 'instagram' && (copy.caption.match(/#[^\s#]+/g)??[]).length > 30) errors.push('Instagram 配文最多 30 个话题标签。');
    copy.covers = spec.covers.filter(ratio => project.covers[ratio]);
    if (id === 'instagram') copy.covers = copy.covers.slice(0,1);
    if (spec.covers.length && !copy.covers.length) notes.push(`${spec.name}没有对应比例的独立封面，可在平台选视频画面。`);
    const alternate = previous?.video || (id === 'instagram' && index.has('成片-ig.mp4') ? '成片-ig.mp4' : '');
    if (alternate) {
      copy.video = projectPath(alternate);
      if (!mp4Path.test(copy.video) || !index.has(copy.video)) errors.push(`${spec.name}单独指定的 MP4 不在工程文件夹内。`);
    }
    if(previous?.mode && previous.mode !== 'video') notes.push(`${spec.name}本次按普通视频导出，请核对旧工程的发布模式。`);
    project.platforms[id] = copy;
  }
  if (Object.values(project.platforms).every(edition => edition.skip)) errors.push('所选平台均标记为跳过，未生成可用的平台稿。');
  if (errors.length) return {errors,notes,project:null};

  const durations = new Map();
  for (const file of new Set([project.video,...Object.values(project.platforms).map(p => p.video).filter(Boolean)])){
    try { durations.set(file,await media(index.get(file))); }
    catch(error) { errors.push(`${file}：${error.message}`); }
  }
  for (const [ratio,file] of Object.entries(project.covers)){
    try { await image(index.get(file),ratio); }
    catch(error) { errors.push(`${file}：${error.message}`); }
  }
  const instagram = project.platforms.instagram;
  if(instagram && durations.get(instagram.video || project.video) > 1200) errors.push('Instagram 版成片超过工程校验上限 20 分钟。');
  project.durationSec = durations.get(project.video);
  return {errors,notes,project:errors.length ? null : project};
}

export function videoProjectPage(escape, logo) {
  const platforms = Object.entries(videoPlatforms);
  return `<main class="publish-page">
    <header class="publish-heading"><div><h1 class="h1">视频工程</h1><p class="lead">检查成片和封面，为多个平台准备文案。</p></div><a href="#/prepare" class="btn">图文与文章</a></header>
    <form class="panel prep-editor" id="video-project">
      <label class="prep-field">视频工程文件夹<input name="directory" type="file" webkitdirectory aria-describedby="video-folder-help"></label>
      <p id="video-folder-help" class="note">选择含成片的文件夹。已有 publish.json 会带入平台稿。素材在本机浏览器中读取。</p>
      <div class="video-project-fields" hidden>
        <label class="prep-field">工程名称<input name="projectName"></label>
        <label class="prep-field">MP4 成片<select name="video"></select></label>
        <div class="video-project-covers">${coverRatios.map(ratio => `<label class="prep-field">${ratio.replace('x',':')} 封面<select name="cover-${ratio}"></select></label>`).join('')}</div>
        <fieldset class="prep-platforms"><legend>目标平台 <span class="note">可多选</span></legend>${platforms.map(([id,spec]) => `<label class="prep-platform"><input type="checkbox" name="video-target" value="${id}"><span>${logo(id)}${escape(spec.name)}</span></label>`).join('')}</fieldset>
        ${platforms.map(([id,spec]) => `<section class="video-edition" data-video-edition="${id}" hidden>
          <h2>${escape(spec.name)}平台稿</h2>
          ${spec.title ? `<label class="prep-field">${spec.title[0]==='shortTitle'?'短标题':'标题'}<input data-video-title></label>` : ''}
          <label class="prep-field">文案<textarea rows="4" data-video-body></textarea></label>
          ${spec.tags ? `<label class="prep-field">${spec.tags==='topics'?'话题':'标签'}（逗号或换行分隔）<textarea rows="2" data-video-tags></textarea></label>` : ''}
        </section>`).join('')}
        <div class="btns"><button type="submit" class="btn pri">校验视频工程</button><button type="button" class="btn" data-save-video disabled>下载 publish.json</button></div>
      </div>
      <div id="video-project-result" role="status" aria-live="polite"></div>
      <div id="video-project-handoff" hidden></div>
      <section class="video-prefill" aria-label="预填运行记录">
        <h2>创作页预填记录</h2>
        <div id="video-prefill-status" role="status" aria-live="polite"></div>
        <details><summary>历史任务</summary><div id="video-prefill-history"></div></details>
        <a class="text-link" href="/api/video-prefill/assistant">下载麦田视频预填助手</a>
      </section>
    </form>
  </main>`;
}

export function initVideoProject() {
  const form = document.querySelector('#video-project');
  const fields = form.querySelector('.video-project-fields'), result = form.querySelector('#video-project-result');
  const handoff = form.querySelector('#video-project-handoff'), save = form.querySelector('[data-save-video]');
  const check = form.querySelector('button[type=submit]');
  const targets = [...form.querySelectorAll('[name=video-target]')];
  const editions = Object.fromEntries(targets.map(target => [target.value,form.querySelector(`[data-video-edition="${target.value}"]`)]));
  const prefillStatus=form.querySelector('#video-prefill-status');
  let current, verified, revision = 0, folderRequest = 0, observedRequest, interval, watching=false, lastReceipt='',historyId=null;
  const connection=async (action,payload)=>callAssistant(action,payload);
  const readStatus=async id=>{
    const response=await fetch('/api/video-prefill/receipt'+(id?`?id=${encodeURIComponent(id)}`:''));
    return (await response.json()).job;
  };
  const linkPublication=async (job,item,host)=>{
    host.textContent='正在读取采集记录…';
    const params=new URLSearchParams({id:job.requestId,platform:item.id});
    try{
      const response=await fetch(`/api/video-prefill/publication?${params}`), result=await response.json();
      if(!response.ok)throw new Error(result.error);
      if(!result.candidates.length){host.textContent='暂无该账号的已验证作品。发布后先更新对应平台数据。';return;}
      const label=document.createElement('label'), select=document.createElement('select'), confirm=document.createElement('button'), preview=document.createElement('a');
      label.textContent='选择你已发布的作品';
      select.append(new Option('请选择作品',''),...result.candidates.map(work=>new Option(`${work.publishedDay} · ${work.title} · ${work.postId}`,work.episodeId)));
      label.append(select);
      preview.target='_blank';preview.rel='noopener noreferrer';preview.textContent='查看所选作品';preview.hidden=true;
      confirm.type='button';confirm.className='btn';confirm.textContent='确认关联';confirm.disabled=true;
      select.onchange=()=>{
        const work=result.candidates.find(candidate=>candidate.episodeId===select.value);
        confirm.disabled=!work;
        preview.hidden=!work;
        if(work)preview.href=work.url;
      };
      confirm.onclick=async()=>{
        confirm.disabled=true;
        try {
          const response=await fetch('/api/video-prefill/publication',{method:'POST',headers:{'content-type':'application/json'},
            body:JSON.stringify({requestId:job.requestId,platform:item.id,episodeId:select.value})});
          const result=await response.json();
          if(!response.ok)throw new Error(result.error);
          showStatus(await readStatus(job.requestId));
        }catch(error){host.textContent=error.message;}
      };
      host.replaceChildren(label,preview,confirm);
    }catch(error){host.textContent=error.message;}
  };
  const showStatus=job=>{
    if(!job){prefillStatus.textContent='暂无预填任务。';return;}
    const caption=document.createElement('p');
    caption.textContent=`${job.name} · ${job.interrupted?'状态待确认':job.running?'预填中':'预填已结束'}`;
    const messages=document.createElement('ul');
    for(const item of job.states??[]){
      const line=document.createElement('li');
      line.textContent=`${videoPlatforms[item.id]?.name||'任务'}${item.account?` · ${item.account}`:''} · ${item.status}${item.message?` · ${item.message}`:''}`;
      if(item.publication){
        const link=document.createElement('a');
        link.href=item.publication.url;link.target='_blank';link.rel='noopener noreferrer';link.textContent=' · 查看已关联作品';
        line.append(link);
      }else if(item.canReconcile&&!job.running){
        const action=document.createElement('button'),panel=document.createElement('div');
        action.type='button';action.className='btn';action.textContent='核对作品';
        action.onclick=()=>{historyId=job.requestId;void linkPublication(job,item,panel);};
        line.append(' ',action,panel);
      }else if(item.id==='channels'&&!job.running){
        line.append(' · 暂无可核验的公开作品链接');
      }
      messages.append(line);
    }
    prefillStatus.replaceChildren(caption,messages);
  };
  const showHistory=async()=>{
    const host=form.querySelector('#video-prefill-history');
    try{
      const {jobs}=await (await fetch('/api/video-prefill/history')).json(), list=document.createElement('ul');
      for(const job of jobs??[]){
        const item=document.createElement('li'),open=document.createElement('button');
        open.type='button';open.className='btn';open.textContent=`${job.name} · ${new Date(job.startedAt).toLocaleString('zh-CN')}`;
        open.onclick=async()=>{historyId=job.requestId;showStatus(await readStatus(historyId).catch(()=>job));};
        item.append(open);list.append(item);
      }
      host.replaceChildren(list);
    }catch{host.textContent='历史任务暂时无法读取。';}
  };
  form.querySelector('.video-prefill details').addEventListener('toggle',event=>{if(event.target.open)void showHistory();});
  const watch=async()=>{
    if(!form.isConnected){clearInterval(interval);return;}
    if(watching)return;
    watching=true;
    try{
      const job=(await connection('status')).job;
      if(!job?.requestId){
        if(observedRequest?.running&&!historyId)showStatus(await readStatus(observedRequest.requestId));
        return;
      }
      observedRequest=job;
      const states=(job.states??[]).map(item=>({id:item.id,status:item.status,message:item.message??item.logs?.slice(-2).map(log=>log.msg).join(' · ')}));
      const snapshot={...job,states};
      const body=JSON.stringify(snapshot);
      if(body!==lastReceipt){
        const response=await fetch('/api/video-prefill/receipt',{method:'POST',headers:{'content-type':'application/json'},body});
        if(response.ok){
          lastReceipt=body;
          const saved=(await response.json()).job;
          if(!historyId)showStatus(saved);
          if(form.querySelector('.video-prefill details').open)void showHistory();
        }
      }
    }catch {
      if(observedRequest?.running&&!historyId)await readStatus(observedRequest.requestId).then(showStatus).catch(()=>{});
    } finally {watching=false;}
  };
  readStatus().then(job=>{
    if(!observedRequest&&!historyId){observedRequest=job;showStatus(job);}
  }).catch(()=>{});
  interval=setInterval(watch,2500);
  void watch();

  const resetResult = () => {
    revision++;
    verified = null;
    save.disabled = true;
    check.disabled = false;
    result.replaceChildren();
    handoff.hidden = true;
    handoff.replaceChildren();
  };
  const showEditions = () => {
    for (const target of targets) editions[target.value].hidden = !target.checked;
  };
  const selectFiles = (select, paths, selected) => {
    select.replaceChildren(new Option('请选择', ''), ...paths.map(file => new Option(file,file)));
    select.value = paths.includes(selected) ? selected : '';
  };
  form.elements.directory.addEventListener('change', async () => {
    const request = ++folderRequest;
    resetResult();
    current = null;
    fields.hidden = true;
    try {
      const files = projectFiles(form.elements.directory.files), loaded = await readProject(files);
      if (request !== folderRequest || !form.isConnected) return;
      current = {...files,...loaded};
      const {saved,video,videos,images,covers,name} = loaded;
      form.elements.projectName.value = name;
      selectFiles(form.elements.video,videos,video);
      for (const ratio of coverRatios) selectFiles(form.elements[`cover-${ratio}`],images,covers[ratio]);
      for (const target of targets) {
        const id = target.value, spec = videoPlatforms[id], section = editions[id];
        const original = saved.platforms?.[id];
        target.checked = !!original;
        if (spec.title) section.querySelector('[data-video-title]').value = original?.[spec.title[0]] ?? name;
        section.querySelector('[data-video-body]').value = original?.[spec.body[0]] ?? (id==='channels' ? original?.desc : '') ?? '';
        if (spec.tags) section.querySelector('[data-video-tags]').value = Array.isArray(original?.[spec.tags]) ? original[spec.tags].join('，') : '';
      }
      showEditions();
      fields.hidden = false;
      const extraPlatforms=Object.keys(saved.platforms??{}).filter(id=>!Object.hasOwn(videoPlatforms,id));
      const notices = [`已读取 ${files.folder}。`];
      if (extraPlatforms.length) notices.push(`此页面仅导出平台视频稿，原工程中的 ${extraPlatforms.join('、')} 请在原工程处理。`);
      if (saved.schedule) notices.push('原工程有定时设置，本页只生成手动准备清单。');
      result.textContent = notices.join(' ');
    } catch(error) {
      if (request === folderRequest) result.textContent = error.message;
    }
  });
  form.addEventListener('input', event => {
    if (!fields.contains(event.target)) return;
    resetResult();
    showEditions();
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!current) return;
    resetResult();
    const started = revision;
    check.disabled = true;
    result.textContent = '正在检查本机成片与封面…';
    const drafts = Object.fromEntries(targets.filter(target=>target.checked).map(({value:id})=>{
      const spec = videoPlatforms[id], section = editions[id];
      return [id,{
        ...(spec.title ? {[spec.title[0]]:section.querySelector('[data-video-title]').value} : {}),
        [spec.body[0]]:section.querySelector('[data-video-body]').value,
        tags:[...new Set((section.querySelector('[data-video-tags]')?.value ?? '').split(/[,，\n]/).map(tag=>tag.trim().replace(/^#+/, '')).filter(Boolean))],
      }];
    }));
    try {
      const {errors,notes,project} = await makeVideoProject({...current, name:form.elements.projectName.value,video:form.elements.video.value,
        covers:Object.fromEntries(coverRatios.map(ratio=>[ratio,form.elements[`cover-${ratio}`].value])),editions:drafts});
      if (started !== revision || !form.isConnected) return;
      result.textContent = errors.length ? '校验未通过。' : `本地校验通过 · 成片 ${Math.round(project.durationSec*10)/10} 秒`;
      if (errors.length || notes.length) {
        const list = document.createElement('ul');
        for (const message of [...errors,...notes]) {
          const item = document.createElement('li');
          item.textContent = message;
          list.append(item);
        }
        result.append(list);
      }
      if (!project) return;
      verified = project;
      renderHandoff(project,handoff,async (rootPath,button)=>{
        button.disabled=true;
        try {
          const folder=rootPath.replaceAll('\\','/').replace(/\/+$/,'').split('/').at(-1);
          if(!/^(?:[A-Za-z]:[/\\]|\/[^/])/.test(rootPath)||folder.toLowerCase()!==current.folder.toLowerCase())
            throw new Error('请填入刚选中文件夹的本机绝对路径');
          const files=[project.video,...Object.values(project.covers),...Object.values(project.platforms).map(edition=>edition.video).filter(Boolean)];
          const assets=[...new Set(files)].map(file=>[file,current.index.get(file)?.size,current.index.get(file)?.lastModified]);
          const normalizedRoot=rootPath.replaceAll('\\','/').replace(/\/+$/,'');
          const key=JSON.stringify([/^[a-z]:/i.test(normalizedRoot)?normalizedRoot.toLowerCase():normalizedRoot,project,assets]);
          const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(key)));
          const hex=[...digest.subarray(0,16)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
          const requestId=[hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20)].join('-');
          await connection('status');
          const response=await fetch('/api/video-prefill/reserve',{method:'POST',headers:{'content-type':'application/json'},
            body:JSON.stringify({requestId,name:project.name,platforms:Object.keys(project.platforms).filter(id=>!project.platforms[id].skip)})});
          const reserved=await response.json();
          if(!response.ok)throw new Error(reserved.error);
          historyId=null;
          showStatus(reserved.job);
          if(!reserved.start)return;
          const result=await connection('start',{requestId,rootPath,data:project,lease:reserved.lease});
          observedRequest=result.job;
          await watch();
        } catch(error){prefillStatus.textContent=error.message;}
        finally {button.disabled=false;}
      });
      save.disabled = false;
    } catch(error) {
      if (started === revision) result.textContent = error.message;
    } finally {
      if (started === revision) check.disabled = false;
    }
  });
  save.addEventListener('click', () => {
    if (!verified) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(verified,null,2)+'\n'],{type:'application/json'}));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'publish.json';
    link.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  });
}

function callAssistant(action,payload){
  const channel='maitian.video.prefill.v1', id=crypto.randomUUID();
  return new Promise((resolve,reject)=>{
    const cleanup=()=>{clearTimeout(timer);window.removeEventListener('message',receive);};
    const receive=event=>{
      const data=event.data;
      if(event.source!==window||event.origin!==location.origin||data?.channel!==channel||data.direction!=='response'||data.id!==id)return;
      cleanup();
      if(data.result?.ok)resolve(data.result);
      else reject(new Error(data.result?.error||'未确认预填请求'));
    };
    const timer=setTimeout(()=>{cleanup();reject(new Error('未连接预填助手，请在专用浏览器加载安装包后刷新麦田。'));},1800);
    window.addEventListener('message',receive);
    window.postMessage({channel,direction:'request',id,action,payload},location.origin);
  });
}

function renderHandoff(project,host,startPrefill) {
  const heading = document.createElement('h2'), help = document.createElement('p');
  heading.textContent = '平台稿与上传入口';
  help.className = 'note';
  help.textContent = '复制对应文案后，在平台编辑器粘贴并选择成片。需要保留工程时，把下载的 publish.json 存到所选文件夹。';
  host.replaceChildren(heading,help);
  const locationLabel=document.createElement('label'),locationInput=document.createElement('input'),start=document.createElement('button');
  locationLabel.className='prep-field';
  locationLabel.textContent='工程文件夹绝对路径';
  locationInput.placeholder='例如 D:\\视频\\本期';
  locationLabel.append(locationInput);
  start.type='button';start.className='btn pri';start.textContent='预填所选创作页';
  start.onclick=()=>startPrefill(locationInput.value.trim(),start);
  host.append(locationLabel,start);
  for (const [id,edition] of Object.entries(project.platforms)) {
    const spec = videoPlatforms[id];
    const row = document.createElement('section'), label = document.createElement('h3');
    row.className = 'video-handoff-row';
    label.textContent = spec.name;
    row.append(label);
    if (edition.skip) {
      const saved = document.createElement('p');
      saved.textContent = `已标记跳过 · ${edition.skip}`;
      row.append(saved);
      host.append(row);
      continue;
    }
    const asset = document.createElement('p'), actions = document.createElement('div'), link = document.createElement('a');
    asset.className = 'note';
    asset.textContent = [edition.video || project.video,...edition.covers.map(ratio=>project.covers[ratio])].join(' · ');
    actions.className = 'btns';
    const topics = edition.topics?.map(topic=>`#${topic}`).join(' ') || '';
    const body = [edition[spec.body[0]],topics].filter(Boolean).join('\n\n');
    const copies = [['复制标题',spec.title && edition[spec.title[0]]],['复制文案',body],['复制标签',edition.tags?.join(', ')]];
    for (const [text,value] of copies.filter(([,value])=>value)){
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn';
      button.textContent = text;
      button.onclick = async () => {
        try { await navigator.clipboard.writeText(value); button.textContent = '已复制'; }
        catch { button.textContent = '复制失败，请从上方平台稿选中文字复制'; }
      };
      actions.append(button);
    }
    link.className = 'btn';
    link.href = spec.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = '打开平台';
    actions.append(link);
    row.append(asset,actions);
    host.append(row);
  }
  host.hidden = false;
}
