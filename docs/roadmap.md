# Roadmap

**English** · [简体中文](roadmap.zh-CN.md)

Where ocu is going, and in what order. Each item has a plan in [plans/](plans/README.md),
written so that one session can implement it.

- [Positioning](#positioning)
- [What we keep](#what-we-keep)
- [What we learn from agent-desktop](#what-we-learn-from-agent-desktop)
- [Plans](#plans)

## Positioning

ocu is the macOS operation layer that costs its caller the fewest turns and tokens, plus
a built-in agent that runs on any OpenAI-compatible model.

[agent-desktop](https://github.com/vercel-labs/agent-desktop) is broader: three
platforms, 75 MCP tools, sessions, traces, sandboxes, a C library, and a large team. ocu
doesn't try to match that breadth. In the
[2026-11-16 comparison](benchmarks.md#compared-with-agent-desktop), the same model on
the same tasks needed, with ocu, about half the time, a third of the tool calls and a
tenth of the input tokens. Both passed every run. The plans below keep that lead and
close the gaps the comparison showed.

## What we keep

These hold the design together; plans must not trade them away.

- **One call does and shows.** An `act` reply says what changed, so callers rarely need
  a separate look.
- **A small tool surface.** Three core MCP tools. agent-desktop's 75 tool definitions add
  about 42k characters to every request. New abilities go into existing tools as actions
  or fields.
- **Text a small model can follow.** One line per element, short replies, words that say
  which refs still hold.
- **Measured.** Every change is checked with `core/bench/` and the comparison benchmark
  before and after.

## What we learn from agent-desktop

| Area | What it does | Plan |
| --- | --- | --- |
| Opening items | Click is a chain of fallbacks (AXPress with a selection check, AXOpen, selecting through the container…) | [03](plans/03-open-items.md) |
| Testing | A fixture app whose controls report what happened, for deterministic end-to-end tests | [04](plans/04-fixture-app.md) |
| Electron | Turns on Chromium's accessibility tree (`AXManualAccessibility`); skeleton and drill-down for dense windows | [05](plans/05-electron-and-dense-apps.md) |
| Focus | Works in the background by default; physical input only when allowed, never as a silent fallback | [06](plans/06-background-operation.md) |
| Safety | Never reads password field values; refuses some system processes | [07](plans/07-safety.md) |
| Install | One-line install, builds for both architectures, checksums | [08](plans/08-distribution.md) |
| Results | Per-action delivery (verified, unverified, not delivered), error codes with retry advice | [09](plans/09-delivery-and-errors.md) |
| Surfaces | Context menus, popovers, menu bar extras, window ids | [10](plans/10-surfaces-and-windows.md) |
| Waits | Waits on text, element state or events | [11](plans/11-waits.md) |
| Traces | JSONL traces with redaction | [12](plans/12-traces.md) |
| Shell | Every command works from the shell, with sessions | [13](plans/13-cli-sessions.md) |

What we don't copy:

- the 75-tool surface and the JSON envelope on every reply;
- private-API element tokens: ocu keeps refs alive in one helper process;
- Chrome DevTools access to Electron apps;
- Windows, Linux and the C library.

## Plans

In implementation order.

| # | Plan | Priority | Depends on | Status |
| --- | --- | --- | --- | --- |
| 01 | [Reproducible comparison benchmark](plans/01-vs-benchmark.md) | P0 | – | planned |
| 02 | [CI and a version command](plans/02-ci-and-version.md) | P0 | – | planned |
| 03 | [Opening items in Finder and file views](plans/03-open-items.md) | P0 | (01) | planned |
| 04 | [Fixture app and local end-to-end tests](plans/04-fixture-app.md) | P1 | – | planned |
| 05 | [Electron apps and dense windows](plans/05-electron-and-dense-apps.md) | P1 | (01, 04) | planned |
| 06 | [Working without taking focus](plans/06-background-operation.md) | P1 | 04, 01 | planned |
| 07 | [Password fields and protected apps](plans/07-safety.md) | P1 | 04 | planned |
| 08 | [Homebrew and Intel builds](plans/08-distribution.md) | P1 | 02 | planned |
| 09 | [Per-action results and error codes](plans/09-delivery-and-errors.md) | P2 | 04, 03 | planned |
| 10 | [Context menus, popovers, menu bar extras, windows](plans/10-surfaces-and-windows.md) | P2 | 04 | planned |
| 11 | [Waiting for a condition](plans/11-waits.md) | P2 | – | planned |
| 12 | [Trace recording](plans/12-traces.md) | P2 | 07 | planned |
| 13 | [Using ocu from the shell](plans/13-cli-sessions.md) | P3 | 09 | planned |

Dependencies in parentheses help but aren't required. [plans/README.md](plans/README.md)
describes how to pick up a plan and what to update when it is done.
