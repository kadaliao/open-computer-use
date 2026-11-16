# MCP 接入

[English](mcp.md) · **简体中文**

`ocu mcp` 通过 stdio 运行一个 MCP 服务。调用它的 agent（Claude Code、Codex、Cursor、Claude Desktop、
DeepSeek Harness……）负责思考；ocu 给它一个快速、准确的 Mac 应用视图，以及操作应用的手段。
核心工具不需要模型 key。

- [接入你的 agent](#接入你的-agent)
- [权限](#权限)
- [GUI 应用里的模型 key](#gui-应用里的模型-key)
- [工具](#工具)
- [给调用方的建议](#给调用方的建议)

## 接入你的 agent

下面的例子用的是发布版的安装路径 `~/.local/share/ocu/ocu`。JSON 和 TOML 配置里要写完整路径，
所以把 `/Users/you` 换成你的主目录。如果要跑源码版，命令改成 `bun`，唯一的参数是
`/path/to/open-computer-use/core/src/mcp.ts`。

**Claude Code**

```sh
claude mcp add ocu -- ~/.local/share/ocu/ocu mcp
```

**Codex**（`~/.codex/config.toml`）

```toml
[mcp_servers.ocu]
command = "/Users/you/.local/share/ocu/ocu"
args = ["mcp"]
```

**Cursor、Claude Desktop 以及其他 JSON 配置**（`~/.cursor/mcp.json`、
`~/Library/Application Support/Claude/claude_desktop_config.json`……）

```json
{
  "mcpServers": {
    "ocu": {
      "command": "/Users/you/.local/share/ocu/ocu",
      "args": ["mcp"]
    }
  }
}
```

**DeepSeek Harness。** 把下面这段加到 `~/.dsh/cordis.patch.yml` 的 `insert:` 下面，然后重启应用：

```yaml
- id: ocu-mcp
  name: "@deepseek-ai/dsh-mcp-client"
  config:
    serverName: ocu
    transport: stdio
    command: /Users/you/.local/share/ocu/ocu
    args: [mcp]
```

要传设置的话，把它们加到宿主配置里这个服务的环境变量中，比如 JSON 里写
`"env": {"OCU_OVERLAY": "0"}`。全部设置见[配置](configuration.zh-CN.md)。

## 权限

macOS 检查的是启动这个服务的应用，而不是 ocu 本身：

- **命令行 agent**（Claude Code、Codex）：给你的终端应用开辅助功能权限。
- **GUI 应用**（Claude Desktop、Cursor、DeepSeek Harness）：给这个应用开辅助功能权限，然后退出并重新打开它。

辅助功能在 系统设置 > 隐私与安全性 > 辅助功能。`screenshot`、`click_visual` 和 `read_visual`
还需要屏幕录制权限，在同一个地方。在同一个应用里运行 `ocu doctor`，它会告诉你缺什么。

## GUI 应用里的模型 key

`observe`、`act` 和 `screenshot` 不需要 key。`click_visual` 和 `read_visual` 需要视觉模型的 key，
`run_task` 需要规划模型（planner）的 key。这几个工具只在对应的 key 设置好时才出现，
所以调用方不会看到一个注定失败的工具。

从程序坞启动的应用拿不到你的 shell 里设置的变量。服务启动时，如果 `DEEPSEEK_API_KEY` 和
`OCU_API_KEY` 都没设置，它会运行一次你的登录 shell（`$SHELL -i -l -c env`），
借用名字以 `_API_KEY` 或 `_BASE_URL` 结尾、或者以 `OCU_` 开头的变量。这些变量只保存在内存里，
不会写到任何地方。设置 `OCU_SHELL_ENV=0` 可以关掉这个行为，改在服务的 `env` 配置里传 key。

## 工具

服务还会发一份使用说明，讲 observe → act 的循环、什么时候该批量、卡住了怎么办，
这样能力弱一些的模型不用自己摸索。

| 工具 | 需要 | 作用 |
| --- | --- | --- |
| `observe {app?}` | – | 以文字返回一个应用的窗口（见[屏幕](concepts.zh-CN.md#屏幕)）。要传 `app`：最前面的应用通常是调用方自己的终端。这个应用会被记住，供之后的调用使用 |
| `act {action, …, then?}` | – | 执行一个[操作](concepts.zh-CN.md#操作)，或通过 `then` 执行一组[批量操作](concepts.zh-CN.md#批量操作)，返回结果和[变了什么](concepts.zh-CN.md#变化回复) |
| `screenshot` | 屏幕录制 | 被观察窗口的图片，外加一个公式，把图片像素换算成屏幕坐标点，供 `act {action:"click_at"}` 使用。给能看图的调用方用 |
| `click_visual {target}` | 视觉模型 key | 给窗口截图，让视觉模型找到描述的元素并点击它。给不能看图的调用方用 |
| `read_visual {question}` | 视觉模型 key | 就这个窗口向视觉模型提一个问题 |
| `run_task {goal}` | 规划模型 key | 把整个目标交给[内置 agent](agent.zh-CN.md)，它用自己的规划模型和动作缓存。返回一段总结；之后要重新 observe |

`run_task` 和其他工具共用同一个 helper 进程，所以 ref 的编号是统一的。

## 给调用方的建议

下面这些服务的使用说明里都有，这里再列一遍，方便写提示词或自己写客户端的人参考。

- 先调用一次 `observe {app: "…"}`。之后每次 `act` 的回复都会给出新屏幕，很少需要再单独 observe。
- 可预料的步骤（按计算器的数字键、全选再加粗）用 `then` 批量执行。
- 输入框用 `set_value`，命令用 `menu{path}` 或快捷键，长页面用 `find_text` 来读。
- 收到 `did not change` 后换个办法，不要重复同一个操作。
- 收到 `unknown ref` 后，用最新回复里的 ref。
- 元素列表很稀疏时（画布、游戏），先 `screenshot` 再 `click_at`，或者用 `click_visual`。
- 遇到辅助功能权限或屏幕锁定的报错，停下来告诉用户。重试没用。
- 最后在最新回复里确认结果，不要想当然地认为操作成功了。

实测：Claude Code（Sonnet）在计算器里算 789 × 36，用一次批量 `act`，4 轮、19 秒完成。
不用批量，同样的任务要 11 轮、45 秒。
