# 故障排查

[English](troubleshooting.md) · **简体中文**

先跑 `ocu doctor`，要在运行 ocu 的那个应用里跑。它会检查辅助功能、屏幕录制权限，以及规划模型、Jev 和视觉模型的 key 能不能用。

- [权限](#权限)
- [安装与启动](#安装与启动)
- [MCP](#mcp)
- [回复里的错误](#回复里的错误)
- [已知限制](#已知限制)
- [报告 bug](#报告-bug)

## 权限

**"Accessibility: not granted"（没有辅助功能权限）。** 在 系统设置 > 隐私与安全性 > 辅助功能 里，给启动 ocu 的那个应用打勾，然后退出并重新打开它。命令行下是你的终端。MCP 下是宿主应用：Claude Desktop、Cursor、DeepSeek Harness，或者运行 Claude Code、Codex 的终端。

**权限给了，但读不了某个应用。** `doctor` 会打印出错误。常见原因是屏幕锁着，或者应用还在启动。

**"Screen Recording" 检查失败。** 只有 `screenshot`、`click_visual` 和 `read_visual` 需要屏幕录制权限。在同一个设置页打开它（系统设置 > 隐私与安全性 > 录屏与系统录音，旧版 macOS 叫「屏幕录制」），再重新打开应用。

## 安装与启动

**`ocu: command not found`。** 安装脚本会建一个 `~/.local/bin/ocu` 链接。把 `~/.local/bin` 加进 `PATH`，或者直接运行 `~/.local/share/ocu/ocu`。

**ocu 一启动就被杀掉（exit 137）。** 已签名的可执行文件被原地覆盖后，macOS 会把它杀掉。用 `install.sh` 安装，它会先删掉旧文件、再给新文件签名，不要直接拷过去覆盖。

**"helper not built"**（源码仓库）。在 `mac/` 里运行 `swift build -c release`。

**"ocu-mac did not answer … within 20s"。** 正在读的应用没有响应。等它恢复响应再试，或者调大 `OCU_CALL_TIMEOUT_MS`。

## MCP

**没有 `click_visual`、`read_visual` 或 `run_task`。** 这几个工具要设了对应的 key 才会出现。GUI 应用拿不到你 shell 里的变量，服务会尽量从登录 shell 借（见 [GUI 应用里的模型 key](mcp.zh-CN.md#gui-应用里的模型-key)）。如果你的 key 设在登录 shell 读不到的地方，就写进服务的 `env` 配置。

**调用方读到的是自己的终端。** 给 `observe` 传 `app`。不传的话，ocu 读的是最前面的应用。

**覆盖层碍事。** 在服务的环境变量里设 `OCU_OVERLAY=0`。

## 回复里的错误

| 回复 | 含义 | 怎么办 |
| --- | --- | --- |
| `unknown ref` | 这个元素已经不在屏幕上了 | 用最新回复里的 ref |
| `did not change` | 这个操作没有看得见的效果 | 换个元素，或者用菜单、快捷键。别重复同一个操作 |
| `accessibility info is sparse here` | 这个应用给辅助功能的信息很少（画布、游戏、部分 Electron 应用） | 先 `screenshot` 再 `click_at`，或者用 `click_visual` / `read_visual` |
| `… was launched but is not running` | 应用一启动就退出了，或者还在加载 | 再 `open_app` 一次，还不行就报告 |
| `no app named …` | macOS 按这个名字找不到应用 | 用应用在「应用程序」文件夹里的名字 |

## 已知限制

- **不暴露网页内容的 Electron 应用。** 在里面点网页内容，效果没有验证过。
- **Safari 阅读器模式**会让页面的一部分（比如维基百科的信息框）在 `find_text` 里搜不到。用 显示 > 隐藏阅读器（英文系统是 View > Hide Reader）关掉，再搜一次。
- **计算器**按运算优先级算，而且没有括号。要先按 `=` 拿到中间结果。
- **发布版**只支持 Apple 芯片。Intel Mac 请从源码构建。

## 报告 bug

用 [bug 报告模板](https://github.com/kadaliao/open-computer-use/issues/new/choose) 开一个 issue，写上：

- ocu 版本（发布版的 tag，源码仓库用 `git rev-parse --short HEAD`）和 macOS 版本；
- 怎么运行的：命令行，还是 MCP，以及哪个宿主应用；
- `ocu doctor` 的输出；
- 目标或者工具调用，以及发生了什么。

屏幕文字、截图和动作缓存里有你屏幕上的内容。贴出来之前，先删掉不想公开的部分。
