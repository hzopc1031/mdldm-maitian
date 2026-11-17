# 面向上游PR的修复对照说明

核对日期：2026-11-18。文档起点为 `l1-real@c7d181e`；上游对照基线为 `61ffcf054f236d93573c74bea43f1f61b9d260e4`，首个公开提交为 `312a51f`。下文只整理已有证据及定点源码/提交核对，没有重新测试、诊断、部署或创建上游 PR。分类只表示本说明中的归属，不替换问题清单原有分类和未完成原因。

已读材料摘录与采用顺序：

- [交付矩阵](focus-delivery.md) 11-18 节：“代码修复不改变X/公众号登录、扩展UI或分享正向未完成状态。”本说明采用这节最新结果；更早矩阵中的正式流量页失败保留为修复前证据。
- [问题清单](issue-register.md)：“首次发现版本不能从证据确定时明确写未知，不以猜测代替归因。”其中 I20 编号在历史中重复，本文以标题、日期和 commit 区分。
- [11-17 诊断](diagnostics/traffic-share-20261117.md)：“具体调用方尚未符号化，也未确认是某个CHECK。”11-18 已定位应用侧触发字符，但没有补出浏览器符号化调用栈。

证据只引用仓库内文档和已由 `git check-ignore` 确认忽略的本机目录名：`_local-bisect-evidence/`、`_local-diag-evidence/`、`_local-focus-evidence/`、`_local-complete-evidence/`。不附秘密、web key、Cookie、原始日志、真实响应、profile、dump 或正式库数据。下列测试结果均是历史记录，不是本次重新运行的结果。

回退说明均供日后评审，不在本次执行：单项优先反向应用所列 commit 中对应文件/hunk；含多项工作的提交不宜整包撤销。涉及服务切换或数据恢复时另行安排停机和一致性核对，不能用代码 revert 推断数据也已恢复。当前受保护的 `8787/PID9904`、`8788/PID6364`、`9333/PID12064` 不动。

## 原生缺陷修复

### U1 作品显示短名截断破坏 emoji

- **类别、基线与定位**：原生缺陷修复。`git show 312a51f:src/web.mjs` 与 `git blame 312a51f -L '/const nickOf/,+1' -- src/web.mjs` 均确认首个公开提交第 12 行已有 `const nickOf = (name, pj) => (pj && pj.nick) || (...).slice(0, 16)`；`312a51f` 无父提交，`61ffcf0` 仍保留此逻辑。当前入口是 `src/web.mjs:nickOf / episodeView / feed`，修复实现为 `src/web-text.mjs:displayNick`。
- **语义与输入**：这是工作台的作品显示短名称，不是平台账号昵称。`episodeView` 用作品记录 `ep.name` 和快照 `project`（无快照则读工程 `publish.json`）调用它；非空 `pj.nick` 优先，旧逻辑不对这个显式短名再截断。否则先取 `name` 的竖线分隔首段，再取中英文逗号、问号、叹号、冒号、句号之前的非空部分，最后截 16 个 UTF-16 代码单元。`feed` 也从作品名称和工程配置生成短名。`src/web/pages.html:epc / vTraffic / vSystem` 将其用于作品行、流量页作品选择链接/标题、最近动态；其他作品展示也复用它。
- **输入来源边界**：上游输入是作品记录的名称和工程短名。分叉 `src/l1-store.mjs:saveObservation` 以 `post.text.slice(0,100) || post.id` 建立 `episodes.name`；`post.text` 的语义由平台采集器决定。小红书 `src/l1-xhs-dom.mjs:visibleNoteCards` 将 `.note-card__title` 作为 `text`，所以这条链是卡片标题→入库作品名→工作台短名，不能写成截取小红书帖子正文。X 导入/观测的 `text` 可来自帖文，但 `nickOf` 直接处理的仍是作品名。没有证据把本次故障项等同于平台账号昵称。
- **复现步骤（复述）**：在修复前用包含 emoji 且截断边界落在代理对中间的作品名打开流量页。UTF-16 的非 BMP emoji 占两个代码单元，旧 `slice(0,16)` 可只保留高代理项 `U+D83D`。既有隔离二分中单行 140 失败、相邻 141 通过；269 行只替换短名后通过；去表格但保留短名选择器仍失败，去除两者后通过。已有只含该孤立字符的精简页也失败，完整 emoji 对照可真实出图，排除了仅由行数造成的解释。
- **崩溃解释与边界**：Chrome `157.0.8103.51` 的 browser / `CrBrowserMain` 退出 `3221225501`（`0xc000001d`）；既有 dump 分析在 `chrome.dll+0xcdafc2c` 读到 `0f0b`，即原生 UD2 陷阱。最小字符对照将孤立代理项确定为本机该版本的触发输入；这不是普通 JS 异常，异常名也不能证明缺少 SSE/AVX。浏览器内部具体 CHECK/调用链未符号化，不宣称所有 Chrome 版本都会崩溃或浏览器本体已修好。
- **具体改动、理由与修复 commit**：`7cb8aa7` 将回退生成的短名改为 `Array.from(value.toWellFormed()).slice(0,16).join('')`，按 Unicode 码点保留完整代理对；显式 `pj.nick` 保持不截断，只做 `toWellFormed()`。对库中已有损坏显示项在读取展示时规范化，孤立代理项变为替代字符，不能还原已丢失字符，也不等于按字素簇截断。原平台昵称/作品原文未被修改；只修复了工作台短名截断方式，以及库中已损坏的显示项。该提交没有数据库迁移或批量回写，不能将此表述解释为改写源记录、重新采集或修改原始标题。
- **证据与真实测试边界**：[交付矩阵](focus-delivery.md) 11-18 节、[问题清单](issue-register.md) 同日流量崩溃条目、[旧诊断](diagnostics/traffic-share-20261117.md)；本机 `_local-bisect-evidence/`、`_local-diag-evidence/`。历史最小回归仅 web-text / l1-share / l1-web 及语法、diff 检查；没有重跑 11+8 套件。正式 SQLite 一致性副本和真实 handler 的候选检查，以及部署后正式流量页，均有真实 Chrome DOM/有效 PNG；269 行、269 项选择、9 行汇总及 Unicode 检查通过，观测/任务/样本/统计不变。第一次深滚动空白 PNG 不算视觉通过，回页顶后重新取得的有效图才算。`c7d181e` 只追加部署证据，不是第二个代码修复。
- **可回退方式**：反向应用 `7cb8aa7` 的 `src/web.mjs` / `src/web-text.mjs` 相关改动会恢复旧截断及风险；分享诊断 hunk 可独立保留。已有 `rollback/bisect-20261118` 指向 `1aa5c66`，但本次不切换、不恢复数据库；显示期规范化本身没有待逆转的数据写入。

### U2 工作台鉴权后丢失深链，未登录页缺少输入表单

- **类别、基线与定位**：原生缺陷修复。`61ffcf0:src/web.mjs:handle` 未认证返回裸 401 提示，查询口令认证成功固定重定向 `/`；更早引入版本未知。当前定位为 `src/web-auth.mjs:authPage / cleanTarget` 和 `src/web.mjs:handle`。
- **复现步骤**：无会话访问 `/p#/system`；在原流程首次认证后观察是否仍停在系统页。历史只源码核对查询口令分支，没有把真实口令写入 URL 做实验。
- **具体改动与修复 commit**：`f243f09` 增加 POST 表单、错误提示和本地返回目标清理，保留路径/hash 并移除 URL 中的 key 参数；API 未登录仍返回 401。解决交互和深链问题，不宣称认证算法漏洞。
- **证据与真实测试边界**：[问题清单](issue-register.md) I05、[交付矩阵](focus-delivery.md)。既有真实 Chrome 表单错误提示、POST 深链、Cookie 认证与地址清理验收通过；原版对照保留原样。本次没有读取或使用口令。
- **可回退方式**：反向应用 `f243f09` 中鉴权相关文件/hunk；不要连带撤销同提交的 L1 health 修复。回退将恢复旧交互，不能据此声称上游对照也已修改。

## Windows兼容

### W1 PowerShell 中文管道及文件读取的编码规避

- **类别、基线与定位**：Windows兼容。分叉 `f243f09` 工作目录下已复现，但首次发生版本未知；定位是 PowerShell 的 `$OutputEncoding` 和 `Get-Content` 解码方式，不是仓库业务函数。纯 Node stdin 实验即可复现，不能归为上游源码缺陷。
- **复现步骤**：历史在默认 PowerShell 中用中文 here-string 管道传给 Node，读回问号码点；同一命令进程显式 UTF-8 后正常。文件默认读取乱码与 stdin 损坏是两种现象。
- **具体改动与修复 commit**：无业务代码修复 commit；仅命令进程显式使用 UTF-8、读取时指定 `Get-Content -Encoding UTF8`，没有修改用户全局配置。现象和规避记于 [问题清单](issue-register.md) I03。
- **证据与真实测试边界**：I03 记载真实本机码点前后对照；本次只按 UTF-8 读取已有文档，没有重做实验。不宣称旧损坏文件已修复，也不据此宣称旧发布 shim 的 macOS 命令已兼容 Windows。
- **可回退方式**：结束该命令进程或撤销局部编码设置即可；没有代码/数据库变更可 revert。UTF-16 短名问题归 U1，不因在 Windows 上触发就改归本类。

## 新增功能

### N1 独立 L1 可见页面采集、导入、落库和日报

- **类别、基线与定位**：新增功能。对照上游 `61ffcf0` 的原 hub/工程链；分叉 `930c19d` 新建 L1 存储/导入，`f019b25` 增加 X 专用页面采集，`6965b06` 增加公众号只读采集。定位：`src/l1-x.mjs:collectX`、`src/l1-xhs.mjs:collectXhs`、`src/l1-wechat.mjs:collectWechat`、`src/l1-store.mjs:saveObservation`、`src/local-report.mjs:writeLocalReport`。
- **复现/使用步骤**：按 [Windows L1 说明](../README-L1-windows.md) 用单平台登录/采集入口或导入公开观测，再查看本地日报。这里描述已有能力，不在本次执行这些命令。
- **具体改动与实现 commit**：上述提交建立每平台独立浏览器、可见身份校验、只读 DOM 观测、事务及幂等落库、缺项保持未知的本地报告链；`a708b10` 在 `src/l1-login.mjs:waitForVisibleLogin` 增加非 TTY 轮询，避免把后台无回车当成登录完成。不是修复上游未提供 L1 的“缺陷”。
- **证据与真实测试边界**：[问题清单](issue-register.md) 22:17 更新、[交付矩阵](focus-delivery.md)、[L1 网页说明](l1-web.md)。小红书有真实身份核验及近 30 天 50 篇采集记录；X 有历史入库记录，不代表当前登录，X/公众号后续仍受本人登录阻塞。轮询自测不消除历史登录/Runtime.evaluate 超时。
- **可回退方式**：停止使用 L1 入口并按对应提交撤销新增模块及接线；已有观测数据需保留，不用回退代码删除正式记录。不能整包回退并误接回原 hub 自动提交链。

### N2 网页发布准备、本地受限适配与 X 文图包

- **类别、基线与定位**：新增功能。分叉基线 `63ad73a` 尚无该准备流程；`src/publish-prep.mjs:createPrepService / prepCommand / acceptPrepResult`、`src/prep-bundle.mjs:xDraftBundle`、`src/web/publish-prep.js`，不等同于原 hub 发布链。
- **复现/使用步骤**：系统页或作品详情进入准备页，填文案/本地图，生成本地任务；X 下载文图 ZIP，小红书/公众号显式检查后才进入受限执行。沿用历史证据，不再填测试稿。
- **具体改动与实现 commit**：`e5ae25c` 接入准备表、下载、固定本地 skill 命令及结构化回执，强制 `submit:false`；`5ef932c` 增加正文与 0–4 张图片的冻结 ZIP、公众号摘要；`39a6e20` 补话题和实际执行证据保留。小红书固定 `--account ai`，公众号只认显式草稿保存回执，绝不用 `--submit`。结果不明不自动重试，X 仍由本人附图/保存，Codex 不发布。
- **证据与真实测试边界**：[发布准备说明](publish-preparation.md)、[问题清单](issue-register.md) I10/I15 及 22:17 更新、[交付矩阵](focus-delivery.md)；本机 `_local-complete-evidence/`。已有隔离真实 Chrome 表单/ZIP 下载、Windows 原生 ZIP 中文读取、本地两种 skill 离线检查；后续小红书生产 HTTP→实际 skill 上传填写/留窗有 `submitted:false` / `dryRun:true` 记录，未最终发布。公众号未保存草稿，X 未证明平台草稿保存。
- **可回退方式**：先停用准备执行入口，再按 `e5ae25c`、`5ef932c`、`39a6e20` 的对应模块/hunk 撤销；保留本地任务及 unknown 状态供人工核对，不能通过删记录触发重复执行。

### N3 可见身份体检、作品/准备稿链接核验与事务回写

- **类别、基线与定位**：新增功能。`63ad73a` 无 L1 inspect；`e5ae25c` 首次增加，`39a6e20` 完善无平台 ID 的准备稿匹配。定位 `src/l1-inspect.mjs:publishedTarget / preparationTarget / selectPublishedLink / inspectPlatform / writePublishedLink / writePreparationLink` 及 `scripts/l1-inspect.mjs`。
- **复现/使用步骤**：系统页体检；作品详情或准备页指定实际发表日期取链接。稳定 ID 优先；没有 ID 时按完整文字和日期唯一匹配（X 正文，小红书/公众号标题），再核验真实公开 URL。
- **具体改动与实现 commit**：`e5ae25c`、`39a6e20` 接通受限 CLI、可见账号判断、公开 URL 验证及任务/准备记录/日志事务。身份、匹配、链接任一不确定即失败；不是旧七平台 doctor，也不实现知识站同步。分享控件和事务补强见 R9。
- **证据与真实测试边界**：[发布准备说明](publish-preparation.md)、[问题清单](issue-register.md) 22:17 更新、[交付矩阵](focus-delivery.md)；本机 `_local-complete-evidence/`、`_local-focus-evidence/`。离线唯一匹配及拒绝分支通过；真实小红书身份体检通过，但目标列表没有公开 URL，正向回写未完成。X/公众号只确认登录页，不等于身份或取链接成功。
- **可回退方式**：撤销对应 CLI/API/UI 接线及事务函数，不删除已核验记录；将入口明确标为未适配。不得用按 ID 拼造地址替代真实链接核验。

### N4 独立浏览器路径、既有代理和发布库加载检查

- **类别、基线与定位**：新增功能。分叉基线 `afb2b7b`，`src/l1-browser.mjs:browserSettings / browserProxyArgs`、`src/driver.mjs:load / publisherInfo`、`scripts/publisher-check.mjs`；原引擎对照为 `61ffcf0` 及 publisher `539091c`。
- **复现/使用步骤**：历史 X 专用 Chrome 未沿用终端现有代理时导航超时/连接重置；补用现有无凭据代理后出现真实登录页。发布库检查只加载已有独立目录并核对导出，不启动浏览器。
- **具体改动与实现 commit**：`39a6e20` 新增 X 既有 HTTP(S)_PROXY 支持及显式 system/direct/无凭据地址选择；允许独立本机绝对 profile 路径，拒绝日常目录、网络共享和跨平台共用；保留固定端口，增加程序路径候选。原 driver 增加 `MAITIAN_PUBLISHER_DIR` 与无浏览器加载检查，不是 Windows shim 全链修复。
- **证据与真实测试边界**：[问题清单](issue-register.md) I18、[发布准备说明](publish-preparation.md)、[引擎核对](publisher-engine-audit.md)。真实 X 网络访问恢复只到 LOGIN_REQUIRED；真实原库七平台导出可加载，不等于扩展 UI 已启用。跨操作系统新增路径候选没有全平台真实运行证据，故不列为已验证的 Windows 路径 bug 修复。
- **可回退方式**：反向应用 `39a6e20` 的路径/代理/库加载 hunk，保留其他准备功能；不修改系统代理、不迁移 profile、不操作当前浏览器。本次不执行加载检查。

## 改造回归修复

### R1 L1 旧快照导致 overview 500 和无工程目录读取异常

- **类别、基线与定位**：改造回归修复。`930c19d` 的 L1 快照仅 account/postId/text；原 `61ffcf0:src/web.mjs:episodeView` 按工程 platforms/covers 读取，不能据此断言正常上游工程会 500。定位 `src/web.mjs:episodeView / episodeFile / coverFile`、`src/l1-store.mjs:saveObservation`。
- **复现步骤**：导入旧 L1 快照且无工程目录，读取 overview 或作品详情。
- **具体改动与修复 commit**：`9503b0a` 兼容缺失 platforms/covers，补齐后续导入平台字段，并避免无工程目录回退到当前目录读取；作品无期数时按已有时间信息展示。
- **证据与真实测试边界**：[问题清单](issue-register.md) I01，提交 `9503b0a`；历史真实 Chrome 首页/流量/档案/详情渲染和离线旧快照回归通过，不证明真实采集链成功。
- **可回退方式**：反向应用 `9503b0a` 中快照读取/写入与模板相关 hunk 会恢复旧风险；不要连带撤销 R2，不删除历史快照。

### R2 正文关键词误判为示例数据

- **类别、基线与定位**：改造回归修复。`930c19d:scripts/import-x-public.mjs:importX` 曾按正文 `/示例|假数据/` 推断来源；上游 `61ffcf0` 没有此导入逻辑。
- **复现步骤**：真实 JSON 未声明 example，正文包含“示例代码”等词，导入后日报误标。
- **具体改动与修复 commit**：`9503b0a` 仅接受顶层或调用方明确 `example:true`，内容不再决定来源标记。
- **证据与真实测试边界**：[问题清单](issue-register.md) I02、`9503b0a` 提交说明；历史离线正文/显式标记/日报回归通过，提交记载本机正式元数据处置且作品与指标保留。本次未改库，代码 revert 也不会自动撤销历史元数据处置。
- **可回退方式**：单独反向应用导入标记 hunk；历史元数据若需恢复必须另按一致性备份核对，不能重导正式数据冒充回退。

### R3 health.login 消费者未随 L1 模型更新

- **类别、基线与定位**：改造回归修复。`1d393d3` 改为 health.platforms，旧页面仍读 health.login；上游 `61ffcf0` 的生产者/消费者结构一致。定位 `src/web/health.js:healthLights`、`src/web/board.html`、`src/web/mt.js:topbar`。
- **复现步骤**：用 `1d393d3` 的 L1 overview 配旧大屏渲染，前端异常停在“加载中”。
- **具体改动与修复 commit**：`f243f09` 统一 health helper，L1 显示手动采集/未实时检查；空结果不再推断全部正常。
- **证据与真实测试边界**：[问题清单](issue-register.md) I06；既有真实首页、系统页且无未捕获 JS 异常记录。健康显示正常不代表平台已登录。
- **可回退方式**：仅反向应用该 helper、引用及消费者 hunk；勿撤销同提交 U2 的鉴权修复。回退需恢复匹配的 API 模型，否则重现回归。

### R4 旧动作误接原 hub，系统页原入口被替换

- **类别、基线与定位**：改造回归修复。上游 `61ffcf0:src/web/pages.html:vSystem` 有状态砖、手动区、最近动态；`1d393d3` / `f243f09` 只剩登录卡及记录，属分叉回归。定位 `src/l1-web.mjs:planL1Action / launchL1`、`src/web.mjs:handle`、`src/web/pages.html:vSystem`。
- **复现步骤**：比较上述版本系统页及 `/api/action` 路由，旧 doctor/metrics/followers/sync 会走原 hub，无法遵守 L1 数据/浏览器约定。
- **具体改动与修复 commit**：`1d393d3` 隔离 L1 白名单与 CLI；`78c65fa` 恢复状态砖、五类手动入口和最近动态，登录卡改附加区；流量/粉丝各有入口并说明同一整轮 collect。`e5ae25c`、`39a6e20` 后续接入可见体检/取链接；`d671c33` 修正体检、取链接结果被标成“采集”的文案。不是补上游没有的按钮。
- **证据与真实测试边界**：[问题清单](issue-register.md) I04/I12 及夜间、22:17 更新，[交付矩阵](focus-delivery.md)。`78c65fa` 当时只有 VM/HTTP，后来隔离真实 Chrome 和正式系统页有图；没有据截图宣称所有平台动作完成。知识站、其他平台、后台自动任务仍在范围外。
- **可回退方式**：按路由、布局、结果文案分别反向应用对应 hunk；保留明确禁用原因。不可为了恢复旧按钮而把 L1 接回 hub run/submit。

### R5 自测 VM 漏载 health.js

- **类别、基线与定位**：改造回归修复。`f243f09` 引入 helper 后，分叉 `8b0dfe2` 的 `scripts/l1-regression-selftest.mjs` 渲染夹具未加载；后续公众号夹具也遗漏。上游没有这些 L1 自测。
- **复现步骤**：历史执行相应回归，到 board VM 时出现 `healthLights is not defined`；真实 HTML 当时已经正确加载 helper。
- **具体改动与修复 commit**：`78c65fa` 补数据回归的加载顺序；`e5ae25c` 补 `scripts/l1-wechat-selftest.mjs` 同类依赖，避免把夹具失败当实际网页失败。
- **证据与真实测试边界**：[问题清单](issue-register.md) I13 及发布准备动态；历史自测修正后退出 0，仅属离线验证，不证明公众号真实链路通过。
- **可回退方式**：反向应用对应测试夹具单行变更会恢复失败；不涉及业务数据。本次没有运行这些测试。

### R6 单篇累计与当日新增混淆，统计三口径不统一

- **类别、基线与定位**：改造回归修复。精确首次引入未知，`f243f09` 前已有 L1 误导文案；分叉 `e5e1da9` 仍未统一账号汇总。上游 `61ffcf0` 以“期”为主，没有同数据证据证明该问题原生存在。定位 `src/l1-summary.mjs:accountSummary / configuredSummaries`、`src/web.mjs:overview`、`src/web/health.js`、`src/web/board.html`、`src/web/pages.html:vTraffic`、`src/local-report.mjs:writeLocalReport`。
- **复现步骤**：作品只有累计值或没有前一日同字段观测时查看首页/流量/日报，若写成今日新增或按 0 补基线即误导。
- **具体改动与修复 commit**：`f243f09` 先纠正文案和未知值；`8871e67` 统一当日发文累计、当前入库作品累计、同集合跨日快照增量，并披露日期/观测范围。缺基线、缺字段或沿用旧字段时增量为 null/暂无；不宣称账号终身总量或零点至今流量。
- **证据与真实测试边界**：[交付矩阵](focus-delivery.md) 三口径表、[问题清单](issue-register.md) I07 最新更新；本机 `_local-focus-evidence/`。已有 SQLite/HTTP/日报对照和隔离 Chrome 汇总可见性通过；当时正式流量页失败，直到 U1 才有正式页有效图。没有为统计重拉平台，也没有足够跨日实测就声称真实增量通过。
- **可回退方式**：撤销 `8871e67` 中统计模块和各消费者对应 hunk，保留分享保护；回退到旧文案/统计会重新引入误读，不改历史观测值。

### R7 可见账号写死，配置更换后仍使用旧身份

- **类别、基线与定位**：改造回归修复。精确引入未知，分叉 `e5ae25c` 仍存在；上游无这套 L1 账号链。定位 `src/l1-account.mjs:l1Account` 以及 X/小红书、导入、网页状态和日报调用处。
- **复现步骤**：在离线配置中更换预期公开账号，旧导航、过滤或报告仍使用固定账号。
- **具体改动与修复 commit**：`5ef932c` 统一读取已有 config 或独立公开身份文件；缺配置/冲突先失败，日报无观测不猜账号。仍每平台单账号，发布别名 ai 不变；没有改写含口令配置或迁移登录态。
- **证据与真实测试边界**：[问题清单](issue-register.md) I16、[发布准备说明](publish-preparation.md)。已有自定义账号、缺失/冲突、跨账号导航/过滤的离线回归通过；真实平台换号未测。
- **可回退方式**：反向应用 `5ef932c` 中账号模块及调用处 hunk，保留 ZIP 功能；公开身份本地文件不入 git，回退不删除其数据或 profile。

### R8 素材校验不足与浏览器能力开关误扩大旧拒绝

- **类别、基线与定位**：改造回归修复。分叉 `e5ae25c` 的准备页只验扩展名/存在性；`afb2b7b` 仍把旧 compare/9368 拒绝扩大为通用禁用。定位 `src/publish-prep.mjs:normalizePrep / prepCapabilities / createPrepService`、`src/l1-web.mjs`。
- **复现步骤**：历史离线夹具用空图/伪文件头生成任务，或原生允许的本地 skill/只读通道被一个全局阻塞原因永久禁用。不是上游产品缺少新功能的运行时 bug。
- **具体改动与修复 commit**：`5ef932c` 加非空、文件头、32MB 单图/64MB 整组限制和网络共享路径拒绝；`39a6e20` 按发布/只读通道和平台拆分，显式 false 仍停用，新增 published 防重复及受限结果证据。不能把配置开关当审批，也不解除 9368 原拒绝。
- **证据与真实测试边界**：[问题清单](issue-register.md) I15/I17、[发布准备说明](publish-preparation.md)；已有离线拒绝分支、真实本地表单/下载、小红书实际填写记录。文件头检查不是完整解码/逐图审阅；小红书成功不覆盖公众号或旧扩展链。
- **可回退方式**：分别反向应用素材或能力判定 hunk；可另用既有显式 false 停单通道，但本次不修改配置。结果未知的准备任务不可通过回退清除防重复状态。

### R9 分享回写保护和精确负向错误码

- **类别、基线与定位**：改造回归修复。分叉 `e5e1da9` 的取链接链需补强；`1aa5c66` 的 `visible-share-control-not-unique` 混用 0/多个。定位 `src/l1-xhs-dom.mjs:visibleNoteShare`、`src/l1-inspect.mjs:inspectPlatform / validateProof / writeTask`。上游没有此 L1 分享分支。
- **复现步骤**：目标稳定 ID 卡片无 href，出现 0、多个或无标签操作控件时观察旧错误；离线在查询后改变快照 ID，确认事务不会写到其他笔记。真实列表的五个 span 没有 text/title/aria/role，不按图标序号点击。
- **具体改动与修复 commit**：`8871e67` 仅允许稳定 ID 唯一卡片内唯一明确“分享/复制链接”控件，读取同 ID 可见卡片/弹层 URL，并在事务中重核快照 ID；`7cb8aa7` 拆分 `visible-share-control-zero` / `multiple` / `unlabelled` / `no-explicit-label`，带控件计数及逐项可见属性，调用方保留 code/evidence。`8871e67` 已在 card 内查询，不能把 `7cb8aa7` 说成修复全页找按钮的范围 bug。全页弹层读取与点击目标选择用途不同。
- **证据与真实测试边界**：[交付矩阵](focus-delivery.md)、[问题清单](issue-register.md) I19、[旧诊断](diagnostics/traffic-share-20261117.md)；本机 `_local-focus-evidence/`、`_local-bisect-evidence/`。离线唯一明确控件正向、歧义/ID 变化拒绝及错误码分支通过；最新真实只读为 10 卡/目标 1、可见控件 5/明确分享 0/公开链接 0，精确 unlabelled，无点击无回写。负向实测不等于正向取链接成功。
- **可回退方式**：诊断 hunk 可独立反向应用 `7cb8aa7` 而保留 U1；若撤销 `8871e67` 的分享保护，应同时停用相应回写入口，不能降级为猜图标或按 ID 拼地址。

## 仍未验证

### V1 小红书真实公开链接正向回写

- **类别、基线与定位**：仍未验证。分叉 `c7d181e`，`src/l1-inspect.mjs:inspectPlatform / writePublishedLink / writePreparationLink`；非已证实的上游缺陷。
- **复现步骤**：已有记录能唯一匹配真实列表目标，但无公开 href；既有额外公开页检查为 404。最新可见操作无明确分享标签，未点击。
- **改动与 commit**：`39a6e20`、`8871e67`、`7cb8aa7` 有匹配、保护与诊断；没有“真实正向已修”commit。还需要可核验的真实分享 URL 来源和成功事务证据。
- **证据与边界**：[交付矩阵](focus-delivery.md)、[问题清单](issue-register.md) I19；本机 `_local-complete-evidence/`、`_local-focus-evidence/`、`_local-bisect-evidence/`。正式任务没有因这些失败写入猜测 URL；原因是正向未完成，不是已证实未登录或安全拒绝。
- **可回退方式**：无新增成功数据可撤销；沿用 R9 的代码回退/停用方式，保留失败记录，不重复采集或发布。

### V2 X/公众号本人登录及后续平台链路

- **类别、基线与定位**：仍未验证。分叉 `39a6e20` 至 `c7d181e`；`src/l1-x.mjs:loginX / collectX`、`src/l1-wechat.mjs:loginWechat / collectWechat`、`src/l1-inspect.mjs:inspectPlatform`、`src/publish-prep.mjs:acceptPrepResult`。非上游缺陷，本分叉环境限制。
- **复现步骤**：既有实际专用页面显示 X 用户名输入页、公众号扫码页，本地公众号 status 也返回 LOGIN_REQUIRED；本人未完成登录，后续不能验收。
- **改动与 commit**：`a708b10` 轮询、`39a6e20` 代理/二维码判定只解决局部能力；没有完成本人登录或公众号显式存草稿的修复 commit。历史 X 超时/公众号 Runtime.evaluate 超时不能靠 mock 宣称消失，也不能都归因 Windows。
- **证据与边界**：[问题清单](issue-register.md) I08/I09/I18 及 22:17 更新、[发布准备说明](publish-preparation.md)。X 历史数据/文图包可用不等于当前采集和平台草稿成功；公众号未 post、未确认保存；没有最终发布。
- **可回退方式**：保持等待本人登录，必要时用既有平台显式 false 停用；无登录/平台草稿成功状态可回退，不清 profile、不借其他会话。本次不改开关、不操作窗口。

### V3 原 publisher 扩展 UI 与 Windows 原发布链

- **类别、基线与定位**：仍未验证。上游主库 `61ffcf0:src/driver.mjs / src/chrome-shim.mjs / src/bridge.mjs / src/hub.mjs`，publisher `539091c`（0.4.0）的 manifest/sidepanel/platform adapters。非上游缺陷结论，只是当前安装启用/功能范围和环境边界。
- **复现/核对步骤**：历史独立目录真实库加载和七平台导出检查通过，但没有扩展 UI 启用成功证据；原 shim 还含 osascript/lsof/sips，库可加载不足以证明 Windows 视频发布链可用。
- **改动与 commit**：`39a6e20` 仅增加库路径与检查入口；没有扩展 UI 已启用或旧 Windows 发布链已修复的 commit。publisher 小红书适配是视频，公众号无适配，图文/公众号接本地 skill 是新增能力，不把缺少适配写成上游 bug。
- **证据与边界**：[引擎核对](publisher-engine-audit.md)、[问题清单](issue-register.md) 夜间与 22:17 更新。以该文档最上方最新加载结果为准，后文“仅源码存在/尚未加载”的历史段落不是当前库加载状态；库与扩展 UI 必须分开。
- **可回退方式**：独立撤销 `39a6e20` 库路径/检查 hunk即可；没有已启用 UI 可撤销，不修改扩展状态文件或当前 Chrome，不在本次重做安装检查。

### V4 compare/9368 拒绝与 Computer Use native pipe

- **类别、基线与定位**：仍未验证。精确首次版本未知，分叉 `f243f09` 后的问题清单已记录；定位是 compare 独立调试启动和 Computer Use 工具传输，不存在已定位的仓库业务函数缺陷。
- **复现步骤**：复述旧 compare/9368 的 `blocked by policy` 和 native pipe `os error 2`；没有更细审批原因，不能改写为审批过期、CPU 指令集或某个业务错误。本次不重试，不换端口/入口。
- **改动与 commit**：无解除这两项阻塞的修复 commit；`39a6e20` 只是缩小通道禁用范围。后来的无调试 Chrome CLI 真实页面通过，不代表旧拒绝或 native pipe 已解除。
- **证据与边界**：[问题清单](issue-register.md) I14/I17、[交付矩阵](focus-delivery.md)、[引擎核对](publisher-engine-audit.md)。非上游缺陷，本机策略/工具限制；不附原始拒绝日志。
- **可回退方式**：无本次变更可撤销，保持原停止状态；不能用第二套服务、其他端口或重复 Codex 作为替代验收。

### V5 范围外产品能力及跨平台/端到端验收

- **类别、基线与定位**：仍未验证。上游 `61ffcf0:src/web/pages.html:vSystem` 的原 hub 工程功能，对照当前 `src/web/pages.html:vSystem`、`src/l1-web.mjs:planL1Action` 和新增准备链。非上游缺陷；属于本分叉范围/缺失产品能力或未完成验收。
- **复现/核对步骤**：查看系统手动区说明；知识站、其他原版平台、定时后台、旧按期全平台核对未被本次 L1 实现。页面恢复入口不能等同于这些功能已经接通；三平台可见身份体检也不是七平台 doctor。
- **改动与 commit**：`78c65fa` 恢复入口并说明限制，`e5ae25c` / `39a6e20` 接部分新能力；范围外功能无修复 commit。路径候选和离线测试同样不构成 macOS/Linux/Windows 全发布链验收。
- **证据与边界**：[问题清单](issue-register.md) I04/I10/I11/I12 最新更新、[发布准备说明](publish-preparation.md)、[交付矩阵](focus-delivery.md)。必须区分源码、离线/HTTP、真实本地 Chrome、真实平台四层。11-17 的 11+8 与 11-18 的三个最小自测是不同轮次；本次文档核对不增加任何 PASS，不承诺全部历史问题已解决。
- **可回退方式**：保留明确未适配说明和边界；若撤销已接入口按 R4/N2/N3 分项处理，不为“功能齐全”接回自动发布或删除失败记录。

本说明适合按项挑选上游候选补丁；U1/U2 有上游基线证据，其余不能仅凭“fix”提交名归因为上游缺陷。本文自身只新增说明文件，回退时反向应用本次文档提交即可，不需要切换服务或恢复数据库。
