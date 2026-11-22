import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const ID = /^[a-z0-9][a-z0-9-]{2,79}$/;
const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const STATES = ['待制作', '待审核', '待上传', '待确认', '已定时', '失败'];

export function requireThat(ok, message) {
  if (!ok) throw new Error(message);
}

export const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

export function writeJson(file, value) {
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    fs.renameSync(temp, file);
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
}

export function createProject(dir) {
  const id = path.basename(dir);
  requireThat(ID.test(id), '任务目录名须为 3–80 位小写字母、数字或连字符');
  fs.mkdirSync(dir, { mode: 0o700 });
  fs.mkdirSync(path.join(dir, 'images'), { mode: 0o700 });
  writeJson(path.join(dir, 'draft.json'), {
    version: 1, id, title: '', body: '', topics: [], sources: [], images: [], scheduledFor: null,
  });
  writeJson(path.join(dir, 'cards.json'), []);
  writeJson(path.join(dir, 'state.json'), { id, phase: '待制作', updatedAt: new Date().toISOString() });
  return id;
}

export function openProject(dir) {
  const root = fs.realpathSync(dir);
  const draftFile = path.join(root, 'draft.json');
  const stateFile = path.join(root, 'state.json');
  const readState = () => {
    const state = readJson(stateFile);
    requireThat(ID.test(state.id) && state.id === path.basename(root) && STATES.includes(state.phase), '任务状态无效');
    return state;
  };
  const { id } = readState();
  return {
    root, id, draftFile, readState,
    scheduleAttemptFile: path.join(root, 'program-schedule-submit-attempt.json'),
    setState(phase, details = {}) {
      requireThat(STATES.includes(phase), '任务阶段无效');
      const state = { id, phase, updatedAt: new Date().toISOString(), ...details };
      writeJson(stateFile, state);
      return state;
    },
  };
}

export async function withProjectLock(project, action) {
  const lock = path.join(project.root, '.lock');
  try {
    fs.mkdirSync(lock, { mode: 0o700 });
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error('任务已被锁定，先确认没有其他操作仍在运行');
    throw error;
  }
  try {
    return await action();
  } finally {
    fs.rmdirSync(lock);
  }
}

function localFile(root, relative, maxBytes) {
  requireThat(typeof relative === 'string' && relative && !path.isAbsolute(relative), '文件须为任务内相对路径');
  requireThat(relative.split('/').every((part) => part && part !== '.' && part !== '..'), '文件路径包含无效片段');
  const joined = path.join(root, relative);
  const file = fs.realpathSync(joined);
  requireThat(file === joined && file.startsWith(root + path.sep), '任务文件不能使用符号链接或指向外部');
  const stat = fs.statSync(file);
  requireThat(stat.isFile() && stat.size > 0 && stat.size <= maxBytes, '任务文件为空、过大或不符合要求');
  return { file, data: fs.readFileSync(file) };
}

const digestOf = (data) => createHash('sha256').update(data).digest('hex');
const text = (value, label, limit) => {
  requireThat(typeof value === 'string' && value.trim() === value && value.length && [...value].length <= limit && !value.includes('\r'), `${label}为空、含首尾空白或超过 ${limit} 字`);
  return value;
};

function sourceEntry(root, item) {
  requireThat(item && typeof item === 'object', '来源记录格式无效');
  const title = text(item.title, '来源标题', 150);
  const evidence = text(item.evidence, '来源说明', 500);
  if (item.kind === 'local') {
    const { data } = localFile(root, item.path, 1_000_000);
    return { kind: 'local', title, evidence, path: item.path, sha256: digestOf(data) };
  }
  requireThat(item.kind === 'url' && typeof item.url === 'string' && URL.canParse(item.url), '来源须提供有效链接或任务内文件');
  const url = new URL(item.url);
  requireThat(url.protocol === 'https:' && !url.username && !url.password, '来源链接须为不含凭据的 HTTPS 地址');
  return { kind: 'url', title, evidence, url: url.href };
}

export function imageName(index) {
  return `images/${String(index + 1).padStart(2, '0')}.png`;
}

function inspectImage(root, name, index) {
  requireThat(name === imageName(index), `第 ${index + 1} 张图片须为 ${imageName(index)}`);
  const item = localFile(root, name, 32_000_000);
  const { data } = item;
  requireThat(data.length >= 45 && data.subarray(0, 8).equals(PNG) && data.toString('ascii', 12, 16) === 'IHDR' && data.toString('ascii', data.length - 8, data.length - 4) === 'IEND', `第 ${index + 1} 张图片不是完整 PNG`);
  const width = data.readUInt32BE(16);
  const height = data.readUInt32BE(20);
  requireThat(width >= 720 && height >= 960 && width * height <= 24_000_000, `第 ${index + 1} 张图片尺寸不合适`);
  return { name, file: item.file, width, height, sha256: digestOf(data) };
}

export function readSchedule(value) {
  if (value === null) return null;
  requireThat(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\+08:00$/.test(value), '定时须为北京时间 ISO 格式，精确到分');
  const instant = Date.parse(value);
  const expected = Number.isFinite(instant) && new Date(instant + 8 * 3600_000).toISOString().slice(0, 19) + '+08:00';
  requireThat(expected === value, '定时日期或时间无效');
  return value;
}

export function validateProject(project) {
  const draft = readJson(project.draftFile);
  requireThat(draft.version === 1 && draft.id === project.id, '任务版本或固定 ID 不匹配');
  const title = text(draft.title, '标题', 20);
  requireThat(!title.includes('\n'), '标题只能有一行');
  const body = text(draft.body, '正文', 1000);
  requireThat(Array.isArray(draft.topics), '话题须为列表');
  const topics = draft.topics.map((tag) => text(tag, '话题', 30));
  requireThat(topics.every((tag) => !/[#\s]/u.test(tag)) && new Set(topics).size === topics.length, '话题不能重复或含 # 和空白');
  requireThat([...body].length + topics.reduce((n, tag) => n + [...tag].length + 2, 0) <= 1000, '正文加话题超过 1000 字');
  requireThat(Array.isArray(draft.sources) && draft.sources.length > 0, '至少需要一条来源');
  const sources = draft.sources.map((item) => sourceEntry(project.root, item));
  requireThat(Array.isArray(draft.images) && draft.images.length > 0 && draft.images.length <= 9, '离线首版须提供 1–9 张 PNG');
  const images = draft.images.map((item, i) => inspectImage(project.root, item, i));
  requireThat(new Set(images.map((item) => item.sha256)).size === images.length, '图片内容重复');
  const scheduledFor = readSchedule(draft.scheduledFor);
  const payload = { id: project.id, title, body, topics, sources,
    images: images.map(({ file, ...item }) => item), scheduledFor };
  return { ...payload, files: images.map((item) => item.file), digest: digestOf(JSON.stringify(payload)) };
}

export function approveOffline(project, reviewedDigest) {
  const candidate = validateProject(project);
  requireThat(reviewedDigest === candidate.digest, '稿件与审核摘要不一致，须重新核对');
  const state = project.readState();
  requireThat(state.phase === '待审核' && state.digest === reviewedDigest, '须先生成待审核的稿件摘要');
  return project.setState('待上传', { digest: candidate.digest, permission: 'offline-only' });
}

export function requireOfflineApproval(project, candidate) {
  const state = project.readState();
  requireThat(state.phase === '待上传' && state.permission === 'offline-only', '须先记录本次离线验收确认');
  requireThat(state.digest === candidate.digest, '稿件或素材已更改，须重新核对');
}
