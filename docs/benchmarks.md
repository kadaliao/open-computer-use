# Benchmarks

**English** · [简体中文](benchmarks.zh-CN.md)

How ocu is measured, and the numbers for each release. The benchmarks drive real apps on
the Mac they run on, so close anything you are working in first.

- [Running them](#running-them)
- [Results: 0.6.0](#results-060)
- [Compared with agent-desktop](#compared-with-agent-desktop)

## Running them

From `core/`:

```sh
bun bench/run.ts                          # built-in agent, all tasks (Jev + planner)
OCU_JEV=0 bun bench/run.ts planner-only   # planner only; the first argument is a label
bun bench/run.ts smoke notes-new calc-add # selected tasks (or "hard" / "easy")
bun bench/perf.ts <label>                 # the helper alone: observe / act / screenshot times
bun bench/mcp-perf.ts <label>             # MCP tool calls as a caller sees them: time and reply size
```

- **Tasks** are in `core/bench/tasks.ts`. Each one puts an app into a known state, runs
  the goal, and checks the outcome against the real screen, the agent's answer, or a
  shell command. A token unique to each run keeps leftovers from earlier runs from
  faking a pass.
- **Results** are saved to `core/bench/results/`, which git ignores. The summary gives
  pass rate, planner calls per task and the time split: observe, model, waits and
  actions.
- **The action cache** is off unless `OCU_CACHE=1`, so the models are measured, not the
  replays.
- `OCU_SETTLE_LOG=1` prints, for every wait for the screen, how long it took and when the
  change first showed. Use it when tuning the waits in `screen.ts`.

When you report numbers, give the machine, the macOS version, the model, and a run of the
previous release on the same machine the same day. Single runs wobble; give the range of
two runs or more.

## Results: 0.6.0

Measured on a Mac mini M2 with macOS 26 and a remote-desktop session adding some load,
so single numbers wobble. Compared with 0.5 (commit `72c21a3`) on the same machine the
same day.

**Helper** (`bench/perf.ts`, p50):

| | 0.5 | 0.6 |
| --- | --- | --- |
| observe Calculator / System Settings / Safari | 43 / 82 / 149 ms | 25 / 59 / 86 ms |
| repeat read while waiting (quiet) | – | 27–60 ms |
| press, one / six in a row | 174 / 1183 ms | 3 / 16 ms |
| key | 112 ms | 1 ms |
| screenshot ready for a model (1280 px) | 266 ms | 117 ms |

**MCP tool calls** as a caller sees them (`bench/mcp-perf.ts`, 12 calls, two runs each):

| | 0.5 | 0.6 |
| --- | --- | --- |
| total | 7.5 s | 3.9–4.5 s |
| one press | 418 ms | 155–182 ms |
| batch of 6 presses | 1684 ms | 143–226 ms |
| settings page change | 1201 ms | 529–627 ms |
| web link, page load | 896 ms (load not seen) | 276–486 ms |
| action with no effect | 330–780 ms | 640–680 ms (watches 600 ms for a late change) |
| characters in the 8 act replies | 6.6k | 4.1–4.3k |

**Built-in agent** (`bench/run.ts`, 22 tasks, DeepSeek `deepseek-chat`, cache off):

| | 0.5 | 0.6 |
| --- | --- | --- |
| passed | 20/22 | 22/22, 22/22 (two runs on the final code; 20–22 in four earlier runs while tuning) |
| seconds per task | 9.8 (6.2 without one 85 s failure) | 3.9, 4.0 |
| planner calls per task | 4.05 | 2.09, 2.23 |
| time split per task (observe / model / waits / actions) | – | 1.1–1.2 / 1.8 / 0.6 / 0.4 s |

Most of the gain is fewer planner round trips (a batch that ends in a locally checked
`done`) and the helper's faster actions. The model is still more than half the time.

**Batching from an MCP caller.** Claude Code (Sonnet) computed 789 × 36 on Calculator in
4 turns and 19 s using a batched `act`. Without batching the same task took 11 turns and
45 s.

## Compared with agent-desktop

On 2026-11-16 the same model drove the same tasks through ocu's MCP server and through
[agent-desktop](https://github.com/vercel-labs/agent-desktop)'s, on one Mac (MacBook Pro,
M1 Max, macOS 26.7, Chinese UI).

**Setup.**

- **Caller.** Claude Code 2.1.325 in headless mode (`claude -p`) with Sonnet 5.5. No
  built-in tools, no user settings, and only one MCP server per run. Tool search was
  off, so all of agent-desktop's tools were loaded directly.
- **ocu.** 0.6.0 with model keys removed, so only `observe`, `act` and `screenshot`.
- **agent-desktop.** 1.3.1 with its defaults: 75 tools, headless.
- **Runs.** Each task first resets its app. The outcome was checked on the real screen,
  or in the answer for Calculator. Each pair ran 2–3 times, with the order alternating.

The reference scripts are in [plans/assets](plans/assets/vs-agent-desktop/).

| Task (medians) | Tool | Passed | Time | Turns | Tool calls | Reply characters | Input tokens | Cost |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Calculator 789 × 36 | ocu | 3/3 | 7.5 s | 3 | 2 | 1.2k | 18k | $0.008 |
| | agent-desktop | 3/3 | 19.2 s | 8 | 7 | 19k | 137k | $0.073 |
| System Settings > About | ocu | 2/2 | 6.3 s | 2 | 1 | 2.2k | 13k | $0.009 |
| | agent-desktop | 2/2 | 19.6 s | 8 | 7 | 29k | 222k | $0.086 |
| Safari: open a page, click its link | ocu | 2/2 | 15.8 s | 5.5 | 4.5 | 12k | 48k | $0.044 |
| | agent-desktop | 2/2 | 40.7 s | 19.5 | 18.5 | 69k | 782k | $0.240 |
| Finder: Applications > Utilities | ocu | 2/2 | 22.6 s | 7.5 | 6.5 | 8k | 64k | $0.044 |
| | agent-desktop | 2/2 | 33.5 s | 12.5 | 11.5 | 73k | 399k | $0.209 |

Over all 9 runs each, ocu took 112 s, 31 tool calls, 49k reply characters, 306k input
tokens and $0.24. agent-desktop took 243 s, 95 tool calls, 403k reply characters, 3,249k
input tokens and $1.35. Costs are API prices.

**Where the gap comes from** (from the call logs):

- **Checking the result.** An ocu `act` reply already shows what changed. After an
  agent-desktop action, the model read again with `snapshot`, `find`, `get` or a
  screenshot.
- **Reply size.** One text line per element, against a JSON tree.
- **Fixed cost per run.** agent-desktop's guide (`skills_get`, about 10k characters) was
  read at the start of every run, and its 75 tool definitions (42k characters) go with
  every request. Without the guide call, the gap is still 2.7× in tool calls and 6× in
  reply characters.
- **A shortcut.** ocu reached System Settings > About in one call with `open_url` and a
  settings link; agent-desktop has no such action and clicked through.

**Where agent-desktop did better.** In Finder's column view it opened folders by
clicking them. ocu's `press` on a file name there did nothing, so the model fell back to
a screenshot and `click_at`. (Since fixed: `press` selects files in every Finder view and
`open` opens them; see [plan 03](plans/03-open-items.md).) agent-desktop also works without taking focus, which this
comparison didn't measure.

**Limits.** Nine runs each, four short tasks, one model, one machine. Three of the tasks
come from ocu's own benchmark, which ocu has been tuned on, and the UI was in Chinese.
Tool search, harder tasks, Electron apps and smaller models were not tested. The
[roadmap](roadmap.md) lists the follow-ups.

