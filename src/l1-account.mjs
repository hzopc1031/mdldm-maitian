// Public identity configuration only. Never load a browser profile or session.
import fs from 'node:fs';
import path from 'node:path';
import {home} from './l1-config.mjs';
import {PLATFORM_IDS} from './platform-registry.mjs';
export function l1Account(config, platform) {
  if(platform==='x'&&config._xAccountRoute&&!config._xAccountRoute.handle)throw Error('此X账户尚未登录绑定，请先登录');
  if(!PLATFORM_IDS.includes(platform))throw new Error('未知 L1 平台');
  if(platform==='x' && config.xHandle && config.l1?.x?.account && config.xHandle.toLowerCase()!==config.l1.x.account.toLowerCase())throw new Error('X 预期账号配置冲突；未启动浏览器');
  const file=process.env.MAITIAN_ACCOUNTS || path.join(home,'l1-accounts.local.json');
  const local=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,'')):{};
  const account=config.l1?.[platform]?.account || (platform==='x'?config.xHandle:null) || local[platform];
  if(typeof account!=='string'||!account.trim()||(platform==='x'&&!/^[A-Za-z0-9_]{1,15}$/.test(account))) throw new Error(`请配置 l1.${platform}.account 或本地公开身份文件中的 ${platform}；未启动浏览器`);
  return account.trim();
}
