import {beijingDay, validDay} from './l1-config.mjs';

export function dayWindow(date = beijingDay(), until = new Date()) {
  validDay(date);
  const start = Date.parse(date + 'T00:00:00+08:00');
  const end = Math.min(start + 864e5, new Date(until).getTime());
  if (!Number.isFinite(end) || end < start) throw new Error('采集日期不能晚于采集截止时间');
  return {scope:'day', date, timezone:'Asia/Shanghai', start:new Date(start).toISOString(), until:new Date(end).toISOString()};
}
export function inDayWindow(created, window) {
  const at = Date.parse(created);
  return Number.isFinite(at) && at >= Date.parse(window.start) && at < Date.parse(window.until);
}
export function previousBeijingDay(at = new Date()) {
  return new Date(Date.parse(beijingDay(at) + 'T00:00:00Z') - 864e5).toISOString().slice(0,10);
}
export const collectionKey = (platform, account, date) => `l1:collection:${platform}:${account}:${date}`;
