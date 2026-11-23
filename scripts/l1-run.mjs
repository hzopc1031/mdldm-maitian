// 第一方手动/零点调度共用入口；仅采集指定日作品并生成本地日报。
import path from 'node:path';
import { parseArgs } from 'node:util';
import { home, dbPath, readConfig, beijingDay, validDay } from '../src/l1-config.mjs';
import {PLATFORM_IDS,platformById} from '../src/platform-registry.mjs';
try {
  const { values } = parseArgs({ options: { only: { type: 'string' }, date: { type: 'string' }, until:{type:'string'}, history:{type:'boolean'}, 'import-x': { type: 'string' }, 'x-json': { type: 'string' }, 'login-x': { type: 'boolean' }, 'login-xhs': { type: 'boolean' }, 'login-wechat': { type: 'boolean' },'login-native':{type:'string'}, 'wait-login': { type: 'boolean' }, 'report-dir': { type: 'string' } } });
  const logins = ['login-x', 'login-xhs', 'login-wechat','login-native'].filter(key => values[key]);
  if (values['wait-login'] && !logins.length) throw new Error('--wait-login 必须与 --login-x / --login-xhs / --login-wechat 一起使用');
  if (values.only && !PLATFORM_IDS.includes(values.only)) throw new Error('--only 仅允许受支持的平台');
  const config = readConfig(), date = validDay(values.date || beijingDay());
  console.log(`L1 DB=${dbPath}；HOME=${home}；日期=${date}`);
  if (values['import-x'] && values['x-json']) throw new Error('--import-x 与兼容别名 --x-json 不能同时使用');
  const input = values['import-x'] || values['x-json'];
  if (values.only && values.only !== 'x' && input) throw new Error(`--only ${values.only} 不能导入 X`);
  if (logins.length) {
    if (logins.length !== 1 || Object.keys(values).some(key => !['login-x', 'login-xhs', 'login-wechat','login-native', 'wait-login'].includes(key))) throw new Error('登录请单独运行，仅可附加 --wait-login');
    if(values['login-native']) {
      const {loginNative}=await import('../src/l1-native.mjs');await loginNative(config,values['login-native']);
    } else
    if (values['login-x']) {
      const { loginX } = await import('../src/l1-x.mjs');
      await loginX(config, { waitLogin: values['wait-login'] });
    } else if (values['login-wechat']) {
      const { loginWechat } = await import('../src/l1-wechat.mjs');
      await loginWechat(config, { waitLogin: values['wait-login'] });
    } else {
      const { loginXhs } = await import('../src/l1-xhs.mjs');
      await loginXhs(config, { waitLogin: values['wait-login'] }); // 登录命令不打开数据库，也不生成日报。
    }
  } else {
    if (!values.only || values.only === 'x') {
      if (input) {
        const { importX } = await import('./import-x-public.mjs');
        await importX(input, { date });
      } else {
        const { collectX } = await import('../src/l1-x.mjs');
        await collectX(config, {date, until:values.until, history:!!values.history});
      }
    }
    if (!values.only || values.only === 'xhs') {
      const { collectXhs } = await import('../src/l1-xhs.mjs');
      await collectXhs(config, date, {until:values.until, history:!!values.history});
    }
    if (values.only === 'wechat') {
      const { collectWechat } = await import('../src/l1-wechat.mjs');
      await collectWechat(config, date, {until:values.until, history:!!values.history});
    }
    if(platformById(values.only)?.native) {
      const {collectNative}=await import('../src/l1-native.mjs');await collectNative(config,values.only,date,{until:values.until});
    }
    const { writeLocalReport } = await import('../src/local-report.mjs');
    await writeLocalReport({ date, reportDir: values['report-dir'] ? path.resolve(values['report-dir']) : undefined });
    console.log('L1 完成（本轮仅采集与本地日报；未发布、未发送飞书）');
  }
} catch (error) { console.error(`L1 失败：${error.message}`); process.exitCode = 1; }
