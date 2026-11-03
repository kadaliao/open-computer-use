# open-computer-use

A lightweight macOS computer-use agent that works from the accessibility tree first.

- `mac/`: a Swift helper (`ocu-mac`) that reads the accessibility tree and sends input over stdio JSON.
- `core/`: the TypeScript core. It runs the agent loop and also exposes it as a CLI and an MCP server.

## Build
    cd mac && swift build -c release
    cd ../core && bun install

## Use
    bun src/cli.ts doctor                  # check permissions and which model keys work
    bun src/cli.ts observe [app]
    DEEPSEEK_API_KEY=... bun src/cli.ts run "新建一条备忘录写 hello" [--no-cache]
    bun src/cli.ts cache [clear]           # list / clear the action cache

## Install a release
    ./scripts/release.sh v0.4.0               # -> dist/ocu-v0.4.0-macos-arm64.tar.gz (single binary + helper, no bun needed)
    tar xzf ocu-*.tar.gz && sh ocu-*/install.sh   # -> ~/.local/share/ocu, ~/.local/bin/ocu

### DeepSeek Harness
Add this to `~/.dsh/cordis.patch.yml` under `insert:`, then restart the app:

    - id: ocu-mcp
      name: "@deepseek-ai/dsh-mcp-client"
      config:
        serverName: ocu
        transport: stdio
        command: /Users/<you>/.local/share/ocu/ocu
        args: [mcp]

Grant **DeepSeek Harness** Accessibility permission (System Settings > Privacy & Security > Accessibility). macOS checks the app that launches the helper, not the terminal. GUI apps don't inherit your shell variables, so `click_visual`/`read_visual`/`run_task`, which need model keys, only appear if the keys are passed in the server's `env` config. `observe`/`act` need no keys.

## Use from another agent (MCP)
The tool brings no model of its own. Under MCP, the calling agent (Claude Code, Codex, Cursor...) does the thinking and these tools give it a fast, exact view of the UI:

    claude mcp add ocu -- bun /path/to/open-computer-use/core/src/mcp.ts

- `observe {app?}`: elements of an app's window. Pass `app` (e.g. "Calculator"; localized names and bundle ids also work), because the caller's own terminal is usually frontmost.
- `act {action, ..., then?}`: run one action, or a batch via `then`, and get the updated screen back, so no separate observe is needed. The reply starts with what changed (new elements, or "did not change" when the action had no effect).
- `screenshot`: image of the window plus the formula to turn image pixels into a `click_at` point. Needs no keys; for callers that can read images.
- The server also sends usage instructions (the observe → act loop, when to batch, what to do when stuck), so weaker models don't have to work it out.

Optional, shown only when their keys are configured:
- `click_visual` / `read_visual`: screenshot fallback through a vision model, for callers that can't read images.
- `run_task {goal}`: hand the whole goal to the built-in agent (uses its own planner key).

Measured: Claude Code (Sonnet) computed 789 × 36 on Calculator in 4 turns, 19 s, using a batched `act`. Without batching the same task took 11 turns and 45 s.

## Action cache
Successful runs are saved as "goal pattern → steps", keyed by the app that was frontmost at the start, in `~/.cache/ocu/actions.json` (`OCU_CACHE_FILE`; `OCU_CACHE=0` disables it).
- Quoted strings and numbers in the goal become parameters, so `算 37 乘以 12` replays for `算 906 乘以 7`. Keypad presses that spell a parameter are re-spelled with the new value.
- Elements are stored by role and label, and resolved to fresh refs on replay.
- After replay the planner checks the screen once. If it has to fix anything, the entry is dropped and the next run records afresh.
- Runs that read content (find_text / read_visual / note) are not cached, because their results change.
- The benchmark disables the cache unless `OCU_CACHE=1`.

## Config (environment variables)
- `OCU_BASE_URL` / `OCU_MODEL` / `OCU_API_KEY`: any OpenAI-compatible planner. Defaults to DeepSeek `deepseek-chat`.
- `OCU_FAST_URL`: optional fast decision server, such as a Jev adapter. The agent POSTs `{goal, observation}` and expects `{step, confidence}` back. If the reply is missing or below `OCU_FAST_MIN_CONF` (default 0.8), it falls back to the planner.

The terminal or app that runs this needs Accessibility permission.
- `OCU_FAST_MODEL`: a fast model behind an OpenAI-compatible API, such as `jev@latest`. Defaults to aihubmix (`OCU_FAST_BASE_URL`), using `AIHUBMIX_API_KEY`. If it fails, times out, or replies `defer`, the agent hands the step to the planner.
- `TYPESAFE_API_KEY`: when set, the official Jev (`https://api.typesafe.ai/v1/systemone`, model `OCU_JEV_MODEL`, default `jev-latest`) is the first tier. Jev is a classifier, so it only chooses which element to press next. When it answers `other` or its confidence is below the threshold, the step goes to the planner. Set `OCU_JEV=0` to turn it off.

## Overlay
While it runs, ocu-mac draws an overlay: a virtual cursor that moves along a curve to each target, a click ripple, and an orange glow around the target window and element. Set `OCU_OVERLAY=0` to turn it off.

## Benchmark
    cd core && bun bench/run.ts                     # Jev + planner
    OCU_JEV=0 bun bench/run.ts planner-only         # planner only
    bun bench/run.ts smoke notes-new calc-add       # run selected tasks
Results are saved to `core/bench/results/`. Tasks are in `core/bench/tasks.ts`; each one is checked against the real screen afterwards.

## Screenshot fallback
When an element is missing from the accessibility tree (Electron, canvas, games), the planner can use:
- `click_visual {target}`: screenshot the window, locate the element with a GUI grounding model, and click it. The user's cursor is put back afterwards.
- `read_visual {question}`: ask a vision model about the window.

Defaults: StepFun `step-gui` for locating (measured error of 0–2 pt on the Calculator buttons) and `step-1o-turbo-vision` for reading, using `STEPFUN_API_KEY`. Override with `OCU_VISION_BASE_URL`, `OCU_VISION_API_KEY`, `OCU_VISION_MODEL` and `OCU_VISION_READ_MODEL`. Locating expects coordinates normalized to 0–1000; set `OCU_VISION_COORDS=pixels` for models that return image pixels. Screen Recording permission is required.

Also verified: `qwen3-vl-plus` via aihubmix (`OCU_VISION_BASE_URL=https://aihubmix.com/v1 OCU_VISION_MODEL=qwen3-vl-plus`), with errors of 0.4–0.5 pt and about 3.3 s per locate. In the same run, step-gui timed out once.
