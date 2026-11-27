# AI通过麦田执行X评论

AI自行选择目标、正文和账户，麦田只负责排队、执行和记录。当前仅支持X纯文字评论。本机地址`http://127.0.0.1:8787`，页面`/p#/comments`；不能把其他机器的127.0.0.1当作这台工作台。只允许同源本机调用，沿用工作台鉴权。

## 一次提交

先GET `/api/comments/contract`，从`accounts`选择实际已登录账号的`id`，不能根据备注猜身份，也不能省略账户。`actor`为真实AI来源（`codex/dsh/grok/other`、本次真实`sessionId`，可带name），属于调用方上报，不代表认证。

POST `/api/comments`，带`Content-Type: application/json`与`Origin: http://127.0.0.1:8787`：

```json
{
  "type": "enqueue",
  "input": {
    "platform": "x",
    "accountId": "从contract.accounts读取的实际ID",
    "rootUrl": "https://x.com/原帖作者/status/原帖ID",
    "targetUrl": "https://x.com/直接对象作者/status/直接对象ID",
    "content": "AI决定的完整评论正文",
    "requestId": "本次稳定任务编号"
  },
  "actor": {"runtime": "codex", "sessionId": "本次真实会话ID"}
}
```

`enqueue`会请求实际发送，不是草稿。回复主帖时`rootUrl=targetUrl`；回复评论时`targetUrl`指该条评论，`rootUrl`指原帖。X评论本身也有status公开链接；只接受`https://x.com/<handle>/status/<数字>`，无查询参数、端口、fragment或其他站点。AI不得提交命令、密码、Cookie、token、profile/port或内部接口。

Windows建议保存UTF-8请求JSON后调用：

```powershell
curl.exe -sS -H 'Content-Type: application/json' -H 'Origin: http://127.0.0.1:8787' --data-binary '@comment.json' http://127.0.0.1:8787/api/comments
```

返回202与`record.id`只表示接受任务。GET `/api/comments/record?id=<ID>`轮询原记录。任务编号重试相同正文返回同ID；换requestId仍按「实际账号+直接对象statusId+完整正文」防重，不会再发。不同稿件复用同requestId会409。其他AI接手沿原ID查询，原决策AI不会被覆盖；恢复执行的AI另记，执行器为本机麦田。

## 状态与恢复

| 状态 | 含义与允许动作 |
| --- | --- |
| queued | 等待现有采集/发帖/登录和前序评论结束；可cancel |
| running | 正在核账号、对象、正文或发送后核验；不能取消/重跑 |
| sent | 已从公开评论页核验作者、全文、原帖及直接父对象，读取url |
| failed | 有证据表明提交前失败，可修复条件后沿原ID明确resume；不自动重试 |
| unknown | 提交后未确认，或无法排除已发送；不resume、不换ID或账户重建 |
| paused | 服务重启前尚未开始的任务；可cancel或明确resume |
| cancelled | 尚未执行时取消；不自动重新排队 |

恢复：POST `{type:"resume",id:"原ID",actor:{runtime,sessionId}}`。取消：POST `{type:"cancel",id:"原ID"}`，只对queued/paused生效。重启时running转unknown、queued转paused，不因启动服务补发旧评论。维护脚本会阻止在评论执行中重启。

原帖与直接对象关系无法从可见会话确认、已有同账号相同正文、发送结果不明确时，保留证据并停止。工作台在本地持久写提交意图后才允许单次发送；不凭按钮消失或成功toast标sent。防重覆盖本工作台记录及本轮可见重复，不能冒称已经导入所有旧AI外部评论历史。

## 查看与接入

- GET `/api/comments?accountId=<ID>&state=<状态>&limit=50&offset=0`：记录、数量和状态计数；limit1–200。没有accountId时返回各账户，页面默认沿用顶部账户选择。
- GET `/api/comments/ai-prompt`：可直接给AI的实时接入指令，含当前已登录账号；页面提供复制按钮。
- GET `/api/comments/shot?id=<ID>&name=before|after`：本任务完整原始PNG，不接受任意文件路径。
- 每条记录包含root/target/url、正文、决策AI、执行器、提交意图、核验时间、尝试历史、错误及可见原文快照。没有数据不造回执。

执行复用本地x-publish的专用连接与自有标签能力；新建账户使用工作台登记的独立目录/端口，核验当前/home账号后才操作。仅关闭本轮自有标签或本轮新启浏览器。不开普通Chrome、不迁移凭据、不调用X内部接口。互斥覆盖本工作台入口，不冒称已经改造或锁住仍绕过接口运行的其他AI脚本。

本轮上线验收不发送真实评论。隔离测试/DOM定位通过不等于真实X评论已实测；首次正式评论需按当次业务任务执行并读回。现有AI任务不会因文件落盘自动改用本接口，须读取此指令并将发送入口改为enqueue。

## 2026-11-27 浏览器准备修正

默认账户的9336无监听时，执行器现在调用既有x-publish的launch：从其公开账号配置匹配实际handle、精确profile/端口及代理，复用或启动同一专用浏览器，再复核PID和/home身份。不会接管不匹配的监听器或改用普通Chrome；启动/连接失败返回X_BROWSER_UNAVAILABLE并保持提交前failed，修复条件后沿原IDresume，不新建评论。已有专用浏览器只清理本轮自有标签，不关闭整份浏览器。

## 2026-11-27 回复框定位修正

兼容X嵌套dialog及没有status时间链接的目标预览；沿用加载等待。无链接预览必须与已验证目标快照和背景精确status对象的作者、全文、时间一致，聚焦/读回/提交前均检查，非空草稿或多编辑器停止。真实空白框核验通过，未发送；原失败任务由调用AI沿原IDresume。证据见../../evidence/comment-composer-20261127/执行记录.md。
