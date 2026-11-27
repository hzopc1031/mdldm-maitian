# 评论执行器无监听修复（已修复上线）

2026-11-27，Codex。Liu提供真实失败记录d071adae-ee71-4323-b061-4cd2ebf7889b：checking_account阶段59ms返回failed/no listener，mayHaveSent:false且无提交意图，原ID保留。本轮只修复与只读核验，不调用resume、不发送评论。

已核对正式API与本机HTTP：原记录仍failed/no listener，9336/json/version当前连接拒绝。旧默认账户适配器直接verifyBrowserProfile，未调用已有x-publish的launch；端口没有监听时在创建标签之前失败，因此不是本次评论提交或其标签清理造成的。浏览器先前为何退出未证实，不能凭用户“只关闭自有标签”归因。

计划：从本地公开accounts配置精确匹配profile/端口/handle，调用已有launch复用或启动同一专用浏览器，严格复核PID/profile，再使用本轮自有标签；仍核/home实际身份。原失败错误改为可理解的启动/连接错误码，不变更账号、代理/凭据或unknown防重。注入测试覆盖无监听启动/已有监听复用、配置冲突和PID变更，随后只读真实/home核验、备份更新服务，核原记录与提交历史不变。证据放项目根evidence/comments-no-listener-20261127/。

## 完成状态

五项回归及真实只读/home身份核验通过，21:23正式19736→4372，11表摘要与原失败记录保持。原ID仍failed/无提交，未resume。新contract含browserReadiness:reuse_or_start_dedicated。备份、校验及后续见[执行记录](../../evidence/comments-no-listener-20261127/执行记录.md)。
