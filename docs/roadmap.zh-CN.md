# 路线图

[English](roadmap.md) · **简体中文**

ocu 接下来往哪走、按什么顺序做。每一项在 [plans/](plans/README.md) 里都有一份计划，写到一个会话就能照着实现的程度。计划是英文的工作文档。

- [定位](#定位)
- [不能丢的东西](#不能丢的东西)
- [向 agent-desktop 学什么](#向-agent-desktop-学什么)
- [计划列表](#计划列表)

## 定位

ocu 是让调用方花最少轮数和 token 的 macOS 操作层，外加一个能用任意兼容 OpenAI 接口模型的内置 agent。

[agent-desktop](https://github.com/vercel-labs/agent-desktop) 覆盖面更广：三个平台、75 个 MCP 工具、会话、trace、沙箱、C 库，背后还有一个大团队。ocu 不去拼覆盖面。在 [2026-11-16 的对比](benchmarks.zh-CN.md#和-agent-desktop-对比)里，同一个模型做同样的任务，用 ocu 大约只花一半时间、三分之一的工具调用、十分之一的输入 token，两边每次都做对了。下面的计划要守住这个优势，同时补上对比里暴露的短板。

## 不能丢的东西

这几条是设计的根基，任何计划都不能拿它们去换。

- **一次调用既做事又看结果。** `act` 的回复会说明变了什么，调用方很少需要再单独看一次。
- **工具面要小。** 核心只有三个 MCP 工具。agent-desktop 的 75 个工具定义，每次请求都要多带约 4.2 万字符。新能力加成现有工具里的动作或字段。
- **小模型也能看懂的文字。** 每个元素一行，回复简短，并直接写明哪些 ref 还有效。
- **用数据说话。** 每个改动前后都要跑 `core/bench/` 和对比基准。

## 向 agent-desktop 学什么

| 方面 | 它怎么做 | 计划 |
| --- | --- | --- |
| 打开项目 | 点击是一串回退步骤（带选中检查的 AXPress、AXOpen、通过容器选中……） | [03](plans/03-open-items.md) |
| 测试 | 一个夹具应用，每个控件都会报告自己被做了什么，用来做确定性的端到端测试 | [04](plans/04-fixture-app.md) |
| Electron | 打开 Chromium 的辅助功能树（`AXManualAccessibility`）；密集窗口先看骨架再逐块展开 | [05](plans/05-electron-and-dense-apps.md) |
| 焦点 | 默认在后台操作；只有获准时才用真实输入，从不悄悄回退 | [06](plans/06-background-operation.md) |
| 安全 | 从不读取密码框的值；拒绝操作部分系统进程 | [07](plans/07-safety.md) |
| 安装 | 一行命令安装，两种芯片都有构建，附校验和 | [08](plans/08-distribution.md) |
| 结果 | 每个操作都有送达结果（已验证、未验证、未送达），错误码附带能否重试 | [09](plans/09-delivery-and-errors.md) |
| 界面层 | 右键菜单、弹出框、菜单栏图标、窗口 id | [10](plans/10-surfaces-and-windows.md) |
| 等待 | 等文字出现、元素状态或事件 | [11](plans/11-waits.md) |
| Trace | 带脱敏的 JSONL trace | [12](plans/12-traces.md) |
| 命令行 | 每个命令都能在 shell 里用，并支持会话 | [13](plans/13-cli-sessions.md) |

不照搬的：

- 75 个工具的接口，以及每条回复都套一层 JSON；
- 私有 API 的元素 token：ocu 在一个 helper 进程里保持 ref 有效；
- 通过 Chrome DevTools 访问 Electron 应用；
- Windows、Linux 和 C 库。

## 计划列表

按实现顺序排列。

| # | 计划 | 优先级 | 依赖 | 状态 |
| --- | --- | --- | --- | --- |
| 01 | [可复现的对比基准](plans/01-vs-benchmark.md) | P0 | – | 计划中 |
| 02 | [CI 和版本命令](plans/02-ci-and-version.md) | P0 | – | 计划中 |
| 03 | [在访达和文件视图里打开项目](plans/03-open-items.md) | P0 | (01) | 计划中 |
| 04 | [夹具应用和本地端到端测试](plans/04-fixture-app.md) | P1 | – | 计划中 |
| 05 | [Electron 应用和密集窗口](plans/05-electron-and-dense-apps.md) | P1 | (01, 04) | 计划中 |
| 06 | [不抢焦点地操作](plans/06-background-operation.md) | P1 | 04, 01 | 计划中 |
| 07 | [密码框和受保护的应用](plans/07-safety.md) | P1 | 04 | 计划中 |
| 08 | [Homebrew 和 Intel 构建](plans/08-distribution.md) | P1 | 02 | 计划中 |
| 09 | [逐个操作的结果和错误码](plans/09-delivery-and-errors.md) | P2 | 04, 03 | 计划中 |
| 10 | [右键菜单、弹出框、菜单栏图标、多窗口](plans/10-surfaces-and-windows.md) | P2 | 04 | 计划中 |
| 11 | [等待某个条件](plans/11-waits.md) | P2 | – | 计划中 |
| 12 | [Trace 记录](plans/12-traces.md) | P2 | 07 | 计划中 |
| 13 | [在 shell 里使用 ocu](plans/13-cli-sessions.md) | P3 | 09 | 计划中 |

括号里的依赖是有帮助但不强制。怎么领一份计划、做完要更新哪些地方，见 [plans/README.md](plans/README.md)。
