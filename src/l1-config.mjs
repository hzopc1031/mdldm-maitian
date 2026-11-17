// L1 独立配置：不加载飞书、发布助手或浏览器。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export const home = path.resolve(process.env.MAITIAN_HOME || path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
export const dbPath = path.resolve(process.env.MAITIAN_DB || path.join(home, 'data', 'hub.db'));
export function readConfig() {
  const file = process.env.MAITIAN_CONFIG || path.join(home, 'config.json');
  if (!fs.existsSync(file)) {
    if (process.env.MAITIAN_CONFIG) throw new Error(`指定配置不存在：${file}`);
    return {};
  }
  const config = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  if (config.xHandle != null && config.xHandle !== 'PeanutPair') throw new Error('L1 xHandle 必须为 PeanutPair');
  return config;
}
export function beijingDay(value = new Date()) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`无效时间：${value}`);
  return new Date(date.getTime() + 8 * 3600000).toISOString().slice(0, 10);
}
export function validDay(day) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) !== day) throw new Error('date 必须为有效 YYYY-MM-DD');
  return day;
}
export function inWindow(created, day) {
  if (!created) return null;
  const age = (Date.parse(`${day}T00:00:00Z`) - Date.parse(`${beijingDay(created)}T00:00:00Z`)) / 86400000;
  return age >= 0 && age < 30;
}
