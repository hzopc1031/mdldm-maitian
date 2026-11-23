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

## Git

- `data/`、`config.json`、`chrome-profile*` 已在 `.gitignore`，不要强加。
- 证据放项目根 `evidence/`，不要塞进仓库。
