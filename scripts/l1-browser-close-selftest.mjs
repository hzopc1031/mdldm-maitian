// First-party integration test: empty temporary profile; closes only its own CDP target.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const folder=fs.mkdtempSync(path.join(os.tmpdir(),'l1-browser-close-'));
process.env.MAITIAN_HOME=folder;
const {withL1Browser,pause}=await import('../src/l1-browser.mjs');
let closedAt;
await assert.rejects(withL1Browser({},async page=>{
  assert.equal(await page.evaluate(()=>1),1);
  closedAt=Date.now();
  await page.evaluate(()=>{window.close();return true;}).catch(error=>{throw error;});
  await pause(50,100);
  await page.evaluate(()=>1);
},'x'),/专用窗口已关闭/);
assert.ok(Date.now()-closedAt<5000,'Closed target must not wait for a 15-second CDP timeout');
console.log(JSON.stringify({ok:true,elapsedAfterCloseMs:Date.now()-closedAt,scope:'only a fresh temporary about:blank target; no platform/profile/data access'}));
