// 以下函数在页面 Runtime.evaluate 中执行，只读取可见 DOM。
export function visibleIdentity() {
  const visible = el => { const r = el.getBoundingClientRect(), s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const names = [...new Set([...document.querySelectorAll('.account-name, .user-info .name-box, .user-info .nickname, .user-name')].filter(visible).map(el => el.innerText.trim()).filter(Boolean))];
  const login = location.origin !== 'https://creator.xiaohongshu.com' || /login|passport|captcha/i.test(location.href) || /扫码登录|手机号登录|验证码登录/.test(document.body?.innerText || '');
  return { nickname: names.length === 1 ? names[0] : null, login, url: location.href };
}
export function visibleFans() {
  const visible = el => { const r = el.getBoundingClientRect(), s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const labels = [...document.querySelectorAll('div,span,p')].filter(visible).filter(el => /^(?:粉丝总数|总粉丝|总粉丝数|粉丝总量)$/.test(el.innerText.trim()));
  const candidates = [];
  for (const label of labels) {
    for (const box of [label.parentElement, label.parentElement?.parentElement].filter(Boolean)) {
      const lines = box.innerText.split('\n').map(s => s.trim()).filter(s => /^[\d,]+(?:\.\d+)?\s*[万亿kKmM]?$/.test(s));
      if (lines.length === 1) { candidates.push(lines[0]); break; }
    }
  }
  const distinct = [...new Set(candidates)];
  return distinct.length === 1 ? distinct[0] : null;
}
export function visibleNoteCards() {
  const visible = el => { const r = el.getBoundingClientRect(), s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  return [...document.querySelectorAll('.note-card')].filter(visible).map(card => {
    // data-impression 是卡片的 DOM 属性，不访问框架内部对象或存储。
    let id = null;
    try { id = JSON.parse(card.getAttribute('data-impression')).noteTarget.value.noteId; } catch { /* 缺失就尝试 DOM 链接 */ }
    const links = [...card.querySelectorAll('a[href]')].filter(visible).map(a => a.href);
    for (const link of links) { const match = link.match(/^https:\/\/(?:www\.)?xiaohongshu.com\/explore\/([\w-]+)/); if (!id && match) id = match[1]; }
    const url = links.find(link => { try { const u = new URL(link); return u.protocol === 'https:' && /^(?:www\.)?xiaohongshu\.com$/.test(u.hostname) && u.pathname === `/explore/${id}` && !u.search && !u.hash; } catch { return false; } }) || null;
    const text = card.innerText;
    const title = (card.querySelector('.note-card__title')?.innerText || '').trim();
    const dateNode = [...card.querySelectorAll('.note-card__time, .note-card__date, .note-card__publish-time, time')].find(visible);
    const dateLine = dateNode?.innerText || text.replace(title, '').split('\n').map(s => s.trim()).find(s => /^(?:发布于?\s*|发布时间\s*[:：]?\s*)?20\d{2}[年/.-]\d{1,2}[月/.-]\d{1,2}(?:日)?(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?$/.test(s)) || '';
    const date = (dateLine.match(/\b(20\d{2})[年/.-](\d{1,2})[月/.-](\d{1,2})(?:日)?/) || []).slice(1);
    const dateText = date.length ? `${date[0]}-${date[1].padStart(2,'0')}-${date[2].padStart(2,'0')}` : null;
    return { id: id == null ? null : String(id), url, text: title, date: dateText, date_status: dateText ? 'visible-date' : 'unknown', stats: [...card.querySelectorAll('.note-card__stat')].map(el => visible(el) ? el.innerText.trim() : null), state: /审核中/.test(text) ? 'reviewing' : /未通过|草稿/.test(text) ? 'skipped' : 'published' };
  });
}
export function scrollNotes() {
  const card = document.querySelector('.note-card');
  let el = card?.parentElement;
  while (el && el !== document.body) {
    if (el.scrollHeight > el.clientHeight + 100 && /auto|scroll/.test(getComputedStyle(el).overflowY)) {
      const atEnd = el.scrollTop + el.clientHeight >= el.scrollHeight - 12;
      el.scrollBy({ top: Math.max(400, el.clientHeight * 0.75), behavior: 'smooth' }); return atEnd;
    }
    el = el.parentElement;
  }
  const scroller = document.scrollingElement || document.documentElement;
  const atEnd = scroller.scrollTop + innerHeight >= scroller.scrollHeight - 12;
  window.scrollBy({ top: Math.max(400, innerHeight * 0.75), behavior: 'smooth' }); return atEnd;
}
export function nextNotesPage() {
  const visible = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const el = [...document.querySelectorAll('button, [role="button"], .el-pagination .btn-next, .ant-pagination-next')].find(el => visible(el) && (/^(?:下一页|下页)$/.test(el.innerText.trim()) || /下一页|next page/i.test(el.getAttribute('aria-label') || '') || el.matches('.btn-next, .ant-pagination-next')));
  if (!el || el.disabled || el.getAttribute('aria-disabled') === 'true' || /disabled/.test(el.className)) return false;
  el.click(); return true;
}
export function parseVisibleNumber(value) {
  if (value == null) return null;
  const m = String(value).replace(/,/g, '').trim().match(/^(\d+(?:\.\d+)?)\s*([万亿kKmM])?$/);
  if (!m) return null;
  return Math.round(Number(m[1]) * ({ 万: 1e4, 亿: 1e8, k: 1e3, m: 1e6 }[(m[2] || '').toLowerCase()] || 1));
}

// Only an explicitly labelled, visible share control on the exact stable-ID card.
// Do not guess icon positions, read clipboard/storage, or synthesize a permalink.
export function visibleNoteShare(postId, open = false) {
  const visible=el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none';};
  const cards=[...document.querySelectorAll('.note-card')].filter(visible).filter(card=>{
    try{return String(JSON.parse(card.getAttribute('data-impression')).noteTarget.value.noteId)===postId;}catch{return false;}
  });
  if(cards.length!==1)return {ok:false,reason:'stable-id-card-not-unique',evidence:{cardCount:cards.length}};
  const card=cards[0];
  if(/审核中|未通过|草稿/.test(card.innerText))return {ok:false,reason:'not-published'};
  const dialogs=[...document.querySelectorAll('[role="dialog"], .el-dialog, .ant-modal, [role="tooltip"], .el-popover')].filter(visible).filter(el=>/分享|复制链接|笔记链接/.test(el.innerText));
  const urls=new Set();
  for(const root of [card,...dialogs]) {
    const values=[...[...root.querySelectorAll('a[href]')].filter(visible).map(a=>a.href), ...[...root.querySelectorAll('input,textarea')].filter(visible).map(a=>a.value),root.innerText];
    for(const value of values)for(const match of String(value || '').matchAll(/https:\/\/(?:www\.)?xiaohongshu\.com\/explore\/[\w-]+(?:[^\s<>"']*)/g)) {
      try{const u=new URL(match[0]);if(u.pathname===`/explore/${postId}`&&!u.search&&!u.hash&&!u.username&&!u.password)urls.add(u.href);}catch{}
    }
  }
  const candidates=[...card.querySelectorAll('button,[role="button"],a,.note-card__action-btn')].filter(visible);
  const attributes=candidates.map(el=>({tag:el.tagName?.toLowerCase() || null,role:el.getAttribute('role'),text:String(el.innerText || '').trim().slice(0,80),ariaLabel:el.getAttribute('aria-label'),title:el.getAttribute('title')}));
  const labelled=a=>[a.text,a.ariaLabel,a.title].some(v=>/^(分享|分享笔记|复制链接|复制笔记链接)$/.test(String(v || '').trim()));
  const controls=candidates.filter((el,i)=>labelled(attributes[i]));
  const unlabelled=attributes.filter(a=>![a.text,a.ariaLabel,a.title].some(v=>String(v || '').trim())).length;
  const evidence={cardCount:1,visibleControlCount:candidates.length,labelledShareCount:controls.length,unlabelledControlCount:unlabelled,publicLinkCount:urls.size,controls:attributes};
  if(urls.size===1)return {ok:true,postId,url:[...urls][0],source:'visible-share-or-card',evidence};
  if(urls.size>1)return {ok:false,reason:'ambiguous-share-links',evidence};
  if(!controls.length)return {ok:false,reason:!candidates.length?'visible-share-control-zero':unlabelled?'visible-share-control-unlabelled':'visible-share-control-no-explicit-label',evidence};
  if(controls.length>1)return {ok:false,reason:'visible-share-control-multiple',evidence};
  if(!open)return {ok:false,reason:'no-verifiable-public-link',evidence};
  controls[0].click();return {ok:false,opened:true,reason:'share-opened',evidence};
}
