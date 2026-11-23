// Only bounded stage codes cross the child IPC channel; never forward browser DOM or URLs.
export function reportL1Progress(stage, timeoutMs) {
  if (typeof process.send !== 'function' || !process.connected) return;
  const counts = timeoutMs && typeof timeoutMs === 'object' ? Object.fromEntries(['round','completed','total'].filter(k=>Number.isSafeInteger(timeoutMs[k])&&timeoutMs[k]>=0&&timeoutMs[k]<=100000).map(k=>[k,timeoutMs[k]])) : {};
  process.send({ type: 'l1:progress', stage, ...counts, ...(Number.isSafeInteger(timeoutMs) && timeoutMs > 0 ? { timeoutMs } : {}) }, () => {});
}
