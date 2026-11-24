# DeepSeek Harness前端技术栈核查

2026-11-24 16:51，Codex，同会话01a205f3-3296-7510-8105-ad4e4d268422。用户请求分析DSH前端技术栈；本轮只读核查及文档持久化，不改应用、运行第三方脚本、安装、迁移、启动或重启。

## 核查范围

- 按统一skills README索引阅读DSH界面参考及来源说明，用于识别官方包与设计规范，不执行插件开发流程。
- 本机独立安装入口D:/AIInfra/dsh-app/package.json声明@deepseek-ai/dsh ^0.2.1-rc.5；实际根包与已读web-frontend/ui-renderer/ui-theme/ui-chat/connection包的package.json为0.2.1-rc.5。不能据此声称正在运行的桌面应用也是该版本。
- 同时读取官方master的apps/web、apps/desktop、client/ui-primitives、store、connection、web、ui-slots及web-styling原文。在线master返回的多个包版本不同，属开发中分支，以下是核查时源码声明，不把它们混成已安装应用版本。
- 本机根node_modules下store/primitives/slots等若未直接找到，只代表该目录布局未命中；不据此断言产品缺包或运行故障。未遍历认证存储或操作登录浏览器。

## 技术组成

| 部分 | 已核实实现 | 作用 |
|---|---|---|
| 界面 | React/React DOM，包声明^18.2.0；TypeScript | 用组件和类型组织交互 |
| Web构建 | apps/web用Vite，@vitejs/plugin-react | 开发与最终Web构建 |
| 包构建与工程 | tsdown、TypeScript、pnpm workspace | 多包编译打包，不能说所有层都由Vite处理 |
| 样式 | CSS Modules、clsx、--dsw-*及--dsw-alias-*主题变量 | 组件样式隔离、统一明暗主题与视觉尺度 |
| 控件 | 自有dsh-client-ui-primitives，ui-theme | 统一按钮、输入、菜单、弹窗等；官方规范明确不新增组件库/Tailwind |
| 状态 | 官方client-store的Zustand/Immer引擎，renderer桥接React选择器钩子 | 状态快照与订阅；不能只凭React推断用Redux |
| 扩展 | Cordis上下文/插件生命周期，typed UI Slots与Component Factory | 插件贡献界面，由统一renderer组装，不是每个插件重建应用根 |
| 通信 | HTTP POST Remote RPC；浏览器WebSocket复用事件/流，重连 | 连接本机/远端Host；桌面载体也可以提供等价逻辑传输，不说所有载体必走WebSocket |
| 桌面 | 官方apps/desktop为Electron shell | 承载Web界面、桌面集成与配套运行时；不属于UI组件框架 |
| 长列表 | 已读ui-chat包声明@tanstack/react-virtual | 用于其相关虚拟列表能力，不泛化全部页面都启用 |

DSH启动先用原生DOM/CSS显示加载和故障页，插件就绪后由统一React renderer挂载/hydrate完整界面；启动页原生DOM不代表整个产品是原生JS页面。

## 与当前工作台的差异及判断

工作台当前是原生HTML/CSS/JS、模板字符串、手写Hash路由/DOM监听、fetch本机接口；没有React/Vite构建流程。DSH把组件、状态、主题和插件生命周期分别交给专用层，适合多面板、流式会话和动态扩展的复杂产品，但引入更多构建与依赖管理。

本项目之前resize重复绑定是生命周期管理缺陷，换React并不会自动消除；仍需正确订阅、清理effect和验证交互。若未来参考DSH架构，可以借鉴React/TypeScript组件、统一设计变量、显式状态及资源释放，不必为外观重写后端或搬整个Cordis插件系统。本轮未作迁移决定或执行。

## 官方证据入口

- https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/web/package.json
- https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/ui-primitives/package.json
- https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/web-styling.md
- https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/store/package.json
- https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/store/README.md
- https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/web/README.md
- https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/ui-slots/README.md
- https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/connection/README.md
- https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/desktop/package.json

无需功能回归：本轮仅文档分析，没有应用代码变化。未验证运行中桌面应用的完整依赖版本；不声称所有Agent已读取本报告。
