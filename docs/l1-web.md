# L1 本机登录与采集

在 `l1-real` 分支运行 `node scripts/l1-web-server.mjs`，只监听 `127.0.0.1:8787`（端口可用 `web.port` 配置）。启动日志只显示普通地址，不显示网页口令。大屏右下角「登录与采集」进入 `/p#/system`。

本机并排对照：用localhost与127对照隔离Cookie。原版固定访问 `http://127.0.0.1:8788/`，L1 访问 `http://localhost:8787/`，各自登录；不用改监听或 Cookie 代码。同 host 不同端口会共享并覆盖 `mt_key`，此次 401 属于覆盖，Cookie 有效期仍为一年。Chrome 已实测 localhost 的 IPv6 连接被拒后成功回退 IPv4，正反登录顺序和刷新均保持登录；其他环境若无法回退，先分开浏览器配置文件。以后只运行 8787，可恢复 `http://127.0.0.1:8787/`。验证边界见[问题清单](issue-register.md)。

2026-11-17 22:17纠正后：三平台可见身份体检、作品取链接、新准备稿按完整文字/实际日期取链接均有实际CLI入口；不调用旧七平台doctor。原本地小红书skill已真实完成ai身份核验、图文上传填写、保留窗口，未发布。X/公众号各自专用profile真实确认需要本人登录。小红书正向取链接尚未成功，原因是当前可见列表没有公开URL，额外公开页404；不会按ID拼造。详见[publish-preparation.md](publish-preparation.md)和[问题清单](issue-register.md)。

网页仅提供 X `@PeanutPair`、小红书 `TwoPeanuts` 和公众号三个平台。公众号可用名称由 `config.l1.wechat.account` 约束；未配置时仍可登录，由可见唯一公众号名称完成校验。首次登录和过期后的扫码/验证需要 Liu 在本次专用窗口完成。

系统页保留状态砖、手动操作、最近动态，平台登录与校验作为附加区域。手动区分别保留“采流量”和“采粉丝”入口，每个平台都调用同一个 L1 `collect` 整轮流程：读取可见作品指标与粉丝，缺项不保证更新，不能宣称只执行其中一项。点击前会明确提示合并范围。原版“体检”（检查全平台登录）、“取链接”（按期核对链接与状态）、“同步知识站数据”暂无 L1 对应实现，按钮保留且禁用，旁边说明原因；其他原版平台也尚未适配。自动保活、定时任务和自动发送继续不启用。

| 网页操作 | 实际 CLI | 行为 |
| --- | --- | --- |
| 登录 / 校验 | `node scripts/l1-run.mjs --login-x --wait-login`（或 `--login-xhs` / `--login-wechat`） | 最多默认等待 10 分钟，核验可见账号后关闭本次专用窗口，不采集、不生成日报 |
| 采集数据 | `node scripts/l1-run.mjs --only x --date YYYY-MM-DD`（或 `xhs` / `wechat`） | 日期默认北京时间当天；执行该平台整轮采集和本地日报，完成后关闭本次专用窗口 |
| 状态 | `GET /api/l1/status` 或 `POST /api/action` 的 `status` | 仅读本机记录，不探测或启动 Chrome |

专用端口固定为9341/9340/9342，默认profile为MAITIAN_HOME下chrome-profile-l1-x/xhs/wechat；可用l1.<平台>.chromeProfile配置独立本机绝对路径，普通Chrome/Edge目录、网络共享、跨平台共用均拒绝。端口被占用即拒绝，不连接已运行浏览器。清理范围由本次子进程PID、profile和端口归属核验限定，不按Chrome进程名全局关闭。

POST /api/action接受type=login/collect/status/doctor/sync与platform=x/xhs/wechat；collect可给date，sync需id，或preparationId+date（二者互斥）。doctor/sync走新L1 inspect，而非旧hub动作。参数逐项白名单校验，使用无shell的argv启动子进程。拒绝旧metrics/followers/board/mark/submit等网页动作。所有平台操作全局串行，运行时再次发起返回409。

接口沿用网页 cookie 鉴权，也支持 `X-Maitian-Key` 请求头；不要把凭据拼入命令行、URL 或日志。写操作需要已有 `web.key` 且请求来自 loopback，跨来源请求拒绝。本文不提供或修改任何凭据。

网页显示的是「最近校验/采集结果」，不宣称当前平台会话仍然有效。失败时操作记录包含脱敏后的 `tail/error`，`ok=false`；非零退出、启动异常、信号退出均失败。结果写入本机 SQLite `meta` 的 `l1:web:<平台>`，刷新/重启后可读回；重启前未结束的记录标为「未确认结束」，不会伪报成功。原 hub 的 `keepAlive/doctorDay/login:*` 不作为 L1 健康依据。

实际库 `data/hub.db`、`data/backups/`、专用 Chrome profile、`config.json`、`reports/`、`inbox/`、`_local-*`、`_l1-selftest*` 均由现有 `.gitignore` 排除。备份只保存在本机，不提交 Git。日报仍由 Grok Bot 读取本地文件；网页不执行发布和自动发送。

离线验收：`node scripts/l1-web-selftest.mjs`，以及现有 `l1-selftest.mjs`、`l1-login-selftest.mjs`、`l1-x-selftest.mjs`、`l1-wechat-selftest.mjs`、`l1-regression-selftest.mjs`。测试使用隔离配置/数据库及 mock 浏览器，不代表真实账号已登录或采集成功。
