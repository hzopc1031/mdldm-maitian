# 公众号草稿USAGE修复记录

2026-11-23，Liu 15:27“do it”批准。本次只修改工作台仓库，不修改统一skill目录。实测只允许本机HTTP API、只存公众号草稿，不发表、不群发。旧记录c3b0b6af不执行、不改状态。

## 根因结论与证据

已读取当日当前wechat-publish 0.6.4的SKILL.md、scripts/wechat.mjs及lib/wechat.mjs、util.mjs、browser-lifecycle.mjs，并补读cdp.mjs的launch与wechat-cover.mjs。当前chooseBodyCover的显式coverImage分支从uploaded中的outerHTML用正则取src，再与页面im.src作字符串等值比较，没有解码HTML实体。用该函数当前源码在隔离VM中、以虚构URL `?a=1&amp;b=2` 对比DOM `?a=1&b=2`，确定复现USAGE“coverImage必须是inlineImages中已上传且出现在正文的图片”；不传coverImage则选择同图成功。

**算法缺陷已证实；12:05旧单的具体根因仍属推断。**旧工作台将无code异常统一记为USAGE、替换原message并丢弃stderr，无法从旧回执排除其他USAGE来源。没有重跑旧单，也没有把浏览器已打开误写成保存成功。

## 修改与执行方式

- prep-wechat.mjs将封面移到最终HTML的首个图片占位，忽略封面的imagePositions设置并去重；其余图保留原段落位置。独立封面加入一次。兼容旧HTML入口时生成副本，不改调用方HTML。
- 新公众号job只用coverFromBody:true、submit:false，不再传coverImage。skill仍按2.35:1比例评分选图、同分才取第一张；1280×545封面与不同宽高比的普通配图便于核对，不能声称任意首图必被选中。
- API与前端说明、预览同步封面顺序；平台版本与历史记录能展示脱敏原始错误。原版本和未知结果锁不迁移、不解除。
- 保留回执code/message/hint/screenshot和stderr末尾4KB；认证查询参数、token=片段、认证头在入库前脱敏。无code异常记UNKNOWN并保留errorName、原message。保存已成功但清理失败仍锁定，不能重复建稿。

正式CLI已评估，当前版本不接受关闭自动重试的选项；CLI中先做独立status又会在finally关闭已核验窗口，再运行post需要重新打开，且不能把前次昵称结果当作当前身份。因此保留原单进程库包装以维持昵称精确TwoPeanuts的AI和首次失败即停。当前SKILL.md允许保存前重试一次，但工作台采用原有更严格约束；不加keep-browser，不加submit。首次可重试异常经skill日志暴露后被包装器中断，code/message原样脱敏保留，该边界未提供的hint或shot不编造；普通抛出异常则完整保留这些字段。

当前ensureBrowser→launch会track已复用的精确profile，cleanupBrowsers会关闭整个已核验的公众号Chrome。因此即使9335是其他任务先打开的列表页，本次结束也会关闭该专用窗口。填写前盘点编辑页，有action=edit/isNew即停止，不登记也不关闭原窗口。只读取进程元数据核对profile，不读取profile内容或凭据。9333/9336不接管。

## 离线验证

八项自测通过：prep-wechat-fix、publish-prep、platform-rules、l1-prep-intake、l1-publication、l1-wechat、l1-web、web-text。覆盖首图及去重、无coverImage、实际选择函数的实体差异复现、无code异常、hint/截图、stderr脱敏与4KB上限、首次失败中止、submit:false、无--submit、publish/submit动作拒绝、submitted:true回执拒绝、未知与重启防重锁。全部使用临时库、模拟skill/CDP，不把离线通过当作平台保存验收。

部署、真实测试稿ID、结果与脱敏截图统一记录在项目 `evidence/publish-redesign-20261123/wechat-fix-回报.md`；维护回执和数据库备份也位于该目录。实测任一失败只记录一次，不自动重试。

## 回退

用 `git log --oneline -- docs/wechat-draft-fix-20261123.md` 定位本修复提交，然后 `git revert <修复commit>` 并推送，不force push。也可在独立回退工作副本检出519d94e，保留当前data/config与专用profile，再用既有Update-Maitian.ps1先CheckOnly、备份hub.db后仅重启8787。不reset当前工作副本、不覆盖其他人的未提交改动；不自动恢复旧数据库、不改旧单状态。回退后旧USAGE风险会重新出现，应停止公众号填写直至重新修复。
