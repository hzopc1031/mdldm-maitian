// Explicit publication is separate from preparation; no browser is accessed here.
export function publicationApproval(input, checkedDigest) {
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['reference','checkedDigest'].includes(k))||
    typeof input.reference!=='string'||!input.reference.trim()||input.reference.length>240||/[\x00-\x1f\x7f]/.test(input.reference)||
    !/^[a-f\d]{64}$/.test(input.checkedDigest)||input.checkedDigest!==checkedDigest) {
    throw Error('发布须提供本篇明确授权引用，并绑定当前检查通过的稿件摘要');
  }
  return {reference:input.reference.trim(),checkedDigest};
}

export function xhsPublicationState(code, result) {
  if(code!==0||result?.ok!==true||result.platform!=='xiaohongshu'||result.account!=='ai'||result.dryRun!==false)throw Error('小红书发布回执未完整成功；先核对平台，不重发');
  if(result.submitted===false&&result.alreadyPublished===true&&result.verification?.found===true)return 'already_exists';
  if(result.submitted===true&&result.alreadyPublished===false&&['toast','url','note-manager'].includes(result.via))return 'submitted';
  throw Error('缺少小红书实际提交或已有作品的明确回执；不重发');
}

export function publicXhsUrl(value) {
  try {
    const url=new URL(value);
    if(url.protocol==='https:'&&!url.username&&!url.password&&!url.search&&!url.hash&&['www.xiaohongshu.com','xiaohongshu.com'].includes(url.hostname)&&/^\/(?:explore|discovery\/item)\/[a-f\d]{24}\/?$/i.test(url.pathname))return url.href;
  }catch{}
  return null;
}
