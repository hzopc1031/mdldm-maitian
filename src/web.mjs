// 麦田：本地网页。播种（发布）、长势（流量）、收成（转化）、粮仓（档案）
import http from 'node:http'; import crypto from 'node:crypto'; import fs from 'node:fs'; import path from 'node:path'; import { execFileSync } from 'node:child_process'; import { fileURLToPath } from 'node:url';
import { db, NAMES, STATE_CN, episodes, getEpisode, getTasks, recentLogs, getSnapshot, getMeta } from './db.mjs';
import { config } from './feishu.mjs';
import { SITE } from './site.mjs';
import { review } from './review.mjs';
import { accessEmail } from './access.mjs';
import { initLogin, sessionOk, handleLogin } from './login.mjs';
import { L1_PLATFORMS, L1_PORTS, planL1Action, launchL1, controlL1, redactL1 } from './l1-web.mjs';
import { home } from './l1-config.mjs';
import { authPage, cleanTarget, isLoopback, localRequestAllowed } from './web-auth.mjs';
import { createPrepService, BROWSER_BLOCK } from './publish-prep.mjs';
import {createPostService} from './publish-posts.mjs';
import {readPrepStatus} from './prep-status.mjs';
import {platformRules} from './platform-rules.mjs';
import { createAgeReviewReader } from './l1-age-review.mjs';
import { videoPrefillJobs } from './video-prefill-jobs.mjs';
import { videoPrefillPublications } from './video-prefill-publications.mjs';
import {ageSamplingSchema,agePlatforms,dueAgeSamples,saveAgeAttempt} from './l1-age-sampling.mjs';
import { drainProjectDrafts, prepRequestLimit } from './prep-intake.mjs';
import { l1Account } from './l1-account.mjs';
import { configuredSummaries } from './l1-summary.mjs';
import { displayNick } from './web-text.mjs';
import {collectionKey} from './l1-collection-window.mjs';
import {PLATFORM_CATALOG,platformById,selectedPlatforms,choosePlatform} from './platform-registry.mjs';

const DIR = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.resolve(DIR, '..');
const W = config.web || { port: 8787, key: '' };
const send = (res, code, body, type = 'application/json; charset=utf-8', extra = {}) => { res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store', ...extra }); res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)); };
const readPj = (dir) => { if (!dir) return null; try { return JSON.parse(fs.readFileSync(path.join(dir, 'publish.json'), 'utf8')); } catch { return null; } };
const short = (n) => (n || '').split(/[｜|]/)[0].trim();
const nickOf = (name, pj) => displayNick(name, pj?.nick);
const latest = db.prepare('SELECT * FROM metrics WHERE episode_id=? AND platform=? ORDER BY day DESC LIMIT 1');
const actions = [];   // 最近的操作（内存里）
function collectionSchedule() {
  try { const s=JSON.parse(fs.readFileSync(path.join(home,'data','l1-schedule.json'),'utf8'));return s.status==='ACTIVE' && s.automationId ? {enabled:true,time:'00:00',timezone:'Asia/Shanghai'} : {enabled:false}; } catch { return {enabled:false}; }
}
const prep = createPrepService({ db, config, home, root: ROOT, secrets: [W.key, W.widgetToken] });
const posts=createPostService({db,home,config,prep});
const videoJobs=videoPrefillJobs(db,{redact:value=>redactL1(value,[W.key,W.widgetToken])});
const videoPublications=videoPrefillPublications(db,videoJobs);
db.exec(ageSamplingSchema);
const ageReview = createAgeReviewReader(db);
const saveMeta=db.prepare('INSERT OR REPLACE INTO meta (key,value) VALUES (?,?)');
const ageSamplingEnabled=()=>getMeta('l1:age:enabled')==='true';

function launchDueAgeSampling(){
  if(!ageSamplingEnabled()||actions.some(record=>!record.done)||prep.busy())return;
  const status=l1Status(), accounts={};
  for(const platform of agePlatforms){
    const current=status[platform];
    if(!current?.selected||current.loginStatus.state!=='logged_in'||!current.identity?.confirmedAt||config.l1?.[platform]?.browserExecution===false)continue;
    try{accounts[platform]=l1Account(config,platform);}catch{}
  }
  const plan=dueAgeSamples(db,{accounts});
  if(!plan.length)return;
  saveAgeAttempt(db,plan);
  const record=launchL1({type:'age',platform:plan[0].platform,plan},{root:ROOT,secrets:[W.key,W.widgetToken],
    save:state=>{if(state.done)saveMeta.run('l1:age:last',JSON.stringify(state));}});
  actions.push(record);
}

// 无工程目录的 L1 观测不能回退到进程当前目录读取文件。
export function episodeFile(ep, rel) {
  if (!ep?.dir || typeof rel !== 'string' || !rel) return null;
  const root = path.resolve(ep.dir), file = path.resolve(root, rel), relative = path.relative(root, file);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return null;
  try { return fs.statSync(file).isFile() ? file : null; } catch { return null; }
}
export function coverFile(ep, key = '4x3') {
  if (!ep?.dir) return null;
  const snap = getSnapshot(ep.id), pj = readPj(ep.dir) || (snap && JSON.parse(snap.project));
  const covers = pj?.covers || {};
  return episodeFile(ep, covers[key] || Object.values(covers)[0]);
}
export function episodeView(ep, full = false) {
  const snap = getSnapshot(ep.id), pj = (snap && JSON.parse(snap.project)) || readPj(ep.dir) || {};
  const platforms = pj.platforms || {};
  let views = 0, inter = 0;
  const tasks = getTasks(ep.id).map(t => {
    const m = latest.get(ep.id, t.platform) || null;
    if (m) { views += m.views || 0; inter += (m.likes || 0) + (m.comments || 0) + (m.favorites || 0) + (m.shares || 0); }
    // 兼容升级前只有 account/postId/text 的 L1 快照。
    const p = platforms[t.platform] || { title: ep.name, text: pj.text };
    return { platform: t.platform, name: NAMES[t.platform] || t.platform, state: t.state, stateCn: STATE_CN[t.state] || t.state, detail: t.detail || '', url: t.url || '', updatedAt: t.updated_at,
      m: m && { day: m.day, views: m.views, likes: m.likes, comments: m.comments, favorites: m.favorites, shares: m.shares, extra: JSON.parse(m.extra || '{}') },
      ...(full ? { copy: { title: p.title || p.shortTitle || '', body: p.desc || p.body || p.text || p.description || '', tags: p.tags || p.topics || [], covers: p.covers || [] }, shot: !!episodeFile(ep, path.join('发布档案', `${t.platform}.jpg`)) } : {}) };
  });
  const out = { id: ep.id, episode: ep.episode, name: ep.name, short: short(ep.name), nick: nickOf(ep.name, pj), schedule: ep.schedule, createdAt: ep.created_at, dir: ep.dir,
    publishedAt: pj.created_at || ep.schedule || null, observedAt: snap?.taken_at || null,
    dateOnly:['xhs-visible-dom','wechat-visible-dom'].includes(pj.source)&&!Object.values(platforms).some(item=>item?.dateAccuracy==='time'),
    campaign: (JSON.stringify(platforms).match(/utm_campaign=([\w-]+)/) || [])[1] || '', covers: Object.keys(pj.covers || {}).filter(k => episodeFile(ep, pj.covers[k])), durationSec: pj.durationSec || 0, tasks, views, inter };
  if (full) {
    out.logs = recentLogs(ep.id, 200);
    out.metrics = db.prepare('SELECT day, platform, views, likes, comments, favorites, shares FROM metrics WHERE episode_id=? ORDER BY day').all(ep.id);
    out.snapshotAt = snap && snap.taken_at;
    out.ageReview = ep.episode == null ? ageReview.forEpisode(ep.id) : [];
    // 复盘：已经到了第 1/3/7 天的节点（和飞书卡片同一套算法）
    const t0 = Date.parse(ep.schedule || ep.created_at);
    out.reviews = tasks.some(t => t.state === 'published') ? [1, 3, 7].filter(a => Date.now() >= t0 + a * 864e5 || a === 1).map(a => { try { const r = review(ep, a); return { age: a, partial: Date.now() < t0 + a * 864e5, views: r.cur.views, ints: r.cur.ints, rows: r.cur.rows.map(x => ({ p: x.p, views: x.m.views, inter: x.m.likes + x.m.comments + x.m.favorites + x.m.shares })), prev: r.prev && { nick: r.prev.nick, views: r.prev.views, rows: r.prev.rows.map(x => ({ p: x.p, views: x.m.views })) }, fans: r.fans.sum, conv: r.conv || null }; } catch { return null; } }).filter(Boolean) : [];
    out.files = ['成片.mp4', '字幕.srt', '发布素材.md', 'publish.json', '发布记录.json'].filter(f => episodeFile(ep, f));
  }
  return out;
}

const ACT = { links: '取链接', mark: '标记', 'login-expired': '登录过期', upload: '上传', fill: '填写', submit: '提交', verify: '核对' };
export function feed(n = 14) {
  const names = Object.fromEntries(episodes().map(e => [e.id, e.episode])), nicks = Object.fromEntries(episodes().map(e => [e.id, nickOf(e.name, readPj(e.dir))]));
  return db.prepare('SELECT * FROM logs ORDER BY id DESC LIMIT ?').all(n).map(l => {
    let r = l.result || ''; try { const j = JSON.parse(r); r = j.status || j.note || ''; } catch {}
    return { ts: l.ts, episode: names[l.episode_id] || '', nick: nicks[l.episode_id] || '', platform: NAMES[l.platform] || l.platform || '', action: ACT[l.action] || l.action, result: STATE_CN[r] || String(r).slice(0, 40) };
  });
}
export function l1Status() {
  return Object.fromEntries(L1_PLATFORMS.map(platform => {
    let last = null;
    try { last = JSON.parse(getMeta(`l1:web:${platform}`) || 'null'); } catch {}
    const active = actions.find(a => a.platform === platform && a.type!=='age' && !a.done);
    if (!active && last?.done === false) last = { ...last, done: true, ok: false,
      error: '上次操作随工作台重启而中断，请重新登录', tail: '上次操作随工作台重启而中断，请重新登录' };
    let account; try { account=l1Account(config,platform); if(platform==='x')account='@'+account; } catch { account='尚未配置预期可见账号'; }
    const profile = path.resolve(config.l1?.[platform]?.chromeProfile || (platform==='xhs'?config.chromeProfile:null) || path.join(home, `chrome-profile-l1-${platform}`));
    let identity = null;
    try { identity = JSON.parse(getMeta(`l1:web:identity:${platform}`) || 'null'); } catch {}
    const hasIdentityHistory = !!identity;
    if (identity?.account !== account || identity?.profile !== profile) identity = null;
    // Compatibility for the persisted successful check from before identity history existed.
    if (!hasIdentityHistory && last?.done && last.ok && ['login','doctor'].includes(last.type)) {
      identity = { confirmedAt: last.endedAt, account, profile };
    }
    const lastAction = active || last;
    const loginStatus = active?.type==='login' && active.loginState!=='logged_in'
      ? {state:active.loginState==='logged_out'?'logged_out':'checking',checkedAt:active.progress?.at}
      : {state:identity?.status || (identity?.confirmedAt?'logged_in':'unknown'),checkedAt:identity?.checkedAt || identity?.confirmedAt};
    let collection = null;
    if(lastAction?.type==='collect' && lastAction.date && lastAction.done && lastAction.ok) {
      try { const saved=JSON.parse(getMeta(collectionKey(platform,l1Account(config,platform),lastAction.date)) || 'null');
        if(saved && Date.parse(saved.capturedAt)>=Date.parse(lastAction.startedAt))collection=saved;
      } catch {}
    }
    return [platform, { account, identity, loginStatus, selected:selectedPlatforms(db).includes(platform),
      port: L1_PORTS[platform], profile,
      state: active ? 'running' : 'idle', last:lastAction && {...lastAction,...(collection?{collection}:{})},
      login: '点击登录后，在电脑专用窗口完成操作；系统自动确认账号并关闭本次窗口' }];
  }));
}

// 纯本地数据读取；overview/status 均不连接浏览器。
export function overviewData() {
  const at = e => Date.parse(e.publishedAt || e.observedAt || e.createdAt) || 0;
  return {
    platforms:PLATFORM_CATALOG.map(p=>({...p,selected:selectedPlatforms(db).includes(p.id)})),
    accountSummaries: configuredSummaries(db, config, l1Account),
    episodes: episodes().map(e => episodeView(e)).sort((a, b) => at(b) - at(a) || a.id.localeCompare(b.id)),
    site: { days: db.prepare('SELECT * FROM site_daily ORDER BY day').all(), channels: db.prepare('SELECT * FROM site_channels ORDER BY revenue DESC').all(),
      campaigns: db.prepare('SELECT * FROM site_campaigns ORDER BY reg DESC').all(), campaignsOn: getMeta('siteCampaigns') === 'on' },
    metrics: db.prepare('SELECT day, episode_id, platform, views FROM metrics ORDER BY day').all(),
    followers: db.prepare("SELECT day, platform, total, gain, loss, source FROM followers WHERE day >= date('now','localtime','-40 day') ORDER BY day").all(),
    samples: db.prepare('SELECT ts, episode_id, platform, views FROM samples ORDER BY ts').all(), feed: feed()
  };
}

function widgetScript(req, file) {
  let base = `${req.headers['x-forwarded-proto'] || (req.headers['cf-visitor'] ? 'https' : 'http')}://${req.headers.host}`;
  try { base = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'tunnel.json'), 'utf8')).base || base; } catch {}
  return fs.readFileSync(path.join(ROOT, 'scripts', 'widget', file), 'utf8').replace('__MAITIAN_URL__', base).replace('__WIDGET_TOKEN__', W.widgetToken);
}
const latestPublished = () => episodes().filter(e => e.schedule && Date.parse(e.schedule) <= Date.now()).sort((a, b) => Date.parse(b.schedule) - Date.parse(a.schedule))[0];
// 手机小组件：只读汇总（粉丝、涨幅、最新一期播放、站点近 7 天），用单独的 config.web.widgetToken，只能读这一个接口
function widgetData() {
  const ORDER = ['bilibili', 'douyin', 'xhs', 'wechat', 'channels', 'youtube', 'x', 'instagram'];
  const rows = db.prepare("SELECT day, platform, total FROM followers WHERE day >= date('now','localtime','-40 day') AND total IS NOT NULL ORDER BY day").all();
  const by = {}; for (const r of rows) (by[r.platform] ||= []).push(r);
  const today = new Date().toLocaleDateString('sv-SE');
  const ago = (d, n) => { const t = new Date(d + 'T12:00:00'); t.setDate(t.getDate() - n); return t.toLocaleDateString('sv-SE'); };
  const stat = (p) => { const a = by[p]; if (!a || !a.length) return null; const last = a[a.length - 1];
    const prev = [...a].reverse().find(r => r.day < last.day), week = [...a].reverse().find(r => r.day <= ago(last.day, 7)) || (a[0] !== last ? a[0] : null);   // 记录不满 7 天就从最早一天算
    return { id: p, name: NAMES[p] || p, total: last.total, today: last.day === today && prev ? last.total - prev.total : 0, week: week ? last.total - week.total : 0, day: last.day }; };
  const platforms = ORDER.map(stat).filter(Boolean);
  const sum = k => platforms.reduce((n, p) => n + (p[k] || 0), 0);
  const now = Date.now();
  const pub = latestPublished();
  const ev = pub && episodeView(pub);
  const days = SITE ? db.prepare('SELECT * FROM site_daily WHERE day >= ? ORDER BY day').all(ago(today, 6)) : [];
  const zsz = stat('zsz');
  return { name: config.name || '麦田', owner: W.owner || '', avatar: !!W.avatar, fans: { total: sum('total'), today: sum('today'), week: sum('week') }, platforms,
    latest: ev && { title: ev.short, nick: ev.nick, views: ev.views, inter: ev.inter, hours: Math.round((now - Date.parse(pub.schedule)) / 36e5) },
    site: SITE && { name: SITE.name, users: zsz && zsz.total, reg: days.reduce((n, d) => n + (d.reg || 0), 0), vip: days.reduce((n, d) => n + (d.vip || 0), 0), revenue: days.reduce((n, d) => n + (d.revenue || 0), 0) },
    metricsDay: getMeta('metricsDay') || '', now: new Date().toISOString() };
}
const tokenEq = (a, b) => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

const widgetPage = (code) => `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>麦田小组件</title>
<style>body{font-family:-apple-system,'PingFang SC',sans-serif;margin:0;padding:22px 18px 40px;background:#f6f1e6;color:#1c1a16;line-height:1.6}h1{font-size:24px;margin:0 0 6px}ol{padding-left:20px;font-size:15px}li{margin:6px 0}
button{width:100%;height:50px;border:0;border-radius:14px;background:#1c1a16;color:#fff;font-size:17px;font-weight:800;margin:14px 0}pre{background:#fff;border-radius:12px;padding:12px;font-size:11px;max-height:220px;overflow:auto;white-space:pre-wrap;word-break:break-all}
.tip{font-size:13px;color:#7a7160}</style></head><body><h1>🌾 麦田小组件</h1>
<ol><li>App Store 安装 <b>Scriptable</b>（免费）</li><li>点下面的按钮复制脚本（自动更新的加载器，只需粘贴这一次）</li><li>打开 Scriptable → 右上角 <b>＋</b> → 粘贴 → 标题改成「麦田」；已经有「麦田」脚本的，打开它全选、粘贴覆盖</li><li>长按桌面 → 左上角 <b>＋</b> → 搜 Scriptable → 选中号 → 添加；长按小组件 → 编辑小组件 → Script 选「麦田」</li><li>锁屏：长按锁屏 → 自定 → 添加小组件 → Scriptable → 同样选「麦田」</li></ol>
<button id="b">复制脚本</button><p class="tip">以后小组件改样式，手机上会自动用上新版，不用再粘贴。脚本里带着小组件口令，只能读汇总数字（粉丝、播放、站点近 7 天），打不开麦田别的页面。别发给别人；泄露了在 config.json 换一个 widgetToken 即可。</p>
<pre id="c"></pre><script>const code=${JSON.stringify(code).replace(/</g, '\\u003c')};document.getElementById('c').textContent=code;
document.getElementById('b').onclick=async()=>{try{await navigator.clipboard.writeText(code);b.textContent='已复制 ✓';}catch{const r=document.createRange();r.selectNodeContents(c);getSelection().removeAllRanges();getSelection().addRange(r);b.textContent='长按选中的文字复制';}};</script></body></html>`;

// 缩略图：macOS 自带 sips 缩放转 JPEG，按 原文件路径+修改时间+尺寸 缓存；失败返回 null（退回原图）
function thumb(f, w) {
  try {
    const st = fs.statSync(f), dir = path.join(ROOT, 'data', 'thumbs');
    const out = path.join(dir, crypto.createHash('sha1').update(`${f}|${st.mtimeMs}|${w}`).digest('hex') + '.jpg');
    if (fs.existsSync(out)) return out;
    fs.mkdirSync(dir, { recursive: true });
    execFileSync('/usr/bin/sips', ['-Z', String(w), '-s', 'format', 'jpeg', '-s', 'formatOptions', '78', f, '--out', out], { stdio: 'ignore', timeout: 20000 });
    return fs.existsSync(out) ? out : null;
  } catch { return null; }
}

export async function handle(req, res) {
  if(req.url==='/api/video-prefill/worker'){
    const {headers,socket}=req;
    if(req.method!=='POST'||!isLoopback(socket.remoteAddress)||headers.host!==`127.0.0.1:${socket.localPort}`||
      !/^chrome-extension:\/\/[a-p]{32}$/.test(headers.origin??'')||!headers['content-type']?.startsWith('application/json'))
      return send(res,403,{error:'只接受本机预填助手回执'});
    let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>10000)return send(res,413,{error:'预填回执过大'});}
    try{
      const input=JSON.parse(raw);
      return input.action==='claim' ? send(res,200,{accounts:videoJobs.claim(input)}) :
        input.action==='receipt' ? send(res,200,{job:videoPublications.annotate(videoJobs.record(input))}) : send(res,400,{error:'未知预填请求'});
    }catch(error){return send(res,400,{error:redactL1(error.message)});}
  }
  const localOnly = W.requireLocalToken === false;
  if (localOnly) {
    if (!localRequestAllowed(req)) return send(res, 403, { error: '仅允许同源本机直连请求' });
    res.setHeader('content-security-policy', "frame-ancestors 'none'");
    res.setHeader('cross-origin-resource-policy', 'same-origin');
  }
  const u = new URL(req.url, 'http://x');
  // 访问控制：前面挂了 Cloudflare Access（邮箱验证码）就认它的登录凭证；否则用口令（第一次带 ?key= 进来，之后用 cookie）
  if (/^\/static\/icon-\d+\.png$/.test(u.pathname)) return send(res, 200, fs.readFileSync(path.join(DIR, 'web', path.basename(u.pathname))), 'image/png', { 'cache-control': 'max-age=86400' });   // 主屏幕图标不用登录
  if (u.pathname === '/api/widget/img') {   // 小组件图片：头像（config.web.avatar）或最新一期封面缩略图，同一个只读口令
    if (!W.widgetToken || !tokenEq(u.searchParams.get('t'), W.widgetToken)) return send(res, 401, '');
    let f = null;
    if (u.searchParams.get('k') === 'avatar') f = W.avatar && path.resolve(ROOT, W.avatar);
    else f = coverFile(latestPublished(), u.searchParams.get('k') || '4x3');
    if (!f || !fs.existsSync(f)) return send(res, 404, '');
    const t = thumb(f, Math.min(800, +u.searchParams.get('w') || 400));
    return send(res, 200, fs.readFileSync(t || f), t ? 'image/jpeg' : 'image/png', { 'cache-control': 'max-age=1800' });
  }
  if (u.pathname === '/api/widget/code') return W.widgetToken && tokenEq(u.searchParams.get('t'), W.widgetToken) ? send(res, 200, widgetScript(req, 'maitian-widget.js'), 'text/javascript; charset=utf-8') : send(res, 401, '');   // 加载器每次刷新来取最新代码
  if (u.pathname === '/api/widget') return W.widgetToken && tokenEq(u.searchParams.get('t') || req.headers['x-widget-token'], W.widgetToken) ? send(res, 200, widgetData()) : send(res, 401, { error: '小组件口令不对' });
  if (u.pathname === '/manifest.webmanifest') return send(res, 200, { name: config.name || '麦田', short_name: config.name || '麦田', start_url: '/', display: 'standalone', background_color: '#efe7d8', theme_color: '#efe7d8', icons: [{ src: '/static/icon-512.png', sizes: '512x512', type: 'image/png' }] }, 'application/manifest+json');
  // 飞书验证码登录（config.web.login = "feishu"）：/login 页面和接口不需要先登录
  const LOGIN = W.login === 'feishu' && config.feishuWebhook;
  if (LOGIN && await handleLogin(req, res, u, send)) return;
  const cookieKey = ((req.headers.cookie || '').match(/mt_key=([^;]+)/) || [])[1];
  const authCookie = { 'set-cookie': `mt_key=${W.key}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax`, 'referrer-policy': 'no-referrer' };
  if (u.pathname === '/auth' && req.method === 'POST') {
    if (!localOnly && req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) return send(res, 403, { error: '请求来源不符' });
    let body = '';
    for await (const chunk of req) {
      body += chunk;
      if (Buffer.byteLength(body) > 4096) return send(res, 413, { error: '请求过大' });
    }
    const form = new URLSearchParams(body);
    if (!W.key || !tokenEq(form.get('key'), W.key)) return send(res, 401, authPage(true, form.get('returnTo')), 'text/html; charset=utf-8');
    return send(res, 303, '', 'text/plain', { ...authCookie, location: cleanTarget(form.get('returnTo')) });
  }
  // 无 fragment 的重定向由浏览器继承原 hash，保留 /p#/system。
  if (W.key && u.searchParams.has('key') && (tokenEq(u.searchParams.get('key'), W.key) || tokenEq(cookieKey, W.key))) {
    return send(res, 302, '', 'text/plain', { ...authCookie, location: cleanTarget(u.pathname + u.search) });
  }
  // 小组件安装页会输出单独的口令，仍需登录。
  if ((!localOnly || u.pathname === '/widget') &&
      !(W.key && (tokenEq(req.headers['x-maitian-key'], W.key) || tokenEq(cookieKey, W.key))) &&
      !(LOGIN && sessionOk(req)) && !(await accessEmail(req, W.access))) {
    if (LOGIN) return u.pathname.startsWith('/api/') ? send(res, 401, { error: '需要登录' }) : send(res, 302, '', 'text/plain', { location: '/login' });
    return u.pathname.startsWith('/api/') ? send(res, 401, { error: '需要登录' }) : send(res, 401, authPage(), 'text/html; charset=utf-8', { 'referrer-policy': 'same-origin' });
  }
  if (u.pathname.startsWith('/static/')) { const f = path.join(DIR, 'web', path.basename(u.pathname)); if (!/\.(css|js|png)$/.test(f) || !fs.existsSync(f)) return send(res, 404, ''); return send(res, 200, fs.readFileSync(f), f.endsWith('.css') ? 'text/css; charset=utf-8' : f.endsWith('.png') ? 'image/png' : 'text/javascript; charset=utf-8'); }
  if (u.pathname === '/p') return send(res, 200, fs.readFileSync(path.join(DIR, 'web', 'pages.html')), 'text/html; charset=utf-8');
  if (u.pathname === '/board') return send(res, 200, fs.readFileSync(path.join(DIR, 'web', 'board.html')), 'text/html; charset=utf-8');
  if (u.pathname === '/') return send(res, 200, fs.readFileSync(path.join(DIR, 'web', 'board.html')), 'text/html; charset=utf-8');
  if (u.pathname === '/widget') {   // 小组件安装页（已登录才能看）：脚本里填好麦田地址和小组件口令，手机上一键复制
    if (!W.widgetToken) return send(res, 404, '<meta charset="utf-8">没配 config.web.widgetToken', 'text/html; charset=utf-8');
    return send(res, 200, widgetPage(widgetScript(req, 'maitian-loader.js')), 'text/html; charset=utf-8');
  }
  if (u.pathname === '/api/overview') {
    return send(res, 200, { name: config.name || '麦田', siteOn: !!SITE, siteName: SITE ? SITE.name : '', siteLogo: !!(SITE && config.site.logo), board: config.board && config.board.url, driver: config.driver,
      ...overviewData(), actions: actions.slice(-8).reverse(),
      health: { mode: 'l1', daemon: false, schedule:collectionSchedule(), ageSampling:{enabled:ageSamplingEnabled(),platforms:agePlatforms,last:JSON.parse(getMeta('l1:age:last')||'null')}, platforms: l1Status() }, publishPrep: prep.publicCapabilities(), now: new Date().toISOString() });
  }
  if (u.pathname === '/api/age-sampling' && req.method === 'POST') {
    if (!isLoopback(req.socket.remoteAddress)||req.headers.origin!==`http://${req.headers.host}`||!req.headers['content-type']?.startsWith('application/json')) return send(res,403,{error:'只接受麦田本机页面操作'});
    let raw='';
    for await(const chunk of req){raw+=chunk;if(raw.length>64)return send(res,413,{error:'设置内容过大'});}
    let input;try{input=JSON.parse(raw);}catch{}
    if(typeof input?.enabled!=='boolean'||Object.keys(input).length!==1)return send(res,400,{error:'请选择是否开启同龄采样'});
    saveMeta.run('l1:age:enabled',String(input.enabled));
    return send(res,200,{enabled:input.enabled});
  }
  if (u.pathname === '/api/video-prefill/assistant' && req.method==='GET') {
    const file=path.join(ROOT,'_local-video-prefill','maitian-video-prefill.zip');
    if(!fs.existsSync(file))return send(res,404,{error:'预填助手安装包尚未构建'});
    return send(res,200,fs.readFileSync(file),'application/zip',{'content-disposition':'attachment; filename="maitian-video-prefill.zip"'});
  }
  if (u.pathname === '/api/video-prefill/history' && req.method==='GET') return send(res,200,{jobs:videoJobs.history().map(videoPublications.annotate)});
  if (['/api/video-prefill/receipt','/api/video-prefill/reserve','/api/video-prefill/publication'].includes(u.pathname)) {
    if(u.pathname.endsWith('/receipt')&&req.method==='GET'){
      const id=u.searchParams.get('id');
      return send(res,200,{job:videoPublications.annotate(id ? videoJobs.get(id) : videoJobs.latest())});
    }
    if(u.pathname.endsWith('/publication')&&req.method==='GET'){
      try{return send(res,200,{candidates:videoPublications.candidates(u.searchParams.get('id'),u.searchParams.get('platform'))});}
      catch(error){return send(res,400,{error:redactL1(error.message)});}
    }
    if(req.method!=='POST'||!isLoopback(req.socket.remoteAddress)||req.headers.origin!==`http://${req.headers.host}`||
      !req.headers['content-type']?.startsWith('application/json'))return send(res,403,{error:'只接受麦田本机页面操作'});
    let raw='';
    for await(const chunk of req){raw+=chunk;if(raw.length>10000)return send(res,413,{error:'预填回执过大'});}
    try {
      const input=JSON.parse(raw);
      if (u.pathname.endsWith('/reserve')) return send(res,200,{ok:true,...videoJobs.reserve(input,platform=>l1Account(config,platform))});
      if (u.pathname.endsWith('/publication'))return send(res,200,{ok:true,publication:videoPublications.verify(input)});
      return send(res,200,{ok:true,job:videoPublications.annotate(videoJobs.record(input))});
    } catch(error) {return send(res,400,{error:redactL1(error.message,[W.key,W.widgetToken])});}
  }
  if (u.pathname === '/api/l1/status' && req.method === 'GET') return send(res, 200, { platforms: l1Status(), actions: actions.slice(-8).reverse() });
  if (u.pathname === '/api/prep/status') {
    if(!isLoopback(req.socket.remoteAddress)||!localRequestAllowed(req))return send(res,403,{code:'LOCAL_ONLY',error:'仅允许同源本机直连调用'});
    if(req.method!=='GET')return send(res,405,{error:'状态汇总仅供读取'},undefined,{allow:'GET'});
    return send(res,200,readPrepStatus(db,{config,selected:selectedPlatforms(db),capabilities:prep.publicCapabilities(),secrets:[W.key,W.widgetToken]}));
  }
  if (u.pathname === '/api/prep/rules-module' && req.method==='GET') return send(res,200,fs.readFileSync(path.join(DIR,'platform-rules.mjs')),'text/javascript; charset=utf-8');
  if (u.pathname === '/api/prep' && req.method === 'GET') return send(res, 200, { capabilities: prep.publicCapabilities(), rules:platformRules(config), records: ageReview.forRecords(prep.list()) });
  if (u.pathname === '/api/prep/contract' && req.method === 'GET') return send(res,200,{version:4,columnOnly:true,agentAttribution:'caller_reported',operationActors:true,finalPublishPlatforms:[],submit:false,manuscriptVersion:2});
  if(u.pathname.startsWith('/api/prep/posts')) {
    if(!isLoopback(req.socket.remoteAddress)||!localRequestAllowed(req))return send(res,403,{code:'LOCAL_ONLY',error:'仅允许带同源 Origin 的本机直连调用'});
    try {
      const id=u.searchParams.get('id'),platform=u.searchParams.get('platform');
      if(req.method==='GET') {
        if(u.pathname==='/api/prep/posts')return send(res,200,{ok:true,posts:posts.list()});
        if(u.pathname==='/api/prep/posts/record')return send(res,200,{ok:true,post:posts.get(id)});
        if(u.pathname==='/api/prep/posts/bundle')return send(res,200,posts.bundle(id),'application/zip',{'content-disposition':'attachment; filename="x-draft.zip"'});
        if(u.pathname==='/api/prep/posts/asset'){const file=posts.asset(id,platform,u.searchParams.get('index'));return send(res,200,fs.readFileSync(file),/\.png$/i.test(file)?'image/png':/\.webp$/i.test(file)?'image/webp':'image/jpeg',{'x-content-type-options':'nosniff'});}
      }
      if(req.method==='POST'&&u.pathname==='/api/prep/posts') {
        let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>prepRequestLimit)return send(res,413,{code:'TOO_LARGE',error:'请求过大'});}
        const a=JSON.parse(body);if(!a||Object.keys(a).some(k=>!['type','id','platform','platforms','input','actor'].includes(k)))throw Object.assign(Error('操作字段不对；不接受 submit 或发布授权'),{code:'INVALID_INPUT'});
        if(['publish','submit'].includes(a.type))return send(res,403,{code:'PUBLISH_DISABLED',error:'Liu要求最后一步由本人操作；接口只填写，不发布'});
        if(actions.some(a=>!a.done)||prep.busy()||posts.busy())return send(res,409,{code:'BUSY',error:'另一个操作正在运行，请先查状态'});
        if(a.type==='create')return send(res,200,{ok:true,post:posts.create(a.input,a.actor)});
        if(a.type==='update')return send(res,200,{ok:true,post:posts.update(a.id,a.platform,a.input,a.actor)});
        if(a.type==='generate')return send(res,202,{ok:true,post:posts.generate(a.id,a.platforms,a.actor)});
        if(a.type==='check')return send(res,200,{ok:true,...posts.check(a.id,a.platform,a.actor)});
        if(a.type==='fill')return send(res,202,{ok:true,post:posts.fill(a.id,a.platform,a.actor)});
      }
      return send(res,404,{code:'NOT_FOUND',error:'接口或动作不存在'});
    }catch(e){return send(res,e.code==='NOT_FOUND'?404:e.code==='BUSY'?409:400,{code:e.code??'PREP_FAILED',error:redactL1(e.message,[W.key,W.widgetToken])});}
  }
  if (u.pathname === '/api/prep/record' && req.method === 'GET') {
    try { return send(res,200,{ok:true,record:ageReview.forRecords([prep.get(u.searchParams.get('id'))])[0]}); }
    catch { return send(res,404,{error:'准备任务不存在'}); }
  }
  if (u.pathname === '/api/prep/bundle' && req.method === 'GET') {
    try { return send(res, 200, prep.bundle(u.searchParams.get('id')), 'application/zip', { 'content-disposition': 'attachment; filename="x-draft.zip"', 'x-content-type-options':'nosniff' }); }
    catch { return send(res, 404, {error:'文图包不存在或素材不可用'}); }
  }
  if (u.pathname === '/api/prep/x' && req.method === 'GET') {
    try {
      const r = prep.get(u.searchParams.get('id'));
      if (r.platform !== 'x') throw new Error('仅支持 X');
      const job = JSON.parse(fs.readFileSync(prep.jobFile(r.id), 'utf8'));
      return send(res, 303, '', 'text/plain', { location: `https://twitter.com/intent/tweet?text=${encodeURIComponent(job.content)}`, 'referrer-policy': 'no-referrer' });
    } catch { return send(res, 400, { error: 'X 准备任务不存在' }); }
  }
  if (u.pathname === '/api/prep/job' && req.method === 'GET') {
    try { return send(res, 200, fs.readFileSync(prep.jobFile(u.searchParams.get('id'))), 'application/json; charset=utf-8', { 'content-disposition': 'attachment; filename="job.json"' }); }
    catch { return send(res, 404, { error: '准备任务不存在' }); }
  }
  if (['/api/prep','/api/prep/image'].includes(u.pathname) && req.method === 'POST') {
    if (!isLoopback(req.socket.remoteAddress)) return send(res, 403, { error: '仅允许本机操作' });
    if (!localOnly && !W.key) return send(res, 503, { error: '请先由用户配置网页口令' });
    if (!localOnly && req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) return send(res, 403, { error: '请求来源不符' });
    if (u.pathname === '/api/prep/image') {
      const chunks=[]; let size=0;
      for await (const chunk of req) { size+=chunk.length; if(size>32*1024*1024) return send(res,413,{error:'单图不超过32MB'}); chunks.push(chunk); }
      try { return send(res,200,prep.uploadImage(u.searchParams.get('name') || '',Buffer.concat(chunks))); }
      catch(e) { return send(res,400,{error:redactL1(e.message,[W.key,W.widgetToken])}); }
    }
    let body = '';
    for await (const chunk of req) { body += chunk; if (Buffer.byteLength(body) > prepRequestLimit) return send(res, 413, { error: '请求过大' }); }
    try {
      const a = JSON.parse(body);
      if(['publish','submit'].includes(a?.type))return send(res,403,{code:'PUBLISH_DISABLED',error:'Liu 2026-11-23 11:33 要求：此入口只填写，最后发布由本人操作'});
      if (!a || Object.keys(a).some(k => !['type', 'input', 'id','actor','approval'].includes(k)) || (a.actor!==undefined&&!['check','execute','publish'].includes(a.type)) || a.approval!==undefined&&a.type!=='publish') throw new Error('操作字段不对');
      if (actions.some(a => !a.done) || prep.busy()) return send(res, 409, { error: '另一个操作还在运行' });
      if (['window','window-check'].includes(a.type)) return send(res,200,{ok:true,window:await prep.window(a.id,a.type==='window')});
      if (a.type==='release-window') return send(res,200,{ok:true,record:prep.releaseWindow(a.id)});
      const record = a.type === 'create' ? prep.create(a.input) : ['check', 'execute'].includes(a.type) ? prep.start(a.id, a.type,a.actor) : null;
      if (!record) throw new Error('不支持此操作');
      return send(res, 200, { ok: true, record });
    } catch (e) { return send(res, 400, { error: redactL1(e.message, [W.key, W.widgetToken]) }); }
  }
  if (u.pathname === '/site-logo') { const f = SITE && config.site.logo && path.resolve(ROOT, config.site.logo); return f && fs.existsSync(f) ? send(res, 200, fs.readFileSync(f), /\.svg$/.test(f) ? 'image/svg+xml' : /\.jpe?g$/.test(f) ? 'image/jpeg' : 'image/png', { 'cache-control': 'max-age=3600' }) : send(res, 404, ''); }
  if (u.pathname === '/api/episode') { const ep = getEpisode(u.searchParams.get('id')); return ep ? send(res, 200, episodeView(ep, true)) : send(res, 404, { error: '没有这一期' }); }
  if (u.pathname === '/cover' || u.pathname === '/shot') {
    const ep = getEpisode(u.searchParams.get('id')); if (!ep) return send(res, 404, '');
    const f = u.pathname === '/shot' ? episodeFile(ep, path.join('发布档案', `${(u.searchParams.get('p') || '').replace(/\W/g, '')}.jpg`)) : coverFile(ep, u.searchParams.get('k') || '4x3');
    if (!f) return send(res, 404, '');
    // 远程打开时原图（每张 ~700KB）太慢：默认给缩略图（长边 ≤ w，默认 720，JPEG），缓存在 data/thumbs；?full=1 给原图
    if (!u.searchParams.get('full') && !/\.svg$/.test(f)) { const t = thumb(f, Math.min(1600, +u.searchParams.get('w') || 720)); if (t) return send(res, 200, fs.readFileSync(t), 'image/jpeg', { 'cache-control': 'max-age=3600' }); }
    return send(res, 200, fs.readFileSync(f), /\.png$/.test(f) ? 'image/png' : /\.svg$/.test(f) ? 'image/svg+xml' : 'image/jpeg', { 'cache-control': 'max-age=300' });
  }
  if (u.pathname === '/api/platforms' && req.method === 'POST') {
    if(!isLoopback(req.socket.remoteAddress))return send(res,403,{error:'只允许本机修改平台设置'});
    if(req.headers.origin!==`http://${req.headers.host}`)return send(res,403,{error:'只允许同源平台设置请求'});
    let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>4096)return send(res,413,{error:'请求过大'});}
    try {
      if(actions.some(a=>!a.done)||prep.busy())return send(res,409,{error:'请等当前任务完成后再修改平台'});
      const a=JSON.parse(body),p=platformById(a.platform);if(!p||Object.keys(a).some(k=>!['platform','selected','account'].includes(k)))throw new Error('平台设置参数不正确');
      if(a.account!==undefined){
        if(typeof a.account!=='string'||!a.account.trim()||a.account.length>100||/[\r\n]/.test(a.account)||/cookie:|bearer\s|https?:\/\/|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/i.test(a.account))throw new Error('仅填写平台公开账号名，不填写密码、邮箱、Cookie或网址');
        const fixed=config.l1?.[p.id]?.account||(p.id==='x'?config.xHandle:null);if(fixed&&fixed!==a.account.trim())throw new Error('此账号已有配置，请保持既有账号名称');
        const file=process.env.MAITIAN_ACCOUNTS||path.join(home,'l1-accounts.local.json');let local={};if(fs.existsSync(file))local=JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));local[p.id]=a.account.trim();fs.writeFileSync(file,JSON.stringify(local,null,2));
      }
      if(a.selected!==undefined)choosePlatform(db,p.id,a.selected);
      return send(res,200,{ok:true,platforms:PLATFORM_CATALOG.map(p=>({...p,selected:selectedPlatforms(db).includes(p.id)}))});
    }catch(error){return send(res,400,{error:redactL1(error.message)});}
  }
  if (u.pathname === '/api/native-work' && req.method === 'POST') {
    if(!isLoopback(req.socket.remoteAddress))return send(res,403,{error:'只允许本机登记作品'});
    if(req.headers.origin!==`http://${req.headers.host}`)return send(res,403,{error:'只允许同源作品登记请求'});
    let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>16384)return send(res,413,{error:'内容过长'});}
    try {
      if(actions.some(a=>!a.done)||prep.busy())return send(res,409,{error:'请等当前任务完成后再登记作品'});
      const a=JSON.parse(body),p=platformById(a.platform);if(!p?.native||Object.keys(a).some(k=>!['platform','title','publishedAt','url'].includes(k)))throw new Error('请选择原生平台');
      const account=l1Account(config,p.id);if(typeof a.title!=='string'||!a.title.trim()||a.title.length>8000)throw new Error('请填写作品标题或正文第一段');
      if(typeof a.publishedAt!=='string'||!/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(a.publishedAt)||!Number.isFinite(Date.parse(a.publishedAt))||Date.parse(a.publishedAt)>Date.now())throw new Error('请填写已发布作品的真实发布时间');
      let id,url=a.url||null;
      if(p.id==='channels'&&!url)id=crypto.createHash('sha256').update(`${a.title}:${a.publishedAt}`).digest('hex').slice(0,24);
      else {
        const u=new URL(url);if(u.protocol!=='https:'||u.username||u.password||u.hash)throw new Error('请填写官方公开作品链接');
        const allowed={bilibili:['www.bilibili.com','bilibili.com'],douyin:['www.douyin.com','douyin.com'],youtube:['youtu.be','www.youtube.com'],instagram:['www.instagram.com','instagram.com'],channels:['channels.weixin.qq.com']};
        if(!allowed[p.id].includes(u.hostname))throw new Error('作品链接不属于所选平台');
        const match=p.id==='bilibili'?u.pathname.match(/^\/video\/(BV[A-Za-z0-9]{10})\/?$/):p.id==='douyin'?u.pathname.match(/^\/video\/(\d+)\/?$/):p.id==='instagram'?u.pathname.match(/^\/reel\/([\w-]+)\/?$/):null;
        id=p.id==='youtube'?(u.hostname==='youtu.be'?u.pathname.slice(1):u.searchParams.get('v')):match?.[1];
        if(p.id==='youtube'){if(!/^[\w-]{11}$/.test(id||''))throw new Error('YouTube视频ID不正确');url=`https://youtu.be/${id}`;}
        else if(p.id==='channels'){if(u.search)throw new Error('视频号可不填写链接，请勿登记带认证参数的网址');id=crypto.createHash('sha256').update(url).digest('hex').slice(0,24);}
        if(p.id!=='youtube')url=u.origin+u.pathname;
        if(!id)throw new Error('未识别作品ID，请填写完整公开链接');
      }
      const store=await import('./l1-store.mjs');store.transaction(()=>store.saveObservation({platform:p.id,account,captured_at:new Date().toISOString(),source:'manual-registration',posts:[{id,text:a.title.trim(),created_at:a.publishedAt,url,precision:'publication date and title supplied by user; metrics not yet collected'}]}));
      choosePlatform(db,p.id,true);return send(res,200,{ok:true,id:`external:${p.id}:${id}`});
    }catch(error){return send(res,400,{error:redactL1(error.message)});}
  }
  if (u.pathname === '/api/action' && req.method === 'POST') {
    if (!isLoopback(req.socket.remoteAddress)) return send(res, 403, { error: 'L1 操作只允许本机请求' });
    if (!localOnly && !W.key) return send(res, 503, { error: '请先由 Liu 配置网页口令' });
    if (!localOnly && req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) return send(res, 403, { error: '请求来源不符' });
    let body = '', tooLarge = false;
    req.on('data', d => { body += d; if (Buffer.byteLength(body) > 4096) { tooLarge = true; body = ''; } }); req.on('end', () => {
      if (tooLarge) return send(res, 413, { error: '请求过大' });
      let a; try { a = JSON.parse(body); } catch { return send(res, 400, { error: '请求格式不对' }); }
      try { planL1Action(a); } catch (error) { return send(res, 400, { error: error.message }); }
      if (a.type === 'status') return send(res, 200, l1Status()[a.platform]);
      if (['show-login', 'cancel-login'].includes(a.type)) {
        try { controlL1(actions.find(record => record.platform === a.platform && !record.done), a.type); }
        catch (error) { return send(res, 409, { error: error.message }); }
        return send(res, 200, { ok: true });
      }
      if (['doctor', 'sync'].includes(a.type) && config.l1?.[a.platform]?.browserExecution === false) return send(res, 409, { error: BROWSER_BLOCK });
      if (actions.some(x => !x.done) || prep.busy()) return send(res, 409, { error: '上一个 L1 操作还在跑，等它结束' });
      const previousIdentity = l1Status()[a.platform].identity;
      if (previousIdentity) db.prepare('INSERT OR REPLACE INTO meta (key,value) VALUES (?,?)').run(`l1:web:identity:${a.platform}`, JSON.stringify(previousIdentity));
      const rec = launchL1(a, { root: ROOT, secrets: [W.key, W.widgetToken],
        save: record => {
          db.prepare('INSERT OR REPLACE INTO meta (key,value) VALUES (?,?)').run(`l1:web:${a.platform}`, JSON.stringify(record));
          const confirmed = record.loginState==='logged_in' && record.progress?.stage==='identity_confirmed' || record.done && record.ok && ['login','doctor','collect'].includes(record.type);
          if (confirmed || record.loginState==='logged_out') {
            const { account, profile } = l1Status()[a.platform];
            const current=l1Status()[a.platform].identity;
            const checkedAt=record.progress?.at || record.endedAt || record.startedAt;
            db.prepare('INSERT OR REPLACE INTO meta (key,value) VALUES (?,?)').run(`l1:web:identity:${a.platform}`, JSON.stringify({ ...(current || {}), account, profile, status:confirmed?'logged_in':'logged_out', checkedAt, ...(confirmed?{confirmedAt:record.endedAt || checkedAt}:{}) }));
            if (record.done && record.ok && ['login','doctor'].includes(record.type)) choosePlatform(db,a.platform,true);
          }
        } });
      actions.push(rec);
      send(res, rec.done && !rec.ok ? 500 : 200, { ok: !rec.done || rec.ok, ...(rec.error ? { error: rec.error } : {}) });
    });
    return;
  }
  send(res, 404, { error: 'not found' });
}
export function startWeb() {
  const srv = http.createServer((req, res) => { handle(req, res).catch((e) => { try { send(res, 500, { error: redactL1(e.message, [W.key, W.widgetToken]) }); } catch {} }); });
  initLogin(ROOT);
  srv.listen(W.port || 8787, '127.0.0.1', () => {
    console.log(`麦田网页：http://127.0.0.1:${srv.address().port}/`);
    const ageTimer=setInterval(()=>{
      try{launchDueAgeSampling();}catch(error){console.error('同龄采样：'+redactL1(error.message,[W.key,W.widgetToken]));}
    },5*60000).unref();
    srv.once('close',()=>clearInterval(ageTimer));
    if (W.requireLocalToken === false) {
      const receive = () => {
        try { drainProjectDrafts(home, prep); }
        catch (error) { console.error('项目暂存稿导入失败：' + redactL1(error.message, [W.key, W.widgetToken])); }
      };
      receive();
      const timer = setInterval(receive, 15000).unref();
      srv.once('close', () => clearInterval(timer));
    }
  });
  srv.on('error', (e) => console.error('麦田网页没起来：' + e.message));
  return srv;
}
