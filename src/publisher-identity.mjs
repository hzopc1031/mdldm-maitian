const creatorHosts={
  bilibili:'member.bilibili.com',xhs:'creator.xiaohongshu.com',douyin:'creator.douyin.com',
  channels:'channels.weixin.qq.com',youtube:'studio.youtube.com',x:'x.com',instagram:'www.instagram.com',
};

export function matchesCreator(platform,observed,expected){
  if(typeof expected!=='string'||!expected.trim()||observed?.login)return false;
  let url;try{url=new URL(observed.url);}catch{return false;}
  if(url.protocol!=='https:'||url.hostname!==creatorHosts[platform])return false;
  if(platform==='x'){
    const handle=value=>typeof value==='string' ? value.trim().replace(/^@/,'').toLowerCase() : '';
    return !!handle(observed.handle)&&handle(observed.handle)===handle(expected);
  }
  const names=platform==='xhs'? [observed.nickname] : observed.names;
  return Array.isArray(names)&&names.length===1&&typeof names[0]==='string'&&names[0].trim()===expected.trim();
}

export function creatorIdentityModule({x,xhs,native}){
  return `const creatorHosts=${JSON.stringify(creatorHosts)};
${matchesCreator.toString()}
const readX=${x.toString()}, readXhs=${xhs.toString()}, readNative=${native.toString()};
export async function verifyCreator(evaluate,tab,platform,expected){
  const reader=platform==='x'?readX:platform==='xhs'?readXhs:readNative;
  const observed=await evaluate(tab,'('+reader.toString()+')('+JSON.stringify(platform)+')');
  return matchesCreator(platform,observed,expected);
}
`;
}
