# 01. A reproducible comparison benchmark

- **Status:** planned
- **Priority:** P0. Every later plan is judged by it.
- **Depends on:** nothing
- **Size:** one session

## Why

The claim that sets ocu apart is cost to the caller: fewer turns, tool calls and tokens
than agent-desktop for the same task ([benchmarks](../benchmarks.md#compared-with-agent-desktop)).
That claim needs to be re-checked after every change, by anyone, with one command. The
2026-11-16 run also had gaps:

- Finder windows left by earlier runs stayed open, so a model could have passed by
  bringing an old "Utilities" window forward. The logs show neither tool did, but the
  check didn't rule it out.
- Three of the four tasks come from ocu's own benchmark (home field).
- One model, tool search off, and nothing measured focus or pointer disturbance.

## Current state

The scripts that ran are in [assets/vs-agent-desktop](assets/vs-agent-desktop/):
`run.ts` (runner), `summary.ts` and `listtools.ts`. The method is described in the
comparison section of `docs/benchmarks.md`.

## Plan

1. Move the scripts to `core/bench/vs/` and make the paths relative to the repo. Write
   results to `core/bench/results/vs-<label>.jsonl` (already ignored by git). Keep the
   per-run stream-json logs next to them.
2. **Clean state per task.** Close the windows a task can leave behind before setup
   (Finder: `key cmd+option+w` through the helper; Safari: close the front window's
   extra tabs; Calculator: quit). Make each check fail on leftovers, for example by
   checking that the window which passes was created during the run.
3. **More and fairer tasks.** Keep the four, and add held-out tasks that ocu was not
   tuned on:
   - a dialog (TextEdit: new document, type, close, choose "Don't Save");
   - a long list (System Settings: find a pane that needs scrolling);
   - two apps (copy a value from Safari into a new note);
   - a toggle (turn a setting on, then back off);
   - an Electron app, if one is installed (skip the task when it isn't).
4. **Variants.**
   - Caller model: `sonnet` and `haiku`, since smaller models are where the reply format
     should matter most.
   - Tool search: off, and on (Claude Code's default).
   - A label flag so runs can be compared over time.
5. **Disturbance.** Before and after each run, record the frontmost app and the pointer
   position. Report how often each tool left the user's app behind or moved the pointer.
   Plan 04 is measured with this.
6. **Privacy.** Committed results and docs carry only numbers and task ids, never
   answers or screen text: these contain the tester's files, device names and hardware.
7. `summary.ts` prints the Markdown table used in `docs/benchmarks.md`, grouped by
   variant.

## Out of scope

Other competitors, and a hosted leaderboard.

## Done when

- `cd core && bun bench/vs/run.ts <rounds> [tasks…]` runs the comparison, and
  `bun bench/vs/summary.ts` prints the tables. Usage is documented in
  `docs/benchmarks.md` and `docs/benchmarks.zh-CN.md`.
- A fresh run with Sonnet and Haiku, tool search on and off, replaces the 2026-11-16
  section, with the date, versions, machine and limits stated.
- No answers, screen text or local paths in committed files.
- The `assets/vs-agent-desktop/` copy is deleted, and the plan's status and the
  [roadmap](../roadmap.md) are updated.

## Notes

- It costs real money: the 2026-11-16 run was about $1.6 at API prices for 18 runs.
  Print an estimate before starting many rounds.
- Runs drive the real desktop for many minutes. Warn at the start, and keep the order of
  tools alternating between rounds.
- `claude -p` flags that worked: `--tools ""`, `--strict-mcp-config --mcp-config <file>`,
  `--allowedTools mcp__<server>`, `--setting-sources ""`, `--no-session-persistence`,
  `--output-format stream-json --verbose`, and `ENABLE_TOOL_SEARCH=false` in the
  environment for "tool search off". `--bare` needs an API key and does not work with
  a subscription login.
- The ocu server ran with `DEEPSEEK_API_KEY=""`, `OCU_API_KEY=""`, `STEPFUN_API_KEY=""`,
  `OCU_VISION_API_KEY=""` and `OCU_SHELL_ENV=0`, so `run_task` and the vision tools stay
  hidden. Keep it that way: the comparison is operation layer against operation layer.
