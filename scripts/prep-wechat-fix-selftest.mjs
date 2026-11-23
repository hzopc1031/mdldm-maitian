// 离线隔离验证：不连接浏览器、不执行实际skill、不访问正式数据库。
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {EventEmitter} from 'node:events';import {DatabaseSync} from 'node:sqlite';
import {runInNewContext} from 'node:vm';
import {wechatEditionJob} from '../src/prep-wechat.mjs';
import {createPrepService,normalizePrep,prepCommand,acceptPrepResult} from '../src/publish-prep.mjs';
import {redactSkillText,skillError,stderrTail} from '../src/prep-skill-errors.mjs';
import {runGuardedWechat,stopSkillRetry} from '../src/prep-wechat-run.mjs';
const home=fs.mkdtempSync(path.join(os.tmpdir(),'wechat-fix-'));
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6WQAAAABJRU5ErkJggg==','base64');
const images=['a','b','c'].map(n=>{const f=path.join(home,n+'.png');fs.writeFileSync(f,png);return f;});
globalThis.fetch=async()=>({ok:true,json:async()=>[]});
globalThis.WebSocket=class{constructor(){throw Error('禁止真实浏览器');}};
const input={title:'【测试】封面排序',content:'工作台测试稿，请勿发表。\n\n第二段。',images,cover:images[1],imagePositions:[{image:images[0],afterParagraph:0},{image:images[1],afterParagraph:2},{image:images[2],afterParagraph:1}]};
try{
 for(const cover of [images[1],path.join(home,'separate.png')]){
  if(!fs.existsSync(cover))fs.writeFileSync(cover,png);
  const job=wechatEditionJob({...input,cover,images:[...images,images[1]]},path.join(home,'edition'));
  assert.equal(Object.hasOwn(job,'coverImage'),false);assert.equal(job.coverFromBody,true);
  assert.equal(job.inlineImages[0].file,cover);assert.equal(job.inlineImages.filter(im=>im.file===cover).length,1);
  const html=fs.readFileSync(job.htmlFile,'utf8');assert.equal([...html.matchAll(/WECHAT_INLINE_IMAGE:([\w-]+)-->/g)][0][1],job.inlineImages[0].id);
  assert.equal((html.match(new RegExp('WECHAT_INLINE_IMAGE:'+job.inlineImages[0].id+'-->','g'))??[]).length,1);
 }
 assert.equal(Object.hasOwn(normalizePrep({...input,platform:'wechat'}).job,'coverImage'),false);
 const secret='do-not-retain-SECRET';
 const sensitive=`https://example.test/?token=${secret}&amp;pass_ticket=${secret}&ticket=${secret}&key=${secret}&access_token=${secret}&cookie=${secret}\nCookie: a=${secret}\nSet-Cookie: b=${secret}\nAuthorization: Bearer ${secret}\nstandalone token=${secret} tempkey=${secret} auth=${secret}\n"token":"${secret}"`;
 assert.ok(!redactSkillText(sensitive).includes(secret));
 assert.equal(skillError(new TypeError('原始异常 token='+secret)).code,'UNKNOWN');
 assert.match(skillError(new TypeError('原始异常')).message,/原始异常/);
 assert.ok(Buffer.byteLength(stderrTail('中'.repeat(6000)))<=4096);
 assert.ok(!stderrTail('truncated-secret\n'+sensitive,true).includes(secret));
 assert.ok(!stderrTail('credential-fragment',true).includes('credential-fragment'));
 let logs='';assert.throws(()=>stopSkillRetry(t=>{logs+=t;})('第 1 次填写失败（UPLOAD_FAILED）：真实上传错误 token='+secret+'；尚未点击保存，自动重试一次'),e=>e.code==='UPLOAD_FAILED'&&e.message.includes('真实上传错误')&&!e.message.includes(secret));assert.ok(!logs.includes(secret));
 // 当前skill源码的选择算法：用合成的outerHTML与DOM值复现实体差异，不访问平台。
 const source=fs.readFileSync(path.join(os.homedir(),'.dsh/skills/wechat-publish/scripts/lib/wechat.mjs'),'utf8');
 const choose=source.slice(source.indexOf('async function chooseBodyCover('),source.indexOf('/** 保存后的自动核对'));
 const chooseBodyCover=runInNewContext('('+choose.trim()+')',{path,process,localFile:f=>f,SkillError:class extends Error{constructor(code,msg){super(msg);this.code=code;}}});
 const page={eval:async()=>[{i:0,src:'https://example.test/image?a=1&b=2',w:1280,h:545,ok:true}]};
 await assert.rejects(chooseBodyCover(page,{coverImage:images[0],inlineImages:[{id:'a',file:images[0]}]},new Map([['a','<img src="https://example.test/image?a=1&amp;b=2">']])),e=>e.code==='USAGE');
 assert.equal((await chooseBodyCover(page,{coverFromBody:true},new Map())).i,0);
 const skills=path.join(home,'skills'),script=path.join(skills,'wechat-publish/scripts/wechat.mjs');fs.mkdirSync(path.dirname(script),{recursive:true});fs.writeFileSync(script,'// offline');
 const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE tasks(episode_id TEXT,platform TEXT,state TEXT,detail TEXT,updated_at TEXT)');let child;
 const service=createPrepService({db,home,root:home,config:{},env:{MAITIAN_LOCAL_SKILLS:skills},spawnChild:(bin,args)=>{assert.ok(!args.includes('--submit'));child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();return child;}});
 const record=service.create({...input,platform:'wechat'}),job=JSON.parse(fs.readFileSync(service.jobFile(record.id)));
 assert.equal(job.submit,false);assert.equal(job.coverImage,undefined);assert.equal(job.inlineImages[0].file,input.cover);
 for(const kind of ['check','execute'])assert.ok(!prepCommand('wechat',kind,{script,jobFile:'job.json'}).includes('--submit'));
 assert.throws(()=>prepCommand('wechat','publish',{script,jobFile:'job.json'}));assert.throws(()=>service.start(record.id,'publish'));
 assert.throws(()=>normalizePrep({...input,platform:'wechat',submit:true}));assert.throws(()=>acceptPrepResult('wechat','execute',0,{ok:true,submitted:true,savedAsDraft:true}));
 service.start(record.id,'check');child.stdout.emit('data',JSON.stringify({ok:true,offline:true}));child.emit('close',0);
 service.start(record.id,'execute');child.stdout.emit('data',JSON.stringify({ok:false,code:'UNKNOWN',message:'原始错误 '+sensitive,hint:'请看截图 token='+secret,screenshot:path.join(home,'error.png')}));child.stderr.emit('data',sensitive);child.emit('close',1);
 const failed=service.get(record.id);assert.equal(failed.state,'unknown');assert.equal(failed.failureEvidence.skillCode,'UNKNOWN');assert.match(failed.error,/原始错误/);assert.ok(!JSON.stringify(failed).includes(secret));assert.equal(failed.failureEvidence.screenshot,path.join(home,'error.png'));assert.throws(()=>service.start(record.id,'execute'));
 db.close();
 // 模拟skill模块，验证未知异常原文、hint/shot、清理和首次失败即停的包装器。
 const fake=path.join(home,'fake/scripts'),lib=path.join(fake,'lib');fs.mkdirSync(lib,{recursive:true});
 fs.writeFileSync(path.join(lib,'util.mjs'),`export const readJob=()=>({submit:false});export const preflight=()=>({errors:[]});export const codeToExit=()=>1;`);
 fs.writeFileSync(path.join(lib,'browser-lifecycle.mjs'),`export const installCleanupHandlers=()=>{};export const keepBrowser=()=>{};export const cleanupBrowsers=async()=>[{remaining:0}];`);
 fs.writeFileSync(path.join(lib,'wechat.mjs'),`// const maxAttempts = 2; 尚未点击保存，自动重试一次 await sleep(2000);
 export const ensureBrowser=async()=>({eval:async()=>({trustedOrigin:true,login:false,names:['TwoPeanuts的AI']}),dispose:async()=>{}});
 export const publish=async()=>{throw Object.assign(new TypeError('真实异常 token=${secret}'),{hint:'原始提示',shot:'D:/safe/error.png'});};`);
 const jobFile=path.join(home,'mock-job.json');fs.writeFileSync(jobFile,'{"submit":false}');
 const wrapped=await runGuardedWechat({skill:path.join(fake,'wechat.mjs'),jobFile});assert.equal(wrapped.result.code,'UNKNOWN');assert.equal(wrapped.result.errorName,'TypeError');assert.match(wrapped.result.message,/真实异常/);assert.equal(wrapped.result.hint,'原始提示');assert.equal(wrapped.result.screenshot,'D:/safe/error.png');assert.ok(!JSON.stringify(wrapped).includes(secret));assert.equal(wrapped.result.browserCleanup[0].remaining,0);
 console.log('公众号修复离线通过：封面首位去重、无coverImage、实体缺陷复现、原始错误透传和脱敏、4KB尾部、单次尝试、仅草稿与未知锁。');
}finally{fs.rmSync(home,{recursive:true,force:true});}
