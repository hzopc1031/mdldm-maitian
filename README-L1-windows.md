# Windows L1：独立工作台、页面采集和本地日报

2026-11-27 当前状态以[交接文件](docs/handoff.md)为准：X通用多账户及评论接口已上线，首条真实评论已公开并同ID只读补验；第二账户尚未登录绑定，显示窗口的9410端口兼容问题已定位、尚未修复；零点任务尚未恢复。下文按日期保留历史记录。

2026-11-21登录状态：账号卡直接显示已登录、未登录及确认/未知状态。已保存会话自动复用；识别正确账号后自动保存、刷新和关窗，不需要手动关窗或回来确认。公众号先恢复本专用目录的后台主页，不移动其他profile的会话；真正返回扫码页时仍由本人按微信官方流程验证，其余自动完成。窗口提前关闭明确提示未确认，不长时间占用任务。

2026-11-21最新平台规则：全部8个社交平台集中在「账号与采集」公开显示；总览仅显示常用平台数据和管理入口，由用户自由加入/移出常用，默认不预选；登录成功也会加入。B站入口为“总览→管理平台（未选择时为选择平台）→全部平台→B站→登录与采集”，其他平台同样操作。原生B站/抖音/视频号/YouTube/Instagram方式更新已登记作品，可在平台卡片登记链接与发布时间；与X/小红书/公众号的列表发现方式不同。原生方式已接回独立浏览器适配，仍待本人登录后做真实数据验收。零点任务只处理用户所选且有成功身份记录的平台，无选择正常跳过。下文按日期保留的“三平台限定／默认三平台”等旧说明以最新台账为准。

2026-11-21现行规则：已配置Codex本聊天每天北京时间00:00运行`scripts/l1-midnight.mjs`，通过工作台8787互斥入口采集前一天发布的作品。手动“更新今日作品数据”只检查当天00:00至点击时发布的作品；不会再逐篇刷新全部历史登记帖子。数字为逐篇读取时的累计值，不等于全账号这段时间新增流量或精确零点快照。默认日采集，显式`--history`才走历史流程。电脑需唤醒、Codex及工作台需运行，失效登录由本人处理；定时只处理已有成功登录记录的平台。首次真实日采集4篇、94秒通过，零点实际调度尚未到时。最新状态见[台账](docs/issue-register.md)。下文“手动模式／尚未定时”等旧段落按历史理解。

2026-11-20补充：首次登录后可直接点“更新数据”，无需每次先登录。系统显示最近一次账号确认时间；刷新或重启工作台不注销专用浏览器会话，平台会话失效仍需本人重新登录。首页导入卡片是已入库样本，可能包含置顶；日历“暂无入库记录”不等于当天没有发布，缺少发布时间的作品不会按采集日归入发布日历。当前X仅一篇认证样本更新，18/19仍待补采。详见[最新台账](docs/issue-register.md)。

## 本机当前入口（2026-11-19）

正式仓库已迁至 `D:\Ai Infra Tools\DeepSeek Harness\AI自媒体工作台\repo`，使用 `http://127.0.0.1:8787/`。下文 `D:\AIInfra\maitian` 是历史示例，不再作为本机路径。迁移后的启动器和备份说明见项目根 `INDEX.md`；最新验收与未完成项见 [问题台账](docs/issue-register.md)。归档工作树不可直接用于 Git 写操作。

L1 仍是手动采集模式。X 与公众号的**采集专用 profile**和文图填写 / 草稿保存的 profile 分开，后者登录成功不代表前者已登录。数据汇总与新生成的日报显示更新状态；当日未更新或部分更新时，当日发文累计保持暂无，历史累计仍保留。

X 文图填写已于 2026-11-19 11:18 在正式工作台通过验收，当前配置仍关闭，仅填写不发布。公众号测试稿可见但旧工作台任务仍为 unknown，禁止重复建稿。下方按日期保留的历史“未验收”结论以最新台账为准。

2026-11-17夜间更新：下文个人账号为本机示例，通用L1代码已改为读取预期身份配置。X使用`xHandle`或`l1.x.account`，小红书使用`l1.xhs.account`；也可另建被git忽略的`MAITIAN_HOME/l1-accounts.local.json`，例如`{"x":"YourHandle","xhs":"Your Creator Name"}`。此文件只放公开名称，不放登录数据；用`MAITIAN_ACCOUNTS`可另指定位置。仍只支持每平台单账号，发布别名固定ai。网页已增加[X文图包与发布准备](docs/publish-preparation.md)，本轮已实际打通小红书ai上传填写及留窗；X/公众号真实确认待本人登录，正向取链接仍未通过。无调试端口的[真实页面验收脚本](scripts/web-headless-accept.mjs)可运行；它使用隔离数据，不代表真实平台登录/采集已通过。

在 `D:\AIInfra\maitian` 手动运行。工作台独立运行，不依赖 Grok Bot 或 inbox JSON。X 默认用专用 Chrome 读取 `@PeanutPair` 已渲染页面，小红书读取 `TwoPeanuts`（ai）创作者页面；公众号通过 `--only wechat` 单独采集。`import-x-public.mjs` 保留为可选手工导入。没有发布、定时任务、开机自启、飞书同步或站点转化采集。原 hub 的发布与 daemon 命令不属于 L1。

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

### 远程登录：自动轮询，无需回车

Grok Bot 可在非 TTY 后台启动，再截取专用窗口的二维码给 Liu 扫码：

```powershell
Set-Location D:\AIInfra\maitian
node scripts/l1-run.mjs --login-xhs --wait-login
# X 同样支持，校验当前登录账号 @PeanutPair
node scripts/l1-run.mjs --login-x --wait-login
```

两条命令分别运行。`--wait-login` 跳过 TTY 检查和回车等待，打开登录/首页后每隔随机 1.8–3.2 秒只读可见 DOM，不刷新二维码页面。小红书可见昵称必须严格等于 `TwoPeanuts`；X 只认当前账号切换器的 `@PeanutPair`（允许省略 @、不区分大小写），不把主页作者当登录账号。发现其他已登录账号立即失败；未登录则继续等待。默认等待最多 10 分钟，最后一次等待不超过剩余时长，可用环境变量覆盖：

```powershell
$env:L1_LOGIN_TIMEOUT_MS = '900000' # 15 分钟，正整数毫秒
node scripts/l1-run.mjs --login-xhs --wait-login
Remove-Item Env:L1_LOGIN_TIMEOUT_MS
```

校验成功退出 0，账号不符、超时或其他错误退出 1。成功和失败均由现有归属校验与清理流程关闭本次专用 Chrome；小红书仍只用 `chrome-profile-l1-xhs` / `127.0.0.1:9340`，不会关闭日常 Chrome 或 9341 的 X 浏览器。登录过程不打开数据库、不采集、不写日报，不读 cookie、token 或 storage。省略 `--wait-login` 时仍使用原有交互回车模式。

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

新增登录自测：`node scripts/l1-login-selftest.mjs`。用假页面执行实际身份 DOM 函数和 CLI，覆盖正确/错误账号、超时、关闭及非 TTY 参数分流；不启动真实 Chrome，不连接 9340/9341，不打开任何数据库。

```powershell
Set-Location D:\AIInfra\maitian
node scripts/l1-x-selftest.mjs
node scripts/l1-selftest.mjs
node scripts/l1-regression-selftest.mjs
```

第一条用自构造 document 执行实际 DOM 函数，覆盖粉丝、目标帖指标/缺项、原创/引用/转推/回复/作者、30 天及未知日期、错误账号零写入、模拟采集、入口分流及临时库合并。后两条回归导入、日报和现有页面兼容性。均不启动真实 Chrome，不连接 9340/9341，不打开正式库，不安装依赖。命令及关键输出保存在 `_l1-selftest-x-output.txt`、`_l1-selftest-output.txt`、`_l1-selftest-regression-output.txt`，临时库和日志不进 Git。

## 公众号只读采集（wechat）

平台 ID 为 `wechat`，显示名称为「公众号」，与视频号 `channels` 分开。默认无参数命令仍采 X 和小红书；公众号必须显式选择。X 的发布仍交给 Grok Bot，本功能不发布任何内容。保留项目原 MIT LICENSE；新增消息图形由本项目绘制，不复制第三方品牌 Logo。

在现有配置的 `l1` 中合并以下片段（不要覆盖整个 `config.json`）：

```json
{
  "wechat": {
    "account": "你的公众号可见名称",
    "chromePort": 9342
  }
}
```

可选 `account`：若配置则必须与可见公众号名称精确匹配（区分大小写）；未配置时只要已进入后台且可见唯一公众号名称即视为成功，并把该名称写入观测。未登录、名称不符、出现多个可见名称或来源不符都停止，不写库。不从文章作者推断登录身份。不要配置 Cookie、token、AppSecret 或其它凭据。本次代码变更只修改 `config.example.json`，不读取或改写你的实际配置。

默认 profile 为 `D:\AIInfra\maitian\chrome-profile-l1-wechat`；设定 `MAITIAN_HOME` 时变为该目录下的 `chrome-profile-l1-wechat`。也可在 `l1.wechat.chromeProfile` 显式填写同一绝对路径，其他路径会被拒绝。公众号不继承全局 `chromePort` / `chromeProfile`；只允许 `127.0.0.1:9342`，不会复用 9333–9336 的发布浏览器、9340 的小红书、9341 的 X 或日常 Chrome。

```powershell
# 请先在配置中填写预期的公众号可见名称
node scripts/l1-run.mjs --login-wechat --wait-login
# 之后手动运行采集；以下日期仅作命令示例
node scripts/l1-run.mjs --only wechat --date 2026-11-17
```

登录只打开 `https://mp.weixin.qq.com/`，由 Liu 在专用可见窗口扫码。`--wait-login` 支持非 TTY，每隔随机 1.8–3.2 秒读取可见账号，不刷新二维码、不要求回车；默认超时 600000 毫秒，沿用 `L1_LOGIN_TIMEOUT_MS` 正整数覆盖。正确账号退出 0；错号、歧义、读取失败或超时退出 1。省略 `--wait-login` 时需要 TTY，扫码后回车校验。三种 `--login-*` 互斥且只能附加 `--wait-login`；单独使用 `--wait-login` 会报错。登录不导入存储模块、不建库、不采集和不生成日报。

本功能始终显示窗口，不加 `--headless`，启动使用 `windowsHide:false`。若 9342 已占用，启动前直接失败，绝不连接或关闭已有浏览器。连接后核验本次子进程 PID、专用 profile、9342 和 loopback 参数，再进行 DOM 操作；重复或冲突的启动参数也拒绝。成功、异常、超时、Ctrl+C 均走同一幂等清理流程；只关闭通过归属校验的会话，必要时仅终止持有的本次子进程树，不按 Chrome 名称或端口杀进程。

采集先校验账号，再低频点击可见的「用户分析/用户增长」及「内容分析/发表记录/已发表」只读菜单。粉丝只接受明确的总用户/总粉丝标签；歧义或不可见保持 NULL。文章使用可见卡片或表格、可见完整年月日、可见指标标签或列标题；不猜测指标列顺序。不主动请求 `cgi-bin/appmsg`、`getuseranalyse` 或任何内部接口，不拦截 XHR/fetch，不读 Cookie、token、storage、profile 文件或框架内部状态。Chrome 自身为显示页面产生的请求不由采集器读取。

主动导航白名单只允许精确的 HTTPS 公众号根入口；后台路径、query、hash、用户名密码、显式端口（包括 :443）、其它域名和跨平台 URL 均拒绝。登录后仅通过可见菜单操作后台，不构造 token URL，也不把后台地址、整页 DOM 或整页文本存入数据库/日志。公开文章链接仅保存无 query/hash 的 `https://mp.weixin.qq.com/s/{id}`；含查询参数的文章链接只提取可靠 mid/appmsgid 与 idx，不保存原 URL，无法取得安全公开链接时 URL 为 NULL。数据属性 ID、mid/appmsgid 或公开短链 ID 都可用于稳定去重；同一多图文的 idx 会区分文章。

每轮等待、核验账号并批量读取卡片，按 ID 去重。窗口由 `--date` 控制：该北京时间自然日及之前 29 日，包含截止日，排除未来和第 30 日以前的文章。无完整可靠日期、非法日期、草稿/未发表/审核中文章跳过计数；旧置顶不会截断遍历。最多 120 轮，通过滚动或可见「下一页」继续，必须看到明确末页；空作品页或上限仍未确认完成则失败，不写入本轮观测。选择器或菜单不匹配时，请先调整 DOM 适配，不能把离线测试当作真实页面验收。

阅读/浏览 → `views`，点赞 → `likes`，留言/评论 → `comments`，分享/转发 → `shares`。只记录实际可见数值，支持逗号与万/亿/K/M，数值可能四舍五入；缺项、破折号或相互冲突的值保持 NULL，明确的 0 保留。收藏 `favorites` 保持 NULL；在看存于 `metrics.extra.watching`，其观测时间为 `field_observed_at.watching`。

整个浏览器阶段结束并再次确认账号、关闭专用 Chrome 后，才打开数据库事务写入。复用 episodes/tasks/metrics/samples/followers/snapshots，不清表。文章 ID 为 `external:wechat:{id}`；快照包含 account、appmsgId/postId 和 platforms.wechat，来源为 `wechat-visible-dom`。同 ID 幂等，旧观测不覆盖新观测，NULL 保留已有非空值及原字段时间，粉丝 NULL 不写；gain/loss 不估算。观测 day 始终取 captured_at 的北京时间日期，不由 `--date` 改写。已有文章若属于另一账号则整轮回滚。

日报列出已观测公众号账号、总粉丝、较上次实测新增、文章阅读/点赞/留言/分享/在看及观测时间。缺项和没有基线的新增显示「暂无」，不把累计粉丝当作新增；沿用历史值时说明原字段时间。工作台和小组件平台顺序中，公众号位于小红书之后，与视频号分列。

### 公众号离线验收

```powershell
node scripts/l1-login-selftest.mjs
node scripts/l1-wechat-selftest.mjs
node scripts/l1-x-selftest.mjs
node scripts/l1-selftest.mjs
node scripts/l1-regression-selftest.mjs
```

公众号自测使用手工构造的 document 执行真实 DOM 函数、内存假浏览器、实际 CLI 分流与隔离临时 SQLite，覆盖身份/超时/隐藏与歧义/日期窗口/NULL与0/在看/敏感链接过滤/端口profile归属/幂等和历史值/日报/API overview 与 detail/大屏模板。登录自测覆盖三个平台的非 TTY 轮询，不启动真实 Chrome，不连接任何调试端口，不打开正式 `data\hub.db`，不读取实际配置或 profile。公众号结果保存到 `_l1-selftest-wechat-output.txt`，已有 `.gitignore` 的 `_l1-selftest*` 同时忽略该日志和临时文件。真实公众号页面需另由 Liu 手动登录后验收，本次不操作已登录 Chrome。

## 回退

先停止手动运行的 L1，再执行 `git switch main`。不删除远程 main，不改 SSH 密钥或全局 Git 配置。切分支不会删除被忽略的本地库、profile 和报告；需要时手动备份。保留现有库，以后仍可按 id 继续合并。

## 2026-11-20 系统页登录入口

打开 http://127.0.0.1:8787/p#/system，各平台点击「登录」，在本机专用窗口完成操作；系统自动确认预期账号。页面持续显示进度，可点「显示登录窗口」或「取消登录」。登录完成后点「更新数据」，一次采集流量和粉丝并生成本地日报。采集窗口与准备发布窗口分开，账号检查一般无需单独执行。真实平台登录成功需本人完成，隔离UI/空白窗口验收不代表平台登录已通过。当前Node12428/隐藏启动器22872，最新状态以问题台账为准。
## 2026-11-20 X手动登录入口（待本人确认结果）

项目根新增 `X工作台-手动登录.lnk`，直接运行普通Chrome，使用同一个 `repo/chrome-profile-l1-x` 专用目录，打开官方账号页。该入口没有自动化控制、调试端口或显式代理参数；使用Windows现有网络配置，不复制日常Chrome登录数据。

先通过快捷方式打开，由本人完成X要求的正常登录/验证。完成后关闭该专用浏览器，再从工作台更新数据。这个手动入口不自动确认账号；窗口关闭也不等于验证成功，采集时仍须核对可见账号。手动窗口未关时不要同时点工作台登录或更新数据。

本轮已创建并读回快捷方式，Chrome PID16116启动；实际平台登录结果等待本人确认，不能标为已经可用。证据为项目根evidence/x-manual-login-20261120/。
### 2026-11-20 手动入口修正（优先于上文账号页说法）

`X工作台-手动登录.lnk` 当前打开 `https://x.com/home`。必须看到主页/通知/发布等登录后菜单及自己的当前账号，不能用公开个人资料页当成登录完成的证明。本人完成后关闭该专用窗口，再运行工作台采集。公开一篇样本已更新，但完整X认证采集仍待核验。
### X日常使用（2026-11-20真实小范围验收通过）

需要本人登录时，用项目根「X工作台-手动登录.lnk」打开/home，完成官方登录后关闭该专用窗口。随后工作台登录检查会复用该目录中的状态，无需重复进入登录页。身份检查已适配只显示头像的Account menu。日常点「更新数据」执行原完整采集，可能耗时较长；本轮仅验收一篇，页面如实显示部分更新，不代表227篇已全部更新。手动浏览器和采集不能同时占用该目录。

## 麦田外网入口

AI 交稿入口见 [项目交稿和继续操作](docs/publish-preparation.md#codex-项目交稿与回执)：只按栏目归档，记录交稿AI与后续执行AI；沿同一 ID 查询、检查及填写/存草稿。外部已发回填和测试记录单独标明，不冒充经过麦田公开发布。

从外网打开 [麦田工作台](https://110.40.227.27:80/)。首次在家里电脑打开[密码设置页](http://127.0.0.1:18791/)并设置独立访问密码。登录后使用台式麦田的页面、实时数据与操作接口。采集、发布准备等操作由家里的麦田运行，涉及平台登录的专用浏览器窗口也开在家里电脑上。

家里电脑需要开机联网，麦田与远程查看进程需要运行。工作台继续使用本机 8787。远程进程使用 `scripts/maitian-remote-view.mjs`，会重新连接腾讯云 SSH。家里电脑重启后可从仓库根用现有 Node 启动这个脚本。设置文件位于当前 Windows 用户的 Local AppData，保存带盐校验值。会话会随远程进程重启结束。

腾讯云的 `maitian-remote-entry.service` 和 `maitian-remote-tls.service` 可随云服务器启动。Caddy 负责公网 IP 证书，SSH 转发只监听云端回环地址。2026-11-23 首次证书签发、外网 HTTPS、未设置密码时的访问拦截已验证。登录和只读数据用隔离密码验收，实际密码由本人设置。

2026-11-23 补验时，家里直连、AWS 和阿里云均以公信证书读取到 `:80` 的登录页。独立 Chrome 的桌面与窄屏窗口也完成页面渲染。腾讯云实例临时监听 443 期间，家里和 AWS 连接仍超时，测试监听已清理。使用标准 HTTPS 地址前须核对腾讯云的入站规则。用户外出设备的具体错误仍待核实。

同日手机 5G 截图显示「请求来源不符」。隔离 Chrome 真实提交表单复现 `Origin: null` 和 HTTP 403。远程页面的 `Referrer-Policy` 改为 `same-origin` 后，390px 视口下真实表单携带正确来源，HTTP 303 后读到只读作品页。跨站与 `Origin: null` 的直接请求仍返回 403。手机实机待重新打开入口读回。

Liu 随后要求外网使用完整工作台。外网入口已改为转发台式麦田的页面与操作。手机宽度的隔离 Chrome 通过 HTTPS 登录并保留作品库深链，总览、数据统计、发布日历、作品库、账号与采集和发布六个页面均已渲染，视频编辑页已加载。源码与静态资源逐字节一致，实际 285 条作品 ID 和常用平台顺序一致。外网 POST 到真实工作台的状态接口返回 200，隔离库通过外网入口更新常用平台并从台式读回，跨站 POST 返回 403。

外网的「项目调度台」使用同一登录会话，直达 [项目调度台](https://110.40.227.27:80/agents/)。390px 的浏览器实测从麦田点入、读到与台式相同的 16 个项目、点回麦田。真实操作接口用无效参数到达原校验分支，无任务派发。台式入口继续连接本机 3351。
