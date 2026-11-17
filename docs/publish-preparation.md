# L1 发布准备

范围：X 文图草稿包、小红书图文、公众号纯文字与本地配图。未接知识站或其他平台，不定时、不后台发布。原 `hub.mjs`、`driver.mjs`、`chrome-shim.mjs`、原插件/macOS 工作流均未修改。

2026-11-17 夜间更新：无调试端口的 Chrome CLI 已完成隔离真实 HTTP/SQLite 页面验收（登录、错误提示、深链、刷新、系统手动区、准备任务生成及 ZIP 下载），正式8787未登录页也有新截图。原调试启动的策略拒绝没有解除；Computer Use 独立标签页再次返回 native pipe `os error 2`。**本机页面测试通道可用，不等于平台执行通道可用**。真实安装的 `xhs-publish preflight` / `wechat-publish check` 经生产适配器实跑成功，只属离线素材检查。

## 从网页使用

打开 `http://127.0.0.1:8787/p#/system`，点击「准备发布」，或直接打开 `http://127.0.0.1:8787/p#/prepare`。需要工作台原有登录；不要把口令放进 URL。作品详情也有「准备发布」入口，可带入文案；已发布或已经准备到位的作品禁止重复准备。

1. 选择平台，填标题、正文；X可填0–4张图，小红书填1–9张图，公众号最多9张图并可填120字摘要。图片须为本机PNG/JPEG/WebP，单张≤32MB、整组≤64MB；网络共享路径、空文件和扩展名/文件头不符会拒绝。公众号首版不接富HTML/章节图。X会复制素材到被git忽略的本地任务目录，其他平台保留引用。
2. 点击「生成准备任务」。只在本机 `data/publish-prep/<随机ID>/job.json` 保存素材引用和 `submit:false`，记录存在独立 SQLite 表。不会进入平台，不会将原作品标为「已填好」。测试稿勾选测试标记后标题与正文都会标明。
3. X点击「下载X文图包」：ZIP包含完整`draft.txt`、按顺序编号的图片、使用说明和无绝对路径的`manifest.json`。源图后来改动不影响已准备的副本。由本人在自己的X窗口确认账号、粘贴正文、手工附图。文字Web Intent只作辅助，不附图；没有上传、平台草稿保存或发布证明。下载不把任务标为filled。入口正文上限仍为2000字符，不截断、不自动拆线程，平台长文权限由本人确认。
4. 小红书/公众号可显式运行本地skill离线检查。夜间已用隔离测试任务通过生产适配器实跑本机已有两个DSH离线命令，没有连接浏览器；此前仅替身测试的历史结论以此更新。小红书`promotionReview`仍须真实逐图审阅，本页不自动伪造“已审”记录。第三方脚本的原授权限制不变。
5. 当前「填写并上传 / 保存公众号草稿」禁用并说明阻塞。适配器代码已接入，但本机浏览器执行没有启用。本轮不尝试恢复或绕过被拒绝的启动。

## 引擎核实与边界

原版 `hub.runBatch → 发布助手 lib/publish.js.run → filled → after`：`config.manual` 中的平台置为 `awaiting_user`，网页显示等你点发布；其他平台可能自动提交，尤其 X，因此本实现不调用 hub run / submit。原版网页「切到页面」依赖原任务 tabId/driver；本实现不冒用旧 tabId。小红书成功后本地 skill 留下本次专用窗口，用户自行切换；公众号保存后由 skill 关闭自己的编辑器，用户自行打开后台草稿箱核对，不拼接认证编辑地址。

正式配置有 `driver:direct`，未配置 `pluginDir/rootPath`。夜间已下载官方publisher源码作只读核对，没有运行其脚本、修改正式配置或加载扩展。上游小红书适配是视频流程，公众号不在适配列表；因此图文/公众号仍接本地DSH skill。详细版本、源码证据、许可和手动加载步骤见 [引擎核对](publisher-engine-audit.md)。

基线 `pages.html` 的「等你点发布」区域实际只有「我已发布」标记按钮，未发现名为「切到页面」的网页动作；`board.html` 只对已有任务 URL 提供打开链接。shim 有 `Target.activateTarget`，但这不证明网页已经接通页面切换。本轮不伪造 tab ID 或公众号认证编辑链接：小红书保留真实专用窗口，公众号由用户从正常后台入口进入草稿箱。

Windows 原 direct shim 虽有 Chrome 路径候选，但仍含 `osascript/lsof/sips`，依赖外部发布助手目录，不等于已经适配。L1 原采集浏览器只提供受限导航与 DOM evaluate，不能上传文件或输入编辑器；不能直接把采集按钮改名为准备发布。

本适配器发现 `${用户目录}/.dsh/skills`，可用 `MAITIAN_LOCAL_SKILLS` 指向另一技能根。没有写死本机用户名/绝对安装目录，不修改本地 skill。支持的命令严格固定：小红书 preflight；小红书 post 固定 `--account ai --keep-browser`；公众号 check / post，永不带 `--submit`。任务固定 `submit:false`，不接受命令、任意参数或 account 覆盖。用户本次明确要求填好停在窗口，覆盖了 skill 正常结束关闭窗口的默认偏好；用户核对后自行关闭这个专用窗口。

只接受成功退出与结构化回执：小红书必须 `ok:true, submitted:false, dryRun:true`，公众号必须 `ok:true, submitted:false, savedAsDraft:true`；否则保持结果未确认，不自动重试。绑定作品成功后才写 `awaiting_user` / `draft_saved`，绝不自动写 published。重启时运行中记录变成 unknown，防止结果不明时直接重复操作。执行前要求本地检查通过且任务文件摘要未变化；skill 仍在上传前做其本身的素材审阅。原始 stdout/stderr 不落盘、不回显，只保存受限结果说明。

## 浏览器、人类动作和配置

上一轮独立 profile + 远程调试启动只返回 **`blocked by policy`**。这是审批/策略拒绝返回，但没有更细理由，不能声称已知具体安全原因，也无证据说是审批过期。Computer Use 另报 **native pipe `os error 2`**，属于工具失败。本轮没有尝试这些启动，也没换脚本/端口绕过。

保留证据：`_local-codex-upstream-compare.err.log` 中相应拒绝记录（含第 2553 行附近的固定错误短语）；既有 I11/I12 和用户本轮给定的上一轮结论。原日志不改、不整体复制，以免携带历史敏感上下文。

当前 `publishPrep.browserExecution` 缺省为 false。本轮未修改真实配置。它是执行开关，不是审批证明。**不能只切为 true 就视为获得授权或作为绕过旧拒绝的方式**；需今后有明确获准的执行通道，并核实该通道适用于当前引擎，维护者才能配置和验收。用户本机正常打开的窗口可以用于今后合规的手工验收；本轮没有接管任何已有登录窗口。

如以后获准使用本地 skill 的专用窗口，用户需亲自完成扫码/验证；小红书 ai 的可见身份由既有 skill 配置核验，公众号按现有专用窗口流程。没有复制 Chrome 登录态，不读取 cookie/token。体检/取链接新增层要求配置 `l1.<平台>.account` 为预期可见账号（X 可复用既有 `xHandle`）；沿用 L1 原来的专用 profile/端口限制。未配置就失败，不用隐含账号。

此版本不依赖Chrome扩展，也没有安装/加载证明。已有源码目录不等于扩展已加载；手动步骤见引擎核对文档。没有接管用户已登录Chrome。

L1预期账号现从`config.l1.<平台>.account`读取，X兼容`xHandle`；也可另建被git忽略的`MAITIAN_HOME/l1-accounts.local.json`，只含公开名称，例如`{"x":"YourHandle","xhs":"Your Creator Name"}`，或用`MAITIAN_ACCOUNTS`指定该文件。X两处显式配置冲突、格式错误、缺少预期账号均拒绝；仍是每平台单账号。路径通过`MAITIAN_HOME`、`MAITIAN_CONFIG`、`MAITIAN_DB`、`MAITIAN_LOCAL_SKILLS`配置。没有写入凭据、迁移profile或改变固定隔离端口。小红书发布别名始终固定`ai`，本地发布skill自己的身份约束原样保留。

## 体检与取链接

系统页体检动作是新增 L1 inspect CLI，只检查 X / 小红书 / 公众号可见账号身份，不读指标、不验证上传表单、没有七平台体检承诺。当前因浏览器开关关闭而禁用。原有登录等待和采集流程保持独立。

作品详情逐平台「取链接」从快照读稳定平台 ID，在可见已发布列表最多读取8轮，严格匹配 ID 和公开永久链接，二次核验身份后回写 `tasks.url/state` 及数据库日志。小红书审核中、公众号草稿、歧义、缺 URL、认证查询链接都失败，不编造。首版不回写工程里的 `发布记录.json/md`；新准备稿无平台 ID 时自动匹配未适配。没有拿到任何新真实链接。

## 验证层级

`scripts/publish-prep-selftest.mjs`：临时 SQLite/素材、模拟子进程/DOM，校验固定命令、开关、回执、摘要变化、重复/重启保护、账号/链接选择。

`scripts/l1-web-selftest.mjs`：临时配置/数据库和 loopback HTTP；验证鉴权、来源、动作白名单、准备任务/下载/X 跳转、互斥、阻塞、前端 VM 模板。没有运行本地发布 skill。

`scripts/web-headless-accept.mjs`：真实Chrome CLI无远程调试端口、无CDP、无扩展；临时SQLite和内存公开测试鉴权夹具，不读取正式口令。六个场景覆盖未登录、错误口令、首页/系统/准备页登录与刷新、系统跳转、X含图任务及ZIP下载；截图/结果均标明隔离数据。可用`CHROME_PATH`指定二进制，`MAITIAN_QA_OUT`指定证据目录。退出前关闭测试HTTP服务，不遗留平台写操作。

其他L1回归、公众号/X/登录自测仍为离线替身。新增`l1-account-selftest`验证不同配置身份及导航/作品过滤。本机真实页面测试不证明真实平台登录、X编辑器、小红书上传/留窗、公众号草稿保存或真实取链接，这些全部未验收。
