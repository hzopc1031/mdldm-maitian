// Real, fresh about:blank browser only. No platform navigation, user profile, or production DB.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

if (process.argv.includes('--child')) {
  const { withL1Browser, pause } = await import('../src/l1-browser.mjs');
  const { reportL1Progress } = await import('../src/l1-progress.mjs');
  try {
    await withL1Browser({xHandle:'PeanutPair'},async page=>{
      await page.bringToFront();
      reportL1Progress('waiting_login',10000);
      for(;;) { await page.evaluate(()=>location.href==='about:blank'); await pause(100,150); }
    },'x');
  } catch(error) {
    console.log(error.message);process.exitCode=1;
  }
} else {
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'l1-browser-control-'));
  const child=spawn(process.execPath,[fileURLToPath(import.meta.url),'--child'],{
    cwd:home,env:{...process.env,MAITIAN_HOME:home},windowsHide:true,stdio:['ignore','pipe','pipe','ipc'],
  });
  const stages=[];let output='';
  child.stdout.on('data',buffer=>output+=buffer);child.stderr.on('data',buffer=>output+=buffer);
  child.on('message',message=>{
    if(message?.type!=='l1:progress')return;
    stages.push(message.stage);
    if(message.stage==='waiting_login')child.send({type:'l1:show-window'});
    if(message.stage==='window_shown')child.send({type:'l1:cancel-login'});
  });
  const timeout=setTimeout(()=>{if(child.connected)child.send({type:'l1:cancel-login'});},30000);
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});
  clearTimeout(timeout);
  assert.equal(code,1,output);
  assert.match(output,/已取消登录/);
  for(const stage of ['browser_ready','waiting_login','window_shown','cancelling'])assert.ok(stages.includes(stage),JSON.stringify(stages));
  console.log(JSON.stringify({ok:true,stages,childExitCode:code,scope:'fresh about:blank only; no platform, existing profile, or database'}));
}
