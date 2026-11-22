import fs from 'node:fs';
import path from 'node:path';
import { openProject, requireThat, validateProject, withProjectLock } from './project.mjs';
import { previewWeb, requireWebApproval } from './web-preview.mjs';

const MODE = 'web-queue';
const isQueued = (state) => state.phase === '待上传' && state.mode === MODE;

export function queueWeb(project, candidate, digest, account) {
  requireWebApproval(candidate, digest, account);
  const state = project.readState();
  requireThat(state.digest === digest, '须先用 check 核对当前稿件');
  requireThat(!fs.existsSync(project.scheduleAttemptFile), '本任务已有定时提交记录，不能再次入队');
  if (state.account === account) {
    if (isQueued(state)) return state;
    if (state.phase === '待确认' && state.mode === 'web-preview') return { ...state, alreadyPrepared: true };
  }
  return project.setState('待上传', { mode: MODE, digest, account });
}

export function cancelQueuedWeb(project) {
  const state = project.readState();
  requireThat(isQueued(state), '没有待撤销的网页验收批准');
  return project.setState('待审核', { digest: state.digest });
}

function nextQueuedProject(root) {
  const pending = [];
  for (const item of fs.readdirSync(root, { withFileTypes: true })) {
    if (!item.isDirectory()) continue;
    const directory = path.join(root, item.name);
    if (!fs.existsSync(path.join(directory, 'state.json'))) continue;
    const project = openProject(directory);
    const state = project.readState();
    if (isQueued(state)) pending.push({ project, state });
  }
  pending.sort((a, b) => a.state.updatedAt.localeCompare(b.state.updatedAt) || a.project.id.localeCompare(b.project.id));
  return pending[0]?.project;
}

export async function runQueue(directory, { dryRun = false, prepare = previewWeb } = {}) {
  const root = fs.realpathSync(directory);
  const runNext = async () => {
    const project = nextQueuedProject(root);
    if (!project) return { status: 'empty', dryRun };
    const runTask = async () => {
      const state = project.readState();
      if (!isQueued(state)) return { status: 'skipped', id: project.id, dryRun };
      const { account, digest } = state;
      const reject = (reason) => {
        if (dryRun) return { status: 'blocked', dryRun, id: project.id, reason };
        project.setState('失败', { mode: MODE, digest, account, reason });
        throw new Error(`${project.id}：${reason}`);
      };
      let candidate;
      try {
        candidate = validateProject(project);
      } catch {
        return reject('稿件或素材未通过校验，须重新核对');
      }
      try {
        requireWebApproval(candidate, digest, account);
      } catch (error) {
        return reject(error.message);
      }
      if (dryRun) return { status: 'ready', dryRun, id: project.id, digest, account };
      const result = await prepare(project, candidate, digest, account);
      return { status: 'prepared', result };
    };
    return dryRun ? runTask() : withProjectLock(project, runTask);
  };
  return dryRun ? runNext() : withProjectLock({ root }, runNext);
}
