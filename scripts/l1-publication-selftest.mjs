// Offline only: preparation interlocks and historical receipts. No browser or platform.
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';import {EventEmitter} from 'node:events';
import {createPrepService,prepCommand,acceptPrepResult} from '../src/publish-prep.mjs';
import {publicXhsUrl} from '../src/prep-publication.mjs';
const home=fs.mkdtempSync(path.join(os.tmpdir(),'prep-no-submit-')),image=path.join(home,'card.png');
fs.writeFileSync(image,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6WQAAAABJRU5ErkJggg==','base64'));
for(const p of ['xhs','wechat']){const folder=path.join(home,p+'-publish','scripts');fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(folder,p+'.mjs'),"// mock opts['keep-browser']");}
const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE tasks(episode_id TEXT,platform TEXT,state TEXT,detail TEXT,url TEXT,updated_at TEXT)');
let child,count=0;const opts={db,home,root:home,config:{},env:{MAITIAN_LOCAL_SKILLS:home},spawnChild:(bin,args)=>{count++;assert.equal(args.includes('--submit'),false);child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();return child;}};
let prep=createPrepService(opts);const complete=receipt=>{child.stdout.emit('data',JSON.stringify(receipt));child.emit('close',0);};
try{
 for(const p of ['x','xhs','wechat']){assert.throws(()=>prepCommand(p,'publish',{script:'s',jobFile:'j'}),/不能发布/);assert.throws(()=>acceptPrepResult(p,'publish',0,{ok:true,submitted:true}),/不能发布/);}
 const r=prep.create({platform:'xhs',title:'仅填写',content:'离线替身',images:[image]});prep.start(r.id,'check');complete({ok:true,offlineOnly:true});const before=count;
 for(const kind of ['publish','submit'])assert.throws(()=>prep.start(r.id,kind,undefined,{reference:'any',checkedDigest:prep.get(r.id).checkedDigest}),/PUBLISH_DISABLED/);
 assert.equal(count,before);assert.equal(JSON.parse(fs.readFileSync(prep.jobFile(r.id))).submit,false);
 prep.start(r.id,'execute');complete({ok:true,submitted:false,dryRun:true});assert.equal(prep.get(r.id).state,'awaiting_user');
 assert.equal(prep.start(r.id,'execute').state,'awaiting_user');assert.equal(count,before+1);
 for(const state of ['submitted','published','already_exists','unknown']){
  const id='legacy-'+state,record={id,platform:'xhs',title:'历史稿',state,operations:[{kind:'publish',state}]};db.prepare('INSERT INTO publish_preparations VALUES (?,?)').run(id,JSON.stringify(record));
  assert.equal(prep.get(id).state,state);for(const kind of ['check','execute','publish'])assert.throws(()=>prep.start(id,kind));
 }
 assert.equal(publicXhsUrl('https://www.xiaohongshu.com/explore/0123456789abcdef01234567?token=private'),null);
 const running=prep.create({platform:'x',content:'old running'});for(let i=0;i<32;i++)prep.create({platform:'x',content:'newer '+i});
 db.prepare('UPDATE publish_preparations SET record=? WHERE id=?').run(JSON.stringify({...running,state:'running'}),running.id);prep=createPrepService(opts);assert.equal(prep.get(running.id).state,'unknown');assert.throws(()=>prep.start(running.id,'execute'));
 console.log('PUBLICATION OFFLINE PASS: publish/submit rejected before spawn; fixed submit:false; old submitted/published records read-only; original window and restart/unknown interlocks retained.');
}finally{db.close();}
