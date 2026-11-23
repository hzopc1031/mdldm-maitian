// Historical public URL validation only. No publication action.
export function publicXhsUrl(value) {
  try {
    const url=new URL(value);
    if(url.protocol==='https:'&&!url.username&&!url.password&&!url.search&&!url.hash&&['www.xiaohongshu.com','xiaohongshu.com'].includes(url.hostname)&&/^\/(?:explore|discovery\/item)\/[a-f\d]{24}\/?$/i.test(url.pathname))return url.href;
  }catch{}
  return null;
}
