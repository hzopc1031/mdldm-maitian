// First-party guard around the existing, unmodified local wechat-publish library.
import fs from 'node:fs';import path from 'node:path';import {pathToFileURL,fileURLToPath} from 'node:url';
import {visibleWechatIdentity} from './l1-wechat-dom.mjs';
export function stopSkillRetry(write) {
  return function(chunk,...args){const text=String(chunk),match=/第\s*1\s*次填写失败（(PAGE_CHANGED|UPLOAD_FAILED|BROWSER_FAILED)）/.exec(text);if(match)throw Object.assign(Error('首次填写失败，按工作台规则停止，不自动重试'),{code:match[1]});return write.call(this,chunk,...args);};
}
export async function runGuardedWechat({skill,jobFile,expected='TwoPeanuts的AI'}) {
  const lib=name=>import(pathToFileURL(path.join(path.dirname(skill),'lib',name+'.mjs')).href);
  const [util,wechat,lifecycle]=await Promise.all([lib('util'),lib('wechat'),lib('browser-lifecycle')]);
  lifecycle.installCleanupHandlers();lifecycle.keepBrowser(false);
  let result,exit=0,page;const originalWrite=process.stderr.write;
  try{
    const installedSource=fs.readFileSync(path.join(path.dirname(skill),'lib','wechat.mjs'),'utf8');
    if(!installedSource.includes('export const publish=')&&!installedSource.includes('尚未点击保存，自动重试一次'))throw Object.assign(Error('本地skill重试边界变化，停止填写'),{code:'USAGE'});
    const source=JSON.parse(fs.readFileSync(jobFile,'utf8'));if(source.submit!==false)throw Object.assign(Error('只允许submit:false'),{code:'USAGE'});
    const job=util.readJob(jobFile);const pre=util.preflight('wechat',job);if(pre.errors.length)throw Object.assign(Error('本地素材检查失败'),{code:'USAGE'});
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
  }catch(error){exit=util.codeToExit(error.code??'USAGE');result={ok:false,platform:'wechat',submitted:false,savedAsDraft:error.savedAsDraft===true,code:error.code??'USAGE',message:'公众号操作停止，请按错误码核对原平台；不自动重跑',...(error.shot?{screenshot:error.shot}:{})};}
  finally{process.stderr.write=originalWrite;await page?.dispose().catch(()=>{});try{result.browserCleanup=await lifecycle.cleanupBrowsers();}catch{result={...result,ok:false,operationCode:result.code,code:'BROWSER_FAILED',message:'操作后浏览器收尾未确认，请先核对，不重复建稿'};exit=6;}}
  return {result,exit};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [skill,jobFile]=process.argv.slice(2);runGuardedWechat({skill,jobFile}).then(({result,exit})=>{process.stdout.write(JSON.stringify(result));process.exitCode=exit;}).catch(()=>{process.stdout.write(JSON.stringify({ok:false,code:'BROWSER_FAILED',submitted:false,savedAsDraft:false}));process.exitCode=6;});
}
