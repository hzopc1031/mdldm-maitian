import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import { once } from 'node:events';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'maitian-intake-'));
const socket = net.createServer().listen(0, '127.0.0.1');
await once(socket, 'listening');
const port = socket.address().port;
await new Promise(resolve => socket.close(resolve));
const base = `http://127.0.0.1:${port}`;
const config = path.join(home, 'config.json');
const skills = path.join(home,'mock-skills');
const mockScript = path.join(skills,'wechat-publish','scripts','wechat.mjs');
fs.mkdirSync(path.dirname(mockScript),{recursive:true});
fs.writeFileSync(mockScript,`import fs from 'node:fs';
  const args=process.argv.slice(2);
  fs.appendFileSync(${JSON.stringify(path.join(home,'mock-calls.jsonl'))},JSON.stringify(args)+'\\n');
  if(args[0]==='check') console.log(JSON.stringify({ok:true,offline:true}));
  else console.log(JSON.stringify({ok:true,submitted:false,savedAsDraft:true,draftVerified:true}));`);
const xhsScript=path.join(skills,'xhs-publish','scripts','xhs.mjs');
fs.mkdirSync(path.dirname(xhsScript),{recursive:true});
fs.writeFileSync(xhsScript,`// mock only opts['keep-browser']
  import fs from 'node:fs';const args=process.argv.slice(2);
  const job=JSON.parse(fs.readFileSync(args[args.indexOf('--job')+1],'utf8'));
  if(args[0]==='preflight')console.log(JSON.stringify({ok:true,offlineOnly:true}));
  else if(args.includes('--submit')&&job.submit===true)console.log(JSON.stringify({ok:true,platform:'xiaohongshu',account:'ai',submitted:true,alreadyPublished:false,dryRun:false,via:'toast'}));
  else throw Error('unexpected mock xhs action');`);
fs.writeFileSync(config, JSON.stringify({xHandle:'FixtureX',web:{port,requireLocalToken:false},publishPrep:{browserExecution:true},l1:{wechat:{browserExecution:false}}}));
process.env.MAITIAN_LOCAL_SKILLS=skills;
Object.assign(process.env, {MAITIAN_HOME:home, MAITIAN_DB:path.join(home, 'hub.db'), MAITIAN_CONFIG:config});
const { submitProjectDraft, readProjectDraft, continueProjectDraft } = await import('../src/prep-intake.mjs');
const {callerPrepAgent}=await import('../src/prep-agent.mjs');
const actor={runtime:'codex',name:'Codex',sessionId:'fixture-codex-session',basis:'environment'};
const reviewer={runtime:'dsh',name:'DSH审稿助手',sessionId:'fixture-dsh-session',basis:'declared'};
const source = {project:'AI 精选项目', column:'每日 AI 精选', runId:'2026-11-21:0830',agent:actor};
assert.deepEqual(callerPrepAgent({CODEX_THREAD_ID:actor.sessionId}),actor);
assert.throws(()=>callerPrepAgent({}),/未识别AI调用环境/);
assert.throws(()=>callerPrepAgent({CODEX_THREAD_ID:'one',CODEX_SESSION_ID:'two'}),/冲突/);
assert.deepEqual(callerPrepAgent({},reviewer),reviewer);
const input = {platform:'x', title:'试点稿', content:'验证栏目和分类同一条记录', source};

const inbox = path.join(home, 'data', 'publish-prep', 'inbox');
const queued = await submitProjectDraft({home, base, input});
assert.equal(queued.state, 'queued');
assert.deepEqual(fs.readdirSync(inbox), [`${queued.id}.json`]);
const duplicate = await submitProjectDraft({home, base, input});
assert.equal(duplicate.state, 'queued');
const malformed = '10000000-0000-0000-0000-000000000000.json';
fs.writeFileSync(path.join(inbox, malformed), '{');

await import('../src/l1-store.mjs');
const { startWeb } = await import('../src/web.mjs');
const { db, LOCKED, STATE_CN } = await import('../src/db.mjs');
for(const state of ['submitted','already_exists','unknown','draft_saved']) {assert.ok(LOCKED.includes(state));assert.ok(STATE_CN[state]);}
const server = startWeb();
try {
  await once(server, 'listening');
  const records = async () => (await (await fetch(`${base}/api/prep`)).json()).records;
  const [record] = await records();
  assert.equal((await records()).length, 1, 'startup drains both submissions into one row');
  assert.deepEqual(record.source, source);
  assert.equal(record.state, 'prepared');
  assert.deepEqual(fs.readdirSync(inbox), ['rejected']);
  assert.ok(fs.existsSync(path.join(inbox, 'rejected', malformed)));
  const accepted = await submitProjectDraft({home, base, input});
  assert.equal(accepted.state,'accepted');
  assert.equal(accepted.id,record.id);
  assert.equal(accepted.draftState,'prepared');
  assert.deepEqual(accepted.source,source);
  assert.equal(accepted.reviewUrl,`${base}/p#/prepare?record=${record.id}`);
  assert.deepEqual(await readProjectDraft({id:record.id,base}),accepted);
  const wechat = await submitProjectDraft({home, base, input:{...input, platform:'wechat'}});
  assert.notEqual(wechat.id, record.id, 'same run can prepare distinct platform editions');
  await assert.rejects(submitProjectDraft({home, base, input:{...input, content:'另一份稿'}}), /同一运行编号/);
  assert.equal((await submitProjectDraft({home,base,input:{...input,source:{...source,category:'兼容旧分类'}}})).id,record.id,'legacy category does not split a column or alter provenance');
  await assert.rejects(submitProjectDraft({home,base,input:{...input,source:{...source,agent:{...actor,sessionId:'another-ai-session'}}}}),/不同AI来源/);
  await assert.rejects(submitProjectDraft({home, base, input:{...input, submit:true}}), /不支持/);
  const other = await submitProjectDraft({home, base, input:{...input, source:{...source, column:'热点扫描'}}});
  assert.notEqual(other.id, record.id, 'same content from different columns keeps its provenance');
  assert.equal((await records()).length,3);
  const publication = {url:'https://x.com/FixtureX/status/12345', publishedAt:'2020-01-01T10:00:00Z', verifiedAt:'2020-01-01T10:01:00Z'};
  const published = await submitProjectDraft({home, base, input:{...input, publication}});
  assert.equal(published.id,record.id);
  assert.equal(published.draftState,'published');
  assert.deepEqual(await submitProjectDraft({home, base, input:{...input, publication}}), published);
  assert.equal((await records()).find(r=>r.id===record.id).url, publication.url);
  assert.deepEqual((await records()).find(r=>r.id===record.id).source, source);
  await assert.rejects(submitProjectDraft({home, base, input:{...input, source:{...source,runId:'other-run'}, publication}}), /原帖已关联/);
  await assert.rejects(submitProjectDraft({home, base, input:{...input, publication:{...publication,url:'https://x.com/Wrong/status/1'}}}), /账号不符/);
  await assert.rejects(submitProjectDraft({home, base, input:{...input, publication:{...publication,url:publication.url+'?secret=bad'}}}), /公开原帖链接/);
  assert.equal((await records()).length,3);
  await assert.rejects(continueProjectDraft({id:record.id,action:'prepare',base}),/X 在此仅交稿/);
  await assert.rejects(continueProjectDraft({id:wechat.id,action:'submit',base}),/仅支持/);
  await assert.rejects(continueProjectDraft({id:wechat.id,action:'prepare',base}),/填写前须检查通过/);
  await assert.rejects(readProjectDraft({id:'../../config.json',base}),/记录 ID/);
  await assert.rejects(readProjectDraft({id:record.id,base:'https://example.com'}),/本机地址/);
  assert.equal((await fetch(`${base}/api/prep/record?id=not-found`)).status,404);
  assert.equal((await fetch(`${base}/api/prep/record?id=${record.id}`,{headers:{origin:'https://example.com'}})).status,403);
  const settled = async (id,state) => {
    for(let i=0;i<100;i++) {
      const result=await readProjectDraft({id,base});
      if(result.draftState!=='running') { assert.equal(result.draftState,state,JSON.stringify(result)); return result; }
      await new Promise(resolve=>setTimeout(resolve,20));
    }
    throw Error('Mock operation did not settle');
  };
  await continueProjectDraft({id:wechat.id,action:'check',base,actor:reviewer});
  assert.deepEqual((await settled(wechat.id,'checked')).source,source);
  await continueProjectDraft({id:wechat.id,action:'prepare',base,actor});
  const saved=await settled(wechat.id,'draft_saved');
  assert.equal(saved.evidence.savedAsDraft,true);
  assert.equal(saved.evidence.submitted,false);
  assert.deepEqual(saved.operations.map(op=>op.actor),[reviewer,actor]);
  assert.deepEqual(saved.operations.map(op=>op.state),['checked','draft_saved']);
  assert.deepEqual(saved.source.agent,actor,'original submitter retained separately from subsequent operators');
  await assert.rejects(continueProjectDraft({id:wechat.id,action:'prepare',base}),/不重跑/);
  const calls=fs.readFileSync(path.join(home,'mock-calls.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(calls.map(args=>args[0]),['check','post']);
  assert.ok(calls.every(args=>!args.includes('--submit')));
  // A started request with an unknown response is never queued or retried.
  let posts=0;
  await assert.rejects(continueProjectDraft({id:wechat.id,action:'prepare',base,request:async(url,opts)=>{
    if(opts.method==='POST') { posts++; throw new DOMException('mock timeout','TimeoutError'); }
    return {ok:true,status:200,json:async()=>({ok:true,record:{...record,id:wechat.id,platform:'wechat',state:'checked'}})};
  }}),/--status 查询原记录/);
  assert.equal(posts,1);
  assert.deepEqual(fs.readdirSync(inbox),['rejected']);
  // Exact record lookup still works after it drops out of the most recent 30.
  for(let i=0;i<32;i++) await submitProjectDraft({home,base,input:{...input,source:{...source,runId:'older-test-'+i}}});
  assert.equal((await records()).some(r=>r.id===record.id),false);
  assert.equal((await readProjectDraft({id:record.id,base})).draftState,'published');
  const cli=await promisify(execFile)(process.execPath,['scripts/l1-submit-prep.mjs','--status',wechat.id],
    {cwd:new URL('../',import.meta.url),env:{...process.env,MAITIAN_PREP_BASE:base}});
  assert.deepEqual(JSON.parse(cli.stdout),saved);
  const draftFile=path.join(home,'real-shape-draft.json');
  fs.writeFileSync(draftFile,JSON.stringify({...input,source:{project:'隔离项目',column:'工具解读',runId:'cli-no-category'}}));
  const submitted=await promisify(execFile)(process.execPath,['scripts/l1-submit-prep.mjs',draftFile,'--agent','grok','--session','fixture-grok-session','--agent-name','Grok交稿助手'],
    {cwd:new URL('../',import.meta.url),env:{...process.env,MAITIAN_PREP_BASE:base}});
  const cliRecord=JSON.parse(submitted.stdout);
  assert.equal(cliRecord.source.category,undefined);
  assert.deepEqual(cliRecord.source.agent,{runtime:'grok',name:'Grok交稿助手',sessionId:'fixture-grok-session',basis:'declared'});
  assert.equal((await (await fetch(base+'/api/prep/contract')).json()).agentAttribution,'caller_reported');
  assert.deepEqual((await (await fetch(base+'/api/prep/contract')).json()).finalPublishPlatforms,['xhs']);
  const card=path.join(home,'card.png');fs.writeFileSync(card,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6WQAAAABJRU5ErkJggg==','base64'));
  const xhs=await submitProjectDraft({home,base,input:{platform:'xhs',title:'隔离发布协议验证',content:'mock protocol only',images:[card],source:{...source,runId:'publish-cli'}}});
  await continueProjectDraft({id:xhs.id,action:'check',actor,base});
  await settled(xhs.id,'checked');
  await assert.rejects(continueProjectDraft({id:xhs.id,action:'publish',actor,base}),/授权引用/);
  const forbiddenPublish=await fetch(base+'/api/prep',{method:'POST',headers:{origin:base,'content-type':'application/json'},body:JSON.stringify({type:'publish',id:xhs.id,actor})});
  assert.equal(forbiddenPublish.status,400);
  const pubCli=await promisify(execFile)(process.execPath,['scripts/l1-submit-prep.mjs','--publish',xhs.id,'--authorization-ref','offline-explicit-reference','--agent','codex','--session','fixture-publisher'],
    {cwd:new URL('../',import.meta.url),env:{...process.env,MAITIAN_PREP_BASE:base}});
  assert.equal(JSON.parse(pubCli.stdout).id,xhs.id);
  const sent=await settled(xhs.id,'submitted');assert.equal(sent.evidence.submitted,true);
  assert.equal(sent.operations.at(-1).actor.sessionId,'fixture-publisher');
  await assert.rejects(continueProjectDraft({id:xhs.id,action:'publish',actor,authorizationRef:'same',base}),/不重跑/);
  const oldReceipt=path.join(home,'legacy-receipt.json');
  fs.writeFileSync(oldReceipt,JSON.stringify({ok:true,submitted:true,status:'published',bodyMatch:true,text:'隔离回执',runKey:'fixture/run',postUrl:publication.url,publishedAt:publication.publishedAt,verifiedAt:publication.verifiedAt}));
  let legacyInput;
  const oldServer=http.createServer(async(req,res)=>{
    res.setHeader('content-type','application/json');
    if(req.url==='/api/prep/contract'){res.writeHead(404);return res.end(JSON.stringify({error:'404'}));}
    let body='';for await(const chunk of req)body+=chunk;
    legacyInput=JSON.parse(body).input;
    res.end(JSON.stringify({ok:true,record:{...record,state:'published',source:legacyInput.source}}));
  }).listen(0,'127.0.0.1');
  await once(oldServer,'listening');
  try {
    const legacy=await promisify(execFile)(process.execPath,['scripts/l1-submit-prep.mjs','--x-receipt',oldReceipt,'历史项目','原栏目','历史分类'],
      {cwd:new URL('../',import.meta.url),env:{...process.env,MAITIAN_PREP_BASE:'http://127.0.0.1:'+oldServer.address().port}});
    assert.equal(legacyInput.source.agent,undefined,'legacy running server keeps its existing receipt ingestion');
    assert.match(JSON.parse(legacy.stdout).attributionNote,/AI来源未记录/);
  } finally {await new Promise(resolve=>oldServer.close(resolve));}
  console.log('PROJECT INTAKE PASS: column-only intake, real HTTP/CLI provenance, separate submitting/reviewing/preparing actors, immutable origin, mock save receipts, old-record lookup, no repeat or timeout retry, cross-origin denial. No real platform operations.');
} finally {
  await new Promise(resolve => server.close(resolve));
  db.close();
}
