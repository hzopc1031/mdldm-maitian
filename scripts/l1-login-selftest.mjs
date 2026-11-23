// 完全离线：实际 CLI + 实际 DOM 函数，浏览器/配置均替换为内存假对象。
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { registerHooks } from 'node:module';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const runner = new URL('./l1-run.mjs', import.meta.url);
if (process.argv[2] === '--fake-child') {
  assert.equal(Boolean(process.stdin.isTTY), false);
  let clock = 0, reads = 0, sleeps = 0;
  Date.now = () => clock;
  globalThis.fetch = () => { throw new Error('禁止网络'); };
  globalThis.WebSocket = class { constructor() { throw new Error('禁止 WebSocket'); } };
  globalThis.__l1FakeBrowser = {
    async pause(min = 1800, max = 3200) {
      assert.ok(min > 0 && min <= max && max <= 3200);
      sleeps++; clock += min;
    },
    async withL1Browser(_config, fn, platform = 'xhs') {
      assert.ok(['xhs', 'x', 'wechat'].includes(platform));
      const urls = [];
      const page = {
        async goto(url) { urls.push(url); },
        async evaluate(fn) {
          reads++;
          if (process.env.L1_FAKE_SCENARIO === 'read-error') throw new Error('模拟 DOM 读取失败');
          const scenario = process.env.L1_FAKE_SCENARIO;
          const loggedIn = !['timeout', 'hidden-only', 'unknown', 'challenge'].includes(scenario) && (scenario !== 'success' || reads > 1);
          const name = scenario === 'wrong' ? 'OtherAccount' : scenario === 'case' ? 'twopeanuts' : 'TwoPeanuts';
          const handle = scenario === 'wrong' ? '@OtherAccount' : '@pEaNuTpAiR';
          const node = (text, hidden = false) => ({ innerText: text,
            getBoundingClientRect: () => ({ width: hidden ? 0 : 100, height: 20 }), querySelectorAll: () => [] });
          const document = {
            body: { innerText: loggedIn ? '创作者首页' : '扫码登录' },
            querySelectorAll(selector) {
              if (platform === 'wechat') return [node('Hidden', true), ...(loggedIn ? [node(scenario === 'wrong' ? 'OtherAccount' : scenario === 'case' ? 'testaccount' : 'TestAccount')] : []), ...(scenario === 'ambiguous' ? [node('SecondAccount')] : [])];
              if (platform === 'xhs') {
                assert.equal(selector, '.account-name, .user-info .name-box, .user-info .nickname, .user-name');
                return [node('OtherHiddenAccount', true), ...(loggedIn ? [node(name)] : []),
                  ...(scenario === 'hidden-only' ? [node('TwoPeanuts', true)] : [])];
              }
              if(selector === 'input[autocomplete="username"], [data-testid="loginButton"], a[href="/i/flow/login"]')return !loggedIn && !['unknown','challenge'].includes(scenario) ? [node('登录')] : [];
              assert.equal(selector, '[data-testid="SideNav_AccountSwitcher_Button"]');
              return loggedIn ? [node(`Display Name\n${handle}`)] : [];
            },
          };
          // X 登录后通常跳到 /home；不能依赖当前页面是 PeanutPair 的主页。
          const href = platform === 'wechat' ? 'https://mp.weixin.qq.com/' : platform === 'xhs' ? 'https://creator.xiaohongshu.com/new/home' : scenario==='challenge' ? 'https://x.com/i/jf/onboarding/web' : 'https://x.com/home';
          return vm.runInNewContext(`(${fn.toString()})()`, { document, location: { href, origin: new URL(href).origin },
            getComputedStyle: () => ({ display: 'block', visibility: 'visible' }) });
        },
      };
      try { return await fn(page); }
      finally { console.log(`FAKE_CLOSED ${JSON.stringify({ platform, urls, reads, sleeps, clock })}`); }
    },
  };
  registerHooks({ load(url, context, next) {
    if (/\/(?:l1-store|local-report)\.mjs$/.test(url) || ['node:sqlite', 'node:net', 'node:child_process'].includes(url)) throw new Error(`禁止副作用模块 ${url}`);
    if (url === 'node:readline/promises') return { format: 'module', shortCircuit: true,
      source: 'export function createInterface() { throw new Error("禁止等待回车"); }' };
    if (url.endsWith('/l1-browser.mjs')) return { format: 'module', shortCircuit: true,
      source: 'export const { pause, withL1Browser } = globalThis.__l1FakeBrowser;' };
    if (url.endsWith('/l1-config.mjs')) return { format: 'module', shortCircuit: true,
      source: `export const home = 'offline', dbPath = 'forbidden/hub.db';
        export const readConfig = () => ({ xHandle:'PeanutPair', l1: { xhs:{account:'TwoPeanuts'}, wechat: { account: process.env.L1_FAKE_SCENARIO === 'missing-account' ? '' : 'TestAccount' } } }), beijingDay = () => '2026-11-17', validDay = day => day, inWindow = () => false;` };
    return next(url, context);
  } });
  process.argv = [process.execPath, fileURLToPath(runner), ...JSON.parse(process.env.L1_FAKE_ARGS)];
  await import(runner.href);
} else {
  let passed = 0;
  function run(args, { scenario = 'success', status = 0, message = /登录校验成功/, closed = true, timeout = '5000', reads } = {}) {
    const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--fake-child'], {
      encoding: 'utf8', timeout: 10000,
      env: { ...process.env, L1_FAKE_ARGS: JSON.stringify(args), L1_FAKE_SCENARIO: scenario, L1_LOGIN_TIMEOUT_MS: timeout },
    });
    assert.equal(result.status, status, result.error?.message || result.stderr || result.stdout);
    assert.match(result.stdout + result.stderr, message);
    const lines = result.stdout.split(/\r?\n/).filter(line => line.startsWith('FAKE_CLOSED '));
    assert.equal(lines.length, closed ? 1 : 0, result.stdout);
    if (closed) {
      const state = JSON.parse(lines[0].slice('FAKE_CLOSED '.length));
      const platform = args.includes('--login-wechat') ? 'wechat' : args.includes('--login-xhs') ? 'xhs' : 'x';
      assert.equal(state.platform, platform);
      const xNeedsLogin=['success','timeout','hidden-only'].includes(scenario);
      assert.deepEqual(state.urls, platform==='x' ? ['https://x.com/home',...(xNeedsLogin?['https://x.com/i/flow/login']:[])] : [platform === 'wechat' ? 'https://mp.weixin.qq.com/' : 'https://creator.xiaohongshu.com/new/home']);
      if (reads != null) assert.equal(state.reads, reads);
      if (scenario === 'success') assert.equal(state.sleeps, platform==='x'?0:1);
      if (scenario === 'timeout' || scenario === 'hidden-only') assert.equal(state.clock, Number(timeout));
    }
    passed++;
  }
  for (const flag of ['--login-xhs', '--login-x', '--login-wechat']) {
    run([flag, '--wait-login'], { reads: 2 });
    run([flag, '--wait-login'], { scenario: 'wrong', status: 1, message: /OtherAccount|账号.*不符/, reads: 1 });
    run([flag, '--wait-login'], { scenario: 'timeout', status: 1, message: /等待登录超时（5000 毫秒）/, reads: flag==='--login-x'?4:3 });
    run([flag, '--wait-login'], { scenario: 'read-error', status: 1, message: /模拟 DOM 读取失败/, reads: 1 });
    run([flag], { status: 1, message: /需要交互终端/, closed: false });
    for (const timeout of ['0', '-1', 'invalid', '1.5']) {
      run([flag, '--wait-login'], { timeout, status: 1, message: /必须为正整数毫秒数/, closed: false });
    }
  }
  run(['--login-x','--wait-login'],{scenario:'existing-session',reads:1,message:/已复用本专用窗口的登录状态/});
  run(['--login-x','--wait-login'],{scenario:'unknown',status:1,reads:1,message:/没有提供可确认的账号或登录入口/});
  run(['--login-x','--wait-login'],{scenario:'challenge',status:1,message:/等待登录超时/});
  run(['--login-xhs', '--wait-login'], { scenario: 'case', status: 1, message: /实际 twopeanuts/, reads: 1 });
  run(['--login-xhs', '--wait-login'], { scenario: 'hidden-only', status: 1, message: /等待登录超时/ });
  run(['--login-wechat', '--wait-login'], { scenario: 'hidden-only', status: 1, message: /等待登录超时/ });
  run(['--login-wechat', '--wait-login'], { scenario: 'ambiguous', status: 1, message: /歧义/ });
  run(['--login-wechat', '--wait-login'], { scenario: 'missing-account', message: /登录校验成功/ });
  run(['--login-wechat', '--wait-login'], { scenario: 'case', status: 1, message: /不符/ });
  run(['--login-wechat', '--login-x'], { status: 1, message: /请单独运行/, closed: false });
  run(['--login-wechat', '--only', 'wechat'], { status: 1, message: /请单独运行/, closed: false });
  run(['--wait-login'], { status: 1, message: /必须与/, closed: false });
  run(['--login-xhs', '--login-x', '--wait-login'], { status: 1, message: /请单独运行/, closed: false });
  run(['--login-xhs', '--wait-login', '--only', 'xhs'], { status: 1, message: /请单独运行/, closed: false });
  run(['--login-xhs', '--wait-login'], { timeout: '', status: 1, message: /必须为正整数毫秒数/, closed: false });
  const { loginTimeoutMs } = await import('../src/l1-login.mjs');
  const saved = process.env.L1_LOGIN_TIMEOUT_MS;
  try {
    delete process.env.L1_LOGIN_TIMEOUT_MS;
    assert.equal(loginTimeoutMs(), 600000);
    assert.equal(loginTimeoutMs('900000'), 900000);
  } finally {
    if (saved === undefined) delete process.env.L1_LOGIN_TIMEOUT_MS;
    else process.env.L1_LOGIN_TIMEOUT_MS = saved;
  }
  console.log(`PASS ${passed} 个 CLI/假 DOM 场景及默认 10 分钟/超时覆盖；正确账号退出 0，错误账号/超时退出 1，均执行假浏览器关闭。`);
  console.log('未启动真实 Chrome；未连接 9340/9341/9342；未打开数据库；未读取真实配置或凭据。');
}
