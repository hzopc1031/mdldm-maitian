// Exercise the real shared-browser adapter with injected local-skill drivers only.
import assert from 'node:assert/strict';
import {withSharedCommentPage} from '../src/x-comment-executor.mjs';
const profile='D:/AIInfra/agent-publish/x/chrome-profile',task={account:'WorkDemo'},route={profile,port:9336};
function driver({listening=false,pidChange=false,badListener=false,badRoute=false,notOwned=false}={}){
 const events=[],state={listening,checks:0,closed:0};
 const page={_owned:!notOwned,_port:9336,targetId:'owned-test-tab',goto:async url=>events.push(['goto',url]),eval:async()=>({handle:'WorkDemo'}),typeText:async()=>assert.fail('Readiness never types'),screenshot:async()=>{},closeOwned:async()=>{state.closed++;events.push(['close-owned']);}};
 return {events,state,listAccounts:()=>({accounts:{arbitraryName:{port:9336,profile,expectedHandle:badRoute?'OtherAccount':'WorkDemo',proxy:'http://127.0.0.1:12334'}}}),
  async launch(input){assert.deepEqual(input,{...route,proxy:'http://127.0.0.1:12334',startUrl:'about:blank'});events.push([state.listening?'reuse':'start']);if(badListener)throw Error('profile mismatch on occupied port');state.listening=true;return {pid:123,reused:listening};},
  async verifyBrowserProfile(port,p){assert.equal(port,9336);assert.equal(p,profile);assert.equal(state.listening,true,'Must launch/reuse before requiring a listener');state.checks++;events.push(['verify']);return {pids:[pidChange&&state.checks===2?456:123],profile};},
  Page:{attach:async(port,options)=>{assert.deepEqual(options,{owned:true,startUrl:'about:blank'});assert.equal(port,9336);events.push(['attach-owned']);return page;}}
 };
}
for(const listening of [false,true]){
 const d=driver({listening});const result=await withSharedCommentPage(task,route,async page=>{await page.goto('https://x.com/home');return 'checked';},d);
 assert.equal(result,'checked');assert.equal(d.events[0][0],listening?'reuse':'start');assert.equal(d.state.checks,2);assert.equal(d.state.closed,1);
 assert.deepEqual(d.events.map(e=>e[0]),[listening?'reuse':'start','verify','attach-owned','verify','goto','close-owned']);
}
for(const options of [{badListener:true},{pidChange:true},{notOwned:true}]){
 const d=driver(options);await assert.rejects(withSharedCommentPage(task,route,async()=>assert.fail('No page operations after a guard fails'),d),e=>e.code==='X_BROWSER_UNAVAILABLE');
 if(options.badListener)assert.equal(d.state.closed,0);else assert.equal(d.state.closed,1);
}
const bad=driver({badRoute:true});await assert.rejects(withSharedCommentPage(task,route,async()=>assert.fail(),bad),e=>e.code==='X_BROWSER_ROUTE_MISMATCH');assert.equal(bad.events.length,0);
await assert.rejects(withSharedCommentPage(task,{...route,port:9337},async()=>assert.fail(),driver()),e=>e.code==='X_BROWSER_ROUTE_MISMATCH');
await assert.rejects(withSharedCommentPage(task,route,async()=>{throw Object.assign(Error('identity mismatch'),{code:'ACCOUNT_MISMATCH'});},driver()),e=>e.code==='ACCOUNT_MISMATCH');
const isolated=driver({listening:true});let tabs=0,closed=[];
isolated.Page.attach=async()=>{const id=++tabs;return {_owned:true,_port:9336,targetId:'owned-'+id,goto:async url=>isolated.events.push(['tab-goto',id,url]),eval:async()=>({handle:'WorkDemo'}),screenshot:async()=>{},typeText:async()=>assert.fail('Reader cannot type'),closeOwned:async()=>closed.push(id)};};
await withSharedCommentPage(task,route,page=>page.withReadOnlyPage(async reader=>{assert.equal(reader.type,undefined);assert.equal(tabs,2);await reader.goto('https://x.com/WorkDemo/status/999');}),isolated);
assert.deepEqual(closed,[2,1]);assert.equal(isolated.events.filter(e=>e[0]==='tab-goto')[0][1],2,'proof navigation only on separate owned reader');
console.log('COMMENT BROWSER PASS: absent listener starts, existing listener reuses, public account/profile/port routing matches, PID changes/mismatches stop, owned tab only, no typing/submission. Injected driver; no Chrome or platform access.');
