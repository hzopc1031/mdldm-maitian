# Windows L1：公开导入、只读采集和本地日报

在 `D:\AIInfra\maitian` 手动运行，只使用 X `@PeanutPair` 和小红书 `TwoPeanuts`（ai）。X 由 Grok 读取公开数据，人工保存 JSON 后导入；L1 不打开 X 网页。小红书只读取已渲染页面，禁止内部指标接口、发布、关注或改设置。没有定时任务、开机自启、飞书通知、多维表格同步或站点转化采集。原 hub 的发布与 daemon 命令不属于此流程。

## 配置与数据隔离

需要已安装的 Node.js 22.5+（内置 `node:sqlite`）和本机 Chrome。无需发布助手插件，也无需 npm install。首次配置可复制 `config.example.json` 为 `config.json`；已有配置不要直接覆盖，修改这些字段即可：

```json
{
  "xHandle": "PeanutPair",
  "chromeProfile": "D:\\AIInfra\\maitian\\chrome-profile-l1-xhs",
  "chromePort": 9340,
  "web": { "host": "127.0.0.1", "port": 8787 }
}
```

Chrome 不在常见安装路径时可增加 `chromeBinary`，值为 chrome.exe 的完整路径。L1 强制检查端口为 9340，profile 为 `MAITIAN_HOME\chrome-profile-l1-xhs`；拒绝复用已被占用的端口，不连接 9333/9334/9335。调试地址仅限 127.0.0.1。每次只关闭本次启动且核验归属的浏览器；异常时仅对子进程 PID 做清理，不按 Chrome 名称杀进程。

默认正式库为 `D:\AIInfra\maitian\data\hub.db`，与 `demo\` 完全分开。`MAITIAN_HOME` 改变默认数据、inbox、报告和 profile 的根目录；`MAITIAN_DB` 单独指定库；`MAITIAN_CONFIG` 单独指定配置文件。显式指定的配置文件必须存在。没有正式配置时，X 导入仍能运行。示例 JSON 只导入临时库，不要放入正式数据目录。

`data/`、`config.json`、`demo/`、`chrome-profile*/`、`inbox/` 中的真实文件和 `reports/daily/`、`reports/latest.md` 均不进 Git。目录按需自动创建。配置示例中的 `l1` 块是路径说明，运行路径以环境变量和入口参数为准。

## 导入 X 公开数据

请 Grok 只读取 PeanutPair 近 30 天的公开作品，包含各帖链接、原文或摘要、实际发布时间、观测时间和公开统计；不可见的数字必须为 null，不要估算。保存为 `inbox\x\x-YYYY-MM-DD.json`。字段契约见 [示例 JSON](examples/x-sample.json)，它明确是假数据，sample 链接不对应真实帖子。真实帖子必须使用真实 statusId。

```powershell
Set-Location D:\AIInfra\maitian
node scripts/import-x-public.mjs inbox/x/x-2026-11-17.json
# 只导入 X 并生成日报，不加载或启动 Chrome：
node scripts/l1-run.mjs --only x --date 2026-11-17 --x-json inbox/x/x-2026-11-17.json
```

省略文件参数时，独立导入脚本查找今天北京时间日期的 JSON；L1 入口查找 `--date` 指定日期的 JSON。指标的 day 永远取 `captured_at` 的北京时间日期，不由 `--date` 改写。`--date` 用于近 30 个自然日筛选和日报截止日。已知发布时间超出窗口的帖子跳过；X 发布时间未知时保留并标记 unknown。观测时间必须含时区，URL 必须与 PeanutPair 和 id 严格一致。整个输入先校验，再以事务写入；非数字、负数和错误账号会失败。

同一个 id 不复制 episode/task；旧观测不覆盖新观测。同日新观测中的 null 保留已有非空值，并保留该字段原观测时间；quotes 存入 extra。粉丝非 null 才写，gain/loss 不推算。相同 UTC 分钟的 samples 幂等。公开数据可能有舍入，数据库和日报均标注来源、精度与观测时间。

## Liu 首次扫码登录（需手动运行）

本轮代码交付没有运行此命令。验收后由 Liu 在交互式 PowerShell 运行：

```powershell
Set-Location D:\AIInfra\maitian
node scripts/l1-run.mjs --login-xhs
```

只启动 9340 对应的专用 Chrome，并打开小红书创作者首页/登录页。终端会提示「请 Liu 在该窗口扫码登录 TwoPeanuts，不要登录其他号」。Liu 扫码完成后回车，程序返回首页读取可见昵称；必须严格等于 TwoPeanuts。成功或失败都会关闭本次浏览器。登录状态由 Chrome 自行保存于专用 profile，程序不读取 cookie、token 或 storage。登录命令不打开数据库、不生成日报。

## 跑 L1

```powershell
# X JSON → TwoPeanuts 只读采集 → 本地日报
node scripts/l1-run.mjs --date 2026-11-17
# 仅小红书 → 本地日报
node scripts/l1-run.mjs --only xhs --date 2026-11-17
```

采集前和写库前校验可见昵称。粉丝从 `statistics/fans-data` 页的「粉丝总数」等可见标签读取，无法可靠识别就失败，不写 0。作品在 note-manager 同一页批量读取卡片，按随机间隔滚动/翻页，noteId 去重；只接受页面可见的完整年月日和近 30 天窗口。日期不明的作品跳过并打印数量，不当成近期作品。只采卡片五项统计（浏览、评论、点赞、收藏、分享），缺失写 NULL。只有页面确实出现的不带签名公开链接才保存 URL，否则仅保留 noteId 和状态。

页面结构变化、空卡片页或达到 120 轮上限会失败，本次小红书观测不落库；不会把读不到解释成 0。此版本 DOM 选择器尚待 Liu 登录后实测验收。若小红书阶段失败，先前成功的 X 导入会保留；修复后可安全重跑。

日报写入 `reports\daily\YYYY-MM-DD.md` 并更新 `reports\latest.md`。包含两个账号粉丝、较上次实测的新增、每篇可得统计和观测时间；没有基线写「暂无」，不会把累计粉丝当今日新增。粉丝基线是最近一次更早的观测，可跨日；当日没有观测会展示截止日期前最新值及其时间。`--report-dir` 可改变报告目录。成功退出 0，任一阶段失败退出 1；Ctrl+C 退出 130。入口打印实际库路径。

## 离线自测

```powershell
Set-Location D:\AIInfra\maitian
node scripts/l1-selftest.mjs
```

只运行新写的导入与日报代码；使用 `examples/x-sample.json` 和 `_l1-selftest\hub.db`，不启动 Chrome、不连接 9340、不打开正式库。覆盖幂等、NULL、时间映射、错误输入零写入和日报示例标识。命令及关键输出保存在 `_l1-selftest-output.txt`，这些临时文件均被 gitignore 排除。

## 回退

先停止手动运行的 L1，再执行 `git switch main`。不删除远程 main，不改 SSH 密钥或全局 Git 配置。切分支不会删除被忽略的本地库、profile 和报告；确认不再需要后可手动备份或删除，保留库则以后可继续幂等导入。MIT LICENSE 保持原样。
