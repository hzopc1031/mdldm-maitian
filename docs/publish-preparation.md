# L1 发布准备

## 2026-11-18 网页填写上传

网页准备任务显式填写上传小红书

入口：`http://127.0.0.1:8787/p#/prepare`。选择小红书、选图、填写标题正文及真实逐图审阅记录，点击「生成准备任务」→「运行本地 skill 离线检查」→「填写上传（不发布）」。账号固定 ai / TwoPeanuts；调用既有 xhs-publish，固定 `--account ai --keep-browser`、`submit:false`，不带 `--submit`。回执持久化并显示运行中、检查失败、结果未知或已填待手动发布；摘要相同的创建/已完成执行复用原记录，结果未知不重跑，图片变化需重新检查。

当前配置未设置 publishPrep 开关，源码缺省允许已安装的本地 skill；全局或单平台显式 `browserExecution:false` 可停用。这只决定用户显式执行按钮是否可用，不会自动操作平台。此说明替代下文历史禁用结论。

9333 / PID12064 的既有未提交测试稿受保护。历史真实回执 `01d27475-7146-4b2d-8ae6-0a022b45c88e` 可作为只读记录展示，明确标为隔离库历史上传，不能称为正式网页新上传。该待发布记录阻止 ai 再上传另一份。窗口按钮现场核验 profile、唯一编辑页与真实窗口/目标 ID，再激活并置前；不导航、不改稿。本人手动处理现稿后，可显式「解除占用」，仅更新本地标志，不代表已发布；结果未知不能解除。当前新一轮平台上传验收受现稿阻塞，已通过的模拟链路与网页渲染不替代它。

## 本轮聚焦更新（e5e1da9之后）

聚焦小红书已发布笔记真实分享链接回写

小红书取链接在稳定ID卡片缺少公开href时，仅检查正常可见、唯一且明确标示“分享/复制链接”的操作；没有这样的控件就明确失败，不按笔记ID生成URL、不猜无文字图标、不调用内部API、不读剪贴板/会话。回写任务前再次核对数据库快照稳定ID，任务与准备记录仍在事务内写入。本轮真实列表10张卡片，目标ID精确命中但公开链接0，未找到唯一明确分享控件；实际无回写。正向真实回写未通过，不能把离线成功当成完成。9333已有测试稿窗口保留，未再次post或提交。

`/api/overview` 新增 `accountSummaries`，大屏下方和流量页顶部显示同一统计。日报复用同一模块：当日发文累计是当天发布作品截至观测时的累计表现；当前作品累计是本账号入库已发布作品的最新值之和；跨日快照增量要求同一批作品在当日和前一日均有各字段实测。不把新发文基线当0；缺日期/字段/前一日观测显示暂无。显示的是入库范围，未证明全账号完整历史，也不把快照差值称作零点至今流量。全部复用既有SQLite，无新增统计采集。

本轮测试和最终状态见 [交付与矩阵](focus-delivery.md)。下方保留历史记录；以本节及22:17纠正后的状态为准。

## 22:17纠正后的当前用法

下文夜间记录按历史保留。本轮已实际调用原本地xhs-publish：ai身份精确匹配TwoPeanuts；经生产HTTP接口完成preflight→post→上传1张已逐图审阅的明确测试卡、填写完整标题正文及3个正式话题。回执submitted:false、dryRun:true，截图已查看，专用窗口按用户约定保留，未点发布。测试只在隔离准备库执行；正式小红书采集另成功读取近30天50篇并更新日报。

原来的“所有平台浏览器禁用”结论已撤回。默认可执行已安装的受限本地skill；publishPrep.browserExecution:false仍可总停，publishPrep.<平台>.browserExecution:false可停单平台。L1只读体检/取链接由l1.<平台>.browserExecution:false单独停用。配置不是审批证明：compare/9368旧拒绝仍保留，本次没有重试或换形式执行该拒绝动作。本地skill的9333/9335专用通道、L1既有profile只读通道在本次授权内分别实测，不能把它们和9368混同。

准备页现可填话题。新准备稿也能选择实际发表日期并点击“从已发布列表取链接”；无ID时按完整正文（X）或完整标题（小红书/公众号）与日期匹配，歧义、审核中、缺少真实公开URL均不写。稳定ID优先；回写任务、准备记录与日志使用事务。真实小红书列表当前没有公开URL，额外公开页实测404，本轮没有正向链接回写成功。

X文图包与真实Chrome下载验收可用，平台草稿仍由本人附图/保存；实际X专用profile未登录。X现支持沿用既有无凭据HTTP(S)_PROXY，或l1.x.proxy显式system/direct/服务地址，不改系统代理。公众号发布skill及L1各自专用profile均已真实确认扫码页，需本人登录；没有执行post、没有伪报草稿保存。

L1的chromeProfile可配置为本机独立绝对目录；缺省使用MAITIAN_HOME下各平台目录。拒绝普通Chrome/Edge目录、网络共享、跨平台共用profile；端口仍9341/9340/9342，不变更旧拒绝的9368。新增macOS/Linux程序路径候选；旧hub、bridge、shim与macOS行为保留。原driver仅新增MAITIAN_PUBLISHER_DIR路径和无浏览器包加载检查。

可复现：node scripts/publisher-check.mjs --plugin-dir <官方publisher目录>；node scripts/l1-inspect.mjs --platform xhs；node scripts/l1-inspect.mjs --platform xhs --episode <真实作品ID>；准备稿用--preparation <记录UUID> --date YYYY-MM-DD。真实操作必须使用实际账号，不能把离线回执当平台证据。

范围：X 文图草稿包、小红书图文、公众号纯文字与本地配图。未接知识站或其他平台，不定时、不后台发布。原 `hub.mjs`、`driver.mjs`、`chrome-shim.mjs`、原插件/macOS 工作流均未修改。

2026-11-17 夜间更新：无调试端口的 Chrome CLI 已完成隔离真实 HTTP/SQLite 页面验收（登录、错误提示、深链、刷新、系统手动区、准备任务生成及 ZIP 下载），正式8787未登录页也有新截图。原调试启动的策略拒绝没有解除；Computer Use 独立标签页再次返回 native pipe `os error 2`。**本机页面测试通道可用，不等于平台执行通道可用**。真实安装的 `xhs-publish preflight` / `wechat-publish check` 经生产适配器实跑成功，只属离线素材检查。

## 从网页使用

打开 `http://127.0.0.1:8787/p#/system`，点击「准备发布」，或直接打开 `http://127.0.0.1:8787/p#/prepare`。需要工作台原有登录；不要把口令放进 URL。作品详情也有「准备发布」入口，可带入文案；已发布或已经准备到位的作品禁止重复准备。

1. 选择平台，填标题、正文；X可填0–4张图，小红书填1–9张图，公众号最多9张图并可填120字摘要。图片须为本机PNG/JPEG/WebP，单张≤32MB、整组≤64MB；网络共享路径、空文件和扩展名/文件头不符会拒绝。公众号首版不接富HTML/章节图。X会复制素材到被git忽略的本地任务目录，其他平台保留引用。
2. 点击「生成准备任务」。只在本机 `data/publish-prep/<随机ID>/job.json` 保存素材引用和 `submit:false`，记录存在独立 SQLite 表。不会进入平台，不会将原作品标为「已填好」。测试稿勾选测试标记后标题与正文都会标明。
3. X点击「下载X文图包」：ZIP包含完整`draft.txt`、按顺序编号的图片、使用说明和无绝对路径的`manifest.json`。源图后来改动不影响已准备的副本。由本人在自己的X窗口确认账号、粘贴正文、手工附图。文字Web Intent只作辅助，不附图；没有上传、平台草稿保存或发布证明。下载不把任务标为filled。入口正文上限仍为2000字符，不截断、不自动拆线程，平台长文权限由本人确认。
4. 小红书/公众号可显式运行本地skill离线检查。夜间已用隔离测试任务通过生产适配器实跑本机已有两个DSH离线命令，没有连接浏览器；此前仅替身测试的历史结论以此更新。小红书`promotionReview`仍须真实逐图审阅，本页不自动伪造“已审”记录。第三方脚本的原授权限制不变。
5. 小红书离线检查通过后，可显式点击「填写上传（不发布）」；现稿或未知结果阻止重复上传。公众号仍仅保存草稿。9368 的旧拒绝不变，本功能使用已有本地 skill 专用通道。

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

`publishPrep.browserExecution` 与 `publishPrep.<平台>.browserExecution` 当前缺省允许，显式 false 停用；正式配置未改。Liu 已授权显式点击后的填写上传（非最终发布）。旧 9368 拒绝和 Computer Use native pipe 失败未解除；本次未重试这些通道。切页仅操作已核实的本地 ai 专用窗口。

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
