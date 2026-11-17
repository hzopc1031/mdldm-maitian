# Windows L1：独立工作台、页面采集和本地日报

在 `D:\AIInfra\maitian` 手动运行。工作台独立运行，不依赖 Grok Bot 或 inbox JSON。X 默认用专用 Chrome 读取 `@PeanutPair` 已渲染页面，小红书读取 `TwoPeanuts`（ai）创作者页面；`import-x-public.mjs` 保留为可选手工导入。没有发布、定时任务、开机自启、飞书同步或站点转化采集。原 hub 的发布与 daemon 命令不属于 L1。

## 配置与隔离

需要已安装的 Node.js 22.5+（内置 SQLite、WebSocket）和本机 Chrome，无需发布插件或 npm install。首次配置可复制 `config.example.json` 为 `config.json`；已有配置不要覆盖。L1 分平台配置：

```json
{
  "xHandle": "PeanutPair",
  "l1": {
    "x": {
      "chromeProfile": "D:\\AIInfra\\maitian\\chrome-profile-l1-x",
      "chromePort": 9341
    },
    "xhs": {
      "chromeProfile": "D:\\AIInfra\\maitian\\chrome-profile-l1-xhs",
      "chromePort": 9340
    }
  },
  "web": { "host": "127.0.0.1", "port": 8787 }
}
```

Chrome 不在常见位置时配置 `chromeBinary` 为 chrome.exe 完整路径。X 强制使用 `MAITIAN_HOME\chrome-profile-l1-x` 和 9341，绝不继承全局 chromePort/chromeProfile。小红书强制使用 `MAITIAN_HOME\chrome-profile-l1-xhs` 和 9340，兼容旧全局配置，优先使用 l1.xhs 配置。省略字段时采用对应专用默认值。9333/9334/9335 不用于 L1。

每次启动前检查本平台端口空闲，拒绝复用现有浏览器。调试地址仅 `127.0.0.1`，连接后核验本次子进程 PID、profile、端口和地址。采完关闭本次专用 Chrome；成功、失败或 Ctrl+C 均清理，仅针对持有的本次子进程，不按 Chrome 名称杀进程，不关闭日常 Chrome 或另一个平台的浏览器。程序不读取 cookie、token、profile 文件内容、storage 或框架内部状态。

默认库为 `D:\AIInfra\maitian\data\hub.db`。MAITIAN_HOME 改变默认数据、报告和专用 profile 根目录；MAITIAN_DB 单独指定库；MAITIAN_CONFIG 单独指定配置文件，显式指定时必须存在。无配置文件也能采用 L1 默认值。配置示例中的 database/xInbox/reports 仅为路径说明，实际以环境变量及入口参数为准。

config.json、data/、inbox/、reports/ 下的运行数据及 chrome-profile*、_local-*、_l1-selftest*、_chrome-shot* 不提交。MIT LICENSE 保持原样。

## Liu 登录 X（单独手动运行）

本轮交付没有运行登录命令，没有启动真实 Chrome。Liu 验收后在交互式 PowerShell 运行：

```powershell
Set-Location D:\AIInfra\maitian
node scripts/l1-run.mjs --login-x
```

仅启动 `127.0.0.1:9341` 对应的 `D:\AIInfra\maitian\chrome-profile-l1-x`，打开 `https://x.com/i/flow/login`。终端提示「请 Liu 在该窗口登录 @PeanutPair，不要登录其他号」。登录完成后回车，程序打开主页，从当前账号切换器读取可见账号，必须是 PeanutPair（允许带 @、不区分大小写）。浏览中的主页作者不作为登录身份。无法确认或账号不符立即失败；成功或失败都关闭本次浏览器。登录命令不打开数据库、不采集、不写日报，Chrome 自行保存会话。

小红书登录保持原样，独立执行：

```powershell
node scripts/l1-run.mjs --login-xhs
```

只启动 9340 的专用 Chrome，提示 Liu 登录 TwoPeanuts；回车后返回首页核验可见昵称。成功或失败均关闭本次浏览器，不打开数据库或写日报。两个登录参数都必须单独运行。

## 默认采集与日报

```powershell
Set-Location D:\AIInfra\maitian
# X Chrome：发现 + 粉丝 + 逐帖 → 小红书 → 日报
node scripts/l1-run.mjs
# 只做 X Chrome 采集和日报，不启动小红书 Chrome
node scripts/l1-run.mjs --only x
# 只做小红书和日报
node scripts/l1-run.mjs --only xhs
```

X 采集前验证当前可见登录账号为 @PeanutPair。低频滚动主页，从主帖作者、时间及 permalink 判断，按 statusId 去重，只登记距采集开始时刻近 30×24 小时内 PeanutPair 的原创帖和引用帖。排除转推、回复及其他作者；引用卡片的作者、时间和指标不作为主帖信息。没有可靠时间的跳过并计数，不推断为近期帖。遇到旧置顶继续滚动；连续三轮都是窗口外帖子且无近期帖，或到末尾连续三轮无新卡片时结束。最多 120 轮；主页为空或到上限仍无法确认结束则失败，不落库。

粉丝沿用原 followers 页面方法：读取主页 `a[href$="/verified_followers"]` 或 `a[href$="/followers"]` 的渲染文本并换算数值。新发现和已登记的 PeanutPair 帖子 URL 合并去重，逐帖打开，读取第一个主帖 permalink 匹配目标的 article 中 `[role="group"][aria-label]`。解析 views/likes/replies/bookmarks/reposts，映射为 views/likes/comments/favorites/shares。缺项保持 NULL；明确显示 0 才记录 0。粉丝读不到保持 NULL。只导航主页、登录页和单帖页，不主动调用 X 内部接口，不点赞、关注、回复或转发。操作及补读之间均随机等待，导航后等待渲染。

每轮滚动、逐帖及写库前再次校验账号，失败则整次 X 观测不写库。初次账号验证前不打开数据库，最终校验成功并关闭专用 Chrome 后才事务落库。不可读的单帖指标为空，不把未匹配结果当 0。

与现有 226 条 grok-public 公开数据按 statusId 幂等合并，不清表、不删除、不复制 episode，保留原登记。当前来源为 chrome/page，快照和指标 extra 的 sources 同时保留历史 grok-public 与新来源。同日旧观测不覆盖更新观测；NULL 保留已有非空值及字段观测时间，跨日可沿用已有值，字段时间仍标明旧时间。samples 按 UTC 分钟幂等，粉丝非 NULL 才更新，gain/loss 不估算。

小红书继续只读创作者页面，采集前和写库前核验 TwoPeanuts。粉丝从 statistics/fans-data 的可见「粉丝总数」标签读取；作品从 note-manager 批量读卡片，随机间隔滚动/翻页，noteId 去重。只接受可靠完整年月日和近 30 个北京时间自然日，日期未知跳过计数，五项统计缺项保持 NULL。空卡片页或达到遍历上限会失败；先前成功的 X 观测保留，可安全重跑。

日报写入 `reports\daily\YYYY-MM-DD.md` 并更新 `reports\latest.md`。--date YYYY-MM-DD 控制日报截止日期和手工导入/小红书自然日窗口；X 发现始终以实际采集时刻计算近 30 天。指标 day 取观测时间的北京时间日期，不由 --date 改写。日报展示粉丝、较上次实测新增、可得指标和观测时间；无基线写「暂无」，不把累计粉丝当新增。--report-dir 可另设目录。成功退出 0，失败退出 1，Ctrl+C 退出 130。

DOM 选择器已用模拟页面验证，真实页面仍待 Liu 登录后验收；页面变化时失败或保留缺项，不伪造结果。

## 可选手工 JSON 导入

不要求 Grok Bot，可将人工整理的公开数据存为 JSON。字段契约见 [示例 JSON](examples/x-sample.json)，明确是假数据，sample 链接不是真实帖子。真实数据必须使用真实 statusId，不可见字段为 null，观测时间必须含时区，账号和 URL 必须匹配 PeanutPair。

```powershell
# 导入替代 X Chrome，随后只写日报
node scripts/l1-run.mjs --only x --import-x inbox/x/x-2026-11-17.json --date 2026-11-17
# 导入后继续采集小红书和写日报
node scripts/l1-run.mjs --import-x inbox/x/x-2026-11-17.json
# 独立脚本保留
node scripts/import-x-public.mjs inbox/x/x-2026-11-17.json
```

L1 仅显式传 --import-x（兼容旧别名 --x-json）时导入，不自动查找 inbox JSON。独立导入脚本省略路径时仍查找当天文件。整体先校验再事务写入；已知窗口外帖子跳过，未知日期保留并标记 unknown（Chrome 新帖发现则必须有可靠时间）。JSON 来源标记 grok-public，quotes 存在 extra，合并规则与页面观测一致。

## 离线自测

```powershell
Set-Location D:\AIInfra\maitian
node scripts/l1-x-selftest.mjs
node scripts/l1-selftest.mjs
node scripts/l1-regression-selftest.mjs
```

第一条用自构造 document 执行实际 DOM 函数，覆盖粉丝、目标帖指标/缺项、原创/引用/转推/回复/作者、30 天及未知日期、错误账号零写入、模拟采集、入口分流及临时库合并。后两条回归导入、日报和现有页面兼容性。均不启动真实 Chrome，不连接 9340/9341，不打开正式库，不安装依赖。命令及关键输出保存在 `_l1-selftest-x-output.txt`、`_l1-selftest-output.txt`、`_l1-selftest-regression-output.txt`，临时库和日志不进 Git。

## 回退

先停止手动运行的 L1，再执行 `git switch main`。不删除远程 main，不改 SSH 密钥或全局 Git 配置。切分支不会删除被忽略的本地库、profile 和报告；需要时手动备份。保留现有库，以后仍可按 id 继续合并。
