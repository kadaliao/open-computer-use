# 更新日志

[English](CHANGELOG.md) · **简体中文**

open-computer-use 的重要改动都记在这里。格式参照 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循[语义化版本](https://semver.org/lang/zh-CN/)。1.0 之前，次版本号可能改动屏幕格式或工具行为，这类改动列在**变更**下。

## [未发布]

## [0.7.2] - 2026-11-16

重跑基准测试时发现的可靠性修复：helper 的一个崩溃，以及内置 agent 的三种出错方式（提前结束、按错元素、原地打转）。

### 修复

- 元素报出的坐标是 NaN 或无穷大时，helper 不再崩溃（在系统设置切换页面时遇到过）。
- 目标里第二步的名字没加引号时（比如一个叫 `inner-x1` 的文件夹），内置 agent 不会再在做完第一步后就接受 `done`。
- 规划模型抄错 ref 时不会再按到别的元素：`press` 和 `open` 步骤现在要写出元素的标签，内置 agent 会拿它和 ref 对照。屏幕上只有一个元素是这个标签，就按那个；否则拒绝这一步，让规划模型重新看。
- 规划模型反复发送一个没有效果的操作时，提示会更直接；连续四轮还这样，任务就停下，不再一直跑到步数上限。
- 在“打开”或“保存”面板里，规划模型会用路径直达文件夹（`cmd+shift+g`），不再一层层点侧边栏：原来要 10 到 15 次规划模型调用，现在 2 次。

### 变更

- `docs/benchmarks.md` 只保留和 agent-desktop 的对比（改成了一张图，README 里也放了）以及基准测试的运行方法。
- 基准测试会关掉自己打开的 Safari 标签页，检查结果前会等还在加载的页面，在英文系统上也能正常清理。

## [0.7.1] - 2026-11-16

修了 `open` 的一个问题，加了 Homebrew formula，并重跑了和 agent-desktop 的对比：同一个模型跑同样的四个任务，ocu 用了 84 秒、29 次工具调用、27 万输入 token，agent-desktop 用了 173 秒、73 次调用、214.5 万 token。详见[基准测试](docs/benchmarks.zh-CN.md#和-agent-desktop-对比)。

### 新增

- `brew install kadaliao/tap/ocu`（Apple 芯片）。
- 用 0.7.0 重跑的 agent-desktop 对比，写进了 `docs/benchmarks.md` 和 README。访达任务里，ocu 从 22.6 秒、6.5 次工具调用外加一张截图，变成 9.4 秒、3 次调用、不用截图。

### 修复

- 对没有自带打开动作的行（比如活动监视器里的进程）用 `open`，现在会双击它。以前发的是 cmd+down，只有文件列表才认。

## [0.7.0] - 2026-11-16

访达里的文件在每种视图下都能选中和打开，项目也有了中英文文档。在 5 个文件视图任务上，内置 agent 从 3/5 通过、每个任务 12.0 秒、10.4 次规划模型调用，变成 5/5 通过、3.6 秒、2.8 次调用。

### 新增

- 新操作 `open{ref}`：相当于双击文件、文件夹或行，打开文件或进入文件夹。访达的四种视图和“打开”“存储”面板里都能用。
- 访达分栏、图标和画廊视图里的文件列为 `Cell "名称"`。以前分栏视图把它们列成文本框，另外两种视图根本不列。
- MIT 许可证。
- 中英文文档：更短的 README，以及 `docs/` 下的概念、MCP 接入、内置 agent、配置、故障排查、架构、基准测试和发布流程。
- 贡献指南、安全政策、行为准则、issue 和 PR 模板，以及给编程 agent 看的 `AGENTS.md`。
- `docs/benchmarks.md` 里加了和 agent-desktop 的对比；新增路线图，`docs/plans/` 下每项工作一份计划。
- `scripts/check-docs.ts`：检查每篇文档都有对应的中文版，并且相对链接和锚点都能找到。

### 变更

- 在访达的分栏、图标和画廊视图里，对文件 `press` 会选中它，和列表视图一致，`extend` 也能用。以前它报告成功，实际什么都没发生。
- 对选不中的行或文件 `press`，会退回到真实的鼠标点击。
- 发布包里也带上 `README.zh-CN.md` 和 `LICENSE`。

## [0.6.0] - 2026-11-10

提速版本。内置 agent 跑 22 个基准任务全部通过，每个任务约 4 秒、2 次规划模型调用；0.5.0 是 20/22 通过、9.8 秒、4 次调用。详见[基准测试](docs/benchmarks.zh-CN.md)。

### 新增

- 元素带上了状态（`[checked]`、`[mixed]`、`[selected]`、`[disabled]`）和值（`= "…"`），调用方不用再截图看复选框。
- 读屏会报告打开的对话框或表单，并把它的控件排在最前面。对话框打开或关闭时，`act` 的回复会说明。
- 小改动之后，MCP 的 `act` 回复只列出变化的行（`+` 新出现，`~` 有变化，`-` 已消失）。
- 内置 agent 可以用 `done` + `expect` 结束，在屏幕上本地检查，不用再调一次规划模型。
- 访达的「前往」菜单一步打开常用文件夹。
- `bench/perf.ts` 和 `bench/mcp-perf.ts` 不经过模型，直接测 helper 和 MCP 服务；agent 基准测试会报告规划模型调用次数和各阶段耗时。

### 变更

- ref 稳定了：同一个元素在多次读屏之间保持同一个 ref，ref 不会被别的元素复用。已经消失的 ref 会返回 `unknown ref`。
- ref 从 `e101` 开始，不再每次回复都重新编号。MCP 调用方可能收到变化列表而不是整屏，服务说明里讲了这两种情况。
- 后续步骤不依赖新屏幕时，agent 的批量操作可以越过屏幕变化继续执行。

### 性能

- 每个元素只需一次辅助功能往返；覆盖层不再拖慢操作；固定的 sleep 改成了条件检查。一次点按从 174 ms 降到 3 ms。
- 截图在进程内完成并缩放（不再调用 `screencapture` 或 `sips`）。
- 统一的等屏幕稳定逻辑，重复读取时不打扰界面。
- 规划模型回复之后，Jev 完成判断不会再多等几秒。

### 修复

- 不带 ref 的 `type` 通过辅助功能把文字插入当前聚焦的原生输入框，并会等输入框获得焦点。在访达里按 cmd+shift+n 之后立刻给新文件夹命名，现在可以了。
- `open_app` 和 `open_url` 等打开的应用真正到前台才返回，批量里后面的按键能送到它那里。
- 屏幕锁定时拒绝所有操作。以前按键会打到登录框里。
- 会自己动的滑块不再让屏幕一直等不到稳定。
- 屏幕变化之后的 `tab` 会先看一眼新屏幕。

### 已知限制

- 访达分栏视图和图标视图里的项目不能用 `press` 打开，改用「前往」菜单或 `open_url`。
- 不暴露页面内容的 Electron 应用里，网页点击还没验证过。

## [0.5.0] - 2026-11-03

### 新增

- MCP 服务说明，讲清楚 observe → act 的循环。
- `act` 的回复会概括变化。
- 不需要模型 key 的 `screenshot` 工具。可选工具在配置好 key 之前不显示。
- 读屏会列出应用的其他窗口。

### 变更

- 屏幕内容更精简，等屏幕稳定的时间更短。

### 修复

- 页面加载往往晚开始，所以 MCP 服务等更久才报告 `did not change`。
- 会把读取的窗口带到前台。
- 从 Electron 宿主启动的 Electron 应用不会再一启动就退出。

## [0.4.3] - 2026-11-03

### 修复

- 网页内容（Electron 应用、浏览器）里的元素改用真实点击，因为这些应用会忽略辅助功能的点按。
- 操作没有任何效果时，会告诉 MCP 调用方。

## [0.4.2] - 2026-11-03

### 修复

- 缺少辅助功能权限时如实报告，并请 macOS 弹出授权提示。
- 在 GUI 宿主里，MCP 服务会从登录 shell 借用模型 key。
- 发给 helper 的请求会超时，不会一直卡住。
- 安装脚本会给装好的二进制重新签名。

## [0.4.0] - 2026-11-02

### 新增

- 独立的发布构建（单文件可执行 + helper，不需要装 Bun）和安装脚本。
- DeepSeek Harness 作为 MCP 宿主的接入方法。

## [0.3.0] - 2026-11-02

### 新增

- MCP：按名字指定应用，一次 `act` 批量执行多个操作。
- `ocu doctor`。
- 动作缓存，参数从目标里提取。

### 修复

- 长列表只保留可见的行。
- 针对 Safari 阅读器模式的提示。

## [0.2.0] - 2026-11-02

### 新增

- 用视觉模型做截图兜底：`click_visual` 和 `read_visual`。
- `note` 和 `find_text` 操作。
- 防止在两个操作之间来回切换的保护。
- 更难的基准测试任务。

## [0.1.0] - 2026-11-02

第一个版本：以辅助功能为主的 macOS computer-use agent，包含 Swift helper、TypeScript core、命令行和 MCP 服务。

[未发布]: https://github.com/kadaliao/open-computer-use/compare/v0.7.2...HEAD
[0.7.2]: https://github.com/kadaliao/open-computer-use/compare/v0.7.1...v0.7.2
[0.7.1]: https://github.com/kadaliao/open-computer-use/compare/v0.7.0...v0.7.1
[0.7.0]: https://github.com/kadaliao/open-computer-use/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/kadaliao/open-computer-use/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/kadaliao/open-computer-use/compare/v0.4.3...v0.5.0
[0.4.3]: https://github.com/kadaliao/open-computer-use/compare/v0.4.2...v0.4.3
[0.4.2]: https://github.com/kadaliao/open-computer-use/compare/v0.4.0...v0.4.2
[0.4.0]: https://github.com/kadaliao/open-computer-use/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/kadaliao/open-computer-use/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/kadaliao/open-computer-use/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/kadaliao/open-computer-use/releases/tag/v0.1.0
