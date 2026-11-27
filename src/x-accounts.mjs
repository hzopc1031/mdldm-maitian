// Public account identities and dedicated browser routes only; never credentials.
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {home,dbPath} from './l1-config.mjs';
import {l1Account} from './l1-account.mjs';
const require=createRequire(import.meta.url);
export const DEFAULT_X_ACCOUNT='default';
export function accountId(value=DEFAULT_X_ACCOUNT){
 if(typeof value!=='string'||! /^(?:default|x-[a-f0-9]{24})$/.test(value))throw Error('X账户ID无效');
 return value;
}
export function initXAccounts(db){db.exec('CREATE TABLE IF NOT EXISTS x_accounts(id TEXT PRIMARY KEY,label TEXT NOT NULL,handle TEXT COLLATE NOCASE UNIQUE,profile TEXT NOT NULL UNIQUE,port INTEGER NOT NULL UNIQUE,created_at TEXT NOT NULL,confirmed_at TEXT)');}
function label(value){if(typeof value!=='string'||!value.trim()||value.trim().length>60||/[\x00-\x1f\x7f]/.test(value))throw Error('账户备注须为1–60字，不是登录凭据');return value.trim();}
export function managedXAccounts(db){
 if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='x_accounts'").get())return [];
 return db.prepare('SELECT * FROM x_accounts ORDER BY created_at,id').all();
}
export function defaultXAccount(config={}){
 let handle=null;try{handle=l1Account(config,'x');}catch{}
 return {id:DEFAULT_X_ACCOUNT,label:'原X账户',handle,profile:path.resolve(config.l1?.x?.chromeProfile||path.join(home,'chrome-profile-l1-x')),port:9341,legacy:true};
}
export function listXAccounts(db,config={}){return [defaultXAccount(config),...managedXAccounts(db)];}
export function createXAccount(db,input={}){
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>k!=='label'))throw Error('新增账户只接受备注；登录身份由平台确认');
 initXAccounts(db);const name=label(input.label??'新X账户');
 const used=new Set(managedXAccounts(db).map(a=>a.port));
 let port=9410;while(used.has(port)&&port<9500)port++;
 if(port>=9500)throw Error('独立X账户浏览器端口已用完');
 const id='x-'+crypto.randomBytes(12).toString('hex'),profile=path.resolve(home,'chrome-profile-l1-'+id);
 db.prepare('INSERT INTO x_accounts VALUES (?,?,NULL,?,?,?,NULL)').run(id,name,profile,port,new Date().toISOString());
 return managedXAccounts(db).find(a=>a.id===id);
}
export function deleteUnboundXAccount(db,input){
 if(!input||typeof input!=='object'||Array.isArray(input)||typeof input.id!=='string'||Object.keys(input).length!==1)throw Error('删除账户只接受账户ID');
 const id=accountId(input.id);
 if(id===DEFAULT_X_ACCOUNT)throw Error('原 X 账户不能通过此入口删除');
 const removed=db.prepare('DELETE FROM x_accounts WHERE id=? AND handle IS NULL AND confirmed_at IS NULL RETURNING id').get(id);
 if(removed)return removed.id;
 managedRecord(db,id);
 throw Error('已绑定的 X 账户不能通过此入口删除');
}
function managedRecord(db,id){
 accountId(id);const row=managedXAccounts(db).find(a=>a.id===id);
 if(!row)throw Error('X账户不存在');
 if(row.profile!==path.resolve(home,'chrome-profile-l1-'+id)||!Number.isInteger(row.port)||row.port<9410||row.port>=9500)throw Error('X账户专用浏览器配置不符');
 return row;
}
function readAccount(id){const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(dbPath,{readOnly:true});try{return managedRecord(db,id);}finally{db.close();}}
export function xAccountConfig(config,id=DEFAULT_X_ACCOUNT,db){
 accountId(id);if(id===DEFAULT_X_ACCOUNT)return config;
 const row=db?managedRecord(db,id):readAccount(id),legacy=defaultXAccount(config).handle;
 return {...config,xHandle:row.handle??undefined,_xAccountRoute:row,_legacyXHandle:legacy,
  l1:{...config.l1,x:{...config.l1?.x,account:row.handle??undefined,chromeProfile:row.profile,chromePort:row.port}},
  publishPrep:{...config.publishPrep,x:{...config.publishPrep?.x,browserProfile:row.profile,browserPort:row.port,browserExecution:config.publishPrep?.x?.browserExecution!==false}}};
}
export function bindXAccount(db,id,handle,legacyHandle){
 const row=managedRecord(db,id);
 if(typeof handle!=='string'||! /^[A-Za-z0-9_]{1,15}$/.test(handle))throw Error('未读到唯一可见X登录账号');
 if(row.handle&&row.handle.toLowerCase()!==handle.toLowerCase())throw Error('此账户槽已经绑定另一X账号，禁止自动换号');
 if(legacyHandle?.toLowerCase()===handle.toLowerCase()||managedXAccounts(db).some(a=>a.id!==id&&a.handle?.toLowerCase()===handle.toLowerCase()))throw Error('此X账号已在另一账户中，请使用原账户');
 db.prepare('UPDATE x_accounts SET handle=?,confirmed_at=? WHERE id=?').run(row.handle||handle,new Date().toISOString(),id);
 return managedRecord(db,id);
}
export function bindConfiguredX(config,handle){
 if(!config._xAccountRoute)return;
 const {DatabaseSync}=require('node:sqlite');
 const db=new DatabaseSync(dbPath);try{bindXAccount(db,config._xAccountRoute.id,handle,config._legacyXHandle);}finally{db.close();}
}
export function resolveXRecord(db,config,id){return id&&id!==DEFAULT_X_ACCOUNT?managedRecord(db,accountId(id)):defaultXAccount(config);}
export function xFollowerRows(db,handle){
 if(!handle)return [];
 const byDay=new Map();
 for(const row of db.prepare("SELECT value FROM meta WHERE key LIKE 'l1:followers:x:%'").all()){
  let r;try{r=JSON.parse(row.value);}catch{continue;}
  if(r.account?.toLowerCase()!==handle.toLowerCase()||!Number.isFinite(r.total))continue;
  if(!Number.isFinite(Date.parse(r.captured_at)))continue;
  const day=new Date(Date.parse(r.captured_at)+8*36e5).toISOString().slice(0,10),old=byDay.get(day);
  if(!old||Date.parse(old.collected_at)<Date.parse(r.captured_at))byDay.set(day,{day,platform:'x',account:handle,total:r.total,gain:null,loss:null,source:r.source,collected_at:r.captured_at});
 }
 return [...byDay.values()].sort((a,b)=>a.day.localeCompare(b.day));
}
