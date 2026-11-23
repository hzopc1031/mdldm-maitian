# 本机图文准备 API

2026-11-23，按 Liu 11:33 的批准方案及 11:37 补充实现。只使用本机 HTTP；不新建 skill，不改 skill 索引。监听 `127.0.0.1:8787`。沿用 Host、loopback、Origin、Fetch Metadata 和转发头校验；新接口即使在启用口令的模式也只允许本机直连。POST 必须带 `Origin: http://127.0.0.1:8787`。不要传网页口令、Cookie、token 或平台凭据。

所有 JSON 是 UTF-8。POST 的顶层只接受 `type,id,platform,platforms,input,actor`。`submit` 和发布授权不在白名单；`publish`、`submit` 动作明确拒绝。公众号只存草稿，不发表、不群发；小红书固定 `--account ai --keep-browser`，任务永远 `submit:false`。X 只下载文图包，此接口不填写 X 编辑器。

## 接口

| 方法与路径 | 用途 |
| --- | --- |
| GET `/api/prep/contract` | 契约 v4，`finalPublishPlatforms:[]`、`submit:false` |
| POST `/api/prep/posts`，`type:create,input:{...}` | 建一份原稿及三个可编辑版本 |
| POST 同上，`type:generate,id,platforms:["x","xhs","wechat"]` | 异步调用本机 Codex 按本地 skill 改稿；省略 platforms 为三端 |
| GET `/api/prep/posts/record?id=ID` | 原稿、平台版本、规则结果、关联平台任务、生成状态 |
| GET `/api/prep/posts` | 最近50份原稿及状态；不是全历史分页接口 |
| POST `/api/prep/posts`，`type:update,id,platform,input:{...}` | 修改完整平台版本；platform 为 master 时只改原稿，不覆盖已编辑版本 |
| POST 同上，`type:check,id,platform` | 共用规则检查；合格后建关联准备任务，并调用本地 skill 离线检查（X仅规则检查） |
| POST 同上，`type:fill,id,platform` | 小红书只填留窗；公众号仅存草稿；必须先检查成功 |
| GET `/api/prep/posts/bundle?id=ID` | X ZIP：全文、按顺序编号的全部配图、manifest；不含本机绝对路径 |
| GET `/api/prep/posts/asset?id=ID&platform=x&index=0` | 本篇有序图片；index=cover 为封面，platform 可为 master |
| POST `/api/prep/image?name=test.png` | 原始图片二进制入本地素材库，返回 path、sha256；不上传平台 |

`input` 字段：`title,content,images,cover,topics,video,digest,caption,author,imagePositions,promotionReview`。images 是有序本机绝对路径数组，cover 是其中一张图或另一张本机图片。视频只预留，校验明确报暂不支持。imagePositions 是公众号 `{image:"本稿图片路径",afterParagraph:1}` 数组，空行分段，0表示正文前。未指定的图在正文末尾，封面默认在正文前；独立封面需加入正文供现有 skill 选择。服务生成安全 section HTML 和 `WECHAT_INLINE_IMAGE` 占位，交给 skill 的 htmlFile/inlineImages；不直接传入网页 HTML。

公众号摘要用 digest（兼容 caption），最多120字；作者最多16字。现有 wechat.mjs 没有作者填写实现，作者保存在版本中，需在草稿里手填。图片上限：X 4、小红书18、公众号20。标题上限：小红书20（与本地 util.mjs 半字算法一致）、公众号32。X默认加权280；本地 `config.publishPrep.x.premium:true` 时25000。X话题计入实际下载正文及加权计数；小红书正文计数含skill为话题预留的字数。修改配置须先备份 config.json；本次没有改配置。前端和后端共用 `src/platform-rules.mjs`。

公众号执行由仓库 `prep-wechat-run.mjs` 包装原 skill 库：先精确profile核验，再读可见昵称，必须为TwoPeanuts的AI；仍调用原草稿保存实现及原清理函数。当前skill内置的第二次填写尝试在首次失败日志处被工作台保护中止；PAGE_CHANGED/UPLOAD_FAILED不会进入第二次尝试。不修改skill。若本地skill的重试边界发生变化，包装器停止而不继续填写。

## 调用示例

下列是本机测试稿。先自行准备并逐张查看测试图片。actor 是调用方上报，**不是认证**；填写真实会话ID，不能照抄示例冒充。

```powershell
$base = 'http://127.0.0.1:8787'
$headers = @{Origin=$base}
$actor = @{runtime='codex'; name='Codex'; sessionId='实际会话ID'; basis='declared'}
$input = @{title='【测试】工作台2张图'; content="工作台改版测试稿，请勿发布。`n`n核对标题、正文与2张测试图片。"; images=@('D:\测试\01.png','D:\测试\02.png'); cover='D:\测试\01.png'; topics=@('AI')}
function Call-Prep($payload) {
  Invoke-RestMethod "$base/api/prep/posts" -Method Post -Headers $headers -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes(($payload|ConvertTo-Json -Depth 20)))
}
$created = Call-Prep @{type='create';input=$input;actor=$actor}
$id = $created.post.id
Call-Prep @{type='generate';id=$id;actor=$actor}
Invoke-RestMethod "$base/api/prep/posts/record?id=$id"
# 等 generation.state 为 done，读取并通读三版。failed 时保留原稿，不自动重试。
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

request.json 的建稿例子：

```json
{"type":"create","input":{"title":"【测试】工作台2张图","content":"工作台改版测试稿，请勿发布。","images":["D:/测试/01.png","D:/测试/02.png"],"cover":"D:/测试/01.png","topics":["AI"]},"actor":{"runtime":"codex","sessionId":"实际会话ID","basis":"declared"}}
```

其余 POST 示例（将 ID 换成返回值）：

```json
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

错误返回 `{code,error}`。常见：403 LOCAL_ONLY（来源不符）、403 PUBLISH_DISABLED（禁止发布）、400 INVALID_INPUT、400 VALIDATION_FAILED、400 CHECK_REQUIRED、400 EDITION_LOCKED、404 NOT_FOUND、409 BUSY、413 TOO_LARGE。已有 skill 错误保存在关联任务 failureEvidence.skillCode：LOGIN_REQUIRED 停止请本人扫码；PAGE_CHANGED/UPLOAD_FAILED 停在该平台，不盲目重试。Codex 无法启动为 CODEX_UNAVAILABLE，超时 GENERATION_TIMEOUT，非零或非JSON为 GENERATION_FAILED；进程只取约定JSON，不保存原始stdout/stderr。默认4分钟超时，重启中断标 failed。

给 Codex 等 AI 的顺序：建原稿 → 生成 → 查状态 → 通读并修改各版 → 逐图审阅 → 检查 → 查至 checked → 按授权填写 → 查状态并核对本篇回执。全程不调用平台内部接口、不传凭据、不点发布。X下载 ZIP 后由本人使用。

旧 `scripts/l1-submit-prep.mjs` 保留：仍能交单平台稿、读原记录、检查、填写/存草稿、登记已经核验的外部X回执；`--publish` 已拒绝。它不自动生成三版；推荐新任务用上述 posts API，已有记录沿原ID继续。旧 publish_preparations 表及 job.json 不迁移、不覆盖。新 publish_posts 表为独立 v2 模型。
