import {platforms,validateEdition} from '/api/prep/rules-module';
const names={x:'X',xhs:'小红书',wechat:'公众号'};
const labels={prepared:'已保存本地稿',editing:'可编辑',checked:'检查通过',check_failed:'检查未通过',running:'正在处理',unknown:'结果未确认，请勿重跑',awaiting_user:'已填好，待本人发布',draft_saved:'已保存草稿',published:'已公开',submitted:'历史已提交',already_exists:'平台已有稿',failed:'执行失败，先核对平台'};
const stateLabel=s=>labels[s]||'暂无状态';
const empty=()=>({title:'',content:'',images:[],cover:null,topics:[],video:null,digest:'',author:'',imagePositions:[]});
const fieldNames=['title','content','images','cover','topics','video','digest','author','imagePositions','promotionReview'];
const inputOf=e=>Object.fromEntries(fieldNames.filter(k=>e[k]!==undefined).map(k=>[k,e[k]]));
const clone=x=>JSON.parse(JSON.stringify(x));
export function preparePage(esc,records) {
 return `<main class="publish-page prepare-v2"><header class="publish-heading"><div><h1 class="h1">一份原稿，三种表达</h1><p class="lead">分别调整、核对，再填入平台。最后发布由你亲自完成。</p></div><a class="btn" href="#/prepare?format=video">视频工程</a></header>
 <div id="post-picker" class="btns"></div><section id="master-editor" class="panel" aria-label="原稿"></section>
 <div class="generation-bar"><button class="btn pri" id="generate-editions">生成各平台版本</button><button class="btn" id="save-post">保存本地改动</button><span id="generation-state" role="status" aria-live="polite">只生成文字，不操作平台</span></div>
 <p id="post-message" role="status" aria-live="polite"></p><div class="platform-card-grid">${platforms.map(p=>`<section class="panel platform-edition" id="edition-${p}" data-platform="${p}" aria-label="${names[p]}版本"></section>`).join('')}</div>
 <section class="panel" id="prep-history" tabindex="-1"><h2 class="h2">历史平台记录</h2><p class="note">旧记录与原任务文件继续保留；已填写或结果未知的稿件请先核对平台。</p><div id="prep-records">${records}</div></section></main>`;
}
export async function initPreparePage({esc,config,postId,initial}) {
 let post=null,master=empty(),editions=Object.fromEntries(platforms.map(p=>[p,empty()])),dirty=new Set(),masterDirty=false,working=false,timer;
 const invalidInputs=new Set();
 const rulesConfig={publishPrep:{x:{premium:config.rules.x.body===25000}}};
 const message=document.getElementById('post-message');
 const say=t=>{message.textContent=t;};
 const request=async a=>{const response=await fetch('/api/prep/posts',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(a)}),r=await response.json();if(!response.ok)throw Error(r.error);return r;};
 const asset=(p,i)=>post?`/api/prep/posts/asset?id=${encodeURIComponent(post.id)}&platform=${p}&index=${i}`:'';
 const img=(p,i)=>{const local=(p==='master'?master:editions[p]).images[i],saved=p==='master'?post?.master:post?.editions[p];const originalIndex=saved?.images.indexOf(local)??i;return asset(p,originalIndex);};
 const content=(key,value,label,rows)=>`<label class="prep-field">${label}${rows?`<textarea data-field="${key}" rows="${rows}">${esc(value??'')}</textarea>`:`<input data-field="${key}" value="${esc(value??'')}">`}</label>`;
 function media(p,e) {return `<div class="edition-media"><div class="prep-media-head"><strong>图片与封面</strong><label class="btn">添加图片<input type="file" data-upload="${p}" accept="image/png,image/jpeg,image/webp" multiple hidden></label></div><p class="note">顺序决定上传顺序；小红书将封面排在首张。</p><div class="edition-strip">${e.images.map((f,i)=>`<div class="edition-image"><img src="${esc(img(p,i))}" alt="第${i+1}张测试或正文图片"><span>${i+1}${f===e.cover?' · 封面':''}</span><div class="btns"><button class="btn" data-move="${i}" data-step="-1" aria-label="第${i+1}张前移" ${i===0?'disabled':''}>←</button><button class="btn" data-move="${i}" data-step="1" aria-label="第${i+1}张后移" ${i===e.images.length-1?'disabled':''}>→</button><button class="btn" data-cover="${i}">设封面</button><button class="btn" data-remove="${i}" aria-label="移除第${i+1}张">×</button></div></div>`).join('')}</div><label class="btn">单独上传封面<input type="file" data-upload="${p}" data-separate-cover accept="image/png,image/jpeg,image/webp" hidden></label>${e.cover&&!e.images.includes(e.cover)?`<p class="note">已指定独立封面（公众号填写时会加入正文供选择）</p><img class="separate-cover" src="${asset(p,'cover')}" alt="独立封面">`:''}</div>`;}
 function renderEditor(p) {
  const e=p==='master'?master:editions[p],node=document.getElementById(p==='master'?'master-editor':'edition-'+p);
  const locked=p!=='master'&&['running','unknown','awaiting_user','draft_saved','published','submitted','already_exists','failed'].includes(e.state);
  node.innerHTML=`<div class="edition-heading"><h2 class="h2">${p==='master'?'原稿':names[p]}</h2><span class="note">${p==='master'?'完整内容，从这里开始':stateLabel(e.state)}</span></div><fieldset ${locked?'disabled':''}>${content('title',e.title,p==='x'?'标题（本地整理用，不计入帖文）':'标题')}${content('content',e.content,'正文',p==='master'?5:7)}${content('topics',e.topics.join('、'),'话题（顿号或逗号分隔）')}${p==='wechat'?content('digest',e.digest,'摘要',2)+content('author',e.author,'作者（需在草稿里手填）'):''}${media(p,e)}${p==='wechat'?`<label class="prep-field">正文图片位置 <span class="note">段落以空行分隔；0为正文前</span><textarea data-positions rows="2" placeholder='[{"image":"本稿图片路径","afterParagraph":1}]'>${esc(JSON.stringify(e.imagePositions))}</textarea></label>`:''}<details><summary>本机路径与审阅选项</summary>${content('paths',e.images.join('\n'),'图片路径（每行一张）',2)}${content('cover',e.cover??'','封面图片路径')}${content('video',e.video??'','视频（预留，暂不支持）')}${p==='xhs'?`<label class="prep-field">逐图审阅记录（不自动声明已审）<textarea data-review rows="3">${esc(JSON.stringify(e.promotionReview??{}))}</textarea></label>`:''}</details></fieldset>${p==='master'?'':`<div class="edition-validation" aria-live="polite"></div><details class="edition-preview" open><summary>仿真预览 · ${names[p]}</summary><div class="edition-preview-body"></div></details><div class="btns edition-actions"><button class="btn" data-action="check" ${locked?'disabled':''}>检查</button><button class="btn pri" data-action="${p==='x'?'bundle':'fill'}" ${p!=='x'&&(e.state!=='checked'||locked)?'disabled':''}>${p==='x'?'下载文图包':p==='xhs'?'填入小红书（不发布）':'存为公众号草稿（不发表）'}</button></div><p class="note">${p==='x'?'下载包含全文和全部配图的 ZIP，自行粘贴并附图。':p==='xhs'?'TwoPeanuts · AI号；保留专用编辑窗口。':'TwoPeanuts的AI · 仅保存草稿。'}</p>`}`;
  if(p!=='master')refreshPreview(p);
 }
 function refreshPreview(p){const node=document.getElementById('edition-'+p),e=editions[p],v=validateEdition(p,e,rulesConfig),counts=v.counts,l=v.limits;
  node.querySelector('.edition-validation').innerHTML=`<p class="edition-counts">${p==='x'?`<span class="${counts.body>l.body?'invalid':''}">加权 ${counts.body}/${l.body}</span>`:`<span class="${counts.title>l.title?'invalid':''}">标题 ${counts.title}/${l.title}</span><span class="${counts.body>l.body?'invalid':''}">正文 ${counts.body}/${l.body}</span>`}<span class="${counts.images<l.imagesMin||counts.images>l.imagesMax?'invalid':''}">图片 ${counts.images}/${l.imagesMax}</span>${p==='wechat'?`<span class="${counts.digest>120?'invalid':''}">摘要 ${counts.digest}/120</span><span class="${counts.author>16?'invalid':''}">作者 ${counts.author}/16</span>`:''}</p>${v.issues.map(i=>`<p class="invalid">${esc(i.message)}</p>`).join('')}${e.record?.error?`<p class="invalid">${esc(e.record.error)}</p>`:''}`;
  const paragraphs=e.content.split(/\n\s*\n/),imageHTML=i=>`<img src="${esc(img(p,i))}" alt="预览第${i+1}张图片">`;
  const gallery=p==='wechat'?'':`<div class="preview-gallery ${p}">${e.images.map((_,i)=>imageHTML(i)).join('')}</div>`;
  const positioned=new Set();let body=paragraphs.map((t,i)=>{const pics=p==='wechat'?e.images.map((file,j)=>e.imagePositions.some(pos=>pos.image===file&&pos.afterParagraph===i+1)?(positioned.add(file),imageHTML(j)):'').join(''):'';return `<p>${esc(t).replace(/\n/g,'<br>')}</p>${pics}`;}).join('');
  if(p==='wechat'){const first=e.images.map((file,i)=>e.imagePositions.some(pos=>pos.image===file&&pos.afterParagraph===0)?(positioned.add(file),imageHTML(i)):'').join('');body=first+body+e.images.map((file,i)=>!positioned.has(file)?imageHTML(i):'').join('');}
  node.querySelector('.edition-preview-body').innerHTML=`${p!=='x'?`<h3>${esc(e.title)}</h3>`:''}${p==='wechat'&&e.author?`<p class="note">${esc(e.author)}（保存后需手填）</p>`:''}${body}${gallery}<p class="note">${esc(e.topics.map(t=>'#'+t).join(' '))}</p>`;
 }
 function adopt(value){post=value;master=clone(value.master);editions=clone(value.editions);dirty.clear();masterDirty=false;renderAll();}
 function renderAll(){renderEditor('master');platforms.forEach(renderEditor);renderState();}
 function renderState(){const g=post?.generation;document.getElementById('generation-state').textContent=g?.state==='running'?'正在按本地写作规范改稿…':g?.state==='done'?'三端版本已生成，可继续编辑':g?.state==='failed'?g.error:'只生成文字，不操作平台';document.getElementById('generate-editions').disabled=working||g?.state==='running';}
 async function save(){if(invalidInputs.size)throw Error('请先修正审阅记录或图片位置中的 JSON 格式');if(!post){const edited=Object.fromEntries([...dirty].map(p=>[p,clone(editions[p])]));post=(await request({type:'create',input:inputOf(master)})).post;masterDirty=false;for(const p of platforms)editions[p]=edited[p]??clone(post.editions[p]);}
  if(masterDirty){post=(await request({type:'update',id:post.id,platform:'master',input:inputOf(master)})).post;masterDirty=false;}
  for(const p of [...dirty]){post=(await request({type:'update',id:post.id,platform:p,input:inputOf(editions[p])})).post;editions[p]=clone(post.editions[p]);dirty.delete(p);}
 }
 function watch(){clearInterval(timer);timer=setInterval(async()=>{if(!document.getElementById('master-editor'))return clearInterval(timer);try{const response=await fetch('/api/prep/posts/record?id='+post.id),r=await response.json();if(!response.ok)throw Error(r.error);const next=r.post;if(next.generation.state==='running'||platforms.some(p=>next.editions[p].state==='running'))return;clearInterval(timer);adopt(next);say(next.generation.state==='failed'?next.generation.error:'状态已更新；未执行最终发布。');}catch(e){clearInterval(timer);say(e.message);}},1500);}
 document.getElementById('generate-editions').onclick=async()=>{working=true;renderState();try{await save();const r=await request({type:'generate',id:post.id});post=r.post;renderState();watch();say('改稿过程中保留原稿，请等待结果。');}catch(e){say(e.message);}finally{working=false;renderState();}};
 document.getElementById('save-post').onclick=async()=>{try{await save();say('本地改动已保存，未操作平台。');renderAll();}catch(e){say(e.message);}};
 const roots=['master',...platforms];
 for(const p of roots){const node=document.getElementById(p==='master'?'master-editor':'edition-'+p);
  node.oninput=event=>{const e=p==='master'?master:editions[p],field=event.target.dataset.field;try{if(field){if(field==='topics')e.topics=event.target.value.split(/[、,，\n]/).map(s=>s.trim().replace(/^#/, '')).filter(Boolean);else if(field==='paths')e.images=event.target.value.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);else e[field]=event.target.value|| (field==='cover'||field==='video'?null:'');}
    if(event.target.hasAttribute('data-review'))e.promotionReview=JSON.parse(event.target.value);if(event.target.hasAttribute('data-positions'))e.imagePositions=JSON.parse(event.target.value);
    invalidInputs.delete(event.target);p==='master'?masterDirty=true:dirty.add(p);if(p!=='master'){e.state='editing';node.querySelector('[data-action=fill]')?.setAttribute('disabled','');refreshPreview(p);}
  }catch{invalidInputs.add(event.target);say('请填写有效 JSON；当前输入尚未保存。');}};
  node.onchange=async event=>{if(!event.target.matches('[data-upload]'))return;try{await save();const e=p==='master'?master:editions[p];const coverOnly=event.target.hasAttribute('data-separate-cover');for(const file of event.target.files){const response=await fetch('/api/prep/image?name='+encodeURIComponent(file.name),{method:'POST',headers:{'content-type':'application/octet-stream'},body:file}),r=await response.json();if(!response.ok)throw Error(r.error);if(coverOnly)e.cover=r.path;else {e.images.push(r.path);e.cover??=r.path;}}
      p==='master'?masterDirty=true:dirty.add(p);await save();adopt(await (await fetch('/api/prep/posts/record?id='+post.id)).json().then(r=>r.post));say('图片已保存到本机，尚未上传平台。');
    }catch(e){say(e.message);}};
  node.onclick=async event=>{const b=event.target.closest('button');if(!b)return;const e=p==='master'?master:editions[p];
    if(b.hasAttribute('data-move')){const i=+b.dataset.move,j=i+(+b.dataset.step);[e.images[i],e.images[j]]=[e.images[j],e.images[i]];}
    else if(b.hasAttribute('data-cover'))e.cover=e.images[+b.dataset.cover];
    else if(b.hasAttribute('data-remove')){const removed=e.images.splice(+b.dataset.remove,1)[0];if(e.cover===removed)e.cover=e.images[0]??null;e.imagePositions=e.imagePositions.filter(pos=>pos.image!==removed);}
    else if(b.dataset.action){b.disabled=true;try{await save();const action=b.dataset.action;if(action==='bundle'){const checked=await request({type:'check',id:post.id,platform:p});if(!checked.validation.ok)throw Error(checked.validation.issues.map(i=>i.message).join('；'));location.href='/api/prep/posts/bundle?id='+post.id;say('已下载 X 全文与全部配图；未连接 X。');}
      else {const result=await request({type:action,id:post.id,platform:p});adopt(result.post);say(action==='check'?(result.validation.ok?'规则检查通过，正在运行本地离线检查。':'请修正红色提示。'):'已启动平台填写，最终发布仍由本人操作。');watch();}
    }catch(error){say(error.message);}finally{b.disabled=false;}return;}
    else return;p==='master'?masterDirty=true:dirty.add(p);renderEditor(p);
  };
 }
 const list=await (await fetch('/api/prep/posts')).json();
 document.getElementById('post-picker').innerHTML=`<label>本地原稿 <select id="post-select"><option value="">新建原稿</option>${list.posts.map(p=>`<option value="${p.id}" ${p.id===postId?'selected':''}>${esc(p.master.title||'未命名原稿')}</option>`).join('')}</select></label><span class="note">来源信息是调用方上报，不是认证</span>`;
 document.getElementById('post-select').onchange=event=>{location.hash='#/prepare'+(event.target.value?'?post='+event.target.value:'');if(!event.target.value)location.reload();};
 if(postId)adopt((await (await fetch('/api/prep/posts/record?id='+encodeURIComponent(postId))).json()).post);
 else{if(initial){master={...empty(),title:initial.copy.title,content:initial.copy.body};editions=Object.fromEntries(platforms.map(p=>[p,clone(master)]));}renderAll();}
 if(post?.generation.state==='running'||platforms.some(p=>editions[p].state==='running'))watch();
}
