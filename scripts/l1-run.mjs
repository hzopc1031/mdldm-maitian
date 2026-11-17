// 仅手动运行：X 本地导入 → 小红书只读 DOM → 本地日报。
import path from 'node:path';
import { parseArgs } from 'node:util';
import { home, dbPath, readConfig, beijingDay, validDay } from '../src/l1-config.mjs';
try {
  const { values } = parseArgs({ options: { only: { type: 'string' }, date: { type: 'string' }, 'x-json': { type: 'string' }, 'login-xhs': { type: 'boolean' }, 'report-dir': { type: 'string' } } });
  if (values.only && !['x','xhs'].includes(values.only)) throw new Error('--only 仅允许 x 或 xhs');
  const config = readConfig(), date = validDay(values.date || beijingDay());
  console.log(`L1 DB=${dbPath}；HOME=${home}；日期=${date}`);
  if (values['login-xhs']) {
    if (values.only || values['x-json']) throw new Error('--login-xhs 请单独运行');
    const { loginXhs } = await import('../src/l1-xhs.mjs');
    await loginXhs(config); // 登录命令不打开数据库，也不生成日报。
  } else {
    if (values.only !== 'xhs') {
      const { importX } = await import('./import-x-public.mjs');
      await importX(values['x-json'] || path.join(home, 'inbox', 'x', `x-${date}.json`), { date });
    }
    if (values.only !== 'x') {
      const { collectXhs } = await import('../src/l1-xhs.mjs');
      await collectXhs(config, date);
    }
    const { writeLocalReport } = await import('../src/local-report.mjs');
    await writeLocalReport({ date, reportDir: values['report-dir'] ? path.resolve(values['report-dir']) : undefined });
    console.log('L1 完成（无发布、无定时任务、无飞书同步）');
  }
} catch (error) { console.error(`L1 失败：${error.message}`); process.exitCode = 1; }
