# 本轮聚焦交付与测试矩阵

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

## 可复现验证

从仓库运行：`node scripts/l1-summary-selftest.mjs`、`node scripts/l1-share-selftest.mjs`、`node scripts/publish-prep-selftest.mjs`、`node scripts/l1-selftest.mjs`、`node scripts/l1-x-selftest.mjs`、`node scripts/l1-wechat-selftest.mjs`、`node scripts/l1-account-selftest.mjs`、`node scripts/l1-login-selftest.mjs`、`node scripts/l1-regression-selftest.mjs`、`node scripts/l1-web-selftest.mjs`、`node scripts/web-auth-selftest.mjs`。11项为第一方离线/loopback夹具，无平台请求。

`node scripts/web-headless-accept.mjs`：8项真实Chrome CLI隔离页面（未登录、错误口令、首页、流量、系统、准备、文图包、启用状态系统）；无远程调试端口、无平台访问。新断言覆盖9行汇总、三种标签、暂无和未垂直裁切。

正式只读URL：`http://127.0.0.1:8787/`、`http://127.0.0.1:8787/p#/traffic`、`http://127.0.0.1:8787/p#/system`、`http://127.0.0.1:8787/api/overview`。口令不得放URL；本轮浏览器使用临时GET-only代理访问正式HTML/API，真实web key只在内存请求头，不给浏览器，不落盘。

证据根 `D:\AIInfra\maitian\_local-focus-evidence\`：`offline-suite.json`及逐项log、`render-final/results.json`和PNG、`real-summary.json`、`reports/daily/2026-11-17.md`、`xhs-share-result.json`、`xhs-share-visible.png`。真实负向不是正向平台成功。部署、备份、最终PNG哈希及推送状态在最终本机报告中列出。

指定附件：`C:\Users\Mayn\.grokbot\attachment-staging\maitian-final-system.png`、`C:\Users\Mayn\.grokbot\attachment-staging\maitian-xhs-prepared.png`。已从真实源图读取并检查；无口令、web key、Cookie。

## 部署与回退

仅在候选代码离线、HTTP和隔离真实Chrome全部通过后切换8787。保留 `rollback/focus-20261117` 指向e5e1da9、一致性SQLite备份 `data/backups/focus-20261117/hub-before-deploy.db`。不停止8788/PID6364或9333/PID12064。最终部署PID、代码提交、推送校验与回退操作写入本机报告 `D:\AIInfra\maitian-focus-out.md`，完成后补本节实测记录。
