# 原发布引擎核对（2026-11-17夜间）

## 22:17纠正后的安装与实际加载

已按[官方仓库README](https://github.com/CzzzzzzJ/mdldm-maitian-publisher#安装)支持的git clone机制，安装完整独立仓库D:\AIInfra\maitian-publisher，HEAD=539091cff24fb8ce32c28d881100a69886aced3a、manifest版本0.4.0、Apache-2.0许可保留。不存在package.json依赖安装步骤；没有执行npm/pip install，也未填写凭据。

实际执行node scripts/publisher-check.mjs --plugin-dir <安装目录>：经过原driver与原shim加载真实publish.js/cdp.js，七个平台导出完整；检查期间禁用网络与WebSocket，没有启动浏览器或平台动作。不是只读源码即声称加载。原库node tests/md.test.mjs README.md也实际通过；初次误用node --test、缺少其要求的文章参数所致错误已纠正，未修改第三方测试。

这证明direct库可加载，不证明Chrome扩展已启用，也不证明旧Windows shim的视频发布链已通过。L1小红书图文使用原xhs-publish，已真实上传填写、留窗、submitted:false；公众号使用原wechat-publish，真实status确认当前扫码页，草稿链路仍待本人扫码。原publisher仍无公众号适配，小红书适配仍为视频，不替换本轮图文引擎。

本机正式Google Chrome产品版本157.0.8103.51（读取chrome.exe版本属性）。[Chrome官方公告](https://groups.google.com/a/chromium.org/g/chromium-extensions/c/1-g8EFx2BBY)确认从137起正式Chrome移除--load-extension；本轮没有试该参数或用其它版本绕过。[官方加载文档](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world)要求chrome://extensions→开发者模式→Load unpacked选择目录。[Windows外部安装文档](https://developer.chrome.com/docs/extensions/how-to/distribute/install-extensions)说明注册表外部安装指向Chrome Web Store并仍需要用户确认；当前仓库README没有提供Web Store项目ID，不能自行编造。

当前剩余扩展启用步骤为该官方UI加载，尚未执行。已知Computer Use native pipe os error 2只影响其UI传输；本轮按要求仅只读核对，没有重试。由[computer-use技能](D:/MovedFromC/.codex/plugins/cache/openai-bundled/computer-use/26.1111.21308/skills/computer-use/SKILL.md)指定的@oai/sky入口当前不可用，指导文件要求“Use only the Computer Use JS APIs for Windows app automation.”；没有自建helper或直接修改Chrome会话/扩展状态文件来替代。因本次没有可用UI输入通道，需本人在允许的窗口选择已准备目录；不是声称Chrome在所有环境一律只允许真人操作。扩展未加载不阻塞本轮已验证的本地skill与L1只读通道。

公开方案研究共2次查询、5个页面；未为旧安全拒绝研究绕行。此前compare独立profile+9368的blocked by policy保留原样，范围不扩大，不自动重试。

核对对象：主库上游基线`61ffcf0`与L1起点`e5ae25c`的`src/driver.mjs`、`src/hub.mjs`、`src/bridge.mjs`；官方姊妹仓库[mdldm-maitian-publisher](https://github.com/CzzzzzzJ/mdldm-maitian-publisher/tree/539091cff24fb8ce32c28d881100a69886aced3a)，只读下载版本`539091cff24fb8ce32c28d881100a69886aced3a`。未执行该仓库脚本、安装依赖、连接Chrome或加载扩展。

| 对象 | 源码证据 | 对本轮的结论 |
| --- | --- | --- |
| direct引擎 | `driver.load`从`pluginDir/lib/publish.js`、`lib/cdp.js`加载，shim提供chrome API | 正式配置未设置pluginDir/rootPath，不能声称已接通 |
| 插件桥 | `bridge.ensureBridge`启动开发桥并打开sidepanel；存在macOS `open`调用 | 不为今晚修改旧桥或影响macOS工作流 |
| 原hub | `hub.after`先判断filled；仅manual列表中平台停awaiting_user，其余可进入提交逻辑 | 不能把原hub.run/submit直接连到L1按钮 |
| 小红书 | publisher `lib/platforms/xhs.js`入口target=video，fill使用`ctx.video`上传 | 不是本轮图文引擎，使用本机xhs-publish、固定ai、submit:false |
| 公众号 | publisher ADAPTERS无wechat；manifest无mp.weixin.qq.com权限；channels是视频号 | 不混淆公众号与视频号，使用本机wechat-publish，仅存草稿 |
| X | publisher X适配使用成片/视频参数，另有X长文功能 | 本轮不调用发布链；交付本地文图包供本人手工附图 |
| 安装状态 | 本机有源码，未读取用户Chrome的扩展状态 | 仅“已下载供核对”，不标“扩展已安装/已加载” |

本地两个DSH skill的真实CLI与回执契约已检查：小红书`preflight --job … --kind post`、`post --job … --account ai --keep-browser`；公众号`check --job …`、`post --job …`。执行命令不含最终提交参数，任务强制submit:false。仅前述离线命令实跑过；post未执行。小红书留窗遵循本次用户明确约定；公众号成功还须收到savedAsDraft:true及本次显式保存成功提示。结果未知时不自动重跑。

若将来需要使用原扩展，必须由用户在允许的Chrome窗口完成：

1. 确认下载目录有manifest.json、background.js、sidepanel.html和lib，先保留原LICENSE。
2. 打开`chrome://extensions`，开启开发者模式，点击“加载已解压的扩展程序”，选择publisher根目录。
3. 在扩展列表确认“麦田发布助手”0.4.0已启用、没有加载错误，再从工具栏打开面板。不能仅凭目录存在推断加载成功。
4. 如需接原driver/bridge，另按真实面板状态配置pluginDir、extensionId及工程根目录并验收；本轮没有执行这一步。原扩展的视频分发不作为本轮图文/公众号的替代方案。

只读副本放在本机被git忽略的`_local-upstream-publisher/`。publisher为Apache-2.0，本次没有把其实现复制进通用代码；主库现有许可、macOS脚本与原发布链均保留。
