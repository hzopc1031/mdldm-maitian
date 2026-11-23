// 完全离线：临时 SQLite / 素材、模拟子进程与 DOM，禁止真实浏览器 / 第三方脚本。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { runInNewContext } from 'node:vm';
import { DatabaseSync } from 'node:sqlite';
import { normalizePrep, prepCommand, acceptPrepResult, createPrepService, prepCapabilities } from '../src/publish-prep.mjs';
import { selectPublishedLink, inspectPlatform, publishedTarget, writePublishedLink,preparationTarget,writePreparationLink } from '../src/l1-inspect.mjs';
import {browserProxyArgs} from '../src/l1-browser.mjs';
import {planL1Action} from '../src/l1-web.mjs';
import {fillXEditor} from '../src/x-draft-editor.mjs';

globalThis.fetch = () => { throw new Error('offline: no network'); };
globalThis.WebSocket = class { constructor() { throw new Error('offline: no browser'); } };
const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'maitian-prep-'));
const image = path.join(folder, 'image.png'); fs.writeFileSync(image, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6WQAAAABJRU5ErkJggg==','base64'));
for (const p of ['xhs','wechat']) {
  const dir = path.join(folder,p === 'xhs' ? 'xhs-publish' : 'wechat-publish','scripts'); fs.mkdirSync(dir,{recursive:true});
  fs.writeFileSync(path.join(dir,`${p}.mjs`), "// offline fixture only: opts['keep-browser']");
}
const db = new DatabaseSync(path.join(folder,'test.db'));
db.exec('CREATE TABLE tasks (episode_id TEXT,platform TEXT,state TEXT,detail TEXT,url TEXT,updated_at TEXT)');
db.prepare('INSERT INTO tasks VALUES (?,?,?,?,?,?)').run('ep','xhs','planned','','','');
let child, lastArgs, spawnCount = 0;
const spawnChild = (binary,args,opts) => { spawnCount++; lastArgs = args; assert.equal(opts.shell,false); child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); return child; };
const opts = { db, home: folder, root:folder, env: { MAITIAN_LOCAL_SKILLS:folder }, config:{publishPrep:{browserExecution:false}}, spawnChild };
const service = createPrepService(opts);
const input = { platform:'xhs',title:'离线测试',content:'离线素材',images:[image],episodeId:'ep' };
try {
  const j = normalizePrep(input).job; assert.equal(j.submit,false); assert.equal(j.account,'ai');
  for (const bad of [{...input,submit:true},{...input,account:'house'},{...input,images:[]},{...input,platform:'youtube'},{...input,images:['C:/not-a-picture.key']},{...input,command:'anything'}]) assert.throws(() => normalizePrep(bad));
  assert.deepEqual(prepCommand('xhs','execute',{script:'s',jobFile:'j'}),['s','post','--job','j','--account','ai','--keep-browser']);
  assert.deepEqual(prepCommand('xhs','check',{script:'s',jobFile:'j'}),['s','preflight','--job','j','--kind','post','--account','ai']);
  assert.equal(prepCommand('wechat','execute',{script:'s',jobFile:'j'}).includes('--submit'),false);
  assert.throws(() => acceptPrepResult('xhs','execute',0,{ok:true,submitted:true}));
  assert.throws(() => acceptPrepResult('wechat','execute',0,{ok:true,submitted:false,savedAsDraft:false}));
  assert.throws(() => acceptPrepResult('xhs','execute',1,{ok:true,submitted:false,dryRun:true}));
  assert.equal(acceptPrepResult('wechat','execute',0,{ok:true,submitted:false,savedAsDraft:true}),'draft_saved');
  const r = service.create(input);
  assert.equal(db.prepare('SELECT state FROM tasks').get().state,'planned');
  assert.equal(service.create(input).id,r.id);
  assert.throws(() => service.start(r.id,'execute'),/本地配置停用/); assert.equal(spawnCount,0);
  assert.equal(prepCapabilities({},opts.env).xhs.browserEnabled,true);
  assert.equal(prepCapabilities({publishPrep:{xhs:{browserExecution:false}}},opts.env).xhs.browserEnabled,false);
  assert.equal(prepCapabilities({publishPrep:{browserExecution:false}},opts.env).xhs.inspectEnabled,true);
  assert.equal(prepCapabilities({l1:{xhs:{browserExecution:false}}},opts.env).xhs.inspectEnabled,false);
  service.start(r.id,'check'); assert.equal(lastArgs[1],'preflight');
  assert.throws(() => service.create({platform:'x',content:'a'}),/正在运行|在运行/);
  child.stdout.emit('data',JSON.stringify({ok:true,offlineOnly:true})); child.emit('close',0);
  assert.equal(service.get(r.id).state,'checked');
  const enabled = createPrepService({...opts,config:{publishPrep:{browserExecution:true}}});
  fs.appendFileSync(service.jobFile(r.id),' ');
  assert.throws(() => enabled.start(r.id,'execute'),/变化/);
  enabled.start(r.id,'check'); child.stdout.emit('data',JSON.stringify({ok:true,offlineOnly:true})); child.emit('close',0);
  const originalImage=fs.readFileSync(image);fs.appendFileSync(image,'changed');
  assert.throws(()=>enabled.start(r.id,'execute'),/变化/);fs.writeFileSync(image,originalImage);
  enabled.start(r.id,'execute'); assert.equal(lastArgs.includes('--submit'),false);
  child.stdout.emit('data',JSON.stringify({ok:true,submitted:false,dryRun:true})); child.emit('close',0);
  assert.equal(enabled.get(r.id).state,'awaiting_user');
  assert.equal(db.prepare('SELECT state FROM tasks').get().state,'awaiting_user');
  const beforeRepeat=spawnCount;
  assert.equal(enabled.start(r.id,'execute').state,'awaiting_user');assert.equal(spawnCount,beforeRepeat);
  const upload=enabled.uploadImage('picked.png',fs.readFileSync(image));
  assert.match(upload.sha256,/^[a-f0-9]{64}$/);assert.equal(fs.readFileSync(upload.path).equals(fs.readFileSync(image)),true);
  assert.throws(()=>enabled.uploadImage('bad.png',Buffer.from('invalid')));
  const other=enabled.create({platform:'xhs',title:'另一份',content:'不能覆盖现稿',images:[image]});
  enabled.start(other.id,'check');child.stdout.emit('data',JSON.stringify({ok:true,offlineOnly:true}));child.emit('close',0);
  assert.throws(()=>enabled.start(other.id,'execute'),/已有待手动发布/);
  assert.equal(enabled.releaseWindow(r.id).windowReleased,true);
  assert.equal(enabled.get(r.id).state,'awaiting_user');
  const w = enabled.create({platform:'wechat',title:'本地稿',content:'只模拟'});
  enabled.start(w.id,'check'); child.stdout.emit('data','not JSON token=do-not-store'); child.emit('close',0);
  assert.equal(enabled.get(w.id).state,'check_failed'); assert.equal(JSON.stringify(enabled.get(w.id)).includes('do-not-store'),false);
  enabled.start(w.id,'check'); child.stdout.emit('data',JSON.stringify({ok:true,offline:true})); child.emit('close',0);
  enabled.start(w.id,'execute'); child.stdout.emit('data',JSON.stringify({ok:true,submitted:false,savedAsDraft:false})); child.emit('close',0);
  assert.equal(enabled.get(w.id).state,'unknown'); assert.throws(() => enabled.start(w.id,'execute'));
  assert.deepEqual(enabled.get(w.id).failureEvidence, {
    exitCode:0, receiptParsed:true, resultOk:true, submitted:false, savedAsDraft:false, skillCode:null, operationCode:null,
    saveConfirmed:false,cleanupFailed:false,draftVerified:null,stage:'save_unconfirmed',
  });
  assert.equal(enabled.get(w.id).evidence,undefined);
  const cleanup = enabled.create({platform:'wechat',title:'草稿浏览器清理失败',content:'只模拟'});
  enabled.start(cleanup.id,'check'); child.stdout.emit('data',JSON.stringify({ok:true,offline:true})); child.emit('close',0);
  enabled.start(cleanup.id,'execute');
  child.stdout.emit('data',JSON.stringify({ok:false,savedAsDraft:false,code:'BROWSER_FAILED',operationCode:'PUBLISH_FAILED',message:'receipt-private-marker'}));
  child.stderr.emit('data','stderr-private-marker'); child.emit('close',6);
  const failure = enabled.get(cleanup.id);
  assert.equal(failure.state,'unknown');
  assert.deepEqual(failure.failureEvidence,{exitCode:6,receiptParsed:true,resultOk:false,submitted:null,savedAsDraft:false,skillCode:'BROWSER_FAILED',operationCode:'PUBLISH_FAILED',saveConfirmed:false,cleanupFailed:true,draftVerified:null,stage:'operation_and_cleanup_failed'});
  assert.doesNotMatch(JSON.stringify(failure),/private-marker/);
  const saved = enabled.create({platform:'wechat',title:'保存已成功但收尾失败',content:'只模拟'});
  enabled.start(saved.id,'check');child.stdout.emit('data',JSON.stringify({ok:true,offline:true}));child.emit('close',0);
  enabled.start(saved.id,'execute');
  child.stdout.emit('data',JSON.stringify({ok:false,submitted:false,savedAsDraft:true,draftVerified:true,code:'BROWSER_FAILED',message:'private-marker'}));child.emit('close',6);
  const savedFailure=enabled.get(saved.id);
  assert.equal(savedFailure.state,'unknown');assert.equal(savedFailure.failureEvidence.saveConfirmed,true);
  assert.equal(savedFailure.failureEvidence.stage,'saved_but_incomplete');assert.equal(savedFailure.evidence.savedAsDraft,true);
  assert.match(savedFailure.error,/显式草稿保存证明/);assert.doesNotMatch(JSON.stringify(savedFailure),/private-marker/);
  const savedSpawnCount=spawnCount;
  assert.throws(()=>enabled.start(saved.id,'execute'),/禁止直接重跑/);assert.equal(spawnCount,savedSpawnCount);
  const malformed = enabled.create({platform:'wechat',title:'草稿回执无法解析',content:'只模拟'});
  enabled.start(malformed.id,'check'); child.stdout.emit('data',JSON.stringify({ok:true,offline:true})); child.emit('close',0);
  enabled.start(malformed.id,'execute'); child.stdout.emit('data','malformed private-marker'); child.emit('close',0);
  assert.equal(enabled.get(malformed.id).state,'unknown');
  assert.equal(enabled.get(malformed.id).failureEvidence.receiptParsed,false);
  assert.doesNotMatch(JSON.stringify(enabled.get(malformed.id)),/private-marker/);
  assert.throws(()=>enabled.releaseWindow(w.id));
  const x = enabled.create({platform:'x',content:'文字草稿',test:true});
  assert.match(JSON.parse(fs.readFileSync(enabled.jobFile(x.id))).content,/测试稿/);
  assert.throws(() => enabled.start(x.id,'execute'),/未启用/);
  const imageBytes=fs.readFileSync(image), xp=enabled.create({platform:'x',content:'完整正文\n第二段',images:[image]});
  fs.writeFileSync(image,'changed after creation');
  const zip=enabled.bundle(xp.id);
  assert.equal(zip.readUInt32LE(),0x04034b50); assert.ok(zip.includes(imageBytes));
  assert.ok(zip.includes(Buffer.from('完整正文\n第二段'))); assert.equal(zip.includes(Buffer.from('changed after creation')),false);
  assert.equal(zip.includes(Buffer.from(folder)),false); // Portable manifest must not expose local paths.
  assert.throws(()=>enabled.bundle(w.id),/仅 X/);
  assert.throws(()=>normalizePrep({platform:'x',content:'x',images:[image]}),/文件头/);
  fs.writeFileSync(image,imageBytes);
  const profile = path.join(folder,'agent-publish','x','chrome-profile');
  const configX = { xHandle:'Example', publishPrep:{x:{browserExecution:true,browserProfile:profile}} };
  const xCalls = [];
  function fakeBrowser({ oldCompose = false, restoredDraft = false, wrongAccount = false, inlineEditorBehindDialog = false } = {}) {
    const old = { type:'page', targetId:'protected', url:oldCompose ? 'https://x.com/compose/post' : 'https://x.com/home' };
    const editor = { type:'page', targetId:'new-editor', url:'https://x.com/compose/post' };
    let opened = false, typed = false, attached = false;
    const clip = { x:0, y:0, width:400, height:300, scale:1 };
    const visible = { getClientRects: () => [clip], getBoundingClientRect: () => ({ ...clip, right:400, bottom:300 }) };
    const fileInput = { files:[] };
    const body = {};
    const inlineEditor = { ...visible, isContentEditable:true, closest:() => null, innerText:'' };
    const document = { body, querySelectorAll: () => [editorNode, inlineEditor] };
    const textCounter = { ...visible, closest:() => null,
      getAttribute(name) { return ({role:'progressbar','aria-valuemax':'100','aria-valuenow':typed ? '8.1' : '0'})[name] ?? null; },
      parentElement:{ querySelector:selector => selector === '[data-testid="tweetButton"]' ? visible : null },
    };
    const toolbarCounter = { ...visible, closest:selector => selector.includes('toolBar') ? visible : null, querySelectorAll:() => [{}, {}, {}],
      getAttribute(name) { return ({role:'progressbar','aria-valuemin':'0','aria-valuemax':'100','aria-valuenow':'30'})[name] ?? null; },
    };
    const composer = { ...visible, parentElement:body, querySelectorAll(selector) {
      if (selector.startsWith('input')) return [fileInput];
      if (selector.includes('progressbar')) return typed ? [textCounter, toolbarCounter] : [textCounter];
      if (attached && selector.includes('button[aria-label="Remove media"]')) return [visible];
      if (attached && selector.includes('attachments')) return [{ ...visible, complete:true, naturalWidth:1 }];
      return [];
    } };
    const editorNode = { ...visible, isContentEditable:true, parentElement:composer, closest:() => composer,
      get innerText() { return typed ? '完整正文\n第二段' : ''; },
      focus() { document.activeElement = editorNode; },
    };
    return {
      pid:1234,
      close:() => xCalls.push('close connection'),
      async send(method, params, session) {
        xCalls.push(method);
        if (method === 'SystemInfo.getProcessInfo') return { processInfo:[{type:'browser',id:1234}] };
        if (method === 'Target.getTargets') return {targetInfos:opened ? [old,editor] : [old]};
        if (method === 'Target.createTarget') {
          assert.deepEqual(params,{url:editor.url,background:false}); opened = true; return {targetId:editor.targetId};
        }
        if (method === 'Target.attachToTarget') {
          assert.equal(params.targetId,editor.targetId); return {sessionId:'new-editor-session'};
        }
        assert.equal(session,'new-editor-session');
        if (method === 'Runtime.evaluate') {
          if (params.expression.includes('function visibleXIdentity(')) return {result:{value:{url:editor.url,handle:wrongAccount?'@Wrong':'@Example'}}};
          if (inlineEditorBehindDialog) {
            const value = runInNewContext(params.expression, { document, location:{href:editor.url}, getComputedStyle:() => ({visibility:'visible'}), scrollX:0, scrollY:0, innerWidth:400, innerHeight:300 });
            return {result:params.returnByValue ? {value} : {objectId:value === fileInput ? 'file-input' : undefined}};
          }
          if (params.expression.includes(',"focus",')) return {result:{value:true}};
          if (!params.returnByValue) { assert.ok(typed); return {result:{objectId:'file-input'}}; }
          return {result:{value:{empty:!restoredDraft&&!typed,ready:typed&&attached,imageCount:Number(attached),clip}}};
        }
        if (method === 'Input.insertText') {
          assert.equal(params.text,'完整正文\n第二段'); typed = true; return {};
        }
        if (method === 'DOM.setFileInputFiles') {
          assert.equal(params.objectId,'file-input'); assert.equal(params.files.length,1);
          assert.ok(fs.readFileSync(params.files[0]).equals(imageBytes)); attached = true; return {};
        }
        if (method === 'Page.captureScreenshot') return {data:imageBytes.toString('base64')};
        assert.fail(`Unexpected X operation: ${method}`);
      },
    };
  }
  const xEnabled = createPrepService({...opts,config:configX,runX:params=>fillXEditor(params,()=>fakeBrowser({inlineEditorBehindDialog:true}))});
  const xJob = JSON.parse(fs.readFileSync(xEnabled.jobFile(xp.id),'utf8'));
  fs.appendFileSync(xJob.images[0],'modified');
  assert.throws(() => xEnabled.start(xp.id,'execute'),/素材已变化/);
  fs.writeFileSync(xJob.images[0],imageBytes);
  assert.equal(xEnabled.start(xp.id,'execute').state,'running');
  await nextTurn();
  const xResult = xEnabled.get(xp.id);
  assert.equal(xResult.state,'awaiting_user');
  assert.equal(xResult.evidence.editorFilled,true);
  assert.equal(xResult.evidence.submitted,false);
  const xCallCount = xCalls.length;
  assert.equal(xEnabled.start(xp.id,'execute').state,'awaiting_user');
  assert.equal(xCalls.length,xCallCount);
  for (const [guard, error] of [
    [{oldCompose:true}, /已有 X 编辑页/], [{restoredDraft:true}, /已有内容/], [{wrongAccount:true}, /账号与预期不符/],
  ]) {
    const initialCalls = xCalls.length;
    await assert.rejects(fillXEditor({account:'Example',profile,job:xJob,folder},()=>fakeBrowser(guard)),error);
    const newCalls = xCalls.slice(initialCalls);
    assert.ok(!newCalls.includes('Input.insertText')&&!newCalls.includes('DOM.setFileInputFiles'));
    if (guard.oldCompose) assert.ok(!newCalls.includes('Target.createTarget'));
  }
  assert.throws(()=>normalizePrep({platform:'x',content:'x',images:Array(5).fill(image)}));
  assert.throws(()=>normalizePrep({platform:'wechat',title:'x',content:'x',caption:'x'.repeat(121)}));
  const url = 'https://www.xiaohongshu.com/explore/abc';
  assert.equal(selectPublishedLink('xhs',[{id:'abc',state:'published',url}],{postId:'abc'}),url);
  for (const cards of [[],[{id:'abc',state:'reviewing',url}],[{id:'abc',state:'published',url:null}],[{id:'abc',state:'published',url:url+'?token=not-allowed'}],[{id:'abc',state:'published',url},{id:'abc',state:'published',url}]]) assert.throws(() => selectPublishedLink('xhs',cards,{postId:'abc'}));
  assert.throws(() => selectPublishedLink('wechat',[{id:'a',state:'published',url:'https://mp.weixin.qq.com/s?mid=123'}],{postId:'a'}));
  const xCard = {id:'123',kind:'original',author:'Example',permalinkAuthor:'Example',url:'https://x.com/Example/status/123'};
  assert.equal(selectPublishedLink('x',[xCard],{postId:'123',account:'Example'}),xCard.url);
  assert.throws(() => selectPublishedLink('x',[{...xCard,kind:'repost'}],{postId:'123',account:'Example'}));
  assert.throws(() => selectPublishedLink('x',[{...xCard,author:'SomeoneElse'}],{postId:'123',account:'Example'}));
  assert.deepEqual(publishedTarget('xhs',{schedule:'2026-11-17'},{platforms:{xhs:{title:'完整标题'}}}),{text:'完整标题',date:'2026-11-17'});
  assert.deepEqual(publishedTarget('x',{}, {postId:'123'}),{postId:'123'});
  assert.deepEqual(publishedTarget('xhs',{}, {postId:'legacy-note'}),{postId:'legacy-note'});
  assert.throws(()=>publishedTarget('xhs',{}, {postId:'other-platform-id',platforms:{x:{id:'other-platform-id'}}}));
  assert.throws(()=>publishedTarget('xhs',{}, {platforms:{xhs:{title:'不猜日期'}}}));
  assert.equal(selectPublishedLink('xhs',[{id:'abc',state:'published',url,date:'2026-11-17',text:'完整标题'}],{text:'完整标题',date:'2026-11-17'}),url);
  assert.throws(()=>selectPublishedLink('xhs',[{id:'abc',state:'published',url,date:'2026-11-17',text:'完整标题片段'}],{text:'完整标题',date:'2026-11-17'}));
  db.exec('CREATE TABLE logs (ts TEXT,episode_id TEXT,platform TEXT,action TEXT,result TEXT)');
  db.exec('CREATE TABLE snapshots (episode_id TEXT PRIMARY KEY,project TEXT)');
  db.prepare('INSERT INTO snapshots VALUES (?,?)').run('ep',JSON.stringify({noteId:'abc'}));
  const proof={ok:true,platform:'xhs',postId:'abc',account:'TwoPeanuts',url,checkedAt:new Date().toISOString()};
  writePublishedLink(db,'ep','xhs',proof);
  assert.equal(db.prepare('SELECT url FROM tasks WHERE episode_id=?').get('ep').url,url);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM logs').get().n,1);
  assert.throws(()=>writePublishedLink(db,'ep','xhs',{...proof,postId:'other'}));
  db.prepare('UPDATE snapshots SET project=? WHERE episode_id=?').run(JSON.stringify({noteId:'changed-after-inspection'}),'ep');
  assert.throws(()=>writePublishedLink(db,'ep','xhs',proof),/稳定ID已变化/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM logs').get().n,1);
  db.prepare('UPDATE snapshots SET project=? WHERE episode_id=?').run(JSON.stringify({noteId:'abc'}),'ep');
  const prepRecord=enabled.create({platform:'x',content:'完整正文'});
  assert.deepEqual(preparationTarget(prepRecord,{content:'完整正文',submit:false},'2026-11-17'),{text:'完整正文',date:'2026-11-17'});
  assert.throws(()=>preparationTarget(prepRecord,{content:'完整正文',submit:false},''));
  assert.deepEqual(planL1Action({type:'sync',platform:'x',preparationId:prepRecord.id,date:'2026-11-17'}),['--platform','x','--preparation',prepRecord.id,'--date','2026-11-17']);
  assert.throws(()=>planL1Action({type:'sync',platform:'x',preparationId:prepRecord.id,id:'ep',date:'2026-11-17'}));
  writePreparationLink(db,prepRecord.id,{...proof,platform:'x',account:'Example',url:xCard.url});
  assert.equal(enabled.get(prepRecord.id).url,xCard.url);assert.equal(enabled.get(prepRecord.id).state,'published');
  assert.throws(()=>enabled.start(prepRecord.id,'execute'));
  assert.deepEqual(browserProxyArgs({},'x',{HTTPS_PROXY:'http://127.0.0.1:12334'}),['--proxy-server=http://127.0.0.1:12334']);
  assert.deepEqual(browserProxyArgs({},'xhs',{HTTPS_PROXY:'http://127.0.0.1:12334'}),[]);
  assert.throws(()=>browserProxyArgs({l1:{x:{proxy:'http://user:pass@proxy.invalid'}}},'x',{}));
  assert.throws(()=>writePublishedLink(db,'missing','xhs',proof));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM logs').get().n,2);
  let reads = [], nav = [];
  const withBrowser = async (cfg,fn,platform) => { assert.equal(platform,'xhs'); return fn({goto:async u => nav.push(u),evaluate:async fn => {
    reads.push(fn.name);
    if (fn.name === 'visibleIdentity') return {nickname:'TwoPeanuts',login:false};
    if (fn.name === 'visibleNoteCards') return [{id:'abc',state:'published',url}];
    throw new Error('unexpected DOM');
  }}); };
  const cfg = {l1:{xhs:{account:'TwoPeanuts'}}};
  const identity = await inspectPlatform(cfg,'xhs',null,{withBrowser,wait:async()=>{}});
  assert.equal(identity.account,'TwoPeanuts'); assert.deepEqual(reads,['visibleIdentity']);
  const found = await inspectPlatform(cfg,'xhs',{postId:'abc'},{withBrowser,wait:async()=>{}});
  assert.equal(found.url,url); assert.ok(nav.includes('https://creator.xiaohongshu.com/new/note-manager'));
  await assert.rejects(inspectPlatform(cfg,'xhs',null,{withBrowser:async(c,fn)=>fn({goto:async()=>{},evaluate:async()=>({nickname:'wrong'})})}));
  const restart = enabled.create({platform:'wechat',title:'restart fixture',content:'mock only'});
  enabled.start(restart.id,'check');
  const restarted = createPrepService(opts);
  assert.equal(restarted.get(restart.id).state,'unknown');
  assert.throws(() => restarted.start(restart.id,'execute'),/禁止直接重跑/);
  console.log('PUBLISH PREP OFFLINE PASS: validation, fixed commands, browser gate, receipt proof, repeat guard, restart/unknown, visible identity/link selection. No real skills/browser/platform executed.');
} finally { db.close(); }
