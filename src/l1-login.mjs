import { pause } from './l1-browser.mjs';

export function loginTimeoutMs(value = process.env.L1_LOGIN_TIMEOUT_MS ?? 600000) {
  const timeout = Number(value);
  if (!Number.isSafeInteger(timeout) || timeout <= 0) throw new Error('L1_LOGIN_TIMEOUT_MS 必须为正整数毫秒数');
  return timeout;
}

// 只轮询已渲染 DOM；不刷新页面，以免打断二维码或登录流程。
export async function waitForVisibleLogin(page, readIdentity, checkIdentity, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const identity = await page.evaluate(readIdentity);
    if (checkIdentity(identity)) return;
    const remaining = deadline - Date.now();
    if (remaining > 0) await pause(Math.min(1800, remaining), Math.min(3200, remaining));
  }
  throw new Error(`等待登录超时（${timeoutMs} 毫秒）；未采集、未写库`);
}
