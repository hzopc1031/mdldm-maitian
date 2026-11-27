// Shared by the independent homepage and the inner pages. No platform operations.
let selectedXAccount='default';try{selectedXAccount=localStorage.getItem('maitian:x-account')||'default';}catch{}
async function api(p) { if(/^\/api\/(?:overview|prep\/status)(?:\?|$)/.test(p))p+=(p.includes('?')?'&':'?')+'xAccount='+encodeURIComponent(selectedXAccount);const r = await fetch(p); if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.status); return r.json(); }
function selectXAccount(id) {
 selectedXAccount=id;
 try{localStorage.setItem('maitian:x-account',id);}catch{}
}
addEventListener('storage',event=>{if(event.key==='maitian:x-account')selectedXAccount=event.newValue||'default';});
document.addEventListener('change',event=>{if(!event.target.matches('[data-x-account-select]'))return;selectXAccount(event.target.value);location.reload();});
function xAccountPicker(O){return `${(O.xAccounts||[]).length>1?`<label class="x-account-picker">X账户 <select data-x-account-select aria-label="查看X账户">${O.xAccounts.map(a=>`<option value="${esc(a.id)}" ${a.id===O.xAccountId?'selected':''}>${esc(a.handle?'@'+a.handle:a.label+'（未登录）')}</option>`).join('')}</select></label>`:''}`;}
