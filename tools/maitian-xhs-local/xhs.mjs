import path from 'node:path';
import {
  approveOffline, createProject, openProject, requireOfflineApproval, requireThat, validateProject, withProjectLock,
} from './project.mjs';
import { renderProject } from './render.mjs';

const usage = [
  '用法：node xhs.mjs <init|render|check|preview-offline|status> <任务目录>',
  '      node xhs.mjs produce <新任务目录> <选题来源JSON>',
  '      node xhs.mjs approve-offline <任务目录> <审核摘要>',
  '      node xhs.mjs preview-web <任务目录> <审核摘要> <小红书账号显示名>',
  '      node xhs.mjs preview-schedule <任务目录> <审核摘要> <小红书账号显示名> <北京时间ISO>',
  '      node xhs.mjs submit-schedule <任务目录> <审核摘要> <小红书账号显示名> <北京时间ISO>',
  '      node xhs.mjs resume-schedule <任务目录> <审核摘要> <小红书账号显示名> <北京时间ISO>',
  '      node xhs.mjs queue-web <任务目录> <审核摘要> <小红书账号显示名>',
  '      node xhs.mjs run-queue <任务根目录> [--dry-run]',
  '      node xhs.mjs cancel-web <任务目录>',
].join('\n');

async function run([command, dir, ...args]) {
  if (command === 'run-queue') {
    requireThat(dir && (!args.length || (args.length === 1 && args[0] === '--dry-run')), usage);
    const { runQueue } = await import('./queue.mjs');
    return runQueue(path.resolve(dir), { dryRun: args[0] === '--dry-run' });
  }
  if (command === 'produce') {
    requireThat(dir && args.length === 1, usage);
    const { produce } = await import('./produce.mjs');
    return produce(path.resolve(dir), path.resolve(args[0]));
  }
  const argCounts = {
    init: 0, render: 0, check: 0, status: 0, 'approve-offline': 1, 'preview-offline': 0,
    'preview-web': 2, 'preview-schedule': 3, 'submit-schedule': 3, 'resume-schedule': 3, 'queue-web': 2, 'cancel-web': 0,
  };
  requireThat(dir && Object.hasOwn(argCounts, command) && args.length === argCounts[command], usage);
  const [digest, account, schedule] = args;
  const root = path.resolve(dir);
  if (command === 'init') return { id: createProject(root), phase: '待制作' };
  const project = openProject(root);
  if (command === 'status') return project.readState();
  return withProjectLock(project, async () => {
    if (command === 'render') return renderProject(project);
    if (command === 'approve-offline') return approveOffline(project, digest);
    if (command === 'cancel-web') {
      const { cancelQueuedWeb } = await import('./queue.mjs');
      return cancelQueuedWeb(project);
    }
    const candidate = validateProject(project);
    if (command === 'check') {
      const state = project.readState();
      if (state.digest !== candidate.digest || state.phase === '失败') project.setState('待审核', { digest: candidate.digest });
      return { id: candidate.id, title: candidate.title, body: candidate.body, topics: candidate.topics,
        sources: candidate.sources.map(({ title, evidence }) => ({ title, evidence })),
        images: candidate.images, scheduledFor: candidate.scheduledFor, digest: candidate.digest,
        phase: project.readState().phase };
    }
    if (command === 'preview-web') {
      const { previewWeb } = await import('./web-preview.mjs');
      return previewWeb(project, candidate, digest, account);
    }
    if (command === 'preview-schedule') {
      const { previewSchedule } = await import('./web-preview.mjs');
      return previewSchedule(project, candidate, digest, account, schedule);
    }
    if (command === 'submit-schedule' || command === 'resume-schedule') {
      const { submitSchedule } = await import('./schedule-submit.mjs');
      return submitSchedule(project, candidate, digest, account, schedule, { resumeAfterIdentity: command === 'resume-schedule' });
    }
    if (command === 'queue-web') {
      const { queueWeb } = await import('./queue.mjs');
      return queueWeb(project, candidate, digest, account);
    }
    requireOfflineApproval(project, candidate);
    try {
      const { previewOffline } = await import('./offline.mjs');
      const observed = await previewOffline(project, candidate);
      project.setState('待确认', { digest: candidate.digest, mode: 'offline-only' });
      return { id: candidate.id, mode: 'offline-only', phase: '待确认', images: observed.images,
        topics: observed.topics, time: observed.time, submitClicks: observed.submitClicks };
    } catch (error) {
      project.setState('失败', { digest: candidate.digest, reason: '离线浏览器填写或回读未通过' });
      throw error;
    }
  });
}

try {
  const result = await run(process.argv.slice(2));
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
