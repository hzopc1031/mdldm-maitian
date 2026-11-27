// 「自有站点」接口（可选）：你自己的课程站 / 会员站。不配 config.site 就整块关掉——
// 不建课、不采站点流量和注册，网页上也不显示站点那一格和「转化」页。
//
// 站点需要提供两个接口（用浏览器里管理员登录态去调，麦田不存密码）：
//   coursesApi   GET → { courses: [{ _id, title, seriesId, visibilityStatus: 'published'|..., viewCount, publishedAt }] }
//   dashboardApi GET → { funnel: { totalRegistered }, registrationTrend: [{ date, count, vipCount }], revenueTrend: [{ date, count, revenue }],
//                        channelStats: [{ source, registeredCount, vipCount, orderCount, revenue }], campaignStats?: [{ campaign, sources, ... }] }
// 建课（上传成片）走发布插件里的站点适配器。
import { config } from './feishu.mjs';

// 启用判定：没有 base 的一律视为未启用（从没配过站点时卡片默认是关）
export function siteEnabled(s = config.site) { return !!(s && s.base) && s.enabled !== false; }
// 卡片「启用」开关看的是标志位（哪怕还没填地址），与 SITE 是否可用（要求 base）分开
export function siteOn(s = config.site) { return !!(s && s.enabled !== false); }
// 配置改动后重新计算 SITE；ES module 的 live binding 让所有 import 方自动拿到新值
export function refreshSite() {
  const s = siteEnabled() ? config.site : null;
  SITE = s && {
    name: s.name || '知识站',
    base: s.base.replace(/\/$/, ''),
    admin: s.base.replace(/\/$/, '') + (s.adminPath || '/admin'),
    coursesApi: s.coursesApi || '/api/courses?admin=1',
    dashboardApi: s.dashboardApi || '/api/admin/dashboard',
    courseUrl: (c) => s.base.replace(/\/$/, '') + (s.coursePath || '/series/{seriesId}?courseId={id}').replace('{seriesId}', c.seriesId).replace('{id}', c.id || c._id),
  };
  return SITE;
}
export let SITE = null;
SITE = refreshSite();
