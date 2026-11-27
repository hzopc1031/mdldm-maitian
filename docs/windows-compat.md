# Windows 兼容性说明

麦田按 macOS 写的第一版在 Windows 上有三处会踩坑，都在本分支修好了。这里记录现象、成因和复现方式，方便以后再加平台时不重复踩。

测试环境：Windows 11 家庭版 10.0.26200（64 位）、Node v24.19.0、Git for Windows、PowerShell 7。

## 1. 封面识别不到（`src/make-publish.mjs`）

**现象**：素材齐全，但生成出来的 publish.json 里 `covers` 是空的，控制台显示「封面：」后面什么都没有；校验照样通过（旧版 `validate.mjs` 只打印「封面 无」，不报错），于是发布时各平台都拿不到封面——插件里是 `const cover = ctx.cover('4x3'); if (cover) { … }`，没有封面就静默跳过上传。

```text
$ node src/make-publish.mjs 发布素材.md 工程目录 --require 账号名
已写入 工程目录\publish.json
平台：bilibili；封面：；定时：无
✅ 校验通过
```

**成因**：`walk()` 用 `path.relative()` 收集工程内文件，Windows 返回的是反斜杠路径（`封面\cover-3x4.png`），而后面的匹配写的是 POSIX 风格 `封面/cover-3x4.png`，永远匹配不上。

**修复**：收集时统一成正斜杠。

```diff
- statSync(p).isDirectory() ? walk(p) : files.push(relative(dir, p));
+ statSync(p).isDirectory() ? walk(p) : files.push(relative(dir, p).split(sep).join('/'));
```

修完：

```text
平台：bilibili；封面：3x4 / 4x3 / 16x9；定时：无
```
```json
"covers": { "3x4": "封面/cover-3x4.png", "4x3": "封面/cover-4x3.png", "16x9": "封面/cover-16x9.jpg" }
```
```text
  B 站：title 16/80，desc 55/2000；封面 4x3
```

## 2. `validate.mjs` 同一个问题

`validate.mjs` 也用 `path.relative` 建 `files` 集合，Windows 上 `files.has('封面/cover-4x3.png')` 为 false。一旦 publish.json 里写明了封面路径（比如手工补的），校验就会报「找不到封面」。同上一行 `.split(path.sep).join('/')` 解决。

## 3. 本机扩展 `src/make-publish.local.mjs` 加载失败

`make-publish.mjs` 尾部会 `await import(localExt)`，Windows 下 `localExt` 是带盘符的绝对路径：

```text
Error [ERR_UNSUPPORTED_ESM_URL_SCHEME]: Only URLs with a scheme in: file, data, and node
are supported by the default ESM loader. On Windows, absolute paths must be valid file:// URLs.
Received protocol 'e:'
```

**修复**：

```diff
- const m = await import(localExt);
+ const m = await import(pathToFileURL(localExt).href);
```

## 顺带一个不算 bug 的点

成片时长用 `ffprobe` 探测，不在 PATH 时静默跳过，publish.json 里没有 `durationSec`，不报错。如果排期逻辑以后要看时长，建议 README 里写明需要 ffmpeg，或者加个回退。

## 最小复现

1. `git clone` 后按 README 跑 `node src/hub.mjs` 完成配置（`config.plugin = "local"` + `pluginDir` 指向插件目录也可以）。
2. 建一个最小工程目录：`成片.mp4` + `封面/cover-3x4.png`、`cover-4x3.png`、`cover-16x9.jpg` + 一份只含 `## 三、B站` 节的 `发布素材.md`。
3. `node src/make-publish.mjs 发布素材.md 工程目录 --require 任意标签` → 看「封面：」是否为空。
4. `node src/validate.mjs 工程目录` → 看「封面」一栏。
5. 在 `src/` 放一个空的 `make-publish.local.mjs` 再跑第 3 步 → 看是否报 `ERR_UNSUPPORTED_ESM_URL_SCHEME`。

第 3、5 步在 `git worktree add <目录> HEAD` 的干净副本上一样能复现，不是本地改动带来的。
