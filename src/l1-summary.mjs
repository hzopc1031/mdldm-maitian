// Pure local aggregation. Never infer a missing baseline or a platform-wide total.
import { beijingDay, validDay } from './l1-config.mjs';
import {collectionKey} from './l1-collection-window.mjs';
import {selectedPlatforms,platformById} from './platform-registry.mjs';
export const SUMMARY_FIELDS = ['views', 'likes', 'comments', 'favorites', 'shares'];
const parse = value => { try { return JSON.parse(value || '{}'); } catch { return {}; } };
const dayOf = value => { try { return value && beijingDay(value); } catch { return null; } };
const empty = () => Object.fromEntries(SUMMARY_FIELDS.map(k => [k, null]));
const sum = rows => Object.fromEntries(SUMMARY_FIELDS.map(k => [k, rows.length && rows.every(r => Number.isFinite(r[k])) ? rows.reduce((n,r) => n + r[k], 0) : null]));

export function accountSummary(db, platform, account, date = beijingDay()) {
  validDay(date);
  let collection=null;
  try { collection=parse(db.prepare('SELECT value FROM meta WHERE key=?').get(collectionKey(platform,account,date))?.value); } catch { /* Legacy offline schema. */ }
  const collected=collection?.scope==='day' && collection?.account===account && collection?.date===date;
  const native=platformById(platform)?.native, knownCohort=collected&&(collection.complete||collection.coverage==='registered-only'&&!collection.unknownDates);
  const previousDay = new Date(Date.parse(date + 'T00:00:00Z') - 864e5).toISOString().slice(0,10);
  const rows = db.prepare(`SELECT m.*,s.project,t.state FROM metrics m JOIN snapshots s ON s.episode_id=m.episode_id
    JOIN tasks t ON t.episode_id=m.episode_id AND t.platform=m.platform WHERE m.platform=? AND m.day<=?
    ORDER BY m.day DESC,m.collected_at DESC`).all(platform,date).filter(r => {
    const p=parse(r.project), e=parse(r.extra);
    return account && p.account===account && e.account===account && r.state==='published' && dayOf(r.collected_at)<=date;
  });
  const current = new Map(), baseline = new Map();
  for (const row of rows) {
    if (!current.has(row.episode_id)) current.set(row.episode_id,row);
    if (row.day===previousDay && !baseline.has(row.episode_id)) baseline.set(row.episode_id,row);
  }
  const works=[...current.values()];
  const publishedDay = row => dayOf(parse(row.project).platforms?.[platform]?.created_at || parse(row.project).created_at);
  const unknownDates=works.filter(r=>!publishedDay(r)).length;
  const today=works.filter(r=>publishedDay(r)===date);
  const fresh=(r,k,day)=> r.day===day && dayOf(parse(r.extra).field_observed_at?.[k] || r.collected_at)===day && Number.isFinite(r[k]);
  const delta=empty();
  for(const k of SUMMARY_FIELDS) {
    if(works.length && works.every(r=>fresh(r,k,date) && baseline.has(r.episode_id) && fresh(baseline.get(r.episode_id),k,previousDay)))
      delta[k]=works.reduce((n,r)=>n+r[k]-baseline.get(r.episode_id)[k],0);
  }
  // Empty known cohort is zero only if some real observations exist and every date is known.
  const todayMetrics=unknownDates ? empty() : today.length ? sum(today) : works.length ? Object.fromEntries(SUMMARY_FIELDS.map(k=>[k,0])) : empty();
  const times=works.map(r=>r.collected_at).sort();
  const baseTimes=works.map(r=>baseline.get(r.episode_id)?.collected_at).filter(Boolean).sort();
  const observedTodayWorks=works.filter(r=>dayOf(r.collected_at)===date).length;
  const latestDay=dayOf(times.at(-1));
  const freshnessState=!works.length ? 'missing' : !observedTodayWorks ? 'stale' : observedTodayWorks===works.length ? 'current' : 'partial';
  const freshness={state:freshnessState,latestDay,observedTodayWorks,
    label:freshnessState==='missing' ? '尚无采集数据' : freshnessState==='stale' ? `当日未更新（最近观测 ${latestDay}）`
      : freshnessState==='partial' ? `当日部分更新（${observedTodayWorks}/${works.length} 篇入库作品）` : `当日已观测 ${works.length} 篇入库作品`};
  // 历史快照不能证明今天没有发文；部分更新也不能把未采集作品当成 0。
  const todayKnown=freshnessState==='current' && !unknownDates;
  return { platform, account:account || null, date, timezone:'Asia/Shanghai',
    coverage:'仅本账号已入库且已发布作品；未证明全账号完整历史，不代表平台账号总量',
    observedWorks:works.length, unknownPublicationDates:unknownDates,
    freshness:collected ? {...freshness,label:`${date} 已检查 ${collection.count} 篇${native?'登记':''}作品${collection.complete ? '' : collection.coverage==='registered-only'?'（仅登记范围）':'（日期不完整）'}`} : freshness,
    collection:collected ? collection : null,
    observedAt:{from:times[0] || null,to:times.at(-1) || null},
    publishedToday:{label:native?'当日登记作品累计':'当日发文累计',count:collected ? (knownCohort ? collection.count : null) : todayKnown ? today.length : null,metrics:collected ? collection.metrics : todayKnown ? todayMetrics : empty(),
      meaning:native?'仅当日已登记作品的最新实测累计；不含未登记内容，不是平台全量或当日新增流量':'当日发布作品截至各自最新观测的累计表现；不是当日新增流量'},
    currentWorks:{label:'当前作品累计',count:works.length || null,metrics:sum(works),
      meaning:'截至该日的入库已发布作品最新观测之和；可含历史保留字段和不同采集时间'},
    crossDayDelta:{label:'跨日快照增量',from:previousDay,to:date,metrics:delta,
      matchedWorks:works.filter(r=>r.day===date && baseline.has(r.episode_id)).length,
      baselineAt:{from:baseTimes[0] || null,to:baseTimes.at(-1) || null},
      meaning:'同一入库作品集合逐篇相减；要求当日与前一日均有对应字段实测。缺项暂无，不把新发文基线当0，也不等同零点至今流量'},
    example:works.some(r=>parse(r.extra).example===true) };
}

export function configuredSummaries(db,config,accountFor,date=beijingDay()) {
  return selectedPlatforms(db).map(platform=>{
    let account;try{account=accountFor(config,platform);}catch{}
    return accountSummary(db,platform,account,date);
  });
}
