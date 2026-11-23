// Original local project collectors, adapted with explicit isolated-browser dependencies.
export async function collectChannelMetrics(p, { withTab, evaluate }) {
  const prefix = [p?.body, p?.desc, p?.shortTitle, p?.title]
    .map(value => typeof value === 'string' ? value.trim().split(/\r?\n/, 1)[0].slice(0, 30) : '')
    .find(Boolean);
  if (!prefix) return null;

  const n = await withTab('https://channels.weixin.qq.com/platform/post/list', tab => evaluate(tab, `(() => {
    const root = document.querySelector('wujie-app')?.shadowRoot;
    if (!root) return null;
    const matches = [...root.querySelectorAll('.post-feed-item')]
      .filter(card => card.innerText.trim().startsWith(${JSON.stringify(prefix)}));
    if (matches.length !== 1) return null;
    const metrics = {};
    for (const item of matches[0].querySelectorAll('.data-item')) {
      const kind = Object.entries({views:'eyes',likes:'outlined-like',comments:'comment',shares:'icon-share',recommend:'thumb'})
        .find(([, icon]) => item.innerHTML.includes(icon))?.[0];
      if (kind) metrics[kind] = item.innerText.trim();
    }
    return metrics;
  })()`), { wait: 14000 });
  if (!n) return null;
  return { views: num(n.views), likes: num(n.likes), comments: num(n.comments), shares: num(n.shares), extra: { 推荐: num(n.recommend) } };
}

// "1.2万" "6,017" "5.3K" → 数字
function num(s) {
  if (s == null) return null;
  const m = String(s).replace(/,/g, '').trim().match(/^([\d.]+)\s*(万|亿|K|M|w)?/i);
  if (!m) return null;
  const multiplier = { '万': 1e4, 'w': 1e4, '亿': 1e8, 'k': 1e3, 'm': 1e6 }[(m[2] || '').toLowerCase()] || 1;
  return Math.round(parseFloat(m[1]) * multiplier);
}

export function originalMetricCollectors({evaluate,withTab,sleep,SITE=null}) {
const J = JSON.stringify;
const idOf = (url, re) => ((url || '').match(re) || [])[1] || '';

return {
  async bilibili({ url, p }) {
    const bvid = idOf(url, /video\/(BV\w+)/);
    const st = await withTab('https://member.bilibili.com/platform/upload-manager/article', (t) => evaluate(t, `fetch('/x/web/archives?status=is_pubing%2Cpubed%2Cnot_pubed&pn=1&ps=50&coop=1',{credentials:'include'}).then(r=>r.json()).then(x=>{const a=(x.data&&x.data.arc_audits||[]).find(a=>a.Archive.bvid===${J(bvid)});return a&&a.stat?{...a.stat,publicationId:a.Archive.state===0?a.Archive.bvid:null}:null})`));
    return st && { views: st.view, likes: st.like, comments: st.reply, favorites: st.favorite, shares: st.share, publicationId:st.publicationId, extra: { 投币: st.coin, 弹幕: st.danmaku } };
  },
  async xhs({ url, p }) {
    const id = idOf(url, /explore\/(\w+)/);
    const n = await withTab('https://creator.xiaohongshu.com/new/note-manager', (t) => evaluate(t, `(()=>{const c=[...document.querySelectorAll('.note-card')].find(c=>{let i='';try{i=JSON.parse(c.getAttribute('data-impression')).noteTarget.value.noteId}catch(e){};return (${J(id)}&&i===${J(id)})||((c.querySelector('.note-card__title')||{}).innerText||'').trim()===${J(p.title)}});return c?[...c.querySelectorAll('.note-card__stat')].map(e=>e.innerText.trim()):null})()`), { wait: 12000 });
    // 图标没有文字标签，按页面顺序：浏览、评论、点赞、收藏、分享
    return n && n.length >= 5 && { views: num(n[0]), comments: num(n[1]), likes: num(n[2]), favorites: num(n[3]), shares: num(n[4]) };
  },
  async douyin({ url, p }) {
    const id = idOf(url, /video\/(\d+)/);
    const st = await withTab('https://creator.douyin.com/creator-micro/content/manage', async (t) => { for (let i = 0; i < 15 && !(await evaluate(t, `document.querySelectorAll('[class*=video-card-info]').length`).catch(() => 0)); i++) await sleep(2000); await sleep(1500); return evaluate(t, `(()=>{for(const c of document.querySelectorAll('[class*=video-card-info]')){const k=Object.keys(c).find(k=>k.startsWith('__reactFiber'));let f=c[k];for(let i=0;i<25&&f;i++,f=f.return){const pr=f.memoizedProps;if(!pr)continue;const v=Object.values(pr).find(v=>v&&typeof v==='object'&&v.aweme_id&&v.desc!==undefined);if(v){if((${J(id)}&&v.aweme_id===${J(id)})&&v.statistics){const links=[...c.querySelectorAll('a[href]')].filter(a=>a.getClientRects().length).map(a=>new URL(a.href));const linked=links.some(u=>u.origin==='https://www.douyin.com'&&u.pathname==='/video/'+${J(id)});return {...v.statistics,publicationId:linked&&c.innerText.split(String.fromCharCode(10)).some(t=>/^(已发布|公开)$/.test(t.trim()))?${J(id)}:null};}break;}}}return null})()`); }, { wait: 6000 });
    return st && { views: st.play_count, likes: st.digg_count, comments: st.comment_count, favorites: st.collect_count, shares: st.share_count, publicationId:st.publicationId };
  },
  channels: ({ p }) => collectChannelMetrics(p, { withTab, evaluate }),
  async youtube({ url, p }) {
    const id = idOf(url, /youtu\.be\/([\w-]+)/);
    const c = await withTab('https://studio.youtube.com/', async (t) => {
      await evaluate(t, `(location.href = location.href.replace(/(\\/channel\\/[^/]+).*/, '$1/videos/upload'), 1)`); await sleep(10000);
      return evaluate(t, `(()=>{const r=[...document.querySelectorAll('ytcp-video-row')].find(r=>{const a=r.querySelector('a[href*="/video/"]');return (${J(id)}&&a&&new URL(a.href).pathname.split('/')[2]===${J(id)})});if(!r)return null;const g=(k)=>((r.querySelector('.tablecell-'+k)||{}).innerText||'').trim();return {views:g('views'),comments:g('comments'),likes:g('likes'),publicationId:/^(Public|公开)$/i.test(g('visibility'))?${J(id)}:null}})()`);
    }, { wait: 9000 });
    return c && { views: num(c.views), comments: num(c.comments), likes: num(c.likes), publicationId:c.publicationId };
  },
  // X：视频帖 + 它引用的长文帖子一起算（长文链接记在任务备注里「长文 https://x.com/…/status/…」）
  async x({ url, detail }) {
    const one = async (u) => {
      if (!/status\/\d+/.test(u || '')) return null;
      const label = await withTab(u, (t) => evaluate(t, `(()=>{const a=document.querySelector('article');const g=a&&a.querySelector('[role=group][aria-label]');return g?g.getAttribute('aria-label'):null})()`), { wait: 10000 });
      if (!label) return null;
      const g = (k) => num((label.match(new RegExp('([\\d,.]+[KM]?)\\s+' + k, 'i')) || [])[1]) ?? 0;
      return { views: g('views?'), likes: g('likes?'), comments: g('repl(?:y|ies)'), favorites: g('bookmarks?'), shares: g('reposts?') };
    };
    const v = await one(url);
    const art = ((detail || '').match(/长文\s*(https:\/\/x\.com\/[^\s（）()]+?\/status\/\d+)/) || [])[1];
    if (!art || art === url) return v;
    await sleep(2000);
    const a = await one(art);
    if (!v && !a) return null;
    const sum = (k) => (v?.[k] ?? 0) + (a?.[k] ?? 0);
    return { views: sum('views'), likes: sum('likes'), comments: sum('comments'), favorites: sum('favorites'), shares: sum('shares'),
      extra: { 视频帖播放: v?.views ?? null, 长文播放: a?.views ?? null } };
  },
  async instagram({ url }) {   // 在自己登录的页面里读这条 Reels 的作品信息（播放、赞、评论、转发）
    const sc = idOf(url, /\/reel\/([\w-]+)/); if (!sc) return null;
    const m = await withTab(url, (t) => evaluate(t, `(async()=>{const A='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';let pk=0n;for(const c of ${J(sc)})pk=pk*64n+BigInt(A.indexOf(c));
      const r=await fetch('/api/v1/media/'+pk+'/info/',{credentials:'include',headers:{'X-IG-App-ID':'936619743392459'}});if(!r.ok)return null;const it=((await r.json()).items||[])[0];
      return it?{owner:it.user&&it.user.username,views:it.play_count??it.ig_play_count,likes:it.like_count,comments:it.comment_count,shares:it.reshare_count,publicationId:it.user?.is_private===false&&it.code===${J(sc)}?it.code:null}:null})()`), { wait: 6000 });
    return m && { owner:m.owner, views: m.views ?? null, likes: m.likes ?? null, comments: m.comments ?? null, shares: m.shares ?? null, publicationId:m.publicationId };
  },
  async zsz({ url, p }) {
    const id = idOf(url, /courseId=(\w+)/);
    if (!SITE) return null;
    const c = await withTab(SITE.admin, (t) => evaluate(t, `fetch(${J(SITE.coursesApi)},{credentials:'include'}).then(r=>r.json()).then(x=>{const c=(x.courses||[]).find(c=>c._id===${J(id)}||c.title===${J(p.title)});return c?{views:c.viewCount||0}:null})`));
    return c && { views: c.views };
  },
};

}
export function originalFollowerCollectors({evaluate,withTab,sleep,config,SITE=null,num}) {
const dayOf = (d) => { const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
const today = () => dayOf(Date.now());
const get = (u) => `fetch(${JSON.stringify(u)},{credentials:'include'}).then(r=>r.json())`;
// 视频号页面在 shadow DOM 里，按文字节点读
const SHADOW_TEXT = `(()=>{const R=document.querySelector('wujie-app')&&document.querySelector('wujie-app').shadowRoot;if(!R)return '';const w=document.createTreeWalker(R,NodeFilter.SHOW_TEXT);let s=[],x;while(x=w.nextNode()){const p=x.parentElement;if(p&&/STYLE|SCRIPT/.test(p.tagName))continue;const v=x.textContent.trim().replace(/\\s+/g,' ');if(v)s.push(v)}return s.join(' | ')})()`;

return {
  async bilibili() {
    const r = await withTab('https://member.bilibili.com/platform/home', (t) => evaluate(t, `Promise.all([${get('/x/web/index/stat')},${get('/x/web/data/v2/overview/stat/graph?period=2&s_locale=zh_CN&type=fan')}]).then(([a,b])=>({total:a.data&&a.data.total_fans,inc:a.data&&a.data.incr_fans,tend:(b.data&&b.data.tendency)||[]}))`));
    return r && r.total != null && { total: r.total, todayNet: r.inc || 0, history: r.tend.map(x => ({ day: dayOf(x.date_key * 1000), net: x.total_inc })) };
  },
  async douyin() {
    const n = await withTab('https://creator.douyin.com/creator-micro/home', async (t) => { await sleep(3000); return evaluate(t, `${get('/web/api/media/user/info/')}.then(x=>x.user&&x.user.follower_count)`); });
    return n != null && { total: n, history: [] };
  },
  async xhs() {
    return withTab('https://creator.xiaohongshu.com/statistics/fans-data', async t => {
      for (let i = 0; i < 6; i++) {
        await sleep(1800 + Math.random() * 1400);
        const identity = await evaluate(t, `(${visibleIdentity.toString()})()`);
        if (identity.login || (identity.nickname && identity.nickname !== 'TwoPeanuts')) throw new Error('小红书可见身份不是 TwoPeanuts，停止采集');
        if (identity.nickname !== 'TwoPeanuts') continue;
        const total = parseVisibleNumber(await evaluate(t, `(${visibleFans.toString()})()`));
        if (total != null) return { total, history: [] };
      }
      throw new Error('未读到 TwoPeanuts 可见身份或粉丝总数，不写入数据');
    });
  },
  async channels() {
    const text = await withTab('https://channels.weixin.qq.com/platform/statistic/follower', async (t) => { for (let i = 0; i < 8; i++) { await sleep(2000); const s = await evaluate(t, SHADOW_TEXT).catch(() => ''); if (/关注者总数 \| \d/.test(s) && /\d{4}\/\d+\/\d+ \|/.test(s)) return s; } return evaluate(t, SHADOW_TEXT); }, { wait: 9000 });
    const total = num(((text || '').match(/关注者总数 \| ([\d,.万]+)/) || [])[1]); if (total == null) return null;
    const history = [...text.matchAll(/(\d{4})\/(\d{1,2})\/(\d{1,2}) \| (-?[\d,]+) \| ([\d,]+) \| ([\d,]+) \| ([\d,]+)/g)].map(m => ({ day: `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`, total: num(m[7]), gain: num(m[5]), loss: num(m[6]) }));
    return { total, history };
  },
  async youtube() {
    const text = await withTab('https://studio.youtube.com/', async (t) => { for (let i = 0; i < 8; i++) { await sleep(2500); const s = await evaluate(t, `document.body.innerText`).catch(() => ''); if (/当前订阅人数|Current subscribers/.test(s)) return s; } return ''; }, { wait: 9000 });
    const total = num(((text || '').match(/(?:当前订阅人数|Current subscribers)\s*\n?\s*([\d,.]+\s*[万KM]?)/) || [])[1]);
    return total != null && { total, history: [] };
  },
  async x() {
    if (!config.xHandle) return null;
    const s = await withTab(`https://x.com/${config.xHandle}`, async (t) => { for (let i = 0; i < 6; i++) { await sleep(2000); const v = await evaluate(t, `(document.querySelector('a[href$="/verified_followers"],a[href$="/followers"]')||{}).innerText||''`).catch(() => ''); if (v) return v; } return ''; }, { wait: 9000 });
    const total = num((s || '').replace(/\n/g, ' ')); return total != null && { total, history: [] };
  },
  async instagram() {   // 读自己主页上的「×× 粉丝」（接口有频率限制，不调）
    const n = await withTab('https://www.instagram.com/', async (t) => {
      let u = null;
      for (let i = 0; i < 8 && !u; i++) { await sleep(2000); u = await evaluate(t, `(()=>{const i=[...document.querySelectorAll('a[href] img[alt]')].find(i=>/的头像|profile picture/i.test(i.alt)&&i.getBoundingClientRect().x<150);return i?i.closest('a').getAttribute('href'):null})()`).catch(() => null); }
      if (!u) return null;
      await evaluate(t, `(location.href=${JSON.stringify(u)},1)`);
      for (let i = 0; i < 8; i++) { await sleep(2500); const v = await evaluate(t, `(document.body.innerText.match(/([\\d,.]+\\s*[万KM]?)\\s*(?:粉丝|位粉丝|followers)/i)||[])[1]||''`).catch(() => ''); if (v) return v; }
      return null;
    }, { wait: 6000 });
    const total = num(n); return total != null && { total, history: [] };
  },
  async zsz() {   // 知识站的「粉丝」= 注册用户
    if (!SITE) return null;
    const r = await withTab(SITE.admin, (t) => evaluate(t, `${get(SITE.dashboardApi)}.then(x=>({total:x.funnel.totalRegistered,trend:x.registrationTrend||[]}))`));
    return r && r.total != null && { total: r.total, todayNet: (r.trend[r.trend.length - 1] || {}).count || 0, history: r.trend.slice(0, -1).map(x => ({ day: x.date, net: x.count, gain: x.count, loss: 0 })) };
  },
};

}
