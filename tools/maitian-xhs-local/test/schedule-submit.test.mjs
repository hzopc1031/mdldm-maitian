import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hasIdentityChallenge, isConfirmedSchedule, requireMatchingAttempt, requireResumableAttempt } from '../schedule-submit.mjs';

test('平台回读必须同时确认唯一记录、状态和准确时间', () => {
  const time = '2030-01-02 20:30';
  const row = { text: '教程标题\n定时发布\n2030-01-02 20:30' };
  assert.equal(isConfirmedSchedule([row], time), true);
  assert.equal(isConfirmedSchedule([row, row], time), false);
  assert.equal(isConfirmedSchedule([row], '2030-01-02 20:31'), false);
  assert.equal(isConfirmedSchedule([{ text: '教程标题\n审核中\n2030-01-02 20:30' }], time), false);
});

test('已有提交记录时只允许核对同一任务、稿件、账号和时间', () => {
  const schedule = '2030-01-02T20:30:00+08:00';
  const attempt = { id: 'test-task', digest: 'reviewed', account: '示例账号', requested: schedule };
  assert.doesNotThrow(() => requireMatchingAttempt(attempt, 'test-task', 'reviewed', '示例账号', schedule));
  assert.throws(() => requireMatchingAttempt(attempt, 'test-task', 'changed', '示例账号', schedule), /已有其他版本/);
  assert.throws(() => requireMatchingAttempt(attempt, 'test-task', 'reviewed', '其他账号', schedule), /已有其他版本/);
  assert.throws(() => requireMatchingAttempt(attempt, 'test-task', 'reviewed', '示例账号', '2030-01-02T21:00:00+08:00'),
    /已有其他版本/);
});

test('页面要求扫码验证身份时须暂停，隐藏文字不算', () => {
  const node = { role: { value: 'StaticText' }, name: { value: '」 扫码验证身份' } };
  assert.equal(hasIdentityChallenge([node]), true);
  assert.equal(hasIdentityChallenge([{ ...node, ignored: true }]), false);
  assert.equal(hasIdentityChallenge([{ ...node, name: { value: '定时发布' } }]), false);
});

test('只有原先因扫码暂停的提交可以在原时间前接续一次', () => {
  const requested = '2030-01-02T20:30:00+08:00';
  const now = Date.parse('2030-01-02T09:00:00+08:00');
  const stopped = { requested, status: '等待扫码验证' };
  assert.doesNotThrow(() => requireResumableAttempt(stopped, now));
  assert.throws(() => requireResumableAttempt({ ...stopped, status: '等待核对' }, now), /没有可接续/);
  assert.throws(() => requireResumableAttempt({ ...stopped, resumedAt: now }, now), /没有可接续/);
  assert.throws(() => requireResumableAttempt(stopped, Date.parse(requested)), /时间已过/);
});
