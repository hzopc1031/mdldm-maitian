// First-party guard around the existing, unmodified local wechat-publish library.
import fs from 'node:fs';import path from 'node:path';import {pathToFileURL,fileURLToPath} from 'node:url';
import {visibleWechatIdentity} from './l1-wechat-dom.mjs';
import {redactSkillText,redactSkillValue,skillError} from './prep-skill-errors.mjs';
export function stopSkillRetry(write) {
  return function(chunk,...args){const text=redactSkillText(chunk),match=/第\s*1\s*次填写失败（(PAGE_CHANGED|UPLOAD_FAILED|BROWSER_FAILED)）[：:]([^\n]*)/.exec(text);const written=write.call(this,text,...args);if(match)throw Object.assign(Error(match[2].replace(/；尚未点击保存，自动重试一次\s*$/,'').trim()),{code:match[1]});return written;};
}
export async function runGuardedWechat({skill,jobFile,expected='TwoPeanuts的AI'}) {
  const lib=name=>import(pathToFileURL(path.join(path.dirname(skill),'lib',name+'.mjs')).href);
  const [util,wechat,lifecycle]=await Promise.all([lib('util'),lib('wechat'),lib('browser-lifecycle')]);
  lifecycle.installCleanupHandlers();lifecycle.keepBrowser(false);
  let result,exit=0,page;const originalWrite=process.stderr.write;
  try{
    const installedSource=fs.readFileSync(path.join(path.dirname(skill),'lib','wechat.mjs'),'utf8');
    if(!installedSource.includes('const maxAttempts = 2;')||!installedSource.includes('尚未点击保存，自动重试一次')||!installedSource.includes('await sleep(2000);'))throw Object.assign(Error('本地skill重试边界变化，停止填写'),{code:'USAGE'});
    const source=JSON.parse(fs.readFileSync(jobFile,'utf8'));if(source.submit!==false)throw Object.assign(Error('只允许submit:false'),{code:'USAGE'});
    const job=util.readJob(jobFile);const pre=util.preflight('wechat',job);if(pre.errors.length)throw Object.assign(Error(pre.errors.join('；')),{code:'USAGE'});
    // 不接管其它任务正在编辑的页面；仅识别路由，不输出认证查询值。
    let targets=[];
    try{const response=await fetch('http://127.0.0.1:9335/json/list',{signal:AbortSignal.timeout(3000)});if(!response.ok)throw Error('9335标签页检查失败');targets=await response.json();}
    catch(error){if(error.cause?.code!=='ECONNREFUSED')throw error;}
    if(!Array.isArray(targets))throw Error('9335标签页列表格式未知');
    if(targets.some(t=>t.type==='page'&&/[?&](?:action=edit(?:&|$)|isNew=)/i.test(t.url??'')))throw Object.assign(Error('9335已有公众号编辑页，停止填写，保留原窗口'),{code:'BROWSER_BUSY'});
    page=await wechat.ensureBrowser(9335);
    const identity=await page.eval(`(${visibleWechatIdentity.toString()})()`,{timeout:5000});
    if(!identity?.trustedOrigin||identity.login||identity.names.length!==1||identity.names[0]!==expected)throw Object.assign(Error('公众号可见昵称与目标账号不符或未能核实，停止填写'),{code:'PAGE_CHANGED'});
    await page.dispose();page=null;
    // The installed skill has a fixed two-attempt loop. Its retry log happens
    // before the 2-second delay; raise here so it never enters attempt two.
    process.stderr.write=stopSkillRetry(originalWrite);
    result=await wechat.publish(job,{port:9335});
    result.identity={account:expected,verified:true};
    result.screenshot=result.draftListCheck?.verified&&result.draftListCheck.screenshot||result.savedScreenshot||result.screenshot;
  }catch(error){exit=util.codeToExit(error.code??'UNKNOWN');result={ok:false,platform:'wechat',submitted:false,savedAsDraft:error.savedAsDraft===true,...skillError(error)};}
  finally{process.stderr.write=originalWrite;await page?.dispose().catch(()=>{});try{result.browserCleanup=await lifecycle.cleanupBrowsers();}catch(error){result={...result,ok:false,operationCode:result?.code,operationMessage:result?.message,...skillError(error),code:'BROWSER_FAILED'};exit=6;}}
  return {result:redactSkillValue(result),exit};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [skill,jobFile]=process.argv.slice(2);runGuardedWechat({skill,jobFile}).then(({result,exit})=>{process.stdout.write(JSON.stringify(result));process.exitCode=exit;}).catch(error=>{process.stdout.write(JSON.stringify({ok:false,...skillError(error),submitted:false,savedAsDraft:false}));process.exitCode=6;});
}
