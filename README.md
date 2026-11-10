# open-computer-use

A lightweight macOS computer-use agent that works from the accessibility tree first.

- `mac/`: a Swift helper (`ocu-mac`) that reads the accessibility tree and sends input over stdio JSON.
- `core/`: the TypeScript core. It runs the agent loop and also exposes it as a CLI and an MCP server.

## What the screen looks like
One line per element: `ref Role "label"`, then the element's state and value when it has one:

    app: 文本编辑 | window: 未命名
    e12 CheckBox "粗体" [checked]
    e7 PopUpButton "字样" = "Helvetica"
    e31 TextArea "hello"

- State: `[checked]`, `[mixed]` (checkboxes, checked menu items), `[selected]` (chosen radio button, tab, row, cell), `[disabled]`. `= "..."` is the current value of a titled field, pop-up button or slider.
- A `dialog open: "…"` line under the window means a sheet or alert is up; its controls come first in the list. An act reply says so when a dialog opens or closes, with the full screen, and the built-in agent never finishes on its own check while a new dialog is up.
- Refs are stable: an element keeps its ref for as long as the helper runs, and a ref is never reused for another element. Only elements on the latest screen can be acted on; a ref that is gone answers `unknown ref`. (An app that creates new element objects on every read gets new refs every time; everything still works, replies are just full lists.)

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
- `act {action, ..., then?}`: run one action, or a batch via `then`, and get the result back, so no separate observe is needed. The reply says what changed:
  - `did not change`: the action had no visible effect; the caller's screen and refs still hold.
  - a small change lists only the changed lines, and every other ref stays valid:

        changed: 1 changed. Only these lines changed (+ new, ~ changed, - gone: don't use it); every other ref from your last screen is unchanged and still valid.
        app: 计算器 | window: 计算器
        ~ e3 Text "7"   (was: Text "0")

  - another window, a big change, or every fifth reply after four change-only ones: the full screen.

  Inside a batch, a step that changes the screen is followed by a wait for the screen to settle (runs of keypad presses go straight on), so later keys reach a window that just opened and a ref that went away fails with `unknown ref` instead of hitting something else.
- `screenshot`: image of the window plus the formula to turn image pixels into a `click_at` point. Needs no keys; for callers that can read images.
- The server also sends usage instructions (the observe → act loop, when to batch, what to do when stuck), so weaker models don't have to work it out.

Optional, shown only when their keys are configured:
- `click_visual` / `read_visual`: screenshot fallback through a vision model, for callers that can't read images.
- `run_task {goal}`: hand the whole goal to the built-in agent (uses its own planner key). It runs on the server's helper; observe again afterwards.

Measured: Claude Code (Sonnet) computed 789 × 36 on Calculator in 4 turns, 19 s, using a batched `act`. Without batching the same task took 11 turns and 45 s.

## Built-in agent (`ocu run`)
The planner (DeepSeek by default) sends a batch of steps per turn; each round trip costs about a second, so the loop tries to need few of them:
- After a step that changes the screen, the batch waits for the screen to settle and goes on with steps that need no ref (keys, typing into the focused field, menus, opening apps or URLs, find_text) and with steps whose element is still there unchanged after a small change (select all, then Bold). Anything else ends the batch and the planner looks at the new screen.
- A batch may end with `done` plus `expect`, a text that only appears once the goal is achieved (the new window title, the calculator's result, the start of the typed text). The loop checks for it locally, in the window title or in content that was not on screen before the batch, and finishes without another model call. Numbers and words match as whole tokens ("444" is not in "4,440"). Controls and one-line fields don't count; text the batch typed counts only when typing was its last step and a text area now holds exactly that text (an error message that repeats it is no proof); a window that came up at the end sends the turn to the planner. For questions the expected text must be the answer in the summary, not words of the goal, and a summary may not state numbers or quoted names that are neither in the goal, on the screen nor in earlier reads. When in doubt the planner looks. Without `expect`, `done` needs a look at the screen first.
- Each step logs observe, model, wait and action time; `ocu run` prints the split at the end.

## Action cache
Successful runs are saved as "goal pattern → steps", keyed by the app that was frontmost at the start, in `~/.cache/ocu/actions.json` (`OCU_CACHE_FILE`; `OCU_CACHE=0` disables it).
- Quoted strings and numbers in the goal become parameters, so `算 37 乘以 12` replays for `算 906 乘以 7`. Keypad presses that spell a parameter are re-spelled with the new value.
- Elements are stored by role and label, and resolved to fresh refs on replay.
- After replay the planner checks the screen once. If it has to fix anything, the entry is dropped and the next run records afresh.
- A run whose `done` + `expect` was the goal's own text (a parameter: the note's content, a name) stores that expect: a replay that brings it on screen finishes without any model call. Results, counts or titles read off the old screen are never replayed; the planner checks.
- Runs that read content (find_text / read_visual / note) are not cached, because their results change.
- The benchmark disables the cache unless `OCU_CACHE=1`.

## Config (environment variables)
- `OCU_BASE_URL` / `OCU_MODEL` / `OCU_API_KEY`: any OpenAI-compatible planner. Defaults to DeepSeek `deepseek-chat`.
- `OCU_FAST_URL`: optional fast decision server, such as a Jev adapter. The agent POSTs `{goal, observation}` and expects `{step, confidence}` back. If the reply is missing or below `OCU_FAST_MIN_CONF` (default 0.8), it falls back to the planner.

The terminal or app that runs this needs Accessibility permission.
- `OCU_FAST_MODEL`: a fast model behind an OpenAI-compatible API, such as `jev@latest`. Defaults to aihubmix (`OCU_FAST_BASE_URL`), using `AIHUBMIX_API_KEY`. If it fails, times out, or replies `defer`, the agent hands the step to the planner.
- `TYPESAFE_API_KEY`: when set, the official Jev (`https://api.typesafe.ai/v1/systemone`, model `OCU_JEV_MODEL`, default `jev-latest`) is the first tier. Jev is a classifier, so it only chooses which element to press next. When it answers `other` or its confidence is below the threshold, the step goes to the planner. Set `OCU_JEV=0` to turn it off.
  Jev also judges each turn whether the goal is already achieved; once the planner has answered it gets `OCU_JEV_DONE_WAIT_MS` (default 300) more.
- `OCU_VISION_MAX`: longest side of screenshots sent to vision models (default 1280); the helper scales while capturing.

## Overlay
While it runs, ocu-mac draws an overlay: a virtual cursor that moves along a curve to each target, a click ripple, and an orange glow around the target window and element. The animation runs alongside the action and never holds it up. Set `OCU_OVERLAY=0` to turn it off.

## Benchmark
    cd core && bun bench/run.ts                     # Jev + planner
    OCU_JEV=0 bun bench/run.ts planner-only         # planner only
    bun bench/run.ts smoke notes-new calc-add       # run selected tasks
    bun bench/perf.ts label                         # the helper alone: observe / act / screenshot times
    bun bench/mcp-perf.ts label                     # MCP tool calls as a caller sees them: time and reply size
Results are saved to `core/bench/results/`. Tasks are in `core/bench/tasks.ts`; each one is checked against the real screen afterwards. The summary gives planner calls per task and the time split (observe, model, waits, actions). `OCU_SETTLE_LOG=1` prints, for every wait for the screen, how long it took and when the change first showed.

## Performance (0.6.0)
Measured on a Mac mini M2 (macOS 26, with a remote-desktop session adding some load, so single numbers wobble),
against 0.5 (commit 72c21a3) on the same machine the same day.

Helper (`bench/perf.ts`, p50):

| | 0.5 | 0.6 |
|---|---|---|
| observe Calculator / System Settings / Safari | 43 / 82 / 149 ms | 25 / 59 / 86 ms |
| repeat read while waiting (quiet) | – | 27–60 ms |
| press, one / six in a row | 174 / 1183 ms | 3 / 16 ms |
| key | 112 ms | 1 ms |
| screenshot ready for a model (1280 px) | 266 ms | 117 ms |

MCP tool calls as a caller sees them (`bench/mcp-perf.ts`, 12 calls, two runs each):

| | 0.5 | 0.6 |
|---|---|---|
| total | 7.5 s | 3.9–4.5 s |
| one press | 418 ms | 155–182 ms |
| batch of 6 presses | 1684 ms | 143–226 ms |
| settings page change | 1201 ms | 529–627 ms |
| web link, page load | 896 ms (load not seen) | 276–486 ms |
| action with no effect | 330–780 ms | 640–680 ms (watches 600 ms for a late change) |
| characters in the 8 act replies | 6.6k | 4.1–4.3k |

Built-in agent (`bench/run.ts`, 22 tasks, DeepSeek `deepseek-chat`, cache off):

| | 0.5 | 0.6 |
|---|---|---|
| passed | 20/22 | 22/22, 22/22 (two runs on the final code; 20–22 in four earlier runs while tuning) |
| seconds per task | 9.8 (6.2 without one 85 s failure) | 3.9, 4.0 |
| planner calls per task | 4.05 | 2.09, 2.23 |
| time split per task (observe / model / waits / actions) | – | 1.1–1.2 / 1.8 / 0.6 / 0.4 s |

Most of the gain is fewer planner round trips (a batch that ends in a locally checked `done`) and the helper's
faster actions; the model is still more than half the time.

## Screenshot fallback
When an element is missing from the accessibility tree (Electron, canvas, games), the planner can use:
- `click_visual {target}`: screenshot the window, locate the element with a GUI grounding model, and click it. The user's cursor is put back afterwards.
- `read_visual {question}`: ask a vision model about the window.

Defaults: StepFun `step-gui` for locating (measured error of 0–2 pt on the Calculator buttons) and `step-1o-turbo-vision` for reading, using `STEPFUN_API_KEY`. Override with `OCU_VISION_BASE_URL`, `OCU_VISION_API_KEY`, `OCU_VISION_MODEL` and `OCU_VISION_READ_MODEL`. Locating expects coordinates normalized to 0–1000; set `OCU_VISION_COORDS=pixels` for models that return image pixels. Screen Recording permission is required.

Also verified: `qwen3-vl-plus` via aihubmix (`OCU_VISION_BASE_URL=https://aihubmix.com/v1 OCU_VISION_MODEL=qwen3-vl-plus`), with errors of 0.4–0.5 pt and about 3.3 s per locate. In the same run, step-gui timed out once.
