# 麦田小红书图文

这套工具独立于现有麦田。它支持离线测试，也可把已确认稿件上传到小红书创作中心，核对图序、标题、正文和话题，停在 `待确认`。任务状态中的 `mode` 标明采用哪种方式验收。

离线验收复用已安装麦田的 Chrome shim，以及发布助手的文件选择、输入和点击函数。它启动带临时资料目录的无头 Chrome，使用随机本机调试端口和 `file://` 验收页。正式浏览器、数据库、麦田配置和 Git 远端都不参与。验收页模拟控件交互，不能用来证明小红书实际页面的控件或定时规则。

## 运行离线验收

在本目录运行，依赖本机已有的 Node.js、Swift/AppKit 和 Google Chrome。该目录可独立执行，浏览器连接仍复用本机安装的麦田主程序和发布助手。

```bash
node --test
```

如需保留由测试生成的占位稿和证据，指定一个尚不存在的目录。

```bash
MAITIAN_XHS_EVIDENCE_DIR="$PWD/demo-output/xhs-offline-demo" node --test test/offline.test.mjs
```

产物包含两张 1080×1440 PNG、`offline-result.json` 和 `offline-preview.png`。测试中的日期只用于验证北京时间格式，没有生产或发布安排。

当前默认读取 `~/maitian/mdldm-maitian` 和 `~/maitian/mdldm-maitian-publisher` 中的驱动源码。路径不同时可设置 `MAITIAN_HUB_DIR` 与 `MAITIAN_PUBLISHER_DIR`。

## 建一个本地稿件工程

把任务目录放到现有麦田分发扫描目录之外，目录名即固定任务 ID。先创建工程，再填 `draft.json` 和 `cards.json`。`draft.json` 按篇保存标题、正文、话题、来源、编号图片和可选的 `scheduledFor`。来源可用 `{ "kind": "local", "title": "来源标题", "path": "source.md", "evidence": "支持的事实" }` 或 `{ "kind": "url", "title": "来源标题", "url": "https://example.com/", "evidence": "支持的事实" }`。写入链接只是记录来源。带定时的例子采用 `2030-01-02T19:30:00+08:00`，无定时用 `null`。

`cards.json` 是 `{ "title": "卡片标题", "body": "卡片正文" }` 列表。可选 `label` 显示卡片所属章节，`code` 用等宽字显示短命令。渲染后按文件顺序写回 `images/01.png` 等路径并撤销旧的离线审核。也可手动放入按序编号的 PNG 并填写 `images` 列表。

```bash
node xhs.mjs init /path/to/task-id
# 编辑 draft.json、cards.json，并放入稿件所用的本地来源文件
node xhs.mjs render /path/to/task-id
node xhs.mjs check /path/to/task-id
# 核对 check 输出，再使用那次输出中的完整 digest
node xhs.mjs approve-offline /path/to/task-id <审核摘要>
node xhs.mjs preview-offline /path/to/task-id
node xhs.mjs status /path/to/task-id
```

`check` 校验必填项、图片格式和顺序、定时格式并生成摘要。文案、图序、图片内容、本地来源内容或时间一变，原审核会失效。每个任务只允许一项操作同时运行。如果进程异常退出留下 `.lock` 目录，确认进程已退出后可用 `rmdir` 清除这个空目录，再运行 `check`。停用时直接停止使用本工具，任务和验收证据保留在独立目录下。

## 从已核对的选题和来源出稿

`produce` 用本机已登录的 Codex CLI 生成正文和卡片文案，再用 Swift/AppKit 渲染 1080×1440 PNG。输入包括选题、写作规则、已经核对的公开事实，以及本机 DeepSeek Harness 的实测记录。命令完成后将新工程放进任务目录，状态为 `待审核`。

```json
{
  "topic": "合成测试主题",
  "guidance": "面向第一次接触这个主题的读者。先讲用途，再讲步骤。",
  "cardCount": 2,
  "sources": [
    { "title": "合成测试资料", "url": "https://example.com/", "evidence": "将已核对的公开事实写在这里。" }
  ],
  "localTest": {
    "environment": "注明 Mac 上的 DSH 和插件版本",
    "observed": "记录实际操作和屏幕上出现的结果",
    "limits": "说明没有实测的步骤"
  }
}
```

```bash
node xhs.mjs produce tasks/new-task-id brief.json
node xhs.mjs check tasks/new-task-id
```

请给每篇使用新的任务 ID。交付物含 `brief.json`、`draft.json`、`cards.json`、`本机实测.json`、按序编号的图片和审核摘要。程序会把实测记录写入审核摘要覆盖的来源文件，记录本身须由实际测试取得。出稿阶段不会进入上传队列，事实和版面仍需审核。 [OpenAI 官方文档](https://learn.chatgpt.com/docs/non-interactive-mode)

### 界面类插件先实拍再出稿

在本机 DSH 的隔离测试资料目录中打开插件，用演示会话走一遍入口、关键操作和结果。亲自保存实拍素材。用户给的参考截图用于理解需求。演示数据在正文和实测记录中说明。图注可省略，仅在读者需要定位控件或理解图表时添加。截图和裁切范围应排除账号、余额、私有会话、路径和凭据。

在选题资料中设 `visualMode` 为 `interface`。页眉在「插件教程」后带插件名称，可加期号。封面用一张全局效果图和一句插件用途说明，从第二张起再讲局部、入口和步骤。界面类任务缺少全局效果或操作截图时会停止出稿。

```json
{
  "visualMode": "interface",
  "pluginName": "dsh-example",
  "episode": 2,
  "coverSummary": "用总览查看会话用量、耗时和上下文组成。",
  "interfaceScreenshots": [
    { "card": 1, "file": "实拍素材/全局效果.jpg", "role": "overview" },
    {
      "card": 2,
      "file": "实拍素材/操作细节.jpg",
      "crop": { "x": 100, "y": 80, "width": 720, "height": 420 }
    }
  ]
}
```

截图和选题资料放在同一目录下，`file` 为相对路径。裁切坐标以截图左上角为原点，保持截图比例。程序把原图留在任务工程，Swift 将裁切和注释合成到 3:4 PNG。重排现有任务时可直接编辑 `cards.json` 的 `screenshots`，再运行 `render` 和 `check`。审核前按手机显示宽度检查版面，关键控件或图表读不清就另截或加局部放大。

已提交稿件的排版修改应先存为独立本地预览，避免覆盖与该次提交关联的素材及验收记录。

## 用程序在真实编辑器验收

确认具体稿件后，在本目录执行以下命令。使用那次确认对应的完整摘要，以及小红书创作中心右上角的账号显示名。命令将文件交给实际创作中心上传。

```bash
node xhs.mjs check tasks/example-note
node xhs.mjs preview-web tasks/example-note '已确认的完整摘要' '你的创作中心账号'
node xhs.mjs status tasks/example-note
```

程序使用麦田配置里的专用 Chrome 会话和发布助手的 CDP 控件操作，新开一个图文标签页。它检查账号显示名、浏览器选择文件的 SHA-256、页面缩略图的内容和顺序，再回读标题、正文和正式话题，并确认定时开关关闭。成功后将该标签页选中，保存 `program-web-result.json` 和 `program-web-preview.png`。稿件保留在编辑页，同一任务、摘要和账号已有成功记录时，重复调用只返回原记录。报告不代表标签页一直开着。

未登录、访问验证、页面变化、话题缺失或回读不符时，本次运行停止并记录原因。处理后可以明确重跑。`preview-web` 只接受 `scheduledFor: null`，终点是发布按钮前。

## 设置并核对定时时间

确认具体时间后，用 `preview-schedule` 接续原有编辑页。保持已经验收的编辑标签页打开，传入同一任务、审核摘要和账号，以及带 `+08:00` 的未来时间。

```bash
node xhs.mjs preview-schedule '任务目录' '已确认的完整摘要' '账号显示名' '2030-01-02T20:30:00+08:00'
```

程序只操作唯一匹配的现有编辑页。它打开定时开关、填写时间并确认关闭输入控件后仍显示指定值，在任务内保存 `program-schedule-preview.png` 和 `program-schedule-result.json`。任务仍是 `待确认`。

## 经明确批准后提交平台定时

仅在用户确认该账号、稿件和时间的真实提交后执行。以下命令会点击一次小红书编辑页的「定时发布」。

```bash
node xhs.mjs submit-schedule '任务目录' '已确认的完整摘要' '账号显示名' '2030-01-02T20:30:00+08:00'
```

程序会在点击前核对编辑页的账号、稿件、图序、时间及笔记管理中的同名记录。点击前先写入 `program-schedule-submit-attempt.json`。有该记录后，同一命令只核对平台结果。遇到扫码等验证时保留原编辑页并暂停。用户完成验证后先用原命令查看结果。如果全部笔记中都没有这篇、原编辑页仍与已确认稿件一致且验证提示已关闭，可将同一命令名替换成 `resume-schedule` 接续一次。只有笔记管理显示对应的定时状态和时间才记作 `已定时`。平台审核状态保留在回读中。审核队列只填写编辑页，正式提交使用单独的命令。

## 处理审核队列

审核具体内容后，`queue-web` 把任务 ID、审核摘要和账号显示名存入任务状态。仅执行这条命令不会访问小红书。每次调用 `run-queue` 最多处理一篇，按批准时间选取，仍然走同一个 `preview-web` 执行流程。

```bash
node xhs.mjs queue-web '任务目录' '已确认的完整摘要' '账号显示名'
node xhs.mjs run-queue tasks --dry-run
node xhs.mjs run-queue tasks
node xhs.mjs cancel-web '任务目录'
```

`--dry-run` 只检查队首，不打开浏览器或修改状态。未批准、已撤回、已完成的任务不会进入队列。批准后若文案、图片或来源发生变化，运行会停止并将该任务标为失败。进程中断、登录失效或出现平台验证时，核对浏览器和本地状态后可重新批准，队列不会自行重试。现阶段可以由外部定时器调用 `run-queue`，项目尚未安装定时任务。

停用时停止调用 `preview-web`、`preview-schedule` 和 `run-queue`，也可以用 `cancel-web` 撤回尚未执行的批准。回退队列功能时，恢复加入队列前备份的 `xhs.mjs` 和本页，再移除 `queue.mjs` 与 `test/queue.test.mjs`。任务和验收证据可保留。
