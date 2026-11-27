// 集成配置管理：飞书群机器人、自定义知识站的合并 / 保存 / 测试。
// 只动这两块字段，写回 config.json 前备份；保存后由调用方 refreshSite() 热更新。
import fs from 'node:fs';
import { config, CFG } from './feishu.mjs';
import * as drv from './driver.mjs';

// ---------- 飞书 ----------
export function applyFeishuPatch(config, { webhook = '', login = false } = {}) {
  const hook = String(webhook || '').trim();
  // 飞书验证码登录靠 webhook 发码：没有 webhook 还开着登录，远程就再也登不进来
  if (login && !hook) throw new Error('开启飞书验证码登录前先填 webhook');
  config.feishuWebhook = hook;
  if (login) config.web = { ...(config.web || {}), login: 'feishu' };
  else if (config.web) delete config.web.login;
  return { webhook: config.feishuWebhook, login: !!(config.web && config.web.login === 'feishu') };
}

// ---------- 知识站 ----------
const SITE_DEFAULTS = { name: '知识站', adminPath: '/admin', coursesApi: '/api/courses?admin=1', dashboardApi: '/api/admin/dashboard', coursePath: '/series/{seriesId}?courseId={id}', logo: '' };
export function applySitePatch(config, p = {}) {
  const prev = config.site || {};
  const pick = (key, dflt) => p[key] !== undefined && p[key] !== null ? String(p[key]) : (prev[key] !== undefined && prev[key] !== null ? String(prev[key]) : dflt);
  const site = {
    enabled: p.enabled !== undefined ? !!p.enabled : (prev.enabled !== false),
    name: pick('name', SITE_DEFAULTS.name),
    base: pick('base', ''),
    adminPath: pick('adminPath', SITE_DEFAULTS.adminPath),
    coursesApi: pick('coursesApi', SITE_DEFAULTS.coursesApi),
    dashboardApi: pick('dashboardApi', SITE_DEFAULTS.dashboardApi),
    coursePath: pick('coursePath', SITE_DEFAULTS.coursePath),
    logo: pick('logo', SITE_DEFAULTS.logo),
  };
  // 启用时必须有站点地址；停用可以空着
  if (site.enabled && !String(site.base || '').trim()) throw new Error('先填站点地址再启用');
  config.site = site;
  return site;
}

// 写回 config.json；失败抛错（调用方负责回滚内存）
export function saveConfig(config) {
  fs.copyFileSync(CFG, CFG + '.bak');
  fs.writeFileSync(CFG, JSON.stringify(config, null, 2) + '\n');
}

// ---------- 测试（只读，用调用方给的字段，不写库） ----------
const dayStr = (t) => new Date(t + 8 * 3600e3).toISOString().slice(0, 10);
export async function testSite(fields = {}) {
  const base = String(fields.base || '').replace(/\/$/, '');
  if (!base) return { ok: false, error: '先填站点地址' };
  const admin = base + (fields.adminPath || '/admin');
  const api = fields.dashboardApi || '/api/admin/dashboard';
  try {
    const d = await drv.withTab(admin, (t) => drv.evaluate(t, `fetch(${JSON.stringify(api)},{credentials:'include'}).then(r=>r.ok?r.json():null).then(x=>x&&({reg:x.registrationTrend,rev:x.revenueTrend}))`), { wait: 8000 });
    if (!d) return { ok: false, error: '知识站后台数据没读到（管理员登录过期？）' };
    const today = dayStr(Date.now()), cut = dayStr(Date.now() - 6 * 86400e3);
    const in7 = (d0) => { const k = String(d0 || '').slice(0, 10); return k >= cut && k <= today; };
    const reg = (d.reg || []).filter(r => in7(r.date)).reduce((n, r) => n + (r.count || 0), 0);
    const revenue = (d.rev || []).filter(r => in7(r.date)).reduce((n, r) => n + (r.revenue || 0), 0);
    return { ok: true, summary: { reg, revenue } };
  } catch (e) { return { ok: false, error: e.message }; }
}
