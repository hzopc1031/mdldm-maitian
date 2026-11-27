// Parse --only for commands that must not silently fall back to all platforms.
export function parseOnlyPlatforms(args, all) {
  const i = args.indexOf('--only');
  if (i < 0) return all.slice();
  const raw = args[i + 1];
  if (raw == null || raw === '' || String(raw).startsWith('--')) {
    throw new Error('doctor --only 需要平台 id，例如 --only xhs,douyin,bilibili');
  }
  const ids = String(raw).split(',').map((s) => s.trim()).filter(Boolean);
  if (!ids.length) {
    throw new Error('doctor --only 不能为空');
  }
  const allowed = new Set(all);
  const bad = [...new Set(ids.filter((id) => !allowed.has(id)))];
  if (bad.length) {
    throw new Error(`未知或不适用于当前配置的平台：${bad.join('、')}。可选：${all.join(', ')}`);
  }
  return [...new Set(ids)];
}
