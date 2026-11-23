# 发布状态页改版（2026-11-23）

Liu 16:08 已批准。工作台发布页改为只读状态页，Liu 不手写原稿，AI 沿原接口建稿、生成、检查、填写。仅保留发布记录、待你处理、失败详情；唯一页面动作是核验后切到既有窗口。验证不点击该按钮、不连接发布专用端口、不执行真实平台检查/填写/发布。

## 实现

- prep-status.mjs 负责唯一状态映射、全量只读数据库投影、原稿/关联任务合并、未关联旧记录和失败详情再脱敏。完整读取避免最近列表上限遗漏待办。不会调用平台服务或核验浏览器。
- GET /api/prep/status 沿同一 loopback/Host/Origin/Fetch Metadata 校验，非 GET 返回405；旧 prep/posts/record/contract 不改。submit:false、finalPublishPlatforms:[] 保持。
- 平台元数据来自现有 platform-registry、常用选择、配置对象、capabilities、版本和记录的并集。页面不保存平台常量或平台数量，新增平台状态可直接显示，执行适配范围仍按原实现。
- 每篇原稿一行，标签可换行；未关联记录独立一行。已有 post/record 深链保持。失败详情显示 code/message/hint/有界stderr/截图路径，重复使用现有脱敏，再隐藏运行时网页密钥；不会载入截图或展示正文。
- 状态仅凭记录：submitted/already_exists 映射未知，不当成已发布；未生成、处理中另有明确标签。无证据字段显示未记录。
- 原 /p#/prepare?format=video 视频工程路由和采集等页面保留。CSS 删除已移除的版本编辑卡片样式，其他页面样式保留。

## 验证和部署记录

prep-status、l1-web、prep-wechat-fix、publish-prep、platform-rules、l1-prep-intake、l1-publication、l1-wechat、web-text、web-auth、l1-platforms、video-project 自测通过。新增模拟20平台、全量65条旧单、状态映射、待办筛选、原始错误脱敏、只读初始化/轮询、唯一显式window请求、去固定数量文案扫描；l1-web 验证旧接口及新接口来源保护/405。全为隔离库、mock平台/子进程。

额外误将需预填助手构建目录参数的 video-prefill-workbench-selftest 当作普通独立自测调用，因未传目录在读取 repo/manifest.json 时报 ENOENT；这是无关扩展自测入口参数不符，不是权限/浏览器/产品错误。未构建或运行第三方扩展，不计入通过项目。

正式部署及真实浏览器验收结果见项目 evidence/publish-redesign-20261123/status-page-回报.md 和 progress.log；截图仅本地留存，不需给 Liu 看。不得以离线通过替代正式记录读回和真实渲染。

## 回退

用 git revert 本文所属功能提交并推送 origin/l1-real，不 force。或独立回退工作副本检出 a263a94，保留现有 data/config/profile 及他人未提交文件；Update-Maitian.ps1 CheckOnly 后备份当前 hub.db，仅重启8787。不要自动恢复旧数据库，不解除任何旧未知锁，不动 remote-view/ssh，不改公共规范和 skill。
## 正式验收补记（2026-11-23 16:49 后补）

功能提交 1ac69fc 已推送并部署；以下为正式环境验收结果，完整回报见 evidence/publish-redesign-20261123/status-page-回报.md 与 progress.log（S0–S7）。

- 部署：Update-Maitian.ps1 CheckOnly 通过；备份 hub-before-20261123-161444-718.db 后仅重启 8787，PID 16604→22168，仅监听 127.0.0.1:8787。首页、/p、GET /api/prep、/api/prep/posts、/api/prep/contract、/api/prep/status 均 200；契约 v4、submit:false、finalPublishPlatforms:[] 不变。remote-view、ssh 与 18790 未受影响。
- 真实渲染：独立无登录临时 Chrome 在 1440 与 390 宽打开发布状态页，无横向溢出；页面写请求 0、页面异常 0。
- 已有记录显示：a901973a（公众号）= 已存草稿；01d27475（小红书）= 已填好待你点，并列入“待你处理”带“切到窗口”按钮（验收未点击）；c3b0b6af（公众号）= 未知，失败详情可展开，code=USAGE，旧单 hint/stderr/截图未记录。
- 模拟 20 个平台仅在浏览器 DOM 中注入，标签换行无溢出，未写正式库。流量、账号与采集、作品库、发布日历页面只读渲染正常。
- 正式 publish_posts 2 条、publish_preparations 19 条与部署前备份逐字一致。未连接 9333/9335/9336，未调用真实 check/fill/activate。
- 收尾：两个临时 Chrome profile 目录（maitian-status-ui-YyZx9u、maitian-status-ui-U1OCee）于 16:49 后确认无进程引用并删除，读回已不存在。
