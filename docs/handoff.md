## 2026-11-28 Mac 新 X 账号首次登录

Codex 处理新增 X 账号在验证页停住的问题。两个实际账号均在各自的普通 Chrome 专用窗口由本人通过 X 验证，随后由麦田核验并绑定，页面均显示「已登录」。

Mac 上未绑定的 X 账号点击「登录账号」后，先打开普通专用 Chrome。进入 X 首页后可点「我已登录，核验账号」，也可以在专用窗口按 ⌘Q 退出。麦田在窗口退出后核验 X 首页的当前身份，并保存已确认的绑定。验证未通过时保留未绑定状态。原账号及已绑定账号仍走已有登录检查。

七组自测、普通 Chrome 启动参数的模拟检查和 18787 HTTP 验收通过。账号库备份为 `data/l1-local-accounts/backups/hub-before-x-manual-login-20261128-082147-219406.db`。18787 从 PID 21321 切换到 23800，已绑定的两个账号保留。8787 仍为 PID 2122。证据见同级项目目录 `../evidence/maitian-x-manual-login-2026-11-28/`。新增入口通过隔离验收，真实账号使用同一分阶段流程完成联调。

## 2026-11-28 本机 X 账号管理

Codex 修复了 18787 的 X 账号与采集入口。已核对两种失败回执，未配置的旧账号无法启动浏览器，托管账号的专用窗口在确认前关闭。账号页隐藏未配置的旧账号卡，并在托管账号卡直接显示失败原因。

误建且尚未绑定的 X 账号可以通过卡片上的「删除账户」移除。工作台在确认后删除相应槽位，专用 Chrome 资料目录保留。原账号、已绑定账号和操作进行中的账号受到保护。删除成功后，页面会清理对已删除账号的当前选择。

七组自测与隔离 Chromium 通过。实际页面在 1440px、390px 下验证，同时测试了确认弹窗、一次删除、保留已绑定账号及页面刷新。18787 账号数据库备份在 `data/l1-local-accounts/backups/hub-before-x-account-ui-20261128-074648-830600.db`。18787 从 PID 18416 切换到 21321，现有账号记录保留，8787 仍为 PID 2122。证据见同级项目目录 `../evidence/maitian-x-accounts-2026-11-28/`。真实 X 登录仍由本人在专用窗口完成，等待页面确认后再关闭窗口。

## 2026-11-28 Mac 开发分支接入

在独立工作树 `codex/maitian-l1-integration` 上，以 `l1-real` 的 `9314289` 为第一父提交，合入本机 `main` 的 `4a6423e` 和本机的 `doctor --only` 校验。L1 网页继续仅监听本机回环地址，启动日志只显示访问地址。网页冲突采用 L1 的界面和接口，飞书与知识站设置的旧系统页仍由原工作树提供。

新版保留本机发布助手的商店和本地加载逻辑，并接回 L1 的显式目录配置。视频预填扩展的打包脚本接受 `--plugin-dir`，可使用这台 Mac 上的发布助手 0.4.0 源码。文件读取和打包均在隔离环境验证。

Mac 隔离测试通过。Node 自测涵盖发布、X 多账号、回执状态、视频预填、鉴权和 `doctor` 参数。临时数据库与独立 Chromium 验证了工作台启动、1440px 和 390px 的页面及一次模拟 X 提交。证据见同级项目目录 `../evidence/maitian-l1-2026-11-28/`。现有 8787 服务仍从原工作树运行。此轮未迁移生产配置、数据库或浏览器会话，也未执行真实平台发布。

后续可在此分支迭代。真实发布联调仍需处理 Mac 上默认 X 账号的浏览器校验、小红书执行脚本依赖，以及两端的公开回执核对。

## 2026-11-27 19:06 原工作台HTTP服务恢复（X日常AI帖调用方）

本栏目正常19点读contract时127.0.0.1:8787连接拒绝10061，实时无监听；停服根因未核实。既有第一方codex-tasks/migration/Start-Maitian.ps1（位于父项目，非repo子目录）经PS/Node语法及路径核验后正常启动只HTTP的l1-web-server.mjs：LauncherPID6660、Node12408、ShowWindow0，contract v4/200及AI热点新闻等当前栏目读回。未停止原进程、改配置/数据库/权限、自启或零点自动化。随后本栏目X已发及外部回执ebe26d13-44a5-4654-83d6-87dd7208b45f核验通过；不称由工作台执行X。细证见D:/Ai Infra Tools/DeepSeek Harness/X日常AI帖/publish-jobs/hot-radar/2026-11-27/1900/execution-notes.md与workbench-start.json。以下零点任务消失调查结论仍有效。

# 交接文件（HANDOFF）

最后更新：2026-11-27（北京时间，原评论已公开并同ID只读补验sent；零点任务仍未恢复）。任何 AI 接手前先读本文件，再按文末「必读顺序」展开。

## 一句话现状

**2026-11-27 当前代码检查点（Codex，按Liu要求先提交）**：新账户显示窗口问题已定位但尚未修复：show-l1-browser.ps1的ValidateSet只含9340–9347，实际PS5调用以ParameterArgumentValidationError拒绝9410，UI误报暂未就绪。下一步扩展注册新槽端口并保留精确PID/profile验证，做真实空白独立窗口与既有回归验收。X继续已实测jf.x.com/onboarding/web/actions/finish_knowledge_check和api.x.com/1.1/flow/viewer.json均200但不推进，确切业务原因未证实。首轮14:43:40Z正常10分钟超时；第二轮14:45:54Z窗口关闭后结束，关闭者未核实；当前未绑定。没有提交/发布任何新内容。详细证据见根evidence/x-second-login-20261127/和evidence/show-account-window-20261127/。


**2026-11-27 新增X账户登录排查中（Codex）**：生活号槽x-6c4a2458a19795d39371ac08/9410未绑定，X账号确认knowledge_check点继续仍停原页；只读归属/脱敏状态已核，尚未证实原因。待本人尝试原生使用密码入口，AI不接触密码/验证码、不更换登录态、不重启或关闭当前窗口。证据[evidence](../../evidence/x-second-login-20261127/执行记录.md)。


**2026-11-27 22:05 原评论已公开并同ID补验sent（Codex）**：原ID d071adae-ee71-4323-b061-4cd2ebf7889b实际13:55:02Z已发，公开2126313854116474963作者/全文/root/parent核验通过；不能重发。修复提交页直接导航、候选未落盘及仅等新卡未等祖先的缺口；改独立自有标签完整核验并提供type:verify只读补验，unknown仍不能resume。五项回归/隔离Chrome通过，正式2692→6892、备份及上线前11表不变；随后通过正式verify沿原记录转sent，原3次attempts/提交意图/来源保持、其他10表不变，本轮没有发送。超时确切beforeunload/网络机制未证实。详见[执行记录](../../evidence/comment-verification-20261127/执行记录.md)。


**2026-11-27 21:50 评论回复框已修复上线（Codex）**：真实X嵌套dialog与预览time无链接导致旧核验始终失败；改为唯一编辑器、最近dialog，并以已核目标快照比对预览/背景全文、时间、作者及精确原链接，输入读回/提交前重复核验。真实@PeanutPair空白框focus:true、五项回归和隔离延迟/错目标等DOM通过；正式4372→2692，备份及11表/原记录完全保持。原ID d071adae-ee71-4323-b061-4cd2ebf7889b仍failed、mayHaveSent:false、2次尝试，本轮未输入/resume/发送；真实发送仍待原调用AI沿原ID续办。详见[执行记录](../../evidence/comment-composer-20261127/执行记录.md)。


**2026-11-27 21:23 评论no listener已修复上线（Codex）**：默认适配器原只连接，9336未监听即失败；现从本地x-publish公开配置精确匹配账户/profile/端口，复用或启动专用浏览器并强验PID，再用自有/home标签核账号。五项回归及真实只读@PeanutPair核验通过，自有标签关闭后9336仍200；正式19736→4372、备份及11表摘要保持，新contract.browserReadiness=reuse_or_start_dedicated。原ID d071adae-ee71-4323-b061-4cd2ebf7889b仍failed、mayHaveSent:false、无意图、1次尝试，未自动resume/发送，由原AI沿原ID继续。本轮未验证真实发送；浏览器先前为何退出未证实。详见[修复记录](../../evidence/comments-no-listener-20261127/执行记录.md)。

**2026-11-27 20:55 X评论接口和记录页已上线（Codex）**：AI选择账户/原帖/直接回复对象/正文，POST /api/comments enqueue请求发送；工作台持久排队、双层防重、校验身份/上下文并单次执行，成功须公开新评论全文/作者/父对象/原帖关系核验。unknown不重发，重启旧队列暂停。导航评论页支持关系、来源、状态、上下文快照和回执，可复制实时AI接入指令。六项回归、1422/522隔离UI及真实本地DOM测试通过；正式8772→19736，备份后原9表摘要保持、评论任务与请求均0，真实GET-onlyChrome页面渲染通过。尚未真实X实发验收、未发送评论，旧运行中AI不会自动改用接口；第二账户仍需用户登录，零点任务未恢复。接口见[comments-api.md](comments-api.md)，备份/测试/PS5辅助文件执行策略拦截详情见[执行记录](../../evidence/comments-20261127/执行记录.md)。

**2026-11-27 20:05 首页api未定义已修复（Codex）**：上轮独立board.html调用仅在mt.js定义的api/xAccountPicker，首页未加载，导致HTTP200但实际渲染失败。现抽为x-account-context.js，首页/内页共用；隔离Chrome首页先失败后通过，五组离线回归、桌面首页/数据页、窄屏522跨页多账户切换通过。正式GET-only新Chrome真实渲染ok:true、mutations:[]，已目视截图；HTML/静态200/no-store且源码一致，用户刷新即可。服务8772未重启、无正式数据/平台操作。评论模块依旧未开发；X多账户实现与真实第二账号待用户登录的边界保持。详细证据[首页修复记录](../../evidence/home-account-context-fix-20261127/执行记录.md)。

**2026-11-27 19:49 X通用多账户与发布必选账号已上线（Codex）**：用户自行新增账户，在独立窗口手动登录，以官方/home当前账号菜单绑定，账号不硬编码。登录/采集/粉丝/作品/发布归属隔离，旧default兼容。发布页每份可执行原稿必选已确认登录账号，选择→检查→固定目标→存草稿/发布；X fill必须accountId，后台拒绝空选、未登录/失效和目标不符，浏览器强验实际身份，unknown锁保留。13项回归及真实隔离Chrome桌面1422/窄屏522两组通过（最终平台执行mock）。正式两次备份更新12408→5320→8772，contract4新增xMultiAccount/requiredXFill；9张业务表行数/摘要完全一致，无新增正式测试数据。备份及证据见[执行记录](../../evidence/x-multi-account-20261127/执行记录.md)，接口见[x-multi-account-20261127.md](x-multi-account-20261127.md)。本轮无真实X登录/保存/发帖/评论；第二个真实账号待用户新增登录。评论可接现有浏览器自动化管理，模块未开发；零点任务未恢复。起始README及本页19:06外部补记保留，不并入本次提交。

**2026-11-27 零点任务消失根因已确认**：原automation是绑定旧会话01a1f8b8-b749-7410-a08f-8c299ef2f7da的heartbeat，11/23 10:02:03旧会话归档；安装中Codex26.1120.5083.0的handleArchivedThreadSideEffects→deleteArchivedHeartbeats→deleteAutomation会删除该会话定时。目录mtime同秒，原任务在toml和automations表均缺失，无迁移记录。原创建/更新成功回执、归档DB状态、业务事件日志、安装包静态代码及SHA256已交叉留证；未发现独立删除工具调用，不推断归档操作者。工作台只读旧ACTIVE标记而显示已启用，是第二个健康显示缺陷。详见项目根evidence/midnight-rootcause-20261127/原因结论.md、evidence.json、audit.mjs。11/26原因未明为历史。本轮按“去查明”只调查，未恢复/重建任务、反归档、补采、平台动作或重启。下一步若恢复，绑定当前保留主会话并核真实触发和结果；不能把恢复定义当采集成功，也不能只改旧标记。

**2026-11-26 21:35 零点采集核对**：用户截图X最近观测仍11/24。正式X最近成功为11/24 10:45手动更新；midnight报告仅目标11/21和11/22，X均失败，后续3个目标日无报告。本机实际automations目录没有旧id=automation定义，但data/l1-schedule.json仍ACTIVE，web.mjs只读旧标记而误报enabled；官方view仅渲染卡片，没有状态元数据。当前不能说零点正常执行，任务何时/为何缺失未证实。本轮仅诊断，未恢复/新建任务或补采，后续先核实官方任务状态和是否曾取消，避免重复恢复。详见项目根evidence/midnight-audit-20261126/核对记录.md、readback.json；历史“已ACTIVE”不是当前实况。

**2026-11-24 16:51 技术栈问答已核查**：DSH官方前端为React/TypeScript、Vite Web构建、CSS Modules与自有主题/控件、Zustand/Immer状态引擎、Cordis及typed UI Slots、HTTP RPC/事件流，桌面Electron。本机独立CLI安装包0.2.1-rc.5与官方master分开标注，未假定运行中桌面版本。详细依据及与当前原生JS工作台的差异见[DSH前端技术栈](dsh-frontend-stack-20261124.md)。仅分析/文档，无迁移、应用修改、安装、重启或平台动作；当前栏目修复状态如下。

**2026-11-24 10:46 管理栏目点击故障已修复（Codex，同会话）**：resize重复调用initPreparePage、重复绑定事件，同一点击展开后立即收起；隔离Chrome先失败后通过证明。WeakSet保证每个DOM根只初始化一次，新页面仍正常初始化。桌面1422/窄屏522 resize→新建→编辑→刷新→轮询保持通过，每场景恰好2次栏目写入（一创建一编辑）；三项必需回归及语法检查通过。正式/static/prepare-page.js返回200、与本地修复源码完全相同、Cache-Control:no-store，发布页200，现有页面刷新一次即可加载。维护脚本发现另一X采集运行而退出1，未停止或重启任何进程；本次前端静态文件已生效，无后端变更/数据库修改/平台动作，不需等采集或补重启。详见项目根evidence/column-click-fix-20261124/执行记录.md。此前“管理已验收”漏了resize场景，以本段修复结果为准；README与prep-xhs-draft既有改动保留。下一步：使用者刷新页面；本项无待实施项。

**2026-11-24 10:24 栏目管理已上线**：Liu新增「AI工具分享」，GitHub/Skill/工具/插件介绍归入。当前正式16行=新闻2、实战2、工具分享12（含保留测试记录）；改18条关联/原稿记录，内容和状态等摘要保持。栏目存在publish_columns，页面顶部“管理栏目”支持新建与编辑名称/说明，改名同步记录，revision防并发覆盖，重启不恢复旧名；AI和旧交稿均读取当前名单，不能再把两项/三项写死。正式20976→26956、v4/200，维护前一致性备份、五项回归及桌面1422/窄屏522真实表单验收通过。详见[栏目管理记录](column-management-20261124.md)及evidence/columns-tools-20261124/。没有平台动作，未覆盖README与prep-xhs-draft既有改动。后续若继续建设，先查contract.columns；旧两栏目段落是历史，不作为限制。

**2026-11-24 10:10 栏目统一已完成**：平台只定义「AI热点新闻」「AI实战详解」，通过contract.columns提供说明，AI按正文主旨精确选择；新原稿、元信息及旧单平台交稿均校验。现有页面16行已按内容整理为新闻2、实战14，含关联共25条底层记录，备份核对除栏目/审计/revision外完全保持，unknown不解除。新增本机type:columns仅变更栏目元信息并记录实际actor。栏目专项及4项相关回归通过，正式8787维护备份后20532→20976、v4/200。详见[本次栏目记录](columns-20261124.md)与项目根evidence/columns-20261124/。本会话只负责栏目，没有平台动作；既有README修改与prep-xhs-draft.mjs未覆盖。下一位AI先读契约columns，不再传AI新闻/每日AI精选等旧名。

**11月24日真实X发布补证**：原稿65dbca9d-75ec-4f67-ac9a-81f8db227fd0经正式HTTP `fill(mode:publish)` 单次发布成功，实际原帖2125013136176816253，独立只读核验全文/来源通过。但工作台回执误报unknown，已在同ID备注说明，禁止重发。执行证据见[本次记录](<D:/Ai Infra Tools/DeepSeek Harness/X日常AI帖/2026-11-24-工作台发布/执行记录.md>)。发布器等待location变为/status、延后只取body尾1000字，本轮/home未捕获成功提示；待完善成功回执与原ID只读核对收敛。本次未改代码、服务、配置、skill，未直接改库，未把unknown伪改published。以下“0条”和“未实测”为11月23日历史快照，不代表本轮实况。

2026-11-23 22:19 契约已改为可发布：`finalPublishPlatforms:["x","xhs"]`、`submit:true`、`fillModes:["fill","draft","publish"]`。接手时重新查接口，不用旧快照。

麦田工作台跑在 `http://127.0.0.1:8787`，`/api/prep/posts` 是唯一写入口；建稿必填栏目、计划时间、AI 来源。AI 用 `fill` 的 `mode` 决定：只填好留窗（fill）、存草稿（draft）或直接发布（publish，仅 X / 小红书）。公众号只能存草稿。库里现有发布记录 0 条（历史数据已于 2026-11-23 清理并留档）。

## 目录与关键文件

| 路径 | 作用 |
| --- | --- |
| `repo/` | 正式代码仓库（Git） |
| `repo/src/web.mjs` | 全部 HTTP 路由与写入口校验 |
| `repo/src/publish-posts.mjs` | v2 原稿模型：create/meta/update/generate/check/fill |
| `repo/src/publish-prep.mjs` | 平台执行层：检查、填写、存草稿、X 文包 |
| `repo/src/platform-rules.mjs` | 三平台字数/图片/封面规则（前后端共用） |
| `repo/src/prep-status.mjs` | 发布状态只读投影 |
| `repo/src/prep-agent.mjs` | AI 来源字段校验（codex/dsh/grok） |
| `repo/data/hub.db` | SQLite 正式库（已在 gitignore） |
| `repo/data/publish-prep/<id>/job.json` | 每篇平台任务快照 |
| `evidence/` | 验收证据、维护备份、清理归档 |
| `repo/docs/publish-api.md` | 接口契约与参数细节 |
| `repo/docs/ai-publish-prompt.md` | 可直接贴给外部 AI 的接入指令 |
| `repo/docs/publishing-status-20261123.md` | 发布入口按日进展 |
| `repo/docs/issue-register.md` | 正式问题台账 |

## 当前契约（v4）

`GET /api/prep/contract` 返回：`version:4`、`submit:true`、`finalPublishPlatforms:["x","xhs"]`、`publishPlatforms:["x","xhs"]`、`requiredCreate:["column","scheduledAt","actor"]`、`scheduledPublish:"recorded_only"`、`noteLimit:500`、`fillModes:["fill","draft","publish"]`。

写入口 `POST /api/prep/posts`，必须带 `Origin: http://127.0.0.1:8787`，仅本机 loopback，请求体 ≤128KB。

顶层字段白名单：`type,id,platform,platforms,input,actor,column,scheduledAt,note,mode`。顶层 `type:publish/submit` 仍拒绝；发布只能走 `fill` 的 `mode:"publish"`。

- `type:create`：必填 `column`（1–80 字）、`scheduledAt`（带时区 ISO、晚于当前时间、只记录不执行）、`actor`（`runtime` codex/dsh/grok，`grokbot` 为别名；`sessionId` 必须真实）。
- `type:meta`：只改 `column`/`scheduledAt`/`note`，至少一项。
- `type:update`：改完整平台版本（`platform` 可为 master）。
- `type:generate`：本机 Codex 按平台 skill 分平台改稿，202 仅表示启动。
- `type:check`：共用规则 + 本地 skill 离线检查；返回 `validation.ok`。
- `type:fill`：`mode` 必填，只能 `draft`（存草稿箱）或 `publish`（直接发布，仅 X、小红书；公众号会明确报错）。没有默认值，不传会 400。
- `input` 字段：`title,content,images,cover,topics,video,digest,caption,author,imagePositions,promotionReview`。

读接口：`record?id=`、`posts`、`bundle?id=`（X ZIP）、`asset?id=&platform=&index=`、`status`、`ai-prompt`。

## 平台边界（2026-11-23 实测状态）

| 平台 | 标题/正文/图 | 填写 | 仅存草稿 | 直接发布 |
| --- | --- | --- | --- | --- |
| X | 加权 280（premium 配置 25000）/ 无标题 / ≤4 图 | 填好留窗，`awaiting_user` | 支持，读到确认记 `draft_saved` | 支持 `publish`：点 Post 并读回 `/status/` 链接才算 `published`（**未实测真实发布**） |
| 小红书 | 20 / 1000 / 1–18 图 | 填好留窗，`awaiting_user` | 支持：填完关闭页面自动存草稿，`draft_saved`（2026-11-23 23:00 实测） | 支持 `publish`：调 `xhs-publish post --submit`，`submitted:true` 才记 `published`（**未实测真实发布**） |
| 公众号 | 32 / 50000 / 摘要120 / 作者16 / ≤20 图 | 仅存草稿 | 支持 | 不支持（skill 明确禁止发表），请求会报错说明 |

X 草稿验证：关闭编辑框 → 弹窗点「保存」→ 先读页面提示（saved to drafts / 已保存 / 草稿箱），没有再重开编辑框点右上角「Drafts」核对首行文字。两处都没有就记 `unknown`，不谎报。

**2026-11-23 22:11 实测通过**：测试稿 `5a18a6eb` 走 `check → fill(mode:draft)`，状态 `draft_saved`，核验方式 `drafts-panel`，@PeanutPair 的 Drafts「Unsent posts」里确有其文。证据：`evidence/x-draft-20261123/`（drafts-panel.png、x-editor.json）。踩坑记录：关闭后的确认按钮是 `[data-testid="confirmationSheetConfirm"]`，用 `[role="dialog"]` 文本匹配会漏；保存后页面不一定有 toast，必须用 Drafts 列表核验。X 草稿箱里现留 2 条【测试】草稿，待本人删除。

## 今天做过的改动（2026-11-23 晚）

1. 建稿新增必填 `column`、`scheduledAt`、`actor`；新增 `note`（≤500 字）和 `type:meta`。
2. 发布状态页：栏目显示 + 按栏目筛选、备注展示、「复制 AI 接入指令」按钮与面板、`?ai=1` 自动展开。
3. 新增 `GET /api/prep/ai-prompt`，文本来自 `docs/ai-publish-prompt.md`，避免两份维护。
4. `fill` 增加 `mode:"draft"`：小红书走 `xhs-publish/scripts/save-draft.mjs`，公众号沿用原路径；X 也支持——填完关闭编辑框并保存，读到确认才记 `draft_saved`，未确认记 `unknown`。X 专用编辑器已启用（`browserExecution:true`），配置改前备份在 `evidence/publish-redesign-20261123/config-before-x-draft-*.json`。
5. 清理历史数据：先删 10 条缺栏目测试记录 + 2 条测试原稿，再按指示删剩余 10 条旧已发布 X 回执（已导出 `evidence/publish-redesign-20261123/removed-legacy-posts-*.json`）。当前记录 0 条。
6. 离线自测三组通过：`platform-rules-selftest`、`prep-status-selftest`、`l1-web-selftest`。
7. 2026-11-23 22:19 起 `mode` 增加 `publish`：X 由已验证编辑器填完后点 Post 并读回 `/status/` 链接；小红书调 `xhs-publish post --account ai --submit`，`submitted:true` 才记 `published`；公众号请求会明确报「只能存草稿」。契约改为 `submit:true`、`publishPlatforms:["x","xhs"]`，`Update-Maitian.ps1` 的启动后校验同步改为核对 `publishPlatforms`。真实发布尚未实测。

## 耗时（含 5–10 秒随机延迟）

- 公众号 1.5–2 分钟；小红书 2–2.5 分钟；X 1–1.5 分钟；三端同一篇约 4–5 分钟。

## 运维命令（Windows，仓库根执行）

```powershell
& 'D:\Ai Infra Tools\DeepSeek Harness\AI自媒体工作台\codex-tasks\migration\Start-Maitian.ps1' -Port 8787   # 启动
& .\scripts\Update-Maitian.ps1 -CheckOnly                                                                  # 只检查
& .\scripts\Update-Maitian.ps1 -Restart -Confirm:$false                                                    # 备份+重启
node scripts\platform-rules-selftest.mjs
node scripts\prep-status-selftest.mjs
node scripts\l1-web-selftest.mjs
```

`Update-Maitian.ps1` 会校验 8787 归属、任务空闲、做一致性备份（写入 `evidence/publish-redesign-20261123/hub-before-*.db`），只动 8787。

只读查库：

```powershell
@'
import {DatabaseSync} from 'node:sqlite';
const db=new DatabaseSync('data/hub.db',{readOnly:true});
console.log(db.prepare('SELECT COUNT(*) n FROM publish_posts').get(),db.prepare('SELECT COUNT(*) n FROM publish_preparations').get());
db.close();
'@ | node --input-type=module -
```

## 硬规则（别违反）

- 不发布、不传 submit/密码/Cookie/token；`publish`/`submit` 直接 403。
- 状态 `unknown` 一律停手人工核对，不换 ID 重建、不重跑。
- 旧记录缺栏目/AI 来源时不猜填；缺就显示未记录。
- 写库前先备份；不要手动改 `data/hub.db` 之外的方式绕锁。
- 不要用其他端口/其他 profile 绕过专用窗口（9333 小红书、9335 公众号、9336 X）。
- 证据和结论写回文档，不把模拟测试说成真实发布。

## 待办与下一步

1. 实测小红书 `mode:"draft"`：存草稿后到草稿箱核对，再决定是否加自动去重。
2. 决定 X 是否要接草稿（需账号核验方案），目前不支持。
3. 可选：小红书版本出现 URL/裸域名时判检查不通过（目前只在 skill 侧 strip）。
4. **最新晚间改动**的桌面/390px视觉验收需核对；11:33改版和15:50公众号修复阶段已经有相应截图验收，不将其整体记成从未做过。证据见项目根 `evidence/publish-redesign-20261123/最终回报.md`、`wechat-fix-回报.md`。
5. 公众号原路径在15:45单次保存成功并有草稿卡片只读补核；原skill的draftVerified:false如实保留。带晚间新增必填字段的完整链路尚待专门验收，不重跑旧unknown单或自动补建测试稿。

## 本地持久化与协作记录

Liu于2026-11-23明确：“我可能因为额度问题，会和别的ai共同开发，因此需要把关键信息、进展都持久化到本地盘”；并要求“后续都要这么做”。这是持续执行要求，不仅本轮补一次文档。

唯一当前摘要为本文件。详细每日过程在 `publishing-status-20261123.md` 等按日文档，证据在项目根 `evidence/`；项目根INDEX和两级AGENTS均指向本页。新AI先读磁盘再执行。当前页面只填写/存草稿；上午的v3显式最终发布方案已被v4取代，不将其恢复成待办。旧记录清理已执行并留档，不重建已删除的本地回执。

### 2026-11-23 本次交接整理

- 执行者：Codex，会话 `01a205f3-3296-7510-8105-ad4e4d268422`；范围仅本地交接文档与规则，无业务代码/平台操作/服务重启。
- 已核对：最新磁盘交接、API、发布说明、按日进展、公众号修复证据；运行接口只读快照为v4和0条记录。Git HEAD当时为336b4e4，工作树有多项既有改动，未提交、重置或覆盖这些业务改动。
- 已补：持续更新的时机、必须记录的字段、证据位置、多AI协作边界和读回校验；修正根INDEX对上午过时待办的概括。
- 本次未占用任何业务开发任务；下一位AI按待办选择当次已获授权范围，先登记负责人/文件/状态再动手。不保证所有其他AI已读到本文件。

### 后续每阶段记录格式

在本文件维护当前摘要，详细过程另存证据，至少留下：

```text
日期与执行AI/真实会话：
本阶段目标、已确认需求和授权范围：
正在做/负责人/涉及文件：
已改内容与重要决定（含理由、被替代旧方案）：
验证方式与实际结果（模拟/真实、是否正式加载）：
真实任务ID、错误原文/退出码、证据及备份路径：
剩余事项、阻塞条件、下一步具体动作：
本地入口已读回；其他AI是否已读取：未核实/实际依据。
```

## 工作约定（Liu 2026-11-23 定，后续都这么做）

- 开工先读本文件，再 `Update-Maitian.ps1 -CheckOnly` 核对服务。
- 每次改动后更新本文件的「今天做过的改动」「待办」，发布入口相关再写 `publishing-status-20261123.md`。
- 三组自测通过才重启；重启后把 PID、备份路径、契约写进文档。
- 改动提交 Git；只讲摘要，关键结论必须落盘。

## 必读顺序

1. 本文件 → 2. `repo/docs/publish-api.md` → 3. `repo/docs/ai-publish-prompt.md` → 4. `repo/docs/publishing-status-20261123.md` → 5. `repo/docs/issue-register.md` 顶部。
