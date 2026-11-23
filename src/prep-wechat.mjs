import fs from 'node:fs';import path from 'node:path';
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function wechatEditionJob(edition,folder) {
  const images=[...edition.images];if(edition.cover&&!images.includes(edition.cover))images.unshift(edition.cover);
  const paragraphs=edition.content.split(/\n\s*\n/),inlineImages=images.map((file,i)=>({id:'image-'+(i+1),file}));
  const slots=new Map();
  inlineImages.forEach((im,i)=>{const specified=(edition.imagePositions??[]).find(p=>p.image===im.file);const after=specified?.afterParagraph??(i===0&&im.file===edition.cover?0:paragraphs.length);if(!Number.isInteger(after)||after<0||after>paragraphs.length)throw Error('图片位置超过正文段落数');slots.set(after,[...(slots.get(after)??[]),`<!--WECHAT_INLINE_IMAGE:${im.id}-->`]);});
  const html=`<section style="color:#27272A;font-size:16px;line-height:1.8">${(slots.get(0)??[]).join('')}${paragraphs.map((p,i)=>`<p style="margin:0 0 18px"><span leaf="">${escape(p).replace(/\n/g,'<br>')}</span></p>${(slots.get(i+1)??[]).join('')}`).join('')}</section>`;
  const htmlFile=path.join(folder,'article.html');fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(htmlFile,html);
  return {images:[],htmlFile,inlineImages,coverImage:edition.cover,coverFromBody:true};
}
