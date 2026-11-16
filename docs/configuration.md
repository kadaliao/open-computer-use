# Configuration

**English** · [简体中文](configuration.zh-CN.md)

ocu is configured with environment variables. `ocu doctor` checks which keys answer and
suggests a working vision setup. It prints variable names, never key values.

Under MCP, set these in the server's `env` config, or let the server borrow them from
your login shell (see [MCP setup](mcp.md#model-keys-under-gui-apps)).

- [Planner](#planner)
- [Jev and fast models](#jev-and-fast-models)
- [Vision models](#vision-models)
- [Action cache](#action-cache)
- [Helper and MCP server](#helper-and-mcp-server)
- [Install and debugging](#install-and-debugging)

## Planner

Needed for `ocu run` and the MCP `run_task` tool. Any OpenAI-compatible chat API works.

| Variable | Default | Meaning |
| --- | --- | --- |
| `OCU_API_KEY` | `DEEPSEEK_API_KEY` | Planner API key |
| `OCU_BASE_URL` | `https://api.deepseek.com` | Planner base URL (`/chat/completions` is appended) |
| `OCU_MODEL` | `deepseek-chat` | Planner model |

## Jev and fast models

All optional. See [built-in agent](agent.md#models) for how they work together.

| Variable | Default | Meaning |
| --- | --- | --- |
| `TYPESAFE_API_KEY` | – | Turns on Jev as the done judge |
| `OCU_JEV` | on | `0` turns Jev off even when the key is set |
| `OCU_JEV_PRESS` | off | `1` also lets Jev pick presses |
| `OCU_JEV_MODEL` | `jev-latest` | Jev model |
| `TYPESAFE_BASE_URL` | `https://api.typesafe.ai` | Jev API base |
| `OCU_JEV_DONE_MIN` | `0.9` | How sure the done judge must be before the planner is asked again |
| `OCU_JEV_DONE_WAIT_MS` | `300` | How long the done judge may take after the planner has answered |
| `OCU_JEV_SEQ` | `2` | How many presses in a row Jev may pick in press mode |
| `OCU_PLANNER_GRACE_MS` | `400` | In press mode, how long to wait for the planner before taking Jev's presses |
| `OCU_FAST_MIN_CONF` | `0.8` | Minimum confidence for a Jev press or a fast-server step |
| `OCU_FAST_TIMEOUT_MS` | `3000` | Timeout for Jev and fast-model requests |
| `OCU_FAST_MODEL` | – | A fast chat model (for example `jev@latest` on aihubmix) that proposes one step, or replies `defer` |
| `OCU_FAST_BASE_URL` | `https://aihubmix.com/v1` | Base URL for `OCU_FAST_MODEL` |
| `OCU_FAST_API_KEY` | `AIHUBMIX_API_KEY` | Key for `OCU_FAST_MODEL` |
| `OCU_FAST_URL` | – | Your own decision server. ocu POSTs `{goal, observation}` and expects `{step, confidence}` within 1.5 s |

When more than one fast option is set, Jev press mode comes first, then `OCU_FAST_MODEL`,
then `OCU_FAST_URL`.

## Vision models

Used by the screenshot fallback (`click_visual`, `read_visual`) in both the agent and the
MCP server. Needs Screen Recording permission.

| Variable | Default | Meaning |
| --- | --- | --- |
| `OCU_VISION_API_KEY` | `STEPFUN_API_KEY` | Vision API key |
| `OCU_VISION_BASE_URL` | `https://api.stepfun.com/v1` | Vision base URL |
| `OCU_VISION_MODEL` | `step-gui` | Model that locates elements (`click_visual`) |
| `OCU_VISION_READ_MODEL` | `step-1o-turbo-vision` | Model that answers questions (`read_visual`) |
| `OCU_VISION_COORDS` | normalized | Locating expects coordinates from 0 to 1000. Set `pixels` for models that return image pixels |
| `OCU_VISION_MAX` | `1280` | Longest side of screenshots sent to vision models. The helper scales while capturing |

Measured choices:

- **StepFun `step-gui`** (default): 0–2 pt error on Calculator's buttons.
- **Qwen `qwen3-vl-plus`** through aihubmix: 0.4–0.5 pt error, about 3.3 s per locate.
  In the same run, `step-gui` timed out once.

  ```sh
  export OCU_VISION_BASE_URL=https://aihubmix.com/v1
  export OCU_VISION_API_KEY=$AIHUBMIX_API_KEY
  export OCU_VISION_MODEL=qwen3-vl-plus
  export OCU_VISION_READ_MODEL=qwen3-vl-plus
  ```

`ocu doctor` tries StepFun, aihubmix and DashScope (`DASHSCOPE_API_KEY`) with whichever
keys you have, and prints the exports for the first one that answers.

## Action cache

| Variable | Default | Meaning |
| --- | --- | --- |
| `OCU_CACHE` | on | `0` turns the [action cache](agent.md#action-cache) off. The benchmark turns it off unless this is `1` |
| `OCU_CACHE_FILE` | `~/.cache/ocu/actions.json` | Where the cache is kept |

## Helper and MCP server

| Variable | Default | Meaning |
| --- | --- | --- |
| `OCU_OVERLAY` | on | `0` turns off the overlay: the moving cursor, click ripple and orange glow around the target |
| `OCU_MAC_BIN` | next to `ocu`, else `mac/.build/release/ocu-mac` | Path to the `ocu-mac` helper |
| `OCU_CALL_TIMEOUT_MS` | `20000` | How long to wait for the helper to answer one request |
| `OCU_SHELL_ENV` | on | `0` stops the MCP server from borrowing keys from your login shell |

## Install and debugging

| Variable | Default | Meaning |
| --- | --- | --- |
| `OCU_HOME` | `~/.local/share/ocu` | Where `install.sh` puts the binaries |
| `OCU_SETTLE_LOG` | off | Any value prints, for every wait for the screen, how long it took and when the change first showed |
