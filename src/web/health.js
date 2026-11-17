// L1 overview 不代表实时登录体检；空检查结果也不能视为全部成功。
function healthLights(h = {}) {
  if (!h || h.mode === 'l1') return '<span class="light warn">手动采集模式</span><span class="light warn">平台登录 未实时检查</span>';
  const values = Object.values(h.login || {});
  const known = values.length > 0, ok = known && values.every(v => v === 'ok');
  const checked = !!h.doctorDay && [new Date().toLocaleDateString('zh-CN'), new Date().toLocaleDateString('sv-SE')].includes(h.doctorDay);
  return `<span class="light ${h.daemon ? 'ok' : 'warn'}">守护进程 ${h.daemon ? '运行中' : '未确认运行'}</span><span class="light ${h.nas ? 'ok' : 'warn'}">NAS ${h.nas ? '已挂载' : '未确认'}</span><span class="light ${h.chrome ? 'ok' : 'warn'}">专用浏览器 ${h.chrome ? '在线' : '未确认'}</span><span class="light ${!known ? 'warn' : !ok ? 'bad' : checked ? 'ok' : 'warn'}">平台登录 ${!known ? '未实时检查' : !ok ? '有掉线' : checked ? '今日已检' : '今天还没检'}</span>`;
}

function accountSummaryHTML(rows = []) {
  const escape = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const show = value => value == null ? '暂无' : value.toLocaleString('zh-CN');
  const names = {x:'X',xhs:'小红书',wechat:'公众号'};
  if(!rows.length)return '';
  return `<section class="panel account-summary" style="padding:18px;margin:18px 0"><h2 style="font-size:18px;margin:0 0 8px">账号今日汇总 · ${escape(rows[0].date)}（北京时间）</h2><p class="note">仅本账号已入库且已发布作品，未证明全账号完整历史。缺少数据或跨日基线显示「暂无」。</p><div class="tw"><table><thead><tr><th>平台 / 账号</th><th>口径</th><th>作品数</th><th>浏览 / 阅读</th><th>点赞</th><th>评论 / 留言</th><th>收藏</th><th>分享</th></tr></thead><tbody>${rows.map(s=>['publishedToday','currentWorks','crossDayDelta'].map(k=>{const r=s[k];return `<tr><td>${escape(names[s.platform])}<br><small>${escape(s.account || '未配置')}</small></td><td title="${escape(r.meaning)}">${escape(r.label)}</td><td>${k==='crossDayDelta'?`${s.crossDayDelta.matchedWorks}/${s.observedWorks} 同ID双日`:show(r.count)}</td>${['views','likes','comments','favorites','shares'].map(f=>`<td>${show(r.metrics[f])}</td>`).join('')}</tr>`;}).join('')).join('')}</tbody></table></div><p class="note">当日发文累计：当天发布作品截至最新观测的累计表现。当前作品累计：入库作品最新观测之和。跨日快照增量：同一批作品当日与前一日的实测差值，不等同零点至今流量；缺项不按0补齐。</p>${rows.map(s=>`<p class="note">${escape(names[s.platform])}：${s.observedWorks} 篇入库作品，发布日期未知 ${s.unknownPublicationDates} 篇；观测 ${escape(s.observedAt.from || '暂无')} 至 ${escape(s.observedAt.to || '暂无')}${s.example?'；示例 / 假数据':''}</p>`).join('')}</section>`;
}
