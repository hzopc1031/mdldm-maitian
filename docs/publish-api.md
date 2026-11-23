# 本机图文准备 API

2026-11-23，按 Liu 11:33 的批准方案及 11:37 补充实现。只使用本机 HTTP；不新建 skill，不改 skill 索引。监听 `127.0.0.1:8787`。沿用 Host、loopback、Origin、Fetch Metadata 和转发头校验；新接口即使在启用口令的模式也只允许本机直连。POST 必须带 `Origin: http://127.0.0.1:8787`。不要传网页口令、Cookie、token 或平台凭据。

所有 JSON 是 UTF-8。POST 的顶层只接受 `type,id,platform,platforms,input,actor,column,scheduledAt,note,mode`。顶层 `publish`/`submit` 动作仍拒绝；平台动作由 `fill` 的必填 `mode` 决定：`draft` 存草稿、`publish` 直接发布（仅 X、小红书）。公众号只能存草稿，不发表、不群发。

建稿（`type:create`）必须同时带 `column`、`scheduledAt`、`actor` 三项：栏目是自由文字（1–80 字，不含控制字符）；定时时间是带时区的 ISO 时间且必须晚于当前时间；AI 来源上报 `runtime` 与会话编号。定时只记录计划发布时间，供状态页展示，**不会自动填写或发布**。`note`（备注）可选，最多 500 字、可换行，只本地保存并显示在状态页。建稿后可用 `type:meta` 单独改栏目、定时或备注。

## 接口

| 方法与路径 | 用途 |
| --- | --- |
| GET `/api/prep/contract` | 契约 v4，`submit:true`、`publishPlatforms:["x","xhs"]`、`fillModes:["fill","draft","publish"]`、`requiredCreate:["column","scheduledAt","actor"]`、`noteLimit:500` |
| GET `/api/prep/ai-prompt` | 返回可直接粘贴给外部 AI 的接入指令纯文本；内容来自 docs/ai-publish-prompt.md，发布状态页同源展示 |
| POST `/api/prep/posts`，`type:create,input:{...},column,scheduledAt,actor[,note]` | 建一份原稿及平台版本；前三项必填，备注可选 |
| POST 同上，`type:meta,id,column?,scheduledAt?,note?` | 只改栏目、计划时间或备注，至少带一项；不动稿件正文 |
| POST 同上，`type:generate,id,platforms:["x","xhs","wechat"]` | 异步调用本机 Codex 按本地 skill 改稿；省略 platforms 使用现有生成平台配置 |
| GET `/api/prep/posts/record?id=ID` | 原稿、平台版本、规则结果、关联平台任务、生成状态 |
| GET `/api/prep/posts` | 最近50份原稿及状态；不是全历史分页接口 |
| POST `/api/prep/posts`，`type:update,id,platform,input:{...}` | 修改完整平台版本；platform 为 master 时只改原稿，不覆盖已编辑版本 |
| POST 同上，`type:check,id,platform` | 共用规则检查；合格后建关联准备任务，并调用本地 skill 离线检查（X仅规则检查） |
| POST 同上，`type:fill,id,platform[,mode:"fill"\|"draft"]` | 小红书/X 填写留窗或只存草稿；公众号仅存草稿；必须先检查成功 |
| GET `/api/prep/posts/bundle?id=ID` | X ZIP：全文、按顺序编号的全部配图、manifest；不含本机绝对路径 |
| GET `/api/prep/posts/asset?id=ID&platform=x&index=0` | 本篇有序图片；index=cover 为封面，platform 可为 master |
| POST `/api/prep/image?name=test.png` | 原始图片二进制入本地素材库，返回 path、sha256；不上传平台 |

`input` 字段：`title,content,images,cover,topics,video,digest,caption,author,imagePositions,promotionReview`。images 是有序本机绝对路径数组，cover 是其中一张图或另一张本机图片。视频只预留，校验明确报暂不支持。imagePositions 是公众号 `{image:"本稿图片路径",afterParagraph:1}` 数组，空行分段，0表示正文前。未指定的普通图片在正文末尾。**公众号封面固定移到最终HTML正文的第一个 `WECHAT_INLINE_IMAGE` 占位**，其段落位置设置不生效；封面已在正文时移位并去重，独立封面只加入一次。服务生成安全 section HTML 和 htmlFile/inlineImages，任务只用 `coverFromBody:true`，不传 `coverImage`。本地skill按最接近2.35:1挑正文图，同分取正文靠前者；建议封面1280×545、普通配图采用其他比例，并核对check回执的cover.file与实际封面。首图位置本身不能改变skill的比例评分规则。不直接传入网页 HTML。

## 只存草稿（mode:draft）

`fill` 可带 `mode:"draft"`，表示只把稿件存进平台草稿箱、不发布：

| 平台 | 草稿 | 说明 |
| --- | --- | --- |
| 公众号 | 支持 | 一直是只存草稿；执行后状态 `draft_saved`，附保存成功回执 |
| 小红书 | 支持（待实测） | 调本地 `xhs-publish/scripts/save-draft.mjs`，固定 ai 号；草稿绑定当前浏览器 profile，反复运行会积多份同名稿，需在草稿箱核对 |
| X | 支持（需启用专用编辑器） | 填完关闭编辑框并在弹窗点「保存」，读到保存确认才记 `draft_saved`；未确认按 `unknown` 处理。专用 Chrome 需在 9336 运行且登录正确账号 |

`mode` 必填，只有两个值：`"draft"`（直接进平台草稿箱）或 `"publish"`（直接发布，仅 X、小红书）。没有默认值，不传会报 `mode 必填`；也没有第三种「填好留窗」的写法。draft 与 publish 都要先检查通过；结果未确认时按 `unknown` 处理，不重跑。实际可用性看 `/api/prep` 返回的 `draft.supported` 与 `publishEnabled`。

## 直接发布（mode:publish）

`fill` 带 `mode:"publish"` 表示由工作台直接发布出去（2026-11-23 22:19 起）：

| 平台 | 直接发布 | 说明 |
| --- | --- | --- |
| X | 支持（未实测） | 在已验证的专用编辑器里点 Post，读回 `https://x.com/<账号>/status/<id>` 才记 `published`，否则 `unknown` |
| 小红书 | 支持（未实测） | 调 `xhs-publish post --account ai --submit`，回执 `submitted:true` 才记 `published` |
| 公众号 | 不支持 | 本地 skill 明确禁止发表；请求会报「只能存草稿」，请保存草稿后在后台发表或群发 |

发布前必须先 `check` 通过；发布成功后 `r.url` 与证据里保留公开链接。结果未确认时按 `unknown` 停手，不重发、不换 ID。实际可用性看 `/api/prep` 的每平台 `publishEnabled`。

公众号摘要用 digest（兼容 caption），最多120字；作者最多16字。现有 wechat.mjs 没有作者填写实现，作者保存在版本中，需在草稿里手填。图片上限：X 4、小红书18、公众号20。标题上限：小红书20（与本地 util.mjs 半字算法一致）、公众号32。X默认加权280；本地 `config.publishPrep.x.premium:true` 时25000。X话题计入实际下载正文及加权计数；小红书正文计数含skill为话题预留的字数。修改配置须先备份 config.json；本次没有改配置。前端和后端共用 `src/platform-rules.mjs`。

公众号执行由仓库 `prep-wechat-run.mjs` 包装原 skill 库：先精确profile核验，再读可见昵称，必须为TwoPeanuts的AI；仍调用原草稿保存实现及原清理函数。当前skill内置的第二次填写尝试在首次失败日志处被工作台保护中止；PAGE_CHANGED/UPLOAD_FAILED不会进入第二次尝试。不修改skill。若本地skill的重试边界发生变化，包装器停止而不继续填写。

2026-11-23修复评估：正式CLI `node <skill>/scripts/wechat.mjs post --job <file>` 已核对，但不能在首次失败处拦截内置重试；另开一次CLI身份检查也会按finally关闭整个专用窗口。因此保留单进程库包装，维持首次失败即停、同进程昵称核验和原skill生命周期，不加 `--keep-browser` 或 `--submit`。当前skill允许保存前重试一次，工作台沿用更严格的不重试约束。第一次重试边界只提供日志文本，包装器保留其code/message，不能虚构该处未提供的hint/截图。

填写前只读盘点9335标签页。发现 `action=edit` 或 `isNew` 编辑页立即停止并保留原窗口；不得把其他任务的编辑页当作本次编辑器。只有列表页且精确profile、可见昵称均核实才继续。当前skill的launch会把**复用的窗口**也登记到cleanup，因此运行结束会关闭已核验的整个9335公众号Chrome；不是仅关闭本次创建的标签页。9333、9336不受此流程操作。

## 调用示例

下列是本机测试稿。先自行准备并逐张查看测试图片。actor 是调用方上报，**不是认证**；填写真实会话ID，不能照抄示例冒充。

```powershell
$base = 'http://127.0.0.1:8787'
$headers = @{Origin=$base}
$actor = @{runtime='codex'; name='Codex'; sessionId='实际会话ID'; basis='declared'}
$column = 'AI新闻'
$scheduledAt = '2026-11-24T09:00:00+08:00'  # 必须晚于当前时间
$input = @{title='【测试】工作台2张图'; content="工作台改版测试稿，请勿发布。`n`n核对标题、正文与2张测试图片。"; images=@('D:\测试\01.png','D:\测试\02.png'); cover='D:\测试\01.png'; topics=@('AI')}
function Call-Prep($payload) {
  Invoke-RestMethod "$base/api/prep/posts" -Method Post -Headers $headers -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes(($payload|ConvertTo-Json -Depth 20)))
}
$created = Call-Prep @{type='create';column=$column;scheduledAt=$scheduledAt;input=$input;actor=$actor}
$id = $created.post.id
Call-Prep @{type='generate';id=$id;actor=$actor}
Invoke-RestMethod "$base/api/prep/posts/record?id=$id"
# 等 generation.state 为 done，读取并通读各平台版本。failed 时保留原稿，不自动重试。
$record = Invoke-RestMethod "$base/api/prep/posts/record?id=$id"
$edition = $record.post.editions.wechat
$edit = @{title=$edition.title;content=$edition.content;images=$edition.images;cover=$edition.cover;topics=$edition.topics;digest=$edition.digest;author=$edition.author;imagePositions=$edition.imagePositions}
Call-Prep @{type='update';id=$id;platform='wechat';input=$edit;actor=$actor}
Call-Prep @{type='check';id=$id;platform='wechat';actor=$actor}
# 查询至 editions.wechat.state 为 checked，再按当次授权填写：
Call-Prep @{type='fill';id=$id;platform='wechat';actor=$actor}
```

curl.exe 用文件传 JSON，避免 PowerShell 引号和中文编码问题；request.json 用 UTF-8 保存。下列 `$id` 指建稿返回的实际ID。

```powershell
curl.exe -sS -H 'Origin: http://127.0.0.1:8787' -H 'Content-Type: application/json' --data-binary '@request.json' 'http://127.0.0.1:8787/api/prep/posts'
curl.exe -sS "http://127.0.0.1:8787/api/prep/posts/record?id=$id"
curl.exe -sS 'http://127.0.0.1:8787/api/prep/posts'
curl.exe -sS "http://127.0.0.1:8787/api/prep/posts/bundle?id=$id" -o 'x-draft.zip'
```

request.json 的建稿例子（`column`、`scheduledAt`、`actor` 三项必填，定时须晚于当前时间）：

```json
{"type":"create","column":"AI新闻","scheduledAt":"2026-11-24T09:00:00+08:00","note":"可选备注","input":{"title":"【测试】工作台2张图","content":"工作台改版测试稿，请勿发布。","images":["D:/测试/01.png","D:/测试/02.png"],"cover":"D:/测试/01.png","topics":["AI"]},"actor":{"runtime":"codex","sessionId":"实际会话ID","basis":"declared"}}
```

其余 POST 示例（将 ID 换成返回值）：

```json
{"type":"meta","id":"ID","scheduledAt":"2026-11-25T09:00:00+08:00","note":"改期并补备注","actor":{"runtime":"dsh","sessionId":"实际会话ID"}}
{"type":"generate","id":"ID","platforms":["x","xhs","wechat"]}
{"type":"check","id":"ID","platform":"xhs"}
{"type":"fill","id":"ID","platform":"wechat"}
```

建稿返回 `200 {ok:true,post:{version:2,id,master,editions,generation,...}}`；生成和填写返回202，表示已启动，不能当作成功完成。检查返回 `200 {ok:true,post,validation:{ok,counts,limits,issues,warnings}}`；顶层 ok 表示请求被处理，须另看 validation.ok 和随后平台状态。超限结果不截断、不丢弃，可继续编辑。小红书逐图审阅必须来自真实看图，按 `xhs-publish/references/promotion-review.md` 填写 promotionReview；接口不会制造审阅声明。

## 状态与错误

| 字段或状态 | 含义与后续 |
| --- | --- |
| generation idle/running/done/failed | 未生成／改稿中／JSON已回填／改稿失败；失败保留原稿与原平台版本 |
| editing/prepared | 本地可编辑；未上传平台 |
| checked/check_failed | 本地离线检查通过／失败；不代表平台审核通过 |
| running | 正在检查、填写或存草稿；只查状态，不重复执行 |
| awaiting_user | 小红书已填留窗，由本人发布 |
| draft_saved | 收到公众号显式保存草稿证明；另看 draftVerified |
| unknown | 结果未确认；**不得重跑、改稿解除锁或换ID重建**，先人工核对原窗口/草稿箱 |
| submitted/published/already_exists | 历史回执，只读展示；新接口不能提交 |

错误返回 `{code,error}`。常见：403 LOCAL_ONLY（来源不符）、403 PUBLISH_DISABLED（禁止发布）、400 INVALID_INPUT、400 VALIDATION_FAILED、400 CHECK_REQUIRED、400 EDITION_LOCKED、404 NOT_FOUND、409 BUSY、413 TOO_LARGE。skill错误保存在关联任务 `failureEvidence`：`skillCode,message,hint,screenshot,stderrTail`（尾部最多4KB）及保存/清理状态；无错误码保留为 `UNKNOWN`，包装器另保留errorName。消息、提示、截图路径和stderr在入库前去除认证参数值、任意token=片段及Cookie/Set-Cookie/Authorization头。状态页的“失败详情”和record接口均可查看；原始stdout/DOM不落库。LOGIN_REQUIRED停止请本人扫码；PAGE_CHANGED/UPLOAD_FAILED停在该平台，不盲目重试。结果未知锁保持，错误信息增加不解除锁。原记录c3b0b6af保持不变。Codex无法启动为CODEX_UNAVAILABLE，超时GENERATION_TIMEOUT，非零或非JSON为GENERATION_FAILED；生成进程不保存stdout/stderr。默认4分钟超时，重启中断标failed。

修复依据、回退及验证见[公众号草稿USAGE修复记录](wechat-draft-fix-20261123.md)。

给 Codex 等 AI 的顺序：建原稿 → 生成 → 查状态 → 通读并修改各版 → 逐图审阅 → 检查 → 查至 checked → 按授权填写 → 查状态并核对本篇回执。全程不调用平台内部接口、不传凭据、不点发布。X下载 ZIP 后由本人使用。可直接粘贴给外部 AI 的完整指令见[给外部 AI 的接入指令](ai-publish-prompt.md)。

旧 `scripts/l1-submit-prep.mjs` 保留：仍能交单平台稿、读原记录、检查、填写/存草稿、登记已经核验的外部X回执；`--publish` 已拒绝。它不自动生成平台版本；推荐新任务用上述 posts API，已有记录沿原ID继续。旧 publish_preparations 表及 job.json 不迁移、不覆盖。新 publish_posts 表为独立 v2 模型。

## 只读发布状态页（2026-11-23）

工作台页面只读，内容由 AI 通过接口提交；Liu 不在页面写稿。`/p#/prepare`（含已有 post/record 定位参数）显示发布记录、待你处理、失败详情。仅“切到窗口”复用 POST `/api/prep` 的 `type:window`，核验原专用窗口后置前，不刷新、不填写、不点击发布。页面自动刷新只 GET 状态汇总，不自动核验浏览器。

新增 GET `/api/prep/status` 读取全部 publish_posts 与 publish_preparations，按 preparationId 合并；无关联的旧记录保留独立行。它不沿用旧列表的50/30条截断，避免遗漏待办和旧未知单。汇总只返回标题、时间、ID、平台状态与脱敏诊断，不返回正文、任务文件、账号身份或凭据。平台元数据来源为 platform-registry.mjs 注册表、meta 常用选择、config 的平台配置、准备能力及已有版本/记录的并集；每行展示已有版本及常用平台。新增平台可显示状态，不代表自动获得发布执行能力。现有平台写作规则与执行适配器范围保持兼容。

汇总采用同样的 loopback、Host、Origin、Fetch Metadata 和转发头校验，仅接受 GET，写请求405。`rows` 是原稿/旧记录行，`pending` 为全部 awaiting_user 项，`failures` 为失败与未知项，`platforms` 为动态平台元数据。状态页可按栏目筛选（`rows[].column`），只在出现两个及以上栏目时显示筛选按钮。所有状态映射唯一维护在 src/prep-status.mjs：prepared/generated→已生成，checked→检查通过，awaiting_user→已填好待你点，draft_saved→已存草稿，failed/check_failed→失败，unknown→未知，published→已发布；submitted/already_exists 仅证明提交/已有稿，显示未知，不能冒充公开发布。editing/idle→未生成，running→处理中，未识别状态→未知。

失败详情保留原 code（兼容 skillCode）、message、hint、stderr 尾部和截图路径；缺字段显示未记录，不制造旧单证据。输出前复用 prep-skill-errors 的脱敏与4KB尾部限制，再经过 redactL1。截图仅展示路径，不自动读取原截图。现有建稿/生成/检查/填写/record/contract接口无删除和改名；契约仍 submit:false、finalPublishPlatforms:[]。
