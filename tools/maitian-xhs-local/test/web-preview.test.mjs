import assert from 'node:assert/strict';
import { test } from 'node:test';
import { imagesMatch, requireScheduleApproval, requireWebApproval } from '../web-preview.mjs';

test('真实页面验收须有相同摘要、账号，且无定时', () => {
  const candidate = { digest: 'approved', scheduledFor: null };
  assert.doesNotThrow(() => requireWebApproval(candidate, 'approved', '示例账号'));
  assert.throws(() => requireWebApproval(candidate, 'different', '示例账号'), /摘要不一致/);
  assert.throws(() => requireWebApproval(candidate, 'approved', ''), /账号显示名/);
  assert.throws(() => requireWebApproval({ ...candidate, scheduledFor: '2030-01-02T19:30:00+08:00' },
    'approved', '示例账号'), /没有排期/);
});

test('即使缩略图数量与序号相同，交换图片内容也须拒绝', () => {
  const expected = [{ sha256: 'first' }, { sha256: 'second' }];
  const originals = [{ sha256: 'first', pixels: [20, 24, 27] }, { sha256: 'second', pixels: [30, 180, 50] }];
  const ordered = [{ position: 1, pixels: [19, 24, 28] }, { position: 2, pixels: [29, 178, 53] }];
  assert.equal(imagesMatch(ordered, originals, expected), true);
  const reversed = ordered.map((slot, i) => ({ ...slot, pixels: ordered[1 - i].pixels }));
  assert.equal(imagesMatch(reversed, originals, expected), false);
  assert.equal(imagesMatch(ordered, [...originals].reverse(), expected), false);
  assert.equal(imagesMatch([{ ...ordered[0], position: 2 }, ordered[1]], originals, expected), false);
  assert.equal(imagesMatch([{ position: 1 }, ordered[1]], originals, expected), false);
  assert.equal(imagesMatch(ordered.slice(0, 1), originals, expected), false);
});

test('设置定时须接续同一个已验收的账号和稿件，时间须是未来的北京时间', () => {
  const candidate = { digest: 'approved', scheduledFor: null };
  const state = {
    mode: 'web-preview', phase: '待确认', account: '示例账号', digest: candidate.digest,
    imageOrderVerified: true, scheduled: false, submitClicked: false,
  };
  const now = Date.parse('2030-02-01T09:00:00+08:00');
  const tonight = '2030-02-01T20:30:00+08:00';
  const check = (time, receipt = state) =>
    requireScheduleApproval(candidate, candidate.digest, state.account, receipt, time, now);
  assert.doesNotThrow(() => check(tonight));
  assert.throws(() => check('2030-02-01T08:30:00+08:00'), /未来/);
  assert.throws(() => check('2030-02-30T20:30:00+08:00'), /日期或时间无效/);
  assert.throws(() => check('2030-02-01T20:30:00Z'), /北京时间/);
  assert.throws(() => check(tonight, { ...state, digest: 'different' }), /没有可接续/);
  assert.throws(() => check(tonight, { ...state, account: '另一个账号' }), /没有可接续/);
  assert.throws(() => check(tonight, { ...state, submitClicked: true }), /没有可接续/);
});
