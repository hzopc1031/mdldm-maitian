// Synthetic offline fixtures. No platform requests, profiles or real credentials.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {accountSummary} from '../src/l1-summary.mjs';
const db=new DatabaseSync(':memory:');
db.exec(`CREATE TABLE metrics(day TEXT,episode_id TEXT,platform TEXT,views INTEGER,likes INTEGER,comments INTEGER,favorites INTEGER,shares INTEGER,extra TEXT,collected_at TEXT);
CREATE TABLE snapshots(episode_id TEXT PRIMARY KEY,project TEXT); CREATE TABLE tasks(episode_id TEXT,platform TEXT,state TEXT);`);
const date='2026-11-17',account='offline-account';
function post(id,created,who=account,state='published') {
  db.prepare('INSERT INTO snapshots VALUES (?,?)').run(id,JSON.stringify({account:who,created_at:created}));
  db.prepare('INSERT INTO tasks VALUES (?, ?, ?)').run(id,'xhs',state);
}
function metric(id,day,views,options={}) {
  db.prepare('INSERT INTO metrics VALUES (?,?,?,?,?,?,?,?,?,?)').run(day,id,'xhs',views,options.likes??3,1,0,2,
    JSON.stringify({account:options.account || account,field_observed_at:options.fields || {}}),day+'T01:00:00Z');
}
try {
  assert.equal(accountSummary(db,'xhs',account,date).currentWorks.metrics.views,null);
  post('old','2026-11-15T00:00:00Z'); metric('old','2026-11-16',100); metric('old',date,125);
  let s=accountSummary(db,'xhs',account,date);
  assert.equal(s.currentWorks.metrics.views,125);assert.equal(s.publishedToday.count,0);
  assert.equal(s.crossDayDelta.metrics.views,25);assert.equal(s.crossDayDelta.metrics.favorites,0);
  // Same-day old observation never becomes a yesterday baseline.
  db.prepare("DELETE FROM metrics WHERE day='2026-11-16'").run();
  assert.equal(accountSummary(db,'xhs',account,date).crossDayDelta.metrics.views,null);
  metric('old','2026-11-16',100);
  // Beijing boundary: Nov 16 16:00 UTC is Nov 17 locally; no invented baseline for a new work.
  post('new','2026-11-16T16:00:00Z');metric('new',date,40);
  s=accountSummary(db,'xhs',account,date);
  assert.equal(s.publishedToday.count,1);assert.equal(s.publishedToday.metrics.views,40);
  assert.equal(s.currentWorks.metrics.views,165);assert.equal(s.crossDayDelta.metrics.views,null);
  metric('new','2026-11-16',10);
  // Unknown fields and retained yesterday fields do not become current measured deltas.
  db.prepare("UPDATE metrics SET likes=NULL WHERE episode_id='new' AND day=?").run(date);
  db.prepare("UPDATE metrics SET extra=? WHERE episode_id='old' AND day=?").run(JSON.stringify({account,field_observed_at:{views:'2026-11-16T01:00:00Z'}}),date);
  s=accountSummary(db,'xhs',account,date);
  assert.equal(s.crossDayDelta.metrics.views,null);assert.equal(s.currentWorks.metrics.likes,null);
  assert.equal(s.crossDayDelta.metrics.comments,0);
  // Foreign account, non-published state and future observations are excluded.
  post('foreign','2026-11-17T00:00:00Z','someone-else');metric('foreign',date,999,{account:'someone-else'});
  post('review','2026-11-17T00:00:00Z',account,'reviewing');metric('review',date,999);
  metric('old','2026-11-18',999);
  assert.equal(accountSummary(db,'xhs',account,date).observedWorks,2);
  post('unknown',null);metric('unknown',date,7);
  s=accountSummary(db,'xhs',account,date);
  assert.equal(s.publishedToday.count,null);assert.equal(s.publishedToday.metrics.views,null);
  assert.equal(s.unknownPublicationDates,1);assert.equal(s.currentWorks.metrics.views,172);
  assert.equal(accountSummary(db,'xhs','other',date).publishedToday.count,null);
  assert.throws(()=>accountSummary(db,'xhs',account,'bad'));
  console.log('L1 SUMMARY OFFLINE PASS: three scopes, Beijing boundary, account/state filtering, missing baseline/date/field, retained field, no inferred zero.');
} finally {db.close();}
