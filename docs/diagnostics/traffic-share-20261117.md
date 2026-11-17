# 聚焦诊断证据说明

流量页3221225501与分享控件范围诊断

起点：`l1-real` / `4d2acb74ac07c56267e2c47dcffe0a3583b00f8a`。这是诊断记录，没有业务代码修复，也没有把未通过改成通过。

## 3221225501

3221225501即`0xc000001d`。Microsoft将其定义为`STATUS_ILLEGAL_INSTRUCTION`，但异常名不能单独证明CPU不兼容。[Microsoft NTSTATUS定义](https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-erref/596a1078-e883-4972-9bbc-49e60bebca55)

本机第一方解析器只从已有minidump读取目录、异常、模块、指令字节及白名单Crashpad注解；未上传dump、安装工具或执行第三方脚本。格式依据为[Crashpad结构定义](https://raw.githubusercontent.com/chromium/crashpad/main/minidump/minidump_extensions.h)。四份结果一致：

| 证据 | 模块 / 版本 | 进程 / 线程 | 异常 / 相对位置 |
| --- | --- | --- | --- |
| 旧formal-render | chrome.dll / 157.0.8103.51 | browser / CrBrowserMain | 0xc000001d / +0xcdafc2c |
| 旧formal-render-retry | 同上 | 同上 | 同上 |
| 旧formal-render-diagnostic（关闭GPU） | 同上 | 同上 | 同上 |
| 本轮普通文件stdout/stderr检查 | 同上 | 同上 | 同上 |

故障指令字节均以`0f0b`开头，即UD2。Chromium主动终止路径也使用UD2，因此这更符合Chrome原生陷阱，不能把退出码直接解读成缺少SSE/AVX；具体调用方尚未符号化，也未确认是某个CHECK。[Chromium ImmediateCrash实现](https://raw.githubusercontent.com/chromium/chromium/main/base/immediate_crash.h)

正式响应与旧隔离夹具差异：正式276作品、269流量行、326采样、响应431814字节；旧夹具1作品/1流量行。正式默认作品只有1个采样、无无效时间，当前`drawLines`会显示采样不足，无需生成折线。269行数值views/inter均有限，accountSummaries与既有formal-api.json一致；这只核对数据形状，不是渲染证据，也没有排除布局/规模因素。旧正式首页/系统/准备成功、流量失败；不能将全部环境判不可用，更不能证明“只要正式数据必崩”。

本轮唯一一次检查与旧命令的差别：保持原Chrome无调试CLI、视口1440×1900、18000ms timeout、12000ms virtual-time-budget和原HTML/API的GET-only代理；仅将Node stdout/stderr管道改为普通文件描述符，另用独立新诊断profile。Chrome官方支持`--dump-dom`与`--screenshot`；它们是实际执行脚本后的DOM/截图输出，不等于HTTP成功。[Chrome CLI说明](https://developer.chrome.com/docs/automation-and-testing/headless-cli)

结果仍为3221225501，stdout/stderr均0字节、无PNG、拒绝请求0，Crashpad同址。此检查否定“简单改输出句柄即可解决”，没有定位数据字段或前端缺陷。结论：Chrome browser主线程原生故障已证实；环境/CLI与正式数据的触发关系仍待核实。没有符号化调用栈、明确前端异常或成功修复验证，故停止，不改页面、不更新Chrome/驱动、不继续试错。

## 分享范围与回写

当前`visibleNoteShare`先用可见`.note-card`和`data-impression`稳定ID精确匹配，要求1张卡片。控件查询为`card.querySelectorAll('button,[role="button"],a,.note-card__action-btn')`，再要求可见且innerText/aria-label/title明确为分享或复制链接。全页可见弹层查询用于读取同ID链接，不用于全页找点击目标。范围已经正确，无可提交范围修复。

上轮`xhs-share-result.json`记录10卡、目标命中1、公开链接0、`opened:false`、`wrote:false`、`taskUrlUnchanged:true`。失败码对0个/多个控件共用，未保存目标逐控件计数，不能声称其含义是多个。

另有更早`_local-complete-evidence/xhs-list-probe.json`和`xhs-note-ui.json`：首卡5个操作span均无文字/title/aria，links为空、dialogs为空。它们支持“无明确标示入口”，但不是目标卡片本轮快照。已目视读取`xhs-share-visible.png`；图标旁数字是统计，无法仅凭形状确认公开分享入口。保留这一区别，不猜图标序号。本轮无需真实页面对照，没有启动9340或操作9333，没有进入分享界面，没有读到可核验公开地址，未回写。

## 其余范围与运行保护

阅读对照问题清单、交付矩阵及`l1-summary.mjs`、`web.mjs`、`web/pages.html`、`web/mt.js`、`web/publish-prep.js`、`l1-web.mjs`、`publish-prep.mjs`、`l1-inspect.mjs`：统计三口径、网页到受限CLI、X本地文图包、本地skill命令及回执、稳定ID/正文日期匹配与事务回写均有实现。没有发现额外的本轮无需身份未实现项；这是有限范围源码审查，未增加任何测试通过声明。

X/公众号仍等本人登录，原扩展UI仍等本人启用；历史未适配表述不覆盖最新已实现进展。知识站、其他平台、定时后台能力不在范围。本轮没有跑11项离线/HTTP或8项隔离Chrome套件，没有平台采集/内部API/新稿/提交，没有重试9368或native pipe。

未更改业务代码或重启服务：8787=5648、8788=6364、9333=12064，创建时间和监听归属未变。未产生已证实修复，故不部署、不新建数据库备份或回退分支；原`rollback/focus-20261117`及`data/backups/focus-20261117/hub-before-deploy.db`保留。本轮只有文档提交，可用文档提交的revert回退，不需停止服务。

本机证据根`D:\AIInfra\maitian\_local-diag-evidence\`：`crash-summary.json`含dump哈希，`crash-annotations.json`、`crash-details.json`、`data-shape.json`、`traffic-regular-files/result.json`、`processes-final.json`、`listeners-final.json`及第一方解析/单次检查脚本。真实响应和profile仅留本机忽略目录，不提交。最终交付`D:\AIInfra\maitian-diag-out.md`记录提交与推送结果。
