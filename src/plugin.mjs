// 麦田发布助手（各平台填写引擎）在哪：
//   默认用专用 Chrome 里从 Chrome 应用商店装的那份。Chrome 会自动更新它，麦田每次发布读最新版本的代码。
//   config.plugin = 'local' 时用 config.pluginDir（插件开发者自己调试用）。
import fs from 'node:fs'; import path from 'node:path';
import { config } from './feishu.mjs';
import { PROFILE } from './chrome-shim.mjs';

export const STORE_ID = 'eaaipbilkhibicihiollecmbpneikpnj';
export const STORE_URL = `https://chromewebstore.google.com/detail/${STORE_ID}`;

const ver = (s) => s.split(/[._]/).map(Number);
const newer = (a, b) => { const x = ver(a), y = ver(b); for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); return 0; };
const usable = (d) => d && fs.existsSync(path.join(d, 'lib', 'publish.js'));

// 专用 Chrome 资料目录里商店版的最新版本目录（形如 Extensions/<id>/0.4.0_0）
export function storeDir() {
  const base = path.join(PROFILE, 'Default', 'Extensions', STORE_ID);
  let dirs = []; try { dirs = fs.readdirSync(base).filter(n => /^\d+(\.\d+)*_\d+$/.test(n)); } catch { return null; }
  const best = dirs.sort(newer).reverse().map(n => path.join(base, n)).find(usable);
  return best || null;
}

function versionOf(dir) { try { return JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')).version; } catch { return null; } }

// 返回 { source: 'store' | 'local' | null, dir, version }
export function pluginInfo() {
  // L1 的本地检查可显式指定发布助手，覆盖商店版和 config.pluginDir。
  if (process.env.MAITIAN_PUBLISHER_DIR) {
    const dir = path.resolve(process.env.MAITIAN_PUBLISHER_DIR);
    return usable(dir) ? { source: 'local', dir, version: versionOf(dir) } : { source: null };
  }
  const local = config.pluginDir && usable(config.pluginDir) ? config.pluginDir : null;
  if (config.plugin === 'local') return local ? { source: 'local', dir: local, version: versionOf(local) } : { source: null };
  const store = storeDir();
  if (store) return { source: 'store', dir: store, version: versionOf(store) };
  // 老配置：没装商店版但有本地插件目录，先接着用本地的
  return local ? { source: 'local', dir: local, version: versionOf(local) } : { source: null };
}

export function pluginDir() {
  const p = pluginInfo();
  if (!p.dir) throw new Error(`还没装麦田发布助手：运行 node src/hub.mjs login，在打开的专用 Chrome 里从应用商店点「添加至 Chrome」（${STORE_URL}）`);
  return p.dir;
}
