const hour = 3600000;
const windowHours = 6;
export const lateAgeHours = 6;
const milestoneDays = [1, 3, 7];
const fields = ['views', 'likes', 'comments'];
const object = value => { try { return JSON.parse(value) ?? {}; } catch { return {}; } };
const timestamp = value => typeof value === 'string' && /(?:Z|[+-]\d\d:\d\d)$/.test(value) ? Date.parse(value) : NaN;
const xPost = url => /^https:\/\/(?:(?:www|mobile)\.)?(?:x|twitter)\.com\/(?:[\w]+|i\/web)\/status\/(\d+)(?:\/?(?:[?#].*)?)$/i.exec(url || '')?.[1];

export function ageMilestones(publishedAt, rows, now = Date.now()) {
  const published = timestamp(publishedAt);
  const observations = rows.map(row => ({ row, extra:object(row.extra) })).filter(({extra}) => !extra.example);
  return milestoneDays.map(day => {
    const target = published + day * 24 * hour;
    if (!Number.isFinite(target)) return {day,state:'unknown-date',values:null};
    if (now < target) return {day,state:'pending',values:null};
    const values = {}, late = {};
    for (const field of fields) {
      let point,delayed;
      for (const {row,extra} of observations) {
        const observed = timestamp(extra.field_observed_at?.[field] ?? row.collected_at);
        if (!Number.isFinite(row[field]) || row[field] < 0 || !Number.isFinite(observed) || observed>now) continue;
        if(observed>=target-windowHours*hour&&observed<=target&&observed>(point?.time??-Infinity))point={value:row[field],time:observed};
        if(observed>target&&observed<=target+lateAgeHours*hour&&observed<(delayed?.time??Infinity))delayed={value:row[field],time:observed};
      }
      if (point) values[field] = {value:point.value,observedAt:new Date(point.time).toISOString(),ageHours:(point.time-published)/hour};
      if (delayed&&!point)late[field]={value:delayed.value,observedAt:new Date(delayed.time).toISOString(),ageHours:(delayed.time-published)/hour};
    }
    return {...(Object.keys(values).length ? {day,state:'observed',values} : {day,state:'missing',values:null}),
      ...(Object.keys(late).length?{late}:{})};
  });
}

export function publicationTime(project, platform, single = true) {
  if (['xhs','wechat'].includes(platform)&&['xhs-visible-dom','wechat-visible-dom'].includes(project.source)&&project.platforms?.[platform]?.dateAccuracy!=='time') return null;
  const value=project.platforms?.[platform]?.created_at ?? (single ? project.created_at : null);
  return Number.isFinite(timestamp(value)) ? value : null;
}

export function createAgeReviewReader(db) {
  const forWork = db.prepare(`SELECT t.episode_id,t.platform,t.url,s.project FROM tasks t
    LEFT JOIN snapshots s ON s.episode_id=t.episode_id WHERE t.episode_id=? AND t.state='published'`);
  const xWorks = db.prepare(`SELECT t.episode_id,t.url FROM tasks t WHERE t.platform='x' AND t.state='published'`);
  const metrics = db.prepare(`SELECT views,likes,comments,extra,collected_at FROM metrics WHERE episode_id=? AND platform=?`);
  const ageMetrics=db.prepare(`SELECT views,likes,comments,'{}' extra,observed_at collected_at FROM age_observations WHERE episode_id=? AND platform=?`);
  const attempts=db.prepare('SELECT attempts,attempted_at FROM age_attempts WHERE episode_id=? AND platform=? AND day=?');
  const readingsFor=(id,platform)=>[...metrics.all(id,platform),...ageMetrics.all(id,platform)];
  const publications = db.prepare(`SELECT record FROM publish_preparations WHERE json_valid(record)
    AND json_extract(record,'$.platform')='x' AND json_extract(record,'$.state')='published'
    AND json_extract(record,'$.publication.url') IS NOT NULL`);

  function readIndex() {
    const records = new Map(), linked = new Map();
    for (const {record} of publications.all()) {
      const r = object(record), id = xPost(r.publication?.url);
      if (!id || r.test || !r.source?.project || !r.source?.column || !Number.isFinite(timestamp(r.publication.publishedAt))) continue;
      records.set(id,{id,title:r.title,url:r.publication.url,publishedAt:r.publication.publishedAt,project:r.source.project,
        column:r.source.column,account:r.publication.account?.toLowerCase()??null});
    }
    for (const {episode_id,url} of xWorks.all()) {
      const id = xPost(url);
      if (records.has(id)) linked.set(id,linked.has(id) ? null : episode_id);
    }
    return {records,linked};
  }

  function analyse({platform,publishedAt,episodeId,receipt}, index, now) {
    const readings = episodeId ? readingsFor(episodeId,platform) : [];
    const past = receipt ? [...index.records.values()].filter(r=>r.column===receipt.column && r.project===receipt.project && r.account===receipt.account &&
      timestamp(r.publishedAt) < timestamp(receipt.publishedAt)).sort((a,b)=>timestamp(b.publishedAt)-timestamp(a.publishedAt))[0] : null;
    const pastEpisode = past ? index.linked.get(past.id) : null;
    const baseline = past ? ageMilestones(past.publishedAt,pastEpisode ? readingsFor(pastEpisode,platform) : [],now) : [];
    const milestones = ageMilestones(publishedAt,readings,now).map((point,i) => {
      const previous = baseline[i]?.values ?? null;
      const delta = Object.fromEntries(fields
        .filter(field=>Object.hasOwn(point.values??{},field) && Object.hasOwn(previous??{},field))
        .map(field=>[field,point.values[field].value-previous[field].value]));
      const attempt=episodeId?attempts.get(episodeId,platform,point.day):null;
      const coverage=point.state!=='missing'?null:attempt?'attempted':'no-attempt';
      return {...point,coverage,lastAttemptAt:attempt?.attempted_at??null,previous,delta};
    });
    return {platform,publishedAt:publishedAt ?? null,windowHours,column:receipt?.column ?? null,
      previous:past ? {title:past.title,url:past.url,episodeId:pastEpisode ?? null} : null,milestones};
  }

  return {
    forEpisode(episodeId, now = Date.now()) {
      const tracks=forWork.all(episodeId);
      if (!tracks.length) return [];
      const index=readIndex();
      return tracks.flatMap(track=>{
        const project=object(track.project);
        if (project.example) return [];
        const receipt = track.platform==='x' ? index.records.get(xPost(track.url)) : null;
        const time = receipt?.publishedAt ?? publicationTime(project,track.platform,tracks.length===1);
        return analyse({platform:track.platform,publishedAt:Number.isFinite(timestamp(time)) ? time : null,episodeId,receipt},index,now);
      });
    },
    forRecords(records, now = Date.now()) {
      if (!records.some(record=>record.publication && !record.test)) return records;
      const index=readIndex();
      return records.map(record=>{
        const receipt=index.records.get(xPost(record.publication?.url));
        return receipt ? {...record,ageReview:analyse({platform:'x',publishedAt:receipt.publishedAt,episodeId:index.linked.get(receipt.id),receipt},index,now)} : record;
      });
    },
  };
}
