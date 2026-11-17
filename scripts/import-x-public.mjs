import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { home, dbPath, readConfig, beijingDay, inWindow, validDay } from '../src/l1-config.mjs';

export function validateX(input) {
  const errors = [];
  if (input?.account !== 'PeanutPair') errors.push('account 必须严格等于 PeanutPair（不带 @）');
  if (typeof input?.captured_at !== 'string' || !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(input.captured_at) || !Number.isFinite(Date.parse(input.captured_at))) errors.push('captured_at 必须是含时区的 ISO8601');
  const count = (value, field) => { if (value !== null && (typeof value !== 'number' || !Number.isFinite(value) || value < 0)) errors.push(`${field} 必须为非负数字或 null`); };
  count(input?.followers, 'followers');
  if (!Array.isArray(input?.posts)) errors.push('posts 必须为数组');
  for (const [i, p] of (Array.isArray(input?.posts) ? input.posts : []).entries()) {
    if (!p || typeof p !== 'object') { errors.push(`posts[${i}] 必须为对象`); continue; }
    if (typeof p.id !== 'string' || !/^[\w-]+$/.test(p.id)) errors.push(`posts[${i}].id 无效`);
    if (p.url !== `https://x.com/PeanutPair/status/${p.id}`) errors.push(`posts[${i}] URL 与 PeanutPair/id 不一致`);
    if (typeof p.text !== 'string') errors.push(`posts[${i}].text 必须为字符串`);
    if (p.created_at != null && p.created_at !== '' && (typeof p.created_at !== 'string' || !Number.isFinite(Date.parse(p.created_at)))) errors.push(`posts[${i}].created_at 无效`);
    for (const key of ['views','likes','reposts','replies','quotes','bookmarks']) count(p[key], `posts[${i}].${key}`);
  }
  if (errors.length) throw new Error(`导入 0，跳过 0，校验错误 ${errors.length}：\n${errors.join('\n')}`);
  return input;
}
export async function importX(file, { date } = {}) {
  readConfig();
  const input = validateX(JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')));
  const day = validDay(date || beijingDay(input.captured_at));
  const posts = input.posts.filter(p => inWindow(p.created_at, day) !== false);
  const store = await import('../src/l1-store.mjs'); // 所有校验通过后才打开库。
  const result = store.transaction(() => store.saveObservation({ platform: 'x', account: input.account, captured_at: new Date(input.captured_at).toISOString(), source: 'grok-public', followers: input.followers, example: input.posts.some(p => /示例|假数据/.test(p.text)), posts: posts.map(p => ({ ...p, comments: p.replies, shares: p.reposts, favorites: p.bookmarks })) }));
  result.skipped += input.posts.length - posts.length;
  console.log(`X PeanutPair：导入 ${result.imported}，跳过 ${result.skipped}，校验错误 0；DB=${dbPath}`);
  return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const file = process.argv[2] || path.join(home, 'inbox', 'x', `x-${beijingDay()}.json`);
  try { await importX(file); } catch (error) { console.error(`X 导入失败：${error.message}`); process.exitCode = 1; }
}
