// Original-platform collectors run only in a newly-owned, per-platform browser.
// No original hub/driver/publisher or ordinary Chrome session is imported.
import fs from 'node:fs';
import path from 'node:path';
import {dbPath,home} from './l1-config.mjs';
import {l1Account} from './l1-account.mjs';
import {withL1Browser,pause} from './l1-browser.mjs';
import {platformById} from './platform-registry.mjs';
import {dayWindow,inDayWindow} from './l1-collection-window.mjs';
import {waitForVisibleLogin,loginTimeoutMs} from './l1-login.mjs';
import {reportL1Progress} from './l1-progress.mjs';
import {originalMetricCollectors,originalFollowerCollectors} from './native-collectors.mjs';

export function nativeVisibleIdentity(platform) {
  const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none';};
  const selectors={
    bilibili:'.header-user-info .username,.header-user-info .name,.header-avatar .username,.header .user-name,.header .username,.header-user-name',
    douyin:'header [class*="user-name"],.header [class*="user-name"],[data-e2e="user-name"],.header [class*="nickname"]',
    channels:'.finder-header .finder-nickname,.account-info .nickname,.header .nickname,.finder-nickname,.account-name',
    youtube:'ytcp-account-button #channel-name,ytcp-account-menu #channel-name,ytcp-account-menu .account-name,#channel-name.ytcp-account-menu',
    instagram:'a[href] img[alt*="profile picture"],a[href] img[alt*="的头像"]'
  };
  const nodes=[...document.querySelectorAll(selectors[platform]||'__no_platform__')].filter(visible).filter(e=>platform!=='instagram'||e.getBoundingClientRect().x<150);
  const names=[...new Set(nodes.map(e=>platform==='instagram'?(e.getAttribute('alt')||'').replace(/的头像$|['’]s profile picture$/i,'').trim():(e.innerText||'').trim()).filter(Boolean))];
  return {names,url:location.href,login:[...document.querySelectorAll('input[type="password"],input[autocomplete="username"]')].some(visible)};
}
function checkIdentity(identity,platform,expected) {
  const host=new URL(identity.url).hostname;
  const domains={bilibili:'member.bilibili.com',douyin:'creator.douyin.com',channels:'channels.weixin.qq.com',youtube:'studio.youtube.com',instagram:'www.instagram.com'};
  if(host!==domains[platform])return false;
  if(identity.names.length>1)throw new Error('可见平台账号有歧义；未采集、未写库');
  if(expected&&identity.names.length===1&&identity.names[0]!==expected)throw new Error('当前可见账号与预期账号不符；未采集、未写库');
  return identity.names.length===1&&!identity.login;
}
async function assertAccount(page,platform,expected,wait=pause) {
  for(let i=0;i<6;i++){if(checkIdentity(await page.evaluate(nativeVisibleIdentity,platform),platform,expected))return;if(i<5)await wait();}
  throw new Error('无法确认专用窗口当前账号；请先登录并核对平台显示名称，未写入数据');
}
export async function loginNative(config,platform,{withBrowser=withL1Browser,timeoutMs=loginTimeoutMs()}={}) {
  if(!platformById(platform)?.native)throw new Error('请选择原生平台');
  let account;try{account=l1Account(config,platform);}catch{account=null;}
  let confirmed;
  await withBrowser(config,async page=>{
    await page.goto(platformById(platform).home);await page.bringToFront?.();
    reportL1Progress('waiting_login',timeoutMs);
    await waitForVisibleLogin({evaluate:()=>page.evaluate(nativeVisibleIdentity,platform)},nativeVisibleIdentity,i=>{if(checkIdentity(i,platform,account)){confirmed=i.names[0];return true;}return false;},timeoutMs);
    reportL1Progress('identity_confirmed');console.log(`${platform} 专用账号确认成功；未发布内容。`);
  },platform);
  if(!account) {
    if(!confirmed||confirmed.length>100||/[\r\n]/.test(confirmed)||/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/.test(confirmed))throw new Error('未安全识别平台公开显示名称；未绑定账号');
    const file=process.env.MAITIAN_ACCOUNTS||path.join(home,'l1-accounts.local.json');let local={};if(fs.existsSync(file))local=JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));local[platform]=confirmed;fs.writeFileSync(file,JSON.stringify(local,null,2));
  }
}
export async function registeredNativePosts(platform,account) {
  if(!fs.existsSync(dbPath))return [];
  const {DatabaseSync}=await import('node:sqlite');const db=new DatabaseSync(dbPath,{readOnly:true});
  try{
    return db.prepare('SELECT t.url,s.project FROM tasks t JOIN snapshots s ON s.episode_id=t.episode_id WHERE t.platform=? AND t.state=?').all(platform,'published').flatMap(r=>{
      let p;try{p=JSON.parse(r.project);}catch{return [];}
      if(p.account!==account)return [];
      const fields=p.platforms?.[platform];
      return [{id:p.postId,url:r.url,text:p.text||'',created_at:p.created_at,
        p:{title:fields?.title||p.text||'',body:fields?.body??(!fields?.desc&&!fields?.shortTitle?p.text:undefined),
          desc:fields?.desc,shortTitle:fields?.shortTitle}}];
    });
  }finally{db.close();}
}
const nativeNumber=s=>{if(s==null)return null;const m=String(s).replace(/,/g,'').trim().match(/^(\d+(?:\.\d+)?)\s*([万亿KMw])?/i);return m?Math.round(+m[1]*({'万':1e4,'亿':1e8,k:1e3,m:1e6,w:1e4}[(m[2]||'').toLowerCase()]||1)):null;};
export async function collectNative(config,platform,date,{until=new Date(),withBrowser=withL1Browser,readRegistered=registeredNativePosts,filterRegistered,persist,wait=pause,now=()=>new Date()}={}) {
  if(!platformById(platform)?.native)throw new Error('未知原生采集平台');
  const account=l1Account(config,platform),window=dayWindow(date,until);
  const observation=await withBrowser(config,async page=>{
    await page.goto(platformById(platform).home);await assertAccount(page,platform,account,wait);
    const registered=await readRegistered(platform,account),byDate=registered.filter(p=>inDayWindow(p.created_at,window));
    const posts=filterRegistered ? filterRegistered(byDate) : byDate;
    const deps={config,num:nativeNumber,sleep:ms=>wait(ms,ms),evaluate:(_tab,expression)=>page.evaluate(function executeNativeRead(expression){return eval(expression);},expression),withTab:async(url,fn,{wait:ms=8000}={})=>{await page.goto(url);await wait(Math.max(0,ms-5000),Math.max(0,ms-5000));await assertAccount(page,platform,account,wait);return fn('owned');}};
    const metrics=originalMetricCollectors(deps),fans=originalFollowerCollectors(deps);
    const followerResult=filterRegistered ? null : await fans[platform]();const followers=followerResult?.total??null;
    let completed=0;
    for(const post of posts){reportL1Progress('reading_posts',{completed,total:posts.length});const m=await metrics[platform](post);if(!m)throw new Error('原生采集器未匹配到登记作品；未把缺失当0，请核对链接与标题');if(platform==='instagram'&&m.owner?.toLowerCase()!==account.toLowerCase())throw new Error('Instagram作品作者与当前账号不符；未写库');Object.assign(post,m,{precision:'original project collector; registered works only'});reportL1Progress('reading_posts',{completed:++completed,total:posts.length});}
    await page.goto(platformById(platform).home);await assertAccount(page,platform,account,wait);
    if(followers==null&&!posts.length)throw new Error('尚无登记作品，且未读到粉丝；请先登记作品链接或检查登录');
    return {platform,account,captured_at:now().toISOString(),source:'native/isolated-browser',followers,posts,collection:{...window,complete:false,coverage:'registered-only',unknownDates:registered.filter(p=>!p.created_at).length}};
  },platform);
  if(persist)return persist(observation);
  const store=await import('./l1-store.mjs');return store.transaction(()=>store.saveObservation(observation));
}
