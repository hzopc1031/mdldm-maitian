// Shared by the Windows route check and path construction in the publisher copy.
// The extension runs inside Chromium, so the helper has no Node dependencies.
function segments(path, allowEmpty = false) {
  if (typeof path !== 'string') throw new Error('素材路径必须为文字');
  const parts = path.replaceAll('\\', '/').split('/');
  if (allowEmpty && parts.length === 1 && parts[0] === '') return [];
  if (parts.some(part => !part || part === '.' || part === '..' || /[:\x00-\x1f\x7f]/.test(part))) {
    throw new Error('工程和素材路径必须是根目录下的相对路径');
  }
  return parts;
}

function readRoot(value) {
  const path = String(value ?? '').trim().replaceAll('\\','/');
  const prefix = /^([A-Za-z]:)\//.exec(path)?.[1] ?? '';
  if (!prefix && (!path.startsWith('/') || path.startsWith('//'))) {
    throw new Error('请填写本机绝对路径，例如 D:\\视频工程');
  }
  const rest = path.slice(prefix.length+1).replace(/\/+$/,'');
  return {prefix,parts:segments(rest,true)};
}

export function validPublisherRoot(root) {
  try { readRoot(root); return true; }
  catch { return false; }
}

export function publisherMediaPath(root, directory, file) {
  const {prefix,parts}=readRoot(root);
  const joined=[...parts,...segments(directory,true),...segments(file)].join('/');
  return prefix ? `${prefix}\\${joined.replaceAll('/','\\')}` : `/${joined}`;
}
