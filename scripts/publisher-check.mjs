// Read installed public package and load the actual upstream modules, never a platform.
import fs from 'node:fs';import path from 'node:path';import {parseArgs} from 'node:util';
const {values}=parseArgs({options:{'plugin-dir':{type:'string'}}});
try {
  if(values['plugin-dir'])process.env.MAITIAN_PUBLISHER_DIR=path.resolve(values['plugin-dir']);
  const {config}=await import('../src/feishu.mjs');
  const dir=process.env.MAITIAN_PUBLISHER_DIR||config.pluginDir;
  if(!dir)throw Error('缺少 --plugin-dir / MAITIAN_PUBLISHER_DIR / pluginDir');
  for(const file of ['manifest.json','LICENSE','background.js','sidepanel.html','lib/publish.js','lib/cdp.js'])if(!fs.statSync(path.join(dir,file)).isFile())throw Error('缺少官方插件文件');
  const manifest=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'),'utf8'));
  // A load check must fail rather than quietly acquire a browser or network connection.
  globalThis.fetch=()=>{throw Error('package check must not access network');};
  globalThis.WebSocket=class {constructor(){throw Error('package check must not open browser');}};
  const {publisherInfo}=await import('../src/driver.mjs');
  console.log(JSON.stringify({ok:true,name:manifest.name,version:manifest.version,...await publisherInfo(),extensionLoaded:'not checked by library load'}));
}catch{console.error('publisher 包加载检查失败；请核对目录、Node版本及原库文件。未启动浏览器。');process.exitCode=1;}
