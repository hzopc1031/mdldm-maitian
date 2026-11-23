// Runs only in the extension's isolated world on the local 麦田 page.
if(location.origin==='http://127.0.0.1:8787'){
  const channel='maitian.video.prefill.v1';
  window.addEventListener('message',async event=>{
    const message=event.data;
    if(event.source!==window||event.origin!==location.origin||message?.channel!==channel||message.direction!=='request'||
      typeof message.id!=='string'||!['start','status'].includes(message.action))return;
    let result;
    try{result=await chrome.runtime.sendMessage({type:'workbench:prefill',action:message.action,payload:message.payload});}
    catch(error){result={ok:false,error:error.message};}
    window.postMessage({channel,direction:'response',id:message.id,result},location.origin);
  });
}
