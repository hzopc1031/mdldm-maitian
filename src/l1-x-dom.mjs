// 序列化到 Runtime.evaluate 的函数只读取已渲染 DOM；不读取 storage/框架状态或调用 X 接口。
export function visibleXIdentity() {
  const visible = el => { const r = el.getBoundingClientRect(), s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden'; };
  // 只认当前账号切换器，不把正在浏览的主页作者当作登录账号。
  const controls = [...document.querySelectorAll('[data-testid="SideNav_AccountSwitcher_Button"]')].filter(visible);
  const handles = [...new Set(controls.flatMap(el => {
    const tagged = (el.innerText || '').match(/@[A-Za-z0-9_]+/g) || [];
    if (tagged.length) return tagged;
    // 没有 @ 时只接受明确的屏幕账号节点，不把显示名称猜成登录账号。
    return [...el.querySelectorAll('[data-testid="UserScreenName"]')].filter(visible)
      .map(node => node.innerText.trim()).filter(text => /^[A-Za-z0-9_]+$/.test(text));
  }))];
  const login = [...document.querySelectorAll('input[autocomplete="username"], [data-testid="loginButton"], a[href="/i/flow/login"]')].some(visible) ||
    /电子邮箱或用户名|Phone, email, or username|手机号码、邮箱地址或用户名/.test(document.body?.innerText || '') && [...document.querySelectorAll('input[type="text"],input[name="text"]')].some(visible);
  return { handle: handles.length === 1 ? handles[0] : null, url: location.href, login: !handles.length && login };
}

export function visibleXFollowers(account) {
  const visible = el => { const r = el.getBoundingClientRect(), s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden'; };
  return [...document.querySelectorAll('a[href$="/verified_followers"],a[href$="/followers"]')]
    .filter(visible).filter(a => new RegExp(`^/${account}/(?:verified_followers|followers)$`,'i').test(new URL(a.href, location.href).pathname))
    .map(a => a.innerText.trim());
}

export function visibleXPosts() {
  const visible = el => { const r = el.getBoundingClientRect(), s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden'; };
  const result = [];
  for (const article of document.querySelectorAll('article')) {
    if (!visible(article)) continue;
    const owned = el => el.closest('article') === article && !el.closest('[data-testid="quoteTweet"],div[role="link"]');
    const header = [...article.querySelectorAll('[data-testid="User-Name"]')].find(el => visible(el) && owned(el));
    const authorLinks = header ? [...header.querySelectorAll('a[href]')].filter(visible) : [];
    const author = authorLinks.map(a => new URL(a.href, location.href).pathname.match(/^\/([A-Za-z0-9_]+)$/)?.[1]).find(Boolean) || null;
    // 主帖的 time/permalink 必须来自主帖头；排除引用卡片中的链接/时间。
    const time = [...article.querySelectorAll('time')].find(el => visible(el) && owned(el));
    const link = time?.closest('a[href]') || [...article.querySelectorAll('a[href]')].find(el => visible(el) && owned(el) && !el.closest('[data-testid="tweetText"]') && /^\/[A-Za-z0-9_]+\/status\/\d+$/.test(new URL(el.href, location.href).pathname));
    let match = null;
    if (link) { const u = new URL(link.href, location.href); if (['x.com', 'www.x.com', 'twitter.com'].includes(u.hostname)) match = u.pathname.match(/^\/([A-Za-z0-9_]+)\/status\/(\d+)$/); }
    const context = [...article.querySelectorAll('[data-testid="socialContext"]')].filter(el => visible(el) && owned(el)).map(el => el.innerText).join(' ');
    const repost = /reposted|retweeted|转推|转帖|转发了|已转帖|リポスト/i.test(context) || [...article.querySelectorAll('[data-testid="socialContext"] [data-testid="retweet"]')].some(el => visible(el) && owned(el));
    // 回复提示是正文外的渲染文本；正文中提到 “Replying to” 不算回复。
    const reply = [...article.querySelectorAll('[data-testid="replyingTo"], div, span')].some(el => visible(el) && owned(el) && !el.closest('[data-testid="tweetText"]') && !el.querySelector('[data-testid="tweetText"]') &&
      (el.getAttribute('data-testid') === 'replyingTo' || /^(?:Replying to\s+@|回复\s*@|返信先[:：])/i.test((el.innerText || '').trim())));
    const text = [...article.querySelectorAll('[data-testid="tweetText"]')].find(el => owned(el))?.innerText || '';
    const quote = [...article.querySelectorAll('[data-testid="quoteTweet"],div[role="link"]')].some(el => visible(el) &&
      [...el.querySelectorAll('a[href]')].some(a => visible(a) && /^\/[A-Za-z0-9_]+\/status\/\d+$/.test(new URL(a.href, location.href).pathname)));
    result.push({ id: match?.[2] || null, author, permalinkAuthor: match?.[1] || null,
      url: match ? `https://x.com/${match[1]}/status/${match[2]}` : null,
      created_at: time?.getAttribute('datetime') || null, text, kind: repost ? 'repost' : reply ? 'reply' : quote ? 'quote' : 'original' });
  }
  return result;
}

export function visibleXMetricLabel(id, account) {
  const visible = el => { const r = el.getBoundingClientRect(), s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden'; };
  for (const article of document.querySelectorAll('article')) {
    if (!visible(article)) continue;
    // 目标必须是主帖时间链接，不能仅因引用卡片含目标 permalink 而选中别的 article。
    const times = [...article.querySelectorAll('time')].filter(el => visible(el) && el.closest('article') === article && !el.closest('[data-testid="quoteTweet"],div[role="link"]'));
    const matched = times.some(el => {
      const a = el.closest('a[href]'); if (!a) return false;
      const u = new URL(a.href, location.href);
      return ['x.com', 'www.x.com', 'twitter.com'].includes(u.hostname) && u.pathname.toLowerCase() === `/${account}/status/${id}`.toLowerCase();
    });
    if (!matched) continue;
    return [...article.querySelectorAll('[role="group"][aria-label]')].find(el => visible(el) && el.closest('article') === article && !el.closest('[data-testid="quoteTweet"],div[role="link"]'))?.getAttribute('aria-label') || null;
  }
  return null;
}

export function scrollXProfile() {
  const el = document.scrollingElement || document.documentElement;
  const atEnd = el.scrollTop + innerHeight >= el.scrollHeight - 12;
  window.scrollBy({ top: Math.max(400, innerHeight * 0.7), behavior: 'smooth' });
  return atEnd;
}

// 与原 metrics.num 的公开数值换算一致，缺项一律 null。
export function xNumber(value) {
  if (value == null) return null;
  const m = String(value).replace(/,/g, '').trim().match(/^(\d+(?:\.\d+)?)\s*([万亿KMW])?(?:\s|$)/i);
  return m ? Math.round(Number(m[1]) * ({ 万: 1e4, 亿: 1e8, k: 1e3, m: 1e6, w: 1e4 }[(m[2] || '').toLowerCase()] || 1)) : null;
}
export function parseXLabel(label) {
  const fields = { views: 'views?|次观看|次查看|次浏览', likes: 'likes?|个赞|次点赞', comments: 'repl(?:y|ies)|条回复|次回复', favorites: 'bookmarks?|次书签|个书签', shares: 'reposts?|retweets?|次转帖|次转推' };
  return Object.fromEntries(Object.entries(fields).map(([key, names]) => [key, xNumber((String(label || '').match(new RegExp(`([\\d,.]+\\s*[KMW万亿]?)\\s*(?:${names})(?=\\b|[,，]|$|\\s)`, 'i')) || [])[1])]));
}

export function selectXPosts(cards, now = new Date(), account) {
  if(!/^[A-Za-z0-9_]{1,15}$/.test(account || ''))throw new Error('需要已校验的 X 预期账号');
  const posts = new Map(), skipped = { unknownTime: 0, outsideWindow: 0, excluded: 0 };
  for (const card of cards) {
    if (!/^\d+$/.test(card.id || '') || card.author?.toLowerCase() !== account?.toLowerCase() || card.permalinkAuthor?.toLowerCase() !== account?.toLowerCase() || !['original', 'quote'].includes(card.kind)) { skipped.excluded++; continue; }
    if (!card.created_at || !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(card.created_at) || !Number.isFinite(Date.parse(card.created_at))) { skipped.unknownTime++; continue; }
    const age = new Date(now).getTime() - Date.parse(card.created_at);
    if (age < 0 || age > 30 * 86400000) { skipped.outsideWindow++; continue; }
    posts.set(card.id, { ...card, url: `https://x.com/${account}/status/${card.id}` });
  }
  return { posts: [...posts.values()], skipped };
}
