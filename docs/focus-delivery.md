# 本轮聚焦交付与测试矩阵

## 2026-11-18 隔离二分修复（起点 1aa5c66）

隔离数据与组件二分定位流量页崩溃

本节优先于历史状态。新增定位与修复：`nickOf` 的 UTF-16 `slice(0,16)` 切断 emoji，产生孤立 `U+D83D`。此代码已存在于上游首个公开版本 `312a51f`；不是本轮统计改造引入。Chrome 157 对只含该字符的精简页也以3221225501退出；完整emoji对照真实出图。已改为按Unicode码点截断，并修复导入昵称中已有的孤立代理项；不改原始标题、统计或鉴权。

| 本轮新增验证 | 结果 / 边界 | 分类 / 未完成原因 |
| --- | --- | --- |
| 相同隔离HTTP/profile规则：精简页、脱敏1/269行 | Chrome退出0，DOM及PNG存在；排除单纯规模及全部CLI不可用 | — |
| 原数据269行；仅表格；去表格但保留昵称选择器 | 均原生崩溃；9行汇总独立通过，去表格和选择器后通过 | 上游原生 / 工具错误（修复前） |
| 数据二分 | 0–134通过；134–201→134–167→134–150→134–142→138–142→140–142失败；单行140失败、141通过；只替换nick后269行通过 | 上游原生：旧截断缺陷 + Chrome原生处理异常 |
| 修复候选，正式SQLite一致性副本+真实handler | 原始观测/样本完全一致；269行、9行汇总、Unicode完整性及第140项选择通过；顶部截图已目视核验 | 已修；部署结果见下方追加 |
| 分享入口：本轮唯一9340低频只读 | 10卡/目标1卡；可见控件5、明确分享0、无标示5、公开链接0；5个span的text/title/aria/role均空；截图核验，无点击/回写 | 待核实 / 真实测试未做（正向成功） |
| 分享错误码与诊断 | 区分zero、multiple、unlabelled、no-explicit-label；回传计数及逐控件可见属性，调用方错误保留code/evidence | 改造引入的旧诊断缺口，已修 |
| 其余范围内无需身份项 | 简短对照当前清单与已实现入口，未发现新增可修缺口 | — |

最小回归仅 `web-text-selftest`、`l1-share-selftest`、`l1-web-selftest`、触及模块语法与diff检查，均通过；没有运行11+8整套。候选Chrome仅流量默认页和emoji选择场景。第一次选择后深滚动PNG为空白，未作为视觉通过；改为选择后回页顶，单独复验选择场景并出图，DOM选择断言通过。上游Chrome内部具体CHECK未符号化，不宣称已修复浏览器本身。

本机证据 `_local-bisect-evidence/`：逐段`result.json`、最小字符对照、`nick-codepoints.json`、`candidate-check/results*.json`及PNG、`share-once.json`。原始数据、SQLite、真实截图及profile均忽略，不提交。X/公众号仍等本人登录，扩展UI仍等本人启用；9368与native pipe不重试。8788与9333不动。原因六类原样保留历史定义，不新造原因类别。

## 聚焦诊断更新（起点 4d2acb7）

流量页3221225501与分享控件范围诊断

本节优先于下方历史状态。本轮没有修复业务代码，没有部署或重启；8787/PID5648、8788/PID6364、9333/PID12064均保留。未跑11项离线/HTTP或8项隔离Chrome套件，没有新增平台采集、测试稿或链接回写。

| 核对项 | 结论 | 问题分类 | 未完成原因 |
| --- | --- | --- | --- |
| 正式流量页 | 已定位Chrome browser原生崩溃位置；正式数据的具体触发条件未定位，真实渲染仍未通过 | 待核实 | 工具错误 |
| 小红书分享控件范围 | 已是稳定ID唯一卡片内查询；并非全页控件查询，无范围修复可做 | 待核实 | 真实测试未做（正向成功） |
| 其余本轮无需身份代码 | 问题清单、页面入口、CLI、回执及事务链对照未发现新增未实现项；仅阅读结论，不增加测试通过项 | — | — |
| X / 公众号身份与后续链路 | 保留本人登录要求，未复测或改变结论 | 环境配置 | 未登录 |
| 原publisher扩展UI | 保留UI未启用结论，等待本人；未重试native pipe | 环境配置 | 工具错误 |

三份旧Crashpad及本轮一次检查均为Chrome 157.0.8103.51、`ptype=browser`、`CrBrowserMain`、`chrome.dll+0xcdafc2c`、异常`0xc000001d`，故障字节以`0f0b`（UD2）开头。不是普通JS异常的证据，也不能由此推断CPU缺少指令集。旧关闭GPU诊断同址失败，stderr为空。正式overview为276作品、流量269行、326采样，隔离夹具仅1行；默认作品仅1个有效时间点，走势图走采样不足分支，未发现该分支的NaN输入。相同正式数据的首页/系统/准备页旧渲染成功，说明不是所有Chrome命令都无法工作；仍不足以证明只有数据内容触发或定位具体字段。

本轮唯一一次Chrome检查保持正式HTML/API及原视口、渲染参数不变，仅将stdout/stderr由Node管道换成普通文件，检验大DOM输出通道假设。仍退出3221225501，DOM/stderr均0字节、无PNG，排除“只换普通文件即可解决”；不再追加检查。没有符号化调用栈或可定位到前端的异常，故不猜改代码、不将HTTP200当渲染通过。

`src/l1-xhs-dom.mjs:visibleNoteShare`先对可见`.note-card`按稳定ID筛选且要求唯一，再用`card.querySelectorAll(...)`找分享控件；全页查询只用于候选卡片和后续可见分享弹层。既有DOM探针的卡片操作是5个无文字、无title/aria标签的span，公开href与弹层均为空；它不是本轮目标卡片的新DOM快照。目标卡片上轮已精确命中，但没有逐控件计数，故旧`not-unique`不能断言为“多个”；结合既有DOM更符合0个明确标示入口。截图中的转发统计图标不能当成已验证分享按钮。无需本轮9340采集；未点击、未取到公开地址、未回写。

完整脱敏诊断见[诊断证据说明](diagnostics/traffic-share-20261117.md)。本机原始分析、响应及唯一检查证据仅在`_local-diag-evidence/`，不提交真实响应/profile/dump。本机交付为`D:\AIInfra\maitian-diag-out.md`。无已证实代码修复，不切换8787；原回退分支和SQLite备份保持不动。

聚焦小红书已发布笔记真实分享链接回写

起点 e5e1da9，分支 l1-real。本轮没有开上游PR、没有发布真实内容、没有再次填小红书测试稿。8788对照与9333已有核对窗口保持不动。

已完成：统一三种统计口径并接入overview/大屏/流量页/日报；可见分享入口严格限制与事务稳定ID复核；真实负向检查和不回写证据；截图读取、脱敏检查与staging交付；隔离代码回归。真实分享链接正向回写仍未完成。

## 统计口径与真实数据

| 口径 | 定义 | 数据不足时 |
| --- | --- | --- |
| 当日发文累计 | 北京时间当日发布的入库已发布作品，截至各自最新观测的累计表现 | 日期未知、字段缺失或无观测则暂无；不冒充今日新增 |
| 当前作品累计 | 本账号入库已发布作品最新观测之和，可能含保留字段和不同观测时间 | 缺字段则该汇总暂无；披露观测区间 |
| 跨日快照增量 | 同一入库作品集合逐篇计算当日减前一日，各字段均需对应日期实测 | 缺基线、新作品无基线、保留旧字段则暂无，不补0 |

“同ID双日”只说明两日有同ID记录；字段缺项仍使对应增量为暂无。入库范围未证明全账号完整历史，不代表平台账号终身总量。X 226篇累计浏览35548、当日10篇累计2153；小红书50篇累计4253、当日4篇累计237。两平台跨日基线不足，增量暂无；公众号无观测，均暂无。数据仅取正式库已有记录，不重新拉平台。

## 状态矩阵

| 项目 | 状态 | 实证与限制 |
| --- | --- | --- |
| 三口径统计 / overview / 日报 | 可运行 | 正式已有SQLite离线核对，HTTP与真实Chrome渲染；不承诺完整平台历史 |
| 正式流量页完整真实渲染 | 仅离线过 | 隔离Chrome页面通过；正式数据下Chrome CLI异常退出3221225501，未生成截图，未标通过 |
| 本地X文图准备与下载 | 可运行 | 第一方HTTP、隔离Chrome表单/ZIP回归；本轮未发布 |
| 小红书既有填稿未提交 | 可运行 | 沿用22:30真实截图及历史submitted:false回执，本轮只复制截图，不再次post |
| 小红书可见列表身份及稳定ID读取 | 可运行 | 本轮一次9340只读检查，10卡片、目标命中1、公开链接0 |
| 分享控件分支与事务回写正向 | 仅离线过 | 唯一明确分享控件、ID匹配、目标变化/歧义拒绝测试通过；真实未取到URL |
| X / 公众号真实身份、采集与取链接；公众号存草稿 | 需用户登录 | 前轮实际登录页证据；本轮不重复扫码或写平台 |
| 原publisher Chrome UI启用 | 仅离线过 | 文件安装/库加载已有证据；UI未启用，工具错误未解除 |
| compare / 9368 | 策略阻塞 | 已有blocked by policy，不重试 |

未完成原因仅按六选一列明：

| 项目 | 问题分类 | 原因 | 本轮结果 |
| --- | --- | --- | --- |
| 小红书正向真实分享URL回写 | 待核实 | 真实测试未做 | 正向未成功；负向已实测，无可见公开href/唯一明确分享控件，未回写 |
| X / 公众号真实平台后续链路 | 环境配置 | 未登录 | 原登录页结论保留；X历史入库数据不代表当前登录 |
| publisher扩展UI启用 | 环境配置 | 工具错误 | 文件安装但UI未启用；不重试native pipe os error 2 |
| compare独立profile/9368 | 环境配置 | 明确安全拒绝 | 不重试、不变形绕过 |
| 正式流量页Chrome CLI验收 | 待核实 | 工具错误 | 退出3221225501、无有效截图；不以HTTP200或隔离小数据冒充正式页面通过 |

## 可复现验证

从仓库运行：`node scripts/l1-summary-selftest.mjs`、`node scripts/l1-share-selftest.mjs`、`node scripts/publish-prep-selftest.mjs`、`node scripts/l1-selftest.mjs`、`node scripts/l1-x-selftest.mjs`、`node scripts/l1-wechat-selftest.mjs`、`node scripts/l1-account-selftest.mjs`、`node scripts/l1-login-selftest.mjs`、`node scripts/l1-regression-selftest.mjs`、`node scripts/l1-web-selftest.mjs`、`node scripts/web-auth-selftest.mjs`。11项为第一方离线/loopback夹具，无平台请求。

`node scripts/web-headless-accept.mjs`：8项真实Chrome CLI隔离页面（未登录、错误口令、首页、流量、系统、准备、文图包、启用状态系统）；无远程调试端口、无平台访问。新断言覆盖9行汇总、三种标签、暂无和未垂直裁切。

正式只读URL：`http://127.0.0.1:8787/`、`http://127.0.0.1:8787/p#/traffic`、`http://127.0.0.1:8787/p#/system`、`http://127.0.0.1:8787/api/overview`。口令不得放URL；本轮浏览器使用临时GET-only代理访问正式HTML/API，真实web key只在内存请求头，不给浏览器，不落盘。

证据根 `D:\AIInfra\maitian\_local-focus-evidence\`：`offline-suite.json`及逐项log、`render-final/results.json`和PNG、`real-summary.json`、`reports/daily/2026-11-17.md`、`xhs-share-result.json`、`xhs-share-visible.png`。真实负向不是正向平台成功。部署、备份、最终PNG哈希及推送状态在最终本机报告中列出。

指定附件：`C:\Users\Mayn\.grokbot\attachment-staging\maitian-final-system.png`、`C:\Users\Mayn\.grokbot\attachment-staging\maitian-xhs-prepared.png`。已从真实源图读取并检查；无口令、web key、Cookie。

## 部署与回退

候选代码离线、HTTP和隔离真实Chrome全部通过后，已从21768切换为隐藏运行的8787/PID5648，代码提交8871e6746e43b8eb275fa5504d6e7897cdb3eea2。保留 `rollback/focus-20261117` 指向e5e1da9、一致性SQLite备份 `data/backups/focus-20261117/hub-before-deploy.db`，部署前quick_check=ok且无运行操作。8788/PID6364与9333/PID12064的创建时间/监听进程未变，未操作该填稿窗口。

正式GET接口统计与已有SQLite结果完全一致；正式首页、系统页、准备页真实Chrome渲染通过，无key/Cookie进入浏览器。正式流量页额外验收三次均异常退出3221225501（含一次关闭GPU的诊断，stderr为空），没有有效PNG，保留失败。尚不能判定是Chrome工具、真实数据渲染或页面自身问题，分类待核实、原因工具错误，不声称该页正式验收通过。隔离流量页及其9行汇总可见性仍通过，不覆盖此失败。

两张指定PNG已从实际源图读取、目视核对无凭据后复制至staging；本轮系统页取部署后23:24截图，小红书取原22:30填稿截图，不是本轮新建稿。最终推送、附件SHA-256、回退步骤与结束检查写入 `D:\AIInfra\maitian-focus-out.md`，证据均在 `_local-focus-evidence/`。
