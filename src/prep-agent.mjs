// Attribution is caller provenance, never authentication or proof of publication.
const runtimes = {codex:'Codex',dsh:'DSH',grok:'Grok',other:'其他 AI'};
export function normalizePrepAgent(value) {
  if (!value || typeof value!=='object' || Array.isArray(value) || Object.keys(value).some(k=>!['runtime','name','sessionId','basis'].includes(k)) || !Object.hasOwn(runtimes,value.runtime)) throw Error('AI来源需要有效 runtime、名称和会话编号');
  const name=value.name??runtimes[value.runtime];
  if(typeof name!=='string'||!name.trim()||name.length>80||/[\x00-\x1f\x7f]/.test(name))throw Error('AI名称格式不对');
  if(typeof value.sessionId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_.:@-]{0,159}$/.test(value.sessionId))throw Error('AI会话编号格式不对');
  const basis=value.basis??'declared';
  if(!['environment','declared'].includes(basis))throw Error('AI来源依据只接受运行环境上报或调用方声明');
  return {runtime:value.runtime,name:name.trim(),sessionId:value.sessionId,basis};
}
export function callerPrepAgent(env=process.env, explicit={}) {
  if(explicit.runtime) return normalizePrepAgent({...explicit,basis:'declared'});
  if(Object.keys(explicit).length)throw Error('显式AI来源须同时提供 --agent 和 --session');
  const thread=env.CODEX_THREAD_ID,session=env.CODEX_SESSION_ID;
  if(thread&&session&&thread!==session)throw Error('Codex环境会话编号冲突，未提交');
  if(thread||session)return normalizePrepAgent({runtime:'codex',sessionId:thread||session,basis:'environment'});
  throw Error('未识别AI调用环境；请提供 --agent codex|dsh|grok|other --session <实际会话ID>，可另加 --agent-name <名称>');
}
