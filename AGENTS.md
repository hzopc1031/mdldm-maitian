# 接手须知（给任何 AI）

先读 [docs/handoff.md](docs/handoff.md)，再读 [docs/publish-api.md](docs/publish-api.md)。本文件只列不能忘的硬约束。

## 边界

- 工作台只填写和存草稿，**不发布**。接口 `publish`/`submit` 一律 403，不要绕。
- 不传平台密码、Cookie、token；不调用平台内部接口。
- 状态 `unknown` 不重跑、不换 ID 重建，先人工核对。
- 缺栏目/AI 来源的旧记录不猜填。
- 不碰 9333（小红书）、9335（公众号）、9336（X）之外的窗口，也不对这些端口另起自动化。

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
