import fs from 'node:fs';
import path from 'node:path';
import { home, beijingDay, validDay } from './l1-config.mjs';
const show = value => value == null ? '暂无' : String(value);
const cell = value => String(value ?? '暂无').replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ').replace(/</g, '&lt;');
export async function writeLocalReport({ date = beijingDay(), reportDir = path.join(home, 'reports') } = {}) {
  validDay(date);
  const { db } = await import('./l1-store.mjs');
  const lines = [`# L1 本地日报 ${date}`, '', '账号：X @PeanutPair / 小红书 TwoPeanuts（ai）/ 公众号（按已核验观测账号）', '', '数据按北京时间日期截取；暂无表示没有观测。此日报不发送飞书。', ''];
  let example = false;
  const wechatAccounts = db.prepare("SELECT DISTINCT extra FROM metrics WHERE platform='wechat' AND day<=?").all(date).map(row => JSON.parse(row.extra || '{}').account);
  const wechatFans = db.prepare("SELECT value FROM meta WHERE key LIKE 'l1:followers:wechat:%'").all().map(row => JSON.parse(row.value)).filter(row => beijingDay(row.captured_at) <= date).map(row => row.account);
  for (const [platform, account] of [['x', 'PeanutPair'], ['xhs', 'TwoPeanuts'], ...[...new Set([...wechatAccounts, ...wechatFans].filter(Boolean))].map(account => ['wechat', account])]) {
    const observations = db.prepare('SELECT value FROM meta WHERE key LIKE ?').all(`l1:followers:${platform}:%`).map(row => JSON.parse(row.value)).filter(row => row.account === account && beijingDay(row.captured_at) <= date).sort((a,b) => Date.parse(b.captured_at) - Date.parse(a.captured_at));
    const current = observations[0], previous = observations.find(row => current && Date.parse(row.captured_at) < Date.parse(current.captured_at));
    example ||= !!current?.example;
    const delta = current && previous ? current.total - previous.total : null;
    const wechat = platform === 'wechat';
    lines.push(`## ${wechat ? '公众号 ' : ''}${cell(account)}`, '', `粉丝：${show(current?.total)}；较上次实测新增：${delta == null ? '暂无' : (delta > 0 ? '+' : '') + delta}`, `观测时间：${show(current?.captured_at)}；基线时间：${show(previous?.captured_at)}`, '', wechat ? '| 作品 / ID | 发布时间 | 阅读 | 点赞 | 留言 | 收藏 | 分享 | 在看 | 观测时间 |' : '| 作品 / ID | 发布时间 | 浏览 | 点赞 | 评论 | 收藏 | 转发 | 引用 | 观测时间 |', '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |');
    const rows = db.prepare(`SELECT e.name,e.id,m.*,s.project FROM metrics m JOIN episodes e ON e.id=m.episode_id JOIN snapshots s ON s.episode_id=e.id WHERE m.platform=? AND m.day<=? ORDER BY m.day DESC,m.collected_at DESC`).all(platform, date);
    const seen = new Set(), retainedNotes = [];
    for (const row of rows) {
      if (seen.has(row.episode_id)) continue;
      const snapshot = JSON.parse(row.project), extra = JSON.parse(row.extra || '{}');
      if (snapshot.account !== account || extra.account !== account) continue;
      seen.add(row.episode_id); example ||= !!extra.example;
      lines.push(`| ${cell(row.name)} (${cell(snapshot.postId)}) | ${cell(snapshot.created_at)} | ${show(row.views)} | ${show(row.likes)} | ${show(row.comments)} | ${show(row.favorites)} | ${show(row.shares)} | ${show(wechat ? extra.watching : extra.quotes)} | ${cell(row.collected_at)} |`);
      const retained = Object.entries(extra.field_observed_at || {}).filter(([, time]) => time !== row.collected_at);
      if (retained.length) retainedNotes.push(`${cell(snapshot.postId)} 保留历史非空字段：${retained.map(([key,time]) => `${key}=${time}`).join('；')}。`);
    }
    if (!seen.size) lines.push('| 暂无 | 暂无 | 暂无 | 暂无 | 暂无 | 暂无 | 暂无 | 暂无 | 暂无 |');
    if (retainedNotes.length) lines.push('', ...retainedNotes, '');
    lines.push('', '来源：' + (wechat ? 'wechat-visible-dom，仅可见 DOM；数值可能四舍五入，发布日期仅精确到日；缺项暂无，收藏不由在看代替' : platform === 'x' ? 'grok-public / chrome/page，公开报告或页面可见值，精度未核实' : 'xhs-visible-dom，可见数值可能四舍五入，发布日期仅精确到日'), '');
  }
  if (example) lines.splice(2, 0, '**示例 / 假数据，不是真实账号数据。数字来自示例 JSON。**', '');
  const daily = path.join(reportDir, 'daily');
  fs.mkdirSync(daily, { recursive: true });
  const content = lines.join('\n') + '\n', file = path.join(daily, `${date}.md`);
  fs.writeFileSync(file, content, 'utf8');
  fs.writeFileSync(path.join(reportDir, 'latest.md'), content, 'utf8');
  console.log(`本地日报：${file}`);
  return file;
}
