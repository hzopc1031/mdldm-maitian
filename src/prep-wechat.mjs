import fs from 'node:fs';import path from 'node:path';
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function wechatEditionJob(edition,folder) {
  const images=[...new Set([...(edition.cover?[edition.cover]:[]),...edition.images])];
  const paragraphs=edition.content.split(/\n\s*\n/),inlineImages=images.map((file,i)=>({id:'image-'+(i+1),file}));
  const slots=new Map();
  inlineImages.forEach(im=>{const specified=(edition.imagePositions??[]).find(p=>p.image===im.file);const after=im.file===edition.cover?0:(specified?.afterParagraph??paragraphs.length);if(!Number.isInteger(after)||after<0||after>paragraphs.length)throw Error('图片位置超过正文段落数');slots.set(after,[...(slots.get(after)??[]),`<!--WECHAT_INLINE_IMAGE:${im.id}-->`]);});
  const html=`<section style="color:#27272A;font-size:16px;line-height:1.8">${(slots.get(0)??[]).join('')}${paragraphs.map((p,i)=>`<p style="margin:0 0 18px"><span leaf="">${escape(p).replace(/\n/g,'<br>')}</span></p>${(slots.get(i+1)??[]).join('')}`).join('')}</section>`;
  const htmlFile=path.join(folder,'article.html');fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(htmlFile,html);
  return {images:[],htmlFile,inlineImages,coverFromBody:true};
}

// 兼容旧单平台 HTML 入口：副本中移动封面占位，不改调用方的HTML。
export function wechatRichJob(job,cover,folder) {
  if(!job.htmlFile)return wechatEditionJob({...job,cover},folder);
  if(job.images.length)throw Error('公众号HTML任务请将全部图片绑定inlineImages');
  let html=fs.readFileSync(job.htmlFile,'utf8');
  const inlineImages=[...(job.inlineImages??[])];
  if(cover){
    let item=inlineImages.find(im=>im.file===cover);
    if(!item){let n=1;while(inlineImages.some(im=>im.id==='cover-'+n))n++;item={id:'cover-'+n,file:cover};inlineImages.unshift(item);}
    const duplicates=inlineImages.filter(im=>im.file===cover);
    for(const im of duplicates)html=html.split(`<!--WECHAT_INLINE_IMAGE:${im.id}-->`).join('');
    html=html.replace(/^(\s*<section\b[^>]*>)/i,`$1<!--WECHAT_INLINE_IMAGE:${item.id}-->`);
    inlineImages.splice(0,inlineImages.length,item,...inlineImages.filter(im=>im.file!==cover));
  }
  const htmlFile=path.join(folder,'article.html');fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(htmlFile,html);
  return {images:[],htmlFile,inlineImages,coverFromBody:true};
}
