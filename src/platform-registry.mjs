export const PLATFORM_CATALOG = [
  {id:'bilibili',name:'B站',home:'https://member.bilibili.com/platform/home',native:true,port:9343},
  {id:'douyin',name:'抖音',home:'https://creator.douyin.com/creator-micro/home',native:true,port:9344},
  {id:'xhs',name:'小红书',home:'https://creator.xiaohongshu.com/new/home',port:9340},
  {id:'wechat',name:'公众号',home:'https://mp.weixin.qq.com/',port:9342},
  {id:'channels',name:'视频号',home:'https://channels.weixin.qq.com/platform/post/list',native:true,port:9345},
  {id:'youtube',name:'YouTube',home:'https://studio.youtube.com/',native:true,port:9346},
  {id:'x',name:'X',home:'https://x.com/home',port:9341},
  {id:'instagram',name:'Instagram',home:'https://www.instagram.com/',native:true,port:9347},
];
export const PLATFORM_IDS=PLATFORM_CATALOG.map(p=>p.id);
export const DEFAULT_SELECTED=[];
export const platformById=id=>PLATFORM_CATALOG.find(p=>p.id===id);
export function selectedPlatforms(db) {
  try { const parsed=JSON.parse(db.prepare('SELECT value FROM meta WHERE key=?').get('l1:platform-selection')?.value || 'null');
    if(Array.isArray(parsed))return parsed.filter((p,i)=>PLATFORM_IDS.includes(p)&&parsed.indexOf(p)===i);
  } catch {}
  return DEFAULT_SELECTED;
}
export function choosePlatform(db,id,selected) {
  if(!PLATFORM_IDS.includes(id)||typeof selected!=='boolean')throw new Error('请选择有效的平台和使用状态');
  const current=selectedPlatforms(db),next=selected?[...new Set([...current,id])]:current.filter(p=>p!==id);
  db.prepare('INSERT OR REPLACE INTO meta(key,value) VALUES (?,?)').run('l1:platform-selection',JSON.stringify(next));return next;
}
