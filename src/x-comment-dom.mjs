// Serialized into the owned X tab. Read only visible public content and controls.
export function commentPageView(){
 const visible=e=>!!e&&e.getClientRects().length>0&&getComputedStyle(e).visibility!=='hidden';
 const column=document.querySelector('[data-testid="primaryColumn"]')||document.querySelector('main');
 const cards=[];
 for(const article of column?.querySelectorAll('article')||[]){
  if(!visible(article))continue;
  const owned=e=>e.closest('article')===article&&!e.closest('[data-testid="quoteTweet"],div[role="link"]');
  const times=[...article.querySelectorAll('time')].filter(e=>visible(e)&&owned(e));
  const links=times.map(t=>({time:t,url:t.closest('a[href]')?.href})).filter(x=>/^https:\/\/x\.com\/[A-Za-z0-9_]{1,15}\/status\/[1-9]\d{0,24}$/.test(x.url||''));
  const ids=[...new Set(links.map(x=>x.url.split('/').at(-1)))];if(ids.length!==1)continue;
  const link=links[0],m=/^https:\/\/x\.com\/([^/]+)\/status\/(\d+)$/.exec(link.url);
  const texts=[...article.querySelectorAll('[data-testid="tweetText"]')].filter(e=>visible(e)&&owned(e));
  if(texts.length!==1)continue;
  cards.push({id:m[2],handle:m[1].toLowerCase(),url:link.url,content:texts[0].innerText.replace(/\r\n?/g,'\n'),createdAt:link.time.getAttribute('datetime')});
 }
 const toastUrls=[...document.querySelectorAll('[role="alert"] a[href]')].filter(visible).map(a=>a.href).filter(u=>/^https:\/\/x\.com\/[A-Za-z0-9_]{1,15}\/status\/[1-9]\d{0,24}$/.test(u));
 return {url:location.href,cards,toastUrls};
}
export function openCommentTarget(targetId,targetHandle){
 const visible=e=>!!e&&e.getClientRects().length>0&&getComputedStyle(e).visibility!=='hidden';
 const column=document.querySelector('[data-testid="primaryColumn"]')||document.querySelector('main');
 const matches=[...column?.querySelectorAll('article')||[]].filter(article=>visible(article)&&[...article.querySelectorAll('time')].some(t=>{
  if(t.closest('article')!==article||t.closest('[data-testid="quoteTweet"],div[role="link"]'))return false;
  return t.closest('a[href]')?.href?.toLowerCase()===`https://x.com/${targetHandle}/status/${targetId}`.toLowerCase();
 }));
 if(matches.length!==1)return false;
 const article=matches[0],buttons=[...article.querySelectorAll('[data-testid="reply"]')].filter(b=>visible(b)&&b.closest('article')===article&&!b.closest('[data-testid="quoteTweet"],div[role="link"]'));
 if(buttons.length!==1)return false;
 buttons[0].scrollIntoView({block:'center'});buttons[0].click();return true;
}
export function commentComposer(targetId,targetHandle,account,content,action){
 const visible=e=>!!e&&e.getClientRects().length>0&&getComputedStyle(e).visibility!=='hidden';
 const menu=document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]');
 if(!visible(menu))return null;
 const handles=[...(menu.innerText.match(/@[A-Za-z0-9_]{1,15}/g)||[]).map(h=>h.slice(1)),...menu.querySelectorAll('[data-testid^="UserAvatar-Container-"]')].map(e=>typeof e==='string'?e:e.getAttribute('data-testid').replace('UserAvatar-Container-','')).map(h=>h.toLowerCase());
 const identities=[...new Set(handles)];if(identities.length!==1||identities[0]!==account.toLowerCase())return null;
 const dialogs=[...document.querySelectorAll('[role="dialog"]')].filter(d=>visible(d)&&[...d.querySelectorAll('[data-testid="tweetTextarea_0"]')].some(visible));
 if(dialogs.length!==1)return null;
 const dialog=dialogs[0],editors=[...dialog.querySelectorAll('[data-testid="tweetTextarea_0"]')].filter(e=>visible(e)&&e.isContentEditable);
 if(editors.length!==1||[...dialog.querySelectorAll('[data-testid="attachments"], [role="alert"], [aria-busy="true"]')].some(visible))return null;
 const targetLinks=[...dialog.querySelectorAll('article time')].filter(t=>visible(t)&&!t.closest('[data-testid="quoteTweet"],div[role="link"]')).map(t=>t.closest('a[href]')?.href?.toLowerCase()).filter(Boolean);
 const targets=[...new Set(targetLinks)];
 if(targets.length!==1||targets[0]!==`https://x.com/${targetHandle}/status/${targetId}`.toLowerCase())return null;
 const editor=editors[0],text=editor.innerText.replace(/\r\n?/g,'\n');
 const buttons=[...dialog.querySelectorAll('[data-testid="tweetButton"], [data-testid="tweetButtonInline"]')].filter(visible);
 const ready=text===content&&buttons.length===1&&!buttons[0].disabled&&buttons[0].getAttribute('aria-disabled')!=='true';
 if(action==='focus'){if(text.trim())return null;editor.focus();return document.activeElement===editor;}
 if(action==='submit'){if(!ready)return null;buttons[0].click();return true;}
 return {empty:!text.trim(),ready,text};
}
