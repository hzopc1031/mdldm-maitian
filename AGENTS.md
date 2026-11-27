# 接手须知（给任何 AI）

先读 [docs/handoff.md](docs/handoff.md)，再读 [docs/publish-api.md](docs/publish-api.md)。本文件只列不能忘的硬约束。

## 边界

- 平台动作由 `type:fill` 的必填 `mode` 决定：`draft` 存草稿、`publish` 直接发布。没有默认值，只接受这两个值。直接发布只对 X 和小红书开放；公众号只能存草稿，本地 skill 明确禁止发表。
- `publish` 必须按当次明确授权执行；发布成功后读回公开链接，失败或未确认记 `unknown`，不重发。
- 不传平台密码、Cookie、token；不调用平台内部接口。
- 状态 `unknown` 不重跑、不换 ID 重建，先人工核对。
- 缺栏目/AI 来源的旧记录不猜填。
- 不碰 9333（小红书）、9335（公众号）、9336（X）之外的窗口，也不对这些端口另起自动化。

2026-11-27用户要求X由用户自己登录、支持通用多账户，本次窄范围补充优先于上一条旧端口限制：原X入口保持兼容，新建槽仅可用x_accounts注册的独立chrome-profile-l1-x-<随机ID>及9410–9499端口；必须按精确槽路由、可见/home当前身份核验，不连接/复制普通或其他项目浏览器。未知槽/未登录槽不得采集或交稿，既有稿件不可换号。详情[docs/x-multi-account-20261127.md](docs/x-multi-account-20261127.md)。不改变发布授权与unknown锁规则。

## 改动流程

1. 改代码前先跑 `node --check` 涉及的 mjs。
2. 存草稿/填写前必须先 `check` 通过。
3. 改完跑三组自测：`scripts/platform-rules-selftest.mjs`、`scripts/prep-status-selftest.mjs`、`scripts/l1-web-selftest.mjs`。
4. 需要上线时用 `scripts/Update-Maitian.ps1 -Restart -Confirm:$false`（会先备份再重启 8787）。
5. 把进展写回 `docs/handoff.md` 或 `docs/publishing-status-20261123.md`，不要只留在聊天里。

## 每次都做（Liu 2026-11-23 定的长期约定）

1. 开工先读 `docs/handoff.md`，再用 `scripts/Update-Maitian.ps1 -CheckOnly` 核对 8787 归属与空闲。
2. 每次改动后更新 `docs/handoff.md` 的「今天做过的改动」和「待办与下一步」；涉及发布入口的追加到 `docs/publishing-status-20261123.md`。
3. 自测三组通过才重启；重启后把 PID、备份路径和新契约写进文档。
4. 改动提交到 Git，提交信息写清做了什么；不要把 `data/`、`config.json`、profile 提交上去。
5. 结论、证据、备份路径都落盘，聊天里只讲摘要，不把关键信息只留在对话里。

## Git

- `data/`、`config.json`、`chrome-profile*` 已在 `.gitignore`，不要强加。
- 证据放项目根 `evidence/`，不要塞进仓库。

## 本地交接维护规则（Liu，2026-11-23，后续持续执行）

- 开工先读本文件、`docs/handoff.md`、本阶段相关的最新进展和证据，再核对工作树及必要的只读状态；不得把旧聊天或历史PID当作当前事实。
- 每个有意义的阶段结束、需求改变、出现阻塞、准备切换AI/会话、额度将尽或结束任务前，先更新本地记录，再汇报。长任务在关键决策和验证结果出现时及时落盘，不等整项完成。
- `docs/handoff.md`维护当前目标、已确认决定、已完成与已验证范围、正在做/负责人/涉及文件、阻塞及下一步。每条结论注明日期、证据位置；未执行、模拟通过、真实通过、已部署分开写。
- 详细步骤、错误、命令退出结果、真实ID、必要回执、截图和备份位置保存项目根 `evidence/<主题-日期>/`，交接页链接到证据。不得保存密码、Cookie、token、私钥或原始认证页面内容。
- 开始改代码时在交接页登记本次范围和负责人，完成后更新；多AI并行前重读磁盘，不覆盖别人改动，不reset/clean已有工作树，不凭旧状态重启服务、重发或恢复已清理记录。冲突先保留双方证据，再协调。
- 已知需求被新指令取代时，当前摘要采用新要求；旧方案标成历史或被取代并保留证据。原稿/任务沿实际ID续办，不因切换AI伪造执行人或重新创建。
- 用实际会话身份记录本次工作；登记待办不等于执行授权，不自动新建调度、不触发平台操作。其他AI不能访问此本机磁盘时，明确未读取，不能宣称已经接手。
- 保存后读回关键段并检查入口链接；给Liu提供可直接打开的文件。文件已落盘不等于其他运行中的AI已自动读取。

- 2026-11-27 X发布账户最终规则：发布页及AI fill均必须显式accountId，只能从contract.xPublishAccounts已确认登录列表选择；原稿未准备前可select-x-account，检查后目标固定，unknown不换号/重建。评论模块尚未开发，本轮无平台动作。详细交接与证据见docs/x-multi-account-20261127.md。
