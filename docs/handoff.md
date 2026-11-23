# 交接文件（HANDOFF）

最后更新：2026-11-23 22:05（北京时间）。任何 AI 接手前先读本文件，再按文末「必读顺序」展开。

## 一句话现状

麦田工作台跑在 `http://127.0.0.1:8787`，只做「填写 / 存草稿」，不做最终发布；`/api/prep/posts` 是唯一写入口，建稿必填栏目、计划时间、AI 来源；库里现有发布记录 0 条（历史测试与旧回执已于 2026-11-23 清理并留档）。

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

`GET /api/prep/contract` 返回：`version:4`、`submit:false`、`finalPublishPlatforms:[]`、`requiredCreate:["column","scheduledAt","actor"]`、`scheduledPublish:"recorded_only"`、`noteLimit:500`、`fillModes:["fill","draft"]`。

写入口 `POST /api/prep/posts`，必须带 `Origin: http://127.0.0.1:8787`，仅本机 loopback，请求体 ≤128KB。

顶层字段白名单：`type,id,platform,platforms,input,actor,column,scheduledAt,note,mode`。`publish`/`submit` 一律 403。

- `type:create`：必填 `column`（1–80 字）、`scheduledAt`（带时区 ISO、晚于当前时间、只记录不执行）、`actor`（`runtime` codex/dsh/grok，`grokbot` 为别名；`sessionId` 必须真实）。
- `type:meta`：只改 `column`/`scheduledAt`/`note`，至少一项。
- `type:update`：改完整平台版本（`platform` 可为 master）。
- `type:generate`：本机 Codex 按平台 skill 分平台改稿，202 仅表示启动。
- `type:check`：共用规则 + 本地 skill 离线检查；返回 `validation.ok`。
- `type:fill`：`mode` 省略=填写留窗（小红书）/存草稿（公众号）；`mode:"draft"` 只存草稿。
- `input` 字段：`title,content,images,cover,topics,video,digest,caption,author,imagePositions,promotionReview`。

读接口：`record?id=`、`posts`、`bundle?id=`（X ZIP）、`asset?id=&platform=&index=`、`status`、`ai-prompt`。

## 平台边界（2026-11-23 实测状态）

| 平台 | 标题/正文/图 | 填写 | 仅存草稿 | 备注 |
| --- | --- | --- | --- | --- |
| X | 加权 280（premium 配置 25000）/ 无标题 / ≤4 图 | 不填编辑器 | 不支持 | 只出文图 ZIP；编辑器开关 `publishPrep.x.browserExecution=false` |
| 小红书 | 20 / 1000 / 1–18 图 | 填好留窗，状态 `awaiting_user` | 支持，`save-draft` 存草稿箱，状态 `draft_saved`（**尚未真实实测**） | 草稿绑定浏览器 profile，重复跑会多份同名稿 |
| 公众号 | 32 / 50000 / 摘要120 / 作者16 / ≤20 图 | 仅存草稿 | 支持（本来就是这样） | 作者需在草稿里手填 |

X 草稿要另用本地 `x-publish` 的 save-draft，不由工作台代操作。

## 今天做过的改动（2026-11-23 晚）

1. 建稿新增必填 `column`、`scheduledAt`、`actor`；新增 `note`（≤500 字）和 `type:meta`。
2. 发布状态页：栏目显示 + 按栏目筛选、备注展示、「复制 AI 接入指令」按钮与面板、`?ai=1` 自动展开。
3. 新增 `GET /api/prep/ai-prompt`，文本来自 `docs/ai-publish-prompt.md`，避免两份维护。
4. `fill` 增加 `mode:"draft"`：小红书走 `xhs-publish/scripts/save-draft.mjs`，公众号沿用原路径，X 明确不支持。
5. 清理历史数据：先删 10 条缺栏目测试记录 + 2 条测试原稿，再按指示删剩余 10 条旧已发布 X 回执（已导出 `evidence/publish-redesign-20261123/removed-legacy-posts-*.json`）。当前记录 0 条。
6. 离线自测三组通过：`platform-rules-selftest`、`prep-status-selftest`、`l1-web-selftest`。

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
4. 页面桌面/390px 视觉验收未做。
5. 真实公众号草稿需带新字段再验一次。

## 工作约定（Liu 2026-11-23 定，后续都这么做）

- 开工先读本文件，再 `Update-Maitian.ps1 -CheckOnly` 核对服务。
- 每次改动后更新本文件的「今天做过的改动」「待办」，发布入口相关再写 `publishing-status-20261123.md`。
- 三组自测通过才重启；重启后把 PID、备份路径、契约写进文档。
- 改动提交 Git；只讲摘要，关键结论必须落盘。

## 必读顺序

1. 本文件 → 2. `repo/docs/publish-api.md` → 3. `repo/docs/ai-publish-prompt.md` → 4. `repo/docs/publishing-status-20261123.md` → 5. `repo/docs/issue-register.md` 顶部。
