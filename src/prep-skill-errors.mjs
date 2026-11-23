// 仅保留有界、脱敏的诊断；不持久化原始 DOM 或认证头。
export function redactSkillText(value) {
  return String(value ?? '')
    .replace(/\b(?:set-cookie|cookie|authorization|proxy-authorization)["']?\s*[:=]\s*[^\r\n]*/gi, '[认证头已脱敏]')
    .replace(/((?:\b|%)(?:[\w-]*(?:token|ticket|secret|password|cookie)[\w-]*|key|tempkey|auth|pass_ticket)["']?\s*(?:=|:|%3[dD])\s*)(?:"[^"]*"|'[^']*'|[^\s&<>"'，。；;]+)/gi, '$1[已脱敏]');
}
export function skillText(value, max=4096) {
  return redactSkillText(value).slice(-max);
}
export function redactSkillValue(value) {
  if(typeof value==='string')return skillText(value,16384);
  if(Array.isArray(value))return value.map(redactSkillValue);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,/^(?:cookie|set-cookie|authorization|proxy-authorization|.*token|.*ticket|key|password|secret)$/i.test(key)?'[已脱敏]':redactSkillValue(item)]));
  return value;
}
export function skillError(error) {
  return {code:skillText(error?.code || 'UNKNOWN',80), errorName:skillText(error?.name || 'Error',80),
    message:skillText(error?.message || String(error)), hint:skillText(error?.hint),
    screenshot:typeof (error?.shot ?? error?.screenshot)==='string'?skillText(error.shot ?? error.screenshot):null};
}
export function stderrTail(value, truncated=false) {
  // 截断边界可能位于凭据中间；丢弃首个不完整行，再脱敏，最后取4KB。
  let raw=String(value??'');
  if(truncated){const line=raw.indexOf('\n');raw=line<0?'[stderr超限且无完整行，已省略]':raw.slice(line+1);}
  const clean=redactSkillText(raw), bytes=Buffer.from(clean,'utf8');
  let start=Math.max(0,bytes.length-4096);
  while(start<bytes.length&&(bytes[start]&0xc0)===0x80)start++;
  return bytes.subarray(start).toString('utf8');
}
