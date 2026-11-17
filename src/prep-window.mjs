// Only the existing ai skill window. Never launch/navigate/close a browser.
import { promisify } from 'node:util';
import path from 'node:path';
function browserCommand(url,method,params={}) {
  if(!/^ws:\/\/127\.0\.0\.1:9333\/devtools\/(browser|page)\/[A-Za-z0-9-]+$/.test(url))throw new Error('专用窗口调试地址未核实');
  return new Promise((resolve,reject)=>{
    const ws=new WebSocket(url),timer=setTimeout(()=>{ws.close();reject(new Error('切页回执超时'));},3000);
    const finish=(error,result)=>{clearTimeout(timer);ws.close();error?reject(new Error('浏览器未确认切页')):resolve(result);};
    ws.addEventListener('open',()=>ws.send(JSON.stringify({id:1,method,params})));
    ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id===1)finish(m.error,m.result);});
    ws.addEventListener('error',()=>finish(true));
  });
}
export async function xhsWindow({ activate = false, env = process.env } = {}) {
  const { execFile } = await import('node:child_process');
  const exec = promisify(execFile);
  if (process.platform !== 'win32') throw new Error('当前仅支持 Windows 专用窗口切换');
  const expected = path.resolve(env.PUBLISH_SKILL_DATA || path.join(env.LOCALAPPDATA, 'agent-publish'), 'xhs', 'chrome-profile');
  const ps = "$c=Get-NetTCPConnection -State Listen -LocalPort 9333 -ErrorAction Stop; $ids=@($c.OwningProcess|Sort-Object -Unique); if($ids.Count -ne 1){throw 'port'}; $p=Get-CimInstance Win32_Process -Filter ('ProcessId='+$ids[0]); $m=[regex]::Match($p.CommandLine,'--user-data-dir=(?:\"([^\"]+)\"|([^ ]+))'); [pscustomobject]@{pid=$p.ProcessId;name=$p.Name;profile=($m.Groups[1].Value+$m.Groups[2].Value)}|ConvertTo-Json -Compress";
  const { stdout } = await exec('powershell.exe', ['-NoProfile', '-EncodedCommand', Buffer.from(ps, 'utf16le').toString('base64')], { windowsHide: true });
  const processInfo = JSON.parse(stdout);
  if (!/^(chrome|msedge)\.exe$/i.test(processInfo.name) || path.resolve(processInfo.profile).toLowerCase() !== expected.toLowerCase()) throw new Error('9333 专用 profile 未核实，未切换');
  const targets = await (await fetch('http://127.0.0.1:9333/json/list', { signal: AbortSignal.timeout(3000) })).json();
  const pages = targets.filter(t => { try { const u = new URL(t.url); return t.type === 'page' && u.origin === 'https://creator.xiaohongshu.com' && u.pathname === '/publish/publish'; } catch { return false; } });
  if (pages.length !== 1 || !/^[A-Za-z0-9-]+$/.test(pages[0].id)) throw new Error('专用窗口中没有唯一可核实的新建编辑页；请手工核对，不新开页面');
  const again=JSON.parse((await exec('powershell.exe',['-NoProfile','-EncodedCommand',Buffer.from(ps,'utf16le').toString('base64')],{windowsHide:true})).stdout);
  if(again.pid!==processInfo.pid || again.profile!==processInfo.profile)throw new Error('核验期间专用窗口变化，未切换');
  const version=await(await fetch('http://127.0.0.1:9333/json/version',{signal:AbortSignal.timeout(3000)})).json();
  const window=await browserCommand(version.webSocketDebuggerUrl,'Browser.getWindowForTarget',{targetId:pages[0].id});
  if(!Number.isInteger(window.windowId))throw new Error('未找到对应专用窗口');
  if (activate) {
    const response = await fetch('http://127.0.0.1:9333/json/activate/' + pages[0].id, { signal: AbortSignal.timeout(3000) });
    if (!response.ok) throw new Error('编辑页切换未确认');
    await browserCommand(version.webSocketDebuggerUrl,'Browser.setWindowBounds',{windowId:window.windowId,bounds:{windowState:'normal'}});
    await browserCommand(pages[0].webSocketDebuggerUrl,'Page.bringToFront');
  }
  return { verified: true, port: 9333, pid: processInfo.pid, targetId: pages[0].id, windowId:window.windowId, activated: activate, note: activate ? '浏览器已确认激活并置前 ai 专用编辑页；若系统未置前，可用 Alt+Tab 选择小红书创作服务平台。未导航、改写或上传，当前内容请本人核对。' : '已核实 ai 专用 profile、唯一编辑页和真实窗口 ID；当前表单内容未核对。' };
}
