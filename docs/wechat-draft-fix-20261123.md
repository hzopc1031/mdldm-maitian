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

## 真实验收结果（15:50补记）

修复提交a8c769415c84e0273ea4d2e69ad80d04af0d84cb已推送origin/l1-real；一致性备份后仅将8787从PID5360更新为16604，仍监听127.0.0.1。首页、GET /api/prep及契约均200，submit:false。remote-view PID16600、ssh PID21908及18790监听保留，SSH到22端口仍Established；8788在操作前即无监听，未启动或停止它。

通过本机HTTP创建原稿956c2a46-edf5-4702-bec4-b06a30e20ba6，只生成公众号版，通读后补回用户指定的测试原句；关联准备任务a901973a-d516-49c0-8083-e3be16c89ba7。三张自制图逐张看过，封面在原上传清单第二位，最终HTML第一占位且只出现一次。1440/390真实预览通过。

仅一次fill，15:45:25开始、15:45:57结束（北京时间）：savedAsDraft:true、submitted:false、confirmation“已保存”、bodyImageCount:3、coverBodyImageIndex:0、remaining:0。skill原始draftVerified:false，draftListCheck报“找不到草稿箱入口，未能核对草稿列表”，不能改称true。额外只读补核后台首页“全部草稿”区域，唯一同名卡片为“【测试】公众号存草稿修复，核对3张图”，显示“更新于15:45”；裁剪卡片截图保留完整标题、封面和时间，不含账号、头像、地址栏。未再创建、编辑或保存草稿。旧c3b0b6af整条记录SHA-256前后相同。

9335填写前只有后台列表页，无编辑路由。按当前skill规则，复用窗口在fill结束时关闭；只读补核重新打开相同精确profile，也在finally确认remaining:0；最终9335无监听。未连接小红书9333或X9336。skill的自动列表入口识别仍有限制，本轮按禁止修改skill的要求保留原状，以可见草稿卡片补足本次验收，不把它当作再次fill的理由。

## 回退

代码回退用 `git revert a8c769415c84e0273ea4d2e69ad80d04af0d84cb` 并推送，不force push；本节所在文档的后续补记提交仅记录验收。也可在独立回退工作副本检出519d94e，保留当前data/config与专用profile，再用既有Update-Maitian.ps1先CheckOnly、备份hub.db后仅重启8787。不reset当前工作副本、不覆盖其他人的未提交改动；不自动恢复旧数据库、不改旧单状态。回退后旧USAGE风险会重新出现，应停止公众号填写直至重新修复。
