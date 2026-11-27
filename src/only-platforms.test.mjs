import { parseOnlyPlatforms } from './only-platforms.mjs';

const ALL = ['bilibili', 'xhs', 'douyin', 'channels', 'youtube', 'x', 'instagram'];
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const throws = (fn, re) => {
  try { fn(); throw new Error(`expected throw: ${re}`); }
  catch (e) { if (e.message === `expected throw: ${re}` || !re.test(e.message)) throw e; }
};

assert(parseOnlyPlatforms(['doctor'], ALL).join(',') === ALL.join(','), 'no --only keeps all');
assert(parseOnlyPlatforms(['doctor', '--only', 'xhs,douyin,bilibili'], ALL).join(',') === 'xhs,douyin,bilibili', 'valid subset');
assert(parseOnlyPlatforms(['doctor', '--only', 'xhs, xhs, douyin'], ALL).join(',') === 'xhs,douyin', 'dedupe');
throws(() => parseOnlyPlatforms(['doctor', '--only'], ALL), /需要平台 id/);
throws(() => parseOnlyPlatforms(['doctor', '--only', '--notify'], ALL), /需要平台 id/);
throws(() => parseOnlyPlatforms(['doctor', '--only', ''], ALL), /需要平台 id|不能为空/);
throws(() => parseOnlyPlatforms(['doctor', '--only', ',,,'], ALL), /不能为空/);
throws(() => parseOnlyPlatforms(['doctor', '--only', 'xiaohongshu'], ALL), /未知或不适用/);
throws(() => parseOnlyPlatforms(['doctor', '--only', 'xhs,foo'], ALL), /未知或不适用/);
throws(() => parseOnlyPlatforms(['doctor', '--only', 'zsz'], ALL), /未知或不适用/);
console.log('only-platforms.test.mjs ok');
