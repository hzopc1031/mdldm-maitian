import fs from 'node:fs';
import { home } from '../src/l1-config.mjs';
import { prepRequestLimit, submitProjectDraft, readProjectDraft, continueProjectDraft, projectDraftContract } from '../src/prep-intake.mjs';
import { callerPrepAgent } from '../src/prep-agent.mjs';

function readJson(file) {
  if (fs.statSync(file).size > prepRequestLimit) throw new Error('稿件文件过大');
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}

async function main() {
  const args = [], explicit = {};
  const options={'--agent':'runtime','--agent-name':'name','--session':'sessionId','--authorization-ref':'authorizationRef'};
  const raw=process.argv.slice(2);
  for(let i=0;i<raw.length;i++) {
    const key=options[raw[i]];
    if(!key) { args.push(raw[i]); continue; }
    if(explicit[key]!==undefined||!raw[i+1]||raw[i+1].startsWith('--'))throw Error('AI来源参数缺失或重复');
    explicit[key]=raw[++i];
  }
  const {authorizationRef,...agentOptions}=explicit;
  if(authorizationRef&&!raw.includes('--publish'))throw Error('--authorization-ref 仅用于本篇已获明确授权的小红书发布');
  const base = process.env.MAITIAN_PREP_BASE || 'http://127.0.0.1:8787';
  if (args.length===2 && ['--status','--check','--prepare','--publish'].includes(args[0])) {
    const [flag,id] = args;
    const result = flag==='--status' ? await readProjectDraft({id,base}) : await continueProjectDraft({id,base,action:flag.slice(2),actor:callerPrepAgent(process.env,agentOptions),authorizationRef});
    console.log(JSON.stringify(result));
    if (['check_failed','failed','unknown'].includes(result.draftState)) process.exitCode=1;
    return;
  }
  let input;
  let legacyReceipt=false;
  if ([4,5].includes(args.length) && args[0]==='--x-receipt') {
    const [,file,project,column,category] = args;
    const receipt = readJson(file);
    if (receipt?.ok!==true || receipt.submitted!==true || receipt.status!=='published' || receipt.bodyMatch!==true || typeof receipt.text!=='string' || typeof receipt.runKey!=='string') {
      throw new Error('需要已发表且核对了公开正文的回执');
    }
    input = {
      platform:'x', title:receipt.text.trim().split(/\r?\n/)[0].slice(0,80), content:receipt.text,
      source:{project,column,...(category?{category}:{}),runId:receipt.runKey.replaceAll('/', 'T')},
      publication:{url:receipt.postUrl,publishedAt:receipt.publishedAt,verifiedAt:receipt.verifiedAt},
    };
    legacyReceipt=args.length===5&&Object.keys(explicit).length===0;
  } else if (args.length===1 && !args[0].startsWith('--')) input = readJson(args[0]);
  else throw new Error('用法：node scripts/l1-submit-prep.mjs <稿件.json>；--status / --check / --prepare <记录ID>；--publish <记录ID> --authorization-ref <本篇用户发布授权引用>；或 --x-receipt <回执.json> <项目> <栏目>。可用 --agent <类型> --session <实际会话ID> --agent-name <名称>。');
  let legacyServer=false;
  {
    try {
      legacyServer=(await projectDraftContract({base})).version===1;
    } catch(error) { if(error.name!=='TimeoutError'&&error.cause?.code!=='ECONNREFUSED')throw error; }
  }
  if(legacyServer&&!legacyReceipt)throw Error('麦田运行版尚未加载栏目和AI来源接口；本次未交稿，先完成服务更新');
  if(!legacyServer)input={...input,source:{...input.source,agent:callerPrepAgent(process.env,agentOptions)}};
  const result = await submitProjectDraft({home, input, base});
  if(legacyServer)result.attributionNote='旧运行版仅接收原格式回执；AI来源未记录，新流程待服务更新';
  console.log(JSON.stringify(result));
}
main().catch(error => {
  console.error(`交稿失败：${error.message}`);
  process.exitCode = 1;
});
