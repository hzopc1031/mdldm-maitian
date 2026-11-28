import fs from 'node:fs';
import {execFile, spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {assertFree, browserSettings} from './l1-browser.mjs';
import {reportL1Progress} from './l1-progress.mjs';

const run = promisify(execFile);

async function macWindow(pid, action) {
  if (!Number.isInteger(pid) || pid<=0) throw Error('专用 Chrome 尚未就绪');
  const command = action==='show' ? 'app.activateWithOptions(2)' : 'app.terminate';
  const script = `ObjC.import('AppKit'); const app = $.NSRunningApplication.runningApplicationWithProcessIdentifier(${pid}); if (!${command}) throw Error('专用 Chrome 窗口暂不可用');`;
  await run('/usr/bin/osascript',['-l','JavaScript','-e',script],{timeout:5000});
}

export async function openXManualLogin(config, timeoutMs) {
  const {profile, port, binary} = browserSettings(config, 'x');
  await assertFree(port);
  fs.mkdirSync(profile,{recursive:true});
  const child=spawn(binary,[
    '--user-data-dir='+profile,'--new-window','--no-first-run','--no-default-browser-check','https://x.com/home',
  ],{stdio:'ignore'});
  await new Promise((resolve,reject)=>{
    let stopError, closeTimer, windowBusy=false, confirmationRequested=false, finished=false;
    const startedAt=Date.now();
    const waitTime=()=>Math.max(1,timeoutMs-(Date.now()-startedAt));
    const showWaiting=()=>{if(!finished)reportL1Progress('waiting_manual_login',waitTime());};
    const stop=error=>{
      if(stopError)return;
      stopError=error;
      void macWindow(child.pid,'close').catch(()=>{});
      closeTimer=setTimeout(()=>child.kill('SIGTERM'),2000).unref();
    };
    const onSignal=()=>stop(Error('专用 X 登录已取消'));
    const onMessage=async message=>{
      if(message?.type==='l1:cancel-login'){
        reportL1Progress('cancelling');onSignal();return;
      }
      if(stopError||windowBusy||confirmationRequested||!['l1:show-window','l1:confirm-login'].includes(message?.type))return;
      windowBusy=true;
      try {
        if(message.type==='l1:confirm-login'){
          confirmationRequested=true;
          reportL1Progress('manual_login_finishing');
          await macWindow(child.pid,'close');
        }else{
          await macWindow(child.pid,'show');
          showWaiting();
        }
      }catch {
        confirmationRequested=false;
        showWaiting();
      }finally{windowBusy=false;}
    };
    const timer=setTimeout(()=>stop(Error('等待手动 X 登录超时，请重新打开专用窗口登录')),timeoutMs);
    const finish=error=>{
      if(finished)return;
      finished=true;
      clearTimeout(timer);
      clearTimeout(closeTimer);
      process.off('message',onMessage);
      process.off('SIGINT',onSignal);
      process.off('SIGTERM',onSignal);
      if(error)reject(error);else resolve();
    };
    process.on('message',onMessage);
    process.once('SIGINT',onSignal);
    process.once('SIGTERM',onSignal);
    child.once('spawn',showWaiting);
    child.once('error',error=>finish(Error('专用 Chrome 启动失败：'+error.message)));
    child.once('exit',(code,signal)=>finish(stopError||(code===0?null:Error('手动登录窗口异常退出：'+(signal||code)))));
  });
}
