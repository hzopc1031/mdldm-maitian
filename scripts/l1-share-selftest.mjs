import assert from 'node:assert/strict';
import {visibleNoteShare} from '../src/l1-xhs-dom.mjs';
import {inspectPlatform} from '../src/l1-inspect.mjs';
// Minimal visible DOM fixture. No real browser, clipboard or platform connection.
let clicks=0,controls=[],links=[],dialogs=[],id='stable',text='已发布';
const node=(label,attrs={})=>({innerText:label,href:attrs.href,getAttribute:k=>attrs[k] || null,getBoundingClientRect:()=>({width:20,height:20}),click:()=>clicks++});
const card={get innerText(){return text;},getBoundingClientRect:()=>({width:20,height:20}),getAttribute:()=>JSON.stringify({noteTarget:{value:{noteId:id}}}),
  querySelectorAll:s=>s==='a[href]'?links:s==='input,textarea'?[]:controls};
globalThis.getComputedStyle=()=>({visibility:'visible',display:'block'});
globalThis.document={querySelectorAll:s=>s==='.note-card'?[card]:dialogs};
try {
  assert.equal(visibleNoteShare('wrong',true).reason,'stable-id-card-not-unique');
  assert.equal(visibleNoteShare('stable',true).reason,'visible-share-control-not-unique');assert.equal(clicks,0);
  controls=[node('编辑'),node('',{'title':'分享'})];
  assert.equal(visibleNoteShare('stable',true).opened,true);assert.equal(clicks,1);
  controls.push(node('复制链接'));assert.equal(visibleNoteShare('stable',true).ok,false);assert.equal(clicks,1);
  links=[node('',{href:'https://www.xiaohongshu.com/explore/other'})];assert.equal(visibleNoteShare('stable').ok,false);
  links=[node('',{href:'https://www.xiaohongshu.com/explore/stable?token=fixture'})];assert.equal(visibleNoteShare('stable').ok,false);
  links=[node('',{href:'https://www.xiaohongshu.com/explore/stable'})];assert.equal(visibleNoteShare('stable').postId,'stable');
  text='审核中';assert.equal(visibleNoteShare('stable',true).ok,false);assert.equal(clicks,1);text='已发布';
  const url='https://www.xiaohongshu.com/explore/stable';
  let reads=[],share={ok:true,postId:'stable',url};
  const withBrowser=async(c,fn)=>fn({goto:async()=>{},evaluate:async fn=>{
    reads.push(fn.name);
    if(fn.name==='visibleIdentity')return {nickname:'offline',login:false};
    if(fn.name==='visibleNoteCards')return [{id:'stable',state:'published',url:null}];
    if(fn.name==='visibleNoteShare')return share;
    throw Error('Unexpected DOM operation');
  }});
  const config={l1:{xhs:{account:'offline'}}},options={withBrowser,wait:async()=>{}};
  assert.equal((await inspectPlatform(config,'xhs',{postId:'stable'},options)).url,url);
  assert.equal(reads.filter(x=>x==='visibleNoteShare').length,1);
  share={ok:true,postId:'other',url};
  await assert.rejects(inspectPlatform(config,'xhs',{postId:'stable'},options),/未回写/);
  share={ok:false,reason:'visible-share-control-not-unique'};
  await assert.rejects(inspectPlatform(config,'xhs',{postId:'stable'},options),/visible-share-control-not-unique/);
  console.log('L1 SHARE OFFLINE PASS: exact stable ID, labelled share only, review/ambiguity/foreign ID/query rejection, fallback success and explicit failure.');
}finally{delete globalThis.document;delete globalThis.getComputedStyle;}
