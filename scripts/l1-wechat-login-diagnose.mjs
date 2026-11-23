// First-party diagnosis of this workbench's own WeChat collection profile.
// No storage/network bodies, complete URLs, QR contents or other browser profiles.
import fs from 'node:fs';
import path from 'node:path';
import {withL1Browser,pause} from '../src/l1-browser.mjs';
import {readConfig} from '../src/l1-config.mjs';
import {l1Account} from '../src/l1-account.mjs';
import {visibleWechatIdentity} from '../src/l1-wechat-dom.mjs';
const out=process.argv[2];
if(!out||!path.isAbsolute(out))throw new Error('Absolute evidence file required');
const config=readConfig(), results=[],start=Date.now();
const mark=(stage,value)=>{const entry={stage,elapsedMs:Date.now()-start,...value};results.push(entry);console.log(JSON.stringify(entry));fs.writeFileSync(out,JSON.stringify(results,null,2));};
const expected=l1Account(config,'wechat');
try {
  await withL1Browser(config,async page=>{
    mark('blank-evaluate',{value:await page.evaluate(()=>1)});
    if(!page.reusedSession)await page.goto('https://mp.weixin.qq.com/');mark('navigated',{reusedSession:page.reusedSession});
    mark('page-basic',await page.evaluate(()=>({origin:location.origin,title:document.title,ready:document.readyState})));
    for(let i=0;i<6;i++) {
      const identity=await page.evaluate(visibleWechatIdentity);
      const layout=await page.evaluate(name=>{
        if(location.origin!=='https://mp.weixin.qq.com') return null;
        const visible=el=>el.getClientRects().length>0&&getComputedStyle(el).visibility==='visible';
        const classes=el=>({tag:el?.tagName,classes:[...el?.classList||[]].filter(s=>/^[a-z_-]{2,70}$/i.test(s)).slice(0,6)});
        const matches=[...document.querySelectorAll('span, div, a, p, h1, h2, h3')].filter(el=>visible(el)&&el.innerText.trim()===name);
        const leaves=matches.filter(el=>!matches.some(other=>other!==el&&el.contains(other)));
        return {dashboard:location.pathname==='/cgi-bin/home',hasUserTotal:document.body?.innerText.includes('总用户数'),matches:leaves.slice(0,4).map(el=>[classes(el),classes(el.parentElement),classes(el.parentElement?.parentElement),classes(el.parentElement?.parentElement?.parentElement)])};
      },expected);
      mark('identity',{...identity,expected,layout,matched:identity.names.length===1&&identity.names[0]===expected});
      if(layout?.matches.length||identity.names.length)break;
      await pause(1600,1700);
    }
  },'wechat');
  mark('closed',{ok:true});
}catch(error){mark('error',{message:error.message});process.exitCode=1;}
