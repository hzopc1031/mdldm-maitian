// 仅已渲染 DOM；不读取页面脚本、框架对象、网络响应或浏览器存储。
export function visibleWechatIdentity() {
  const visible = el => { const r = el.getBoundingClientRect(), s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const names = [...new Set([...document.querySelectorAll('.weui-desktop-account__nickname, .weui-desktop-account__name, .account_meta .nickname, #accountNickName')].filter(visible).map(el => el.innerText.trim()).filter(Boolean))];
  return { names, trustedOrigin: location.origin === 'https://mp.weixin.qq.com', login: /扫码登录|扫描二维码登录|重新登录|登录已过期/.test(document.body?.innerText || '') };
}
export function visibleWechatFollowers() {
  const visible = el => { const r = el.getBoundingClientRect(), s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const results = [];
  for (const label of [...document.querySelectorAll('span, div, p, dt')].filter(visible).filter(el => /^(?:总用户数|用户总数|累计关注人数|总关注人数|总粉丝数|粉丝总数)$/.test(el.innerText.trim()))) {
    for (const box of [label.parentElement, label.parentElement?.parentElement].filter(Boolean)) {
      const values = box.innerText.split('\n').map(s => s.trim()).filter(s => /^[\d,]+(?:\.\d+)?\s*[万亿kKmM]?$/.test(s));
      if (values.length === 1) { results.push(values[0]); break; }
    }
  }
  const unique = [...new Set(results)];
  return unique.length === 1 ? unique[0] : null;
}
export function visibleWechatArticles() {
  const visible = el => { const r = el.getBoundingClientRect(), s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const selector = '.weui-desktop-mass-appmsg, .appmsg-card, .appmsg_item, tr[data-id], tr[data-appmsgid], .weui-desktop-table tbody tr';
  const cards = [...document.querySelectorAll(selector)].filter(visible);
  return cards.filter(card => !cards.some(other => other !== card && card.contains(other))).map(card => {
    let id = card.getAttribute('data-appmsgid') || card.getAttribute('data-mid') || card.getAttribute('data-id'), url = null;
    // 只输出不含 query/hash 的文章 permalink；后台含凭据链接绝不返回给 Node。
    for (const link of [...card.querySelectorAll('a[href]')].filter(visible)) {
      try {
        const u = new URL(link.getAttribute('href'), 'https://mp.weixin.qq.com');
        if (u.protocol !== 'https:' || u.hostname !== 'mp.weixin.qq.com' || u.username || u.password || u.port) continue;
        if (/^\/s\/[\w-]+$/.test(u.pathname) && !u.search && !u.hash) { url = `https://mp.weixin.qq.com${u.pathname}`; id ||= u.pathname.slice(3); }
        if (!id && u.pathname === '/s') {
          const mids = [...u.searchParams.getAll('mid'), ...u.searchParams.getAll('appmsgid')];
          const idx = u.searchParams.get('idx');
          if (mids.length === 1 && /^\d+$/.test(mids[0]) && (!idx || /^\d+$/.test(idx))) id = mids[0] + (idx ? `_${idx}` : '');
        }
      } catch { /* 非文章链接 */ }
    }
    const idx = card.getAttribute('data-idx');
    if (id && idx && /^\d+$/.test(idx)) id += `_${idx}`;
    const titleNode = [...card.querySelectorAll('.weui-desktop-mass-appmsg__title, .appmsg_title, .appmsg-title, [data-field="title"]')].find(visible);
    const text = titleNode?.innerText.trim() || '';
    const lines = card.innerText.split('\n').map(s => s.trim()).filter(Boolean);
    const dateLines = lines.filter(s => /^(?:(?:发表|发布|群发)(?:时间|于)?\s*[:：]?\s*)?20\d{2}[年/.-]\d{1,2}[月/.-]\d{1,2}日?(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?$/.test(s));
    const dates = [...new Set(dateLines.map(s => { const m = s.match(/(20\d{2})[年/.-](\d{1,2})[月/.-](\d{1,2})/); return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`; }))];
    const stats = [];
    for (const label of [...card.querySelectorAll('span, div, p, dt')].filter(visible)) {
      const value = label.innerText.trim();
      if (/^(?:阅读(?:人数|次数|量)?|浏览(?:量)?|点赞(?:数)?|赞|留言(?:数|人数)?|评论(?:数)?|分享(?:数|人数|次数)?|转发(?:数)?|在看(?:数|人数)?)$/.test(value)) {
        const values = label.parentElement.innerText.split('\n').map(s => s.trim());
        if (values.length === 2 && values.includes(value)) stats.push([value, values.find(s => s !== value)]);
      }
      if (/^(?:阅读(?:人数|次数|量)?|浏览量|点赞(?:数)?|赞|留言(?:数|人数)?|评论(?:数)?|分享(?:数|人数|次数)?|转发(?:数)?|在看(?:数|人数)?)\s*[:：]\s*[^\n]+$/.test(value)) stats.push(value.split(/\s*[:：]\s*/));
    }
    // 表格必须用可见列标题配对，绝不猜测第几列对应哪个指标。
    const table = card.closest('table');
    const headers = table ? [...table.querySelectorAll('thead th')].filter(visible) : [];
    const cells = [...card.querySelectorAll('td')].filter(visible);
    if (headers.length === cells.length) headers.forEach((header, i) => stats.push([header.innerText.trim(), cells[i].innerText.trim()]));
    return { id: id && /^[\w-]+$/.test(id) ? id : null, url, text, date: dates.length === 1 ? dates[0] : null, stats, state: /草稿|审核中|未发表|未发布|已删除|已撤回/.test(card.innerText) ? 'skipped' : 'published' };
  });
}
export function clickWechatSection(section) {
  const labels = section === 'followers' ? ['用户分析', '用户增长'] : section === 'posts' ? ['内容分析', '发表记录', '已发表'] : [];
  const visible = el => { const r = el.getBoundingClientRect(), s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  if (location.origin !== 'https://mp.weixin.qq.com') return false;
  for (const label of labels) {
    const matches = [...document.querySelectorAll('a, button, [role="menuitem"], .weui-desktop-menu__name')].filter(visible).filter(el => el.innerText.trim() === label && !el.disabled && el.getAttribute('aria-disabled') !== 'true');
    if (matches.length === 1) { matches[0].click(); return true; }
  }
  return false;
}
export function advanceWechatArticles() {
  const visible = el => { const r = el.getBoundingClientRect(), s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const next = [...document.querySelectorAll('button, a')].filter(visible).filter(el => /^(?:下一页|下页)$/.test(el.innerText.trim()) || /^(?:下一页|next page)$/i.test(el.getAttribute('aria-label') || ''));
  if (next.length === 1) {
    const el = next[0];
    if (!el.disabled && el.getAttribute('aria-disabled') !== 'true' && !/disabled/.test(el.className)) { el.click(); return 'next'; }
    return 'end';
  }
  // 没有明确的末页/空态不推断采集完成；滚动交给浏览器自然加载。
  if ([...document.querySelectorAll('.weui-desktop-pagination__num, .weui-desktop-empty, .weui-desktop-loadmore')].filter(visible).some(el => /^(?:共\s*1\s*页|1\s*\/\s*1|没有更多(?:了)?|暂无数据|暂无发表记录)$/.test(el.innerText.trim()))) return 'end';
  const scroller = document.scrollingElement || document.documentElement;
  const atEnd = scroller.scrollTop + innerHeight >= scroller.scrollHeight - 12;
  window.scrollBy({ top: Math.max(400, innerHeight * 0.75), behavior: 'smooth' });
  return atEnd ? 'unconfirmed' : 'scroll';
}
export function wechatNumber(value) {
  if (value == null) return null;
  const m = String(value).trim().replace(/,/g, '').match(/^(\d+(?:\.\d+)?)\s*([万亿kKmM])?$/);
  if (!m) return null;
  const n = Math.round(Number(m[1]) * ({ 万: 1e4, 亿: 1e8, k: 1e3, m: 1e6 }[(m[2] || '').toLowerCase()] || 1));
  return Number.isSafeInteger(n) ? n : null;
}
export function wechatMetrics(stats) {
  const labels = { views: /^(?:阅读(?:人数|次数|量)?|浏览量?)$/, likes: /^(?:点赞(?:数)?|赞)$/, comments: /^(?:留言(?:数|人数)?|评论(?:数)?)$/, shares: /^(?:分享(?:数|人数|次数)?|转发(?:数)?)$/, watching: /^在看(?:数|人数)?$/ };
  return Object.fromEntries(Object.entries(labels).map(([key, pattern]) => {
    const values = [...new Set(stats.filter(([label]) => pattern.test(label)).map(([, value]) => wechatNumber(value)))];
    return [key, values.length === 1 ? values[0] : null];
  }));
}
