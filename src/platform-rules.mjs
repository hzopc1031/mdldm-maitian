// Shared browser/Node rules. xhsTitleCount mirrors local xhs-publish util.mjs titleLen.
export const platforms = ['x','xhs','wechat'];
export const charCount = value => Array.from(String(value ?? '')).length;
export function xEditionText(input){const content=String(input.content??''),topics=(input.topics??[]).map(t=>String(t).replace(/^#/,'' )).filter(t=>t&&!content.includes('#'+t));return content+(topics.length?'\n\n'+topics.map(t=>'#'+t).join(' '):'');}
export const xhsTitleCount = value => Math.ceil(String(value ?? '').split('').reduce((n,c)=>n+(c.charCodeAt(0)<=127?0.5:1),0));
export function xWeightedCount(value) {
  const segments = new Intl.Segmenter('en',{granularity:'grapheme'});
  const plain = s => [...segments.segment(s)].reduce((n,{segment}) => n + (/\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20e3/u.test(segment) ? 2 : [...segment].reduce((a,c)=>a+(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(c)?2:1),0)),0);
  let total=0,last=0;const input=String(value??'').normalize('NFC');
  for(const m of input.matchAll(/https?:\/\/[^\s<>]+/gi)){let url=m[0].replace(/[.,!?;:，。！？；：)\]】》]+$/u,'');total+=plain(input.slice(last,m.index))+23;last=m.index+url.length;}
  return total+plain(input.slice(last));
}
export function platformRules(config={}) {
  return {x:{title:null,body:config.publishPrep?.x?.premium===true?25000:280,imagesMin:0,imagesMax:4},xhs:{title:20,body:1000,imagesMin:1,imagesMax:18},wechat:{title:32,body:50000,digest:120,author:16,imagesMin:0,imagesMax:20}};
}
export function validateEdition(platform,input,config={}) {
  const rule=platformRules(config)[platform];if(!rule)throw Error('不支持的平台');
  const separateCover=platform!=='x'&&(input.cover??input.coverImage)&&!input.images?.includes(input.cover??input.coverImage)&&!input.inlineImages?.some(im=>im.file===(input.cover??input.coverImage))?1:0;
  const counts={title:platform==='xhs'?xhsTitleCount(input.title):charCount(input.title),body:platform==='x'?xWeightedCount(xEditionText(input)):charCount(input.content)+(platform==='xhs'?(input.topics??[]).reduce((n,t)=>n+charCount(t)+4,0):0),images:(input.images?.length??0)+separateCover,digest:charCount(input.digest??input.caption),author:charCount(input.author)};
  const issues=[];
  const add=(field,message)=>issues.push({field,message});
  if(platform!=='x'&&!input.title?.trim())add('title','请填写标题');
  if(!input.content?.trim())add('content','请填写正文');
  if(rule.title&&counts.title>rule.title)add('title',`标题 ${counts.title}/${rule.title} 字，超过上限`);
  if(counts.body>rule.body)add('content',`正文 ${counts.body}/${rule.body} 字，超过上限`);
  if(counts.images<rule.imagesMin||counts.images>rule.imagesMax)add('images',`图片需要 ${rule.imagesMin}–${rule.imagesMax} 张`);
  if(input.images?.some(f=>typeof f!=='string'||! /\.(png|jpe?g|webp)$/i.test(f)))add('images','图片仅支持 PNG/JPEG/WebP');
  if(platform==='wechat'){
    if(!input.cover&&!input.coverImage&&!(input.coverFromBody&&input.images?.length))add('cover','公众号封面必填，可选择正文图片');
    if(counts.digest>120)add('digest','摘要超过 120 字');if(counts.author>16)add('author','作者超过 16 字');
  }
  if(input.video)add('video','视频暂不支持');
  return {ok:issues.length===0,counts,limits:rule,issues,warnings:platform==='wechat'&&input.author?['作者需在草稿里手填']:[]};
}
