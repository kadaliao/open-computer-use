# 配置

[English](configuration.md) · **简体中文**

ocu 用环境变量配置。`ocu doctor` 会检查哪些 key 能用，并给出一套能用的视觉模型配置。它只打印变量名，从不打印 key 的值。

在 MCP 下，这些变量写在服务的 `env` 配置里，或者让服务从你的登录 shell 借过来（见 [MCP 接入](mcp.zh-CN.md#gui-应用里的模型-key)）。

- [规划模型](#规划模型)
- [Jev 与快速模型](#jev-与快速模型)
- [视觉模型](#视觉模型)
- [动作缓存](#动作缓存)
- [helper 与 MCP 服务](#helper-与-mcp-服务)
- [安装与调试](#安装与调试)

## 规划模型

`ocu run` 和 MCP 的 `run_task` 工具需要它。任何兼容 OpenAI 的聊天 API 都可以。

| 变量 | 默认值 | 含义 |
| --- | --- | --- |
| `OCU_API_KEY` | `DEEPSEEK_API_KEY` | 规划模型的 API key |
| `OCU_BASE_URL` | `https://api.deepseek.com` | 规划模型的 base URL（后面会拼上 `/chat/completions`） |
| `OCU_MODEL` | `deepseek-chat` | 规划模型 |

## Jev 与快速模型

全部可选。它们怎么配合，见[内置 agent](agent.zh-CN.md#模型)。

| 变量 | 默认值 | 含义 |
| --- | --- | --- |
| `TYPESAFE_API_KEY` | – | 打开 Jev，用来做完成判断 |
| `OCU_JEV` | 开 | 设为 `0` 时，即使有 key 也关掉 Jev |
| `OCU_JEV_PRESS` | 关 | 设为 `1` 时，Jev 还会挑要按的元素 |
| `OCU_JEV_MODEL` | `jev-latest` | Jev 模型 |
| `TYPESAFE_BASE_URL` | `https://api.typesafe.ai` | Jev API 地址 |
| `OCU_JEV_DONE_MIN` | `0.9` | 完成判断要有多大把握，才会让规划模型再问一次 |
| `OCU_JEV_DONE_WAIT_MS` | `300` | 规划模型答完之后，完成判断最多还能用多久 |
| `OCU_JEV_SEQ` | `2` | 按键模式下，Jev 一次最多连续挑几个要按的元素 |
| `OCU_PLANNER_GRACE_MS` | `400` | 按键模式下，等规划模型多久，过时就用 Jev 挑的 |
| `OCU_FAST_MIN_CONF` | `0.8` | Jev 挑的按键或快速服务给的步骤，最低置信度 |
| `OCU_FAST_TIMEOUT_MS` | `3000` | Jev 和快速模型请求的超时 |
| `OCU_FAST_MODEL` | – | 一个快速聊天模型（比如 aihubmix 上的 `jev@latest`），给出一步，或者回 `defer` |
| `OCU_FAST_BASE_URL` | `https://aihubmix.com/v1` | `OCU_FAST_MODEL` 的 base URL |
| `OCU_FAST_API_KEY` | `AIHUBMIX_API_KEY` | `OCU_FAST_MODEL` 的 key |
| `OCU_FAST_URL` | – | 你自己的决策服务。ocu POST `{goal, observation}`，期望 1.5 秒内拿到 `{step, confidence}` |

同时设了几种快速方式时，先用 Jev 按键模式，再是 `OCU_FAST_MODEL`，最后是 `OCU_FAST_URL`。

## 视觉模型

截图兜底（`click_visual`、`read_visual`）会用到，内置 agent 和 MCP 服务都一样。需要屏幕录制权限。

| 变量 | 默认值 | 含义 |
| --- | --- | --- |
| `OCU_VISION_API_KEY` | `STEPFUN_API_KEY` | 视觉模型的 API key |
| `OCU_VISION_BASE_URL` | `https://api.stepfun.com/v1` | 视觉模型的 base URL |
| `OCU_VISION_MODEL` | `step-gui` | 定位元素的模型（`click_visual`） |
| `OCU_VISION_READ_MODEL` | `step-1o-turbo-vision` | 回答问题的模型（`read_visual`） |
| `OCU_VISION_COORDS` | 归一化 | 定位时期望 0 到 1000 的坐标。模型返回的是图片像素时，设为 `pixels` |
| `OCU_VISION_MAX` | `1280` | 发给视觉模型的截图最长边。helper 在截图时就缩放好 |

实测过的选择：

- **阶跃 `step-gui`**（默认）：在计算器按钮上误差 0–2 pt。
- **通义 `qwen3-vl-plus`**，经 aihubmix：误差 0.4–0.5 pt，每次定位约 3.3 秒。同一轮测试里 `step-gui` 超时过一次。

  ```sh
  export OCU_VISION_BASE_URL=https://aihubmix.com/v1
  export OCU_VISION_API_KEY=$AIHUBMIX_API_KEY
  export OCU_VISION_MODEL=qwen3-vl-plus
  export OCU_VISION_READ_MODEL=qwen3-vl-plus
  ```

`ocu doctor` 会用你手上有的 key 依次试阶跃、aihubmix 和 DashScope（`DASHSCOPE_API_KEY`），并给第一个能用的打印出 export 命令。

## 动作缓存

| 变量 | 默认值 | 含义 |
| --- | --- | --- |
| `OCU_CACHE` | 开 | 设为 `0` 关掉[动作缓存](agent.zh-CN.md#动作缓存)。跑基准测试时默认关，除非设为 `1` |
| `OCU_CACHE_FILE` | `~/.cache/ocu/actions.json` | 缓存文件的位置 |

## helper 与 MCP 服务

| 变量 | 默认值 | 含义 |
| --- | --- | --- |
| `OCU_OVERLAY` | 开 | 设为 `0` 关掉覆盖层：移动的光标、点击波纹和目标周围的橙色光晕 |
| `OCU_MAC_BIN` | `ocu` 旁边，找不到就用 `mac/.build/release/ocu-mac` | `ocu-mac` helper 的路径 |
| `OCU_CALL_TIMEOUT_MS` | `20000` | 等 helper 回应单个请求的最长时间 |
| `OCU_SHELL_ENV` | 开 | 设为 `0` 时，MCP 服务不再从登录 shell 借 key |

## 安装与调试

| 变量 | 默认值 | 含义 |
| --- | --- | --- |
| `OCU_HOME` | `~/.local/share/ocu` | `install.sh` 把可执行文件放在哪里 |
| `OCU_SETTLE_LOG` | 关 | 设成任意值后，每次等屏幕稳定都会打印用了多久、变化最早什么时候出现 |
