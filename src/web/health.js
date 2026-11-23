// Shared visible navigation; URLs remain compatible with existing deep links.
function workbenchNav(on,siteOn=false) {
  const local=typeof location==='undefined'||['127.0.0.1','localhost'].includes(location.hostname);
  const agents=local?'http://127.0.0.1:3351/':'/agents/';
  const items=[['/','总览','board'],['/p#/prepare','发布','prepare'],['/p#/traffic','数据统计','traffic'],['/p#/calendar','发布日历','calendar'],['/p#/archive','作品库','archive'],['/p#/system','账号与采集','system'],[agents,'项目调度台','agents']];
  if(siteOn)items.splice(4,0,['/p#/convert','站点转化','convert']);
  return `<nav class="nav" aria-label="工作台导航">${items.map(([url,label,key])=>`<a href="${url}" class="${key===on?'on ':''}${key==='prepare'?'nav-publish':''}" ${key===on?'aria-current="page"':''}>${label}</a>`).join('')}</nav>`;
}
function visiblePlatforms(O) {
  if(Array.isArray(O.platforms))return O.platforms.filter(p=>p.selected).map(p=>p.id);
  return O.accountSummaries?.length ? [...new Set(O.accountSummaries.map(s=>s.platform)),...(O.siteOn?['zsz']:[])] : ['bilibili','douyin','xhs','wechat','channels','youtube','x','instagram',...(O.siteOn?['zsz']:[])];
}
function platformPickerHTML(O) {
  if(!O.platforms)return '';
  const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  return `<section class="panel platform-picker" id="all-platforms"><div class="ph"><h2>全部平台</h2><span class="note">自由选择常用平台</span></div><p class="note">选中的平台会显示在首页；登录成功也会自动加入常用。所有平台的入口都保留在这里。</p><div class="platform-options">${O.platforms.map(p=>`<div class="platform-option"><h3>${typeof logo==='function'?logo(p.id):''}${escape(p.name)}<small>${p.selected?'常用':'未选用'}</small></h3><p class="note">${p.native?'原生采集 · 已登记作品':'按日期发现和采集作品'}<br>${O.health?.platforms?.[p.id]?.identity?.confirmedAt?'有登录确认记录':'尚无登录确认记录'}</p><div class="btns"><button class="btn ${p.selected?'':'pri'}" data-platform-toggle="${p.id}" data-selected="${!p.selected}">${p.selected?'移出常用':'加入常用'}</button><a class="text-link" href="/p#/system/${p.id}">登录与采集 ›</a></div></div>`).join('')}</div></section>`;
}
function platformLoginHTML(s={}) {
  const state=s.loginStatus?.state || (s.state==='running'&&s.last?.type==='login'?'checking':s.identity?.confirmedAt?'logged_in':'unknown');
  const labels={logged_in:'已登录',logged_out:'未登录',checking:'正在确认登录',unknown:'登录待确认'};
  return `<span class="platform-login ${['logged_in','logged_out','checking','unknown'].includes(state)?state:'unknown'}" role="status">${labels[state]||labels.unknown}</span>`;
}
// L1 overview 不代表实时登录体检；空检查结果也不能视为全部成功。
function healthLights(h = {}) {
  if (!h || h.mode === 'l1') return `<span class="light">${h?.schedule?.enabled ? '零点自动采集' : '手动采集模式'}</span>`;
  const values = Object.values(h.login || {});
  const known = values.length > 0, ok = known && values.every(v => v === 'ok');
  const checked = !!h.doctorDay && [new Date().toLocaleDateString('zh-CN'), new Date().toLocaleDateString('sv-SE')].includes(h.doctorDay);
  return `<span class="light ${h.daemon ? 'ok' : 'warn'}">守护进程 ${h.daemon ? '运行中' : '未确认运行'}</span><span class="light ${h.nas ? 'ok' : 'warn'}">NAS ${h.nas ? '已挂载' : '未确认'}</span><span class="light ${h.chrome ? 'ok' : 'warn'}">专用浏览器 ${h.chrome ? '在线' : '未确认'}</span><span class="light ${!known ? 'warn' : !ok ? 'bad' : checked ? 'ok' : 'warn'}">平台登录 ${!known ? '未实时检查' : !ok ? '有掉线' : checked ? '今日已检' : '今天还没检'}</span>`;
}

function accountSummaryHTML(rows = [], compact = false) {
  const escape = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const show = value => value == null ? '暂无' : value.toLocaleString('zh-CN');
  const names = {x:'X',xhs:'小红书',wechat:'公众号',bilibili:'B站',douyin:'抖音',channels:'视频号',youtube:'YouTube',instagram:'Instagram'};
  if(!rows.length)return '';
  const time = at => new Date(at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false});
  const freshness = s => `<p class="note">${escape(s.freshness?.label || '更新状态未知')}</p>`;
  const heading=`<div class="ph"><h2>今日发布作品 <small>${escape(rows[0].date)} · 北京时间</small></h2>${compact?'<a class="text-link" href="/p#/traffic">查看完整统计 ›</a>':''}</div><p class="note scope-note">仅统计当天发布的作品，数字为采集时累计值；暂无不代表0，也不是全账号当日新增流量。</p>`;
  if(compact)return `<section class="panel account-summary summary-compact">${heading}<div class="cohort-grid">${rows.map(s=>`<div class="summary-account-card"><h3>${escape(names[s.platform])}<small>${escape(s.account||'未配置')}</small></h3><div class="cohort-values"><div><span>${s.collection?.coverage==='registered-only'?'登记作品':'发布作品'}</span><b>${show(s.publishedToday.count)}</b></div><div><span>累计浏览</span><b>${show(s.publishedToday.metrics.views)}</b></div></div>${freshness(s)}</div>`).join('')}</div></section>`;
  const fields=['views','likes','comments','favorites','shares'];
  const table = (keys) => `<div class="tw"><table><thead><tr><th>平台 / 账号</th>${keys.length>1?'<th>统计范围</th>':''}<th class="n">作品数</th><th class="n">浏览 / 阅读</th><th class="n">点赞</th><th class="n">评论 / 留言</th><th class="n">收藏</th><th class="n">分享</th></tr></thead><tbody>${rows.map(s=>keys.map(k=>{const r=s[k];return `<tr><td>${escape(names[s.platform])}<br><small>${escape(s.account||'未配置')}</small></td>${keys.length>1?`<td>${escape(r.label)}</td>`:''}<td class="n">${k==='crossDayDelta'?`${s.crossDayDelta.matchedWorks}/${s.observedWorks} 同ID双日`:show(r.count)}</td>${fields.map(f=>`<td class="n">${show(r.metrics[f])}</td>`).join('')}</tr>`;}).join('')).join('')}</tbody></table></div>`;
  return `<section class="panel account-summary">${heading}<h3 class="scope-title">当日发文累计</h3>${table(['publishedToday'])}<div class="summary-freshness">${rows.map(s=>`<div><strong>${escape(names[s.platform])}</strong>${freshness(s)}</div>`).join('')}</div><details class="summary-more"><summary>历史累计与跨日对比</summary><p class="note">当前作品累计：入库作品最新观测之和。跨日快照增量：同一批作品两日实测差值，不等同零点至今流量；缺少基线不按0补齐。未证明全账号完整历史。</p>${table(['currentWorks','crossDayDelta'])}</details><details class="summary-more"><summary>采集范围与观测时间</summary>${rows.map(s=>`<p class="note">${escape(names[s.platform])}：${s.observedWorks} 篇入库作品，发布日期未知 ${s.unknownPublicationDates} 篇。${s.collection?`最近检查的发布范围：${escape(time(s.collection.start))} 至 ${escape(time(s.collection.until))}；实际采集于 ${escape(time(s.collection.capturedAt))}。${s.collection.complete?'':'存在日期未知作品，汇总仍为暂无。'}`:`最近观测：${s.observedAt.to?escape(time(s.observedAt.to)):'暂无'}`} ${s.example?'示例 / 假数据':''}</p>`).join('')}</details></section>`;
}
