# Changelog

**English** · [简体中文](CHANGELOG.zh-CN.md)

All notable changes to open-computer-use. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[semantic versioning](https://semver.org/). Before 1.0, a minor version may change the
screen format or tool behavior; such changes are listed under **Changed**.

## [Unreleased]

### Fixed

- The helper no longer crashes when an element reports a frame with NaN or infinite
  numbers (seen in System Settings during a page change).
- The built-in agent no longer accepts `done` after the first of two steps when the
  goal names the second without quotes (for example a folder called `inner-x1`).
- A planner that copies the wrong ref no longer presses the wrong element: `press` and
  `open` steps now name the element's label, and the built-in agent checks it against
  the ref. With one element of that label, that element is used; otherwise the step is
  refused and the planner looks again.
- A planner that keeps sending an action that does nothing is told so more bluntly, and
  the task stops after four such turns instead of running to the step limit.
- In an open or save panel the planner goes to a folder by its path (`cmd+shift+g`)
  instead of clicking through the sidebar: 2 planner calls, where it took 10 to 15.

### Changed

- `docs/benchmarks.md` keeps only the comparison with agent-desktop, now a chart that
  the README also shows, and how to run the benchmarks.
- The benchmark closes the Safari tabs it opens, waits for a page that is still
  loading before it checks the outcome, and cleans up on an English system too.

## [0.7.1] - 2026-11-16

A fix for `open`, a Homebrew formula, and the comparison with agent-desktop run again:
with the same model on the same four tasks, ocu took 84 s, 29 tool calls and 270k input
tokens, agent-desktop 173 s, 73 calls and 2,145k tokens. See
[benchmarks](docs/benchmarks.md#compared-with-agent-desktop).

### Added

- `brew install kadaliao/tap/ocu` (Apple silicon).
- The comparison with agent-desktop, run again with 0.7.0, in `docs/benchmarks.md` and
  the README. In the Finder task ocu went from 22.6 s and 6.5 tool calls with a
  screenshot to 9.4 s and 3 calls with none.

### Fixed

- `open` on a row that has no open action of its own (a process in Activity Monitor)
  double-clicks it. It used to send cmd+down, which only file lists understand.

## [0.7.0] - 2026-11-16

Files in Finder can be selected and opened from every view, and the project gets its
documentation in English and Chinese. On five file-view tasks the built-in agent went
from 3 of 5 passed, 12.0 s and 10.4 planner calls a task to 5 of 5, 3.6 s and 2.8 calls.

### Added

- `open{ref}` action: a double click on a file, folder or row. It opens the file or goes
  into the folder, in Finder's four views and in open and save panels.
- Files in Finder's column, icon and gallery views are listed as `Cell "name"`. Before,
  column view listed them as text fields and the other two didn't list them.
- MIT license.
- Documentation in English and Chinese: a shorter README, and pages for concepts, MCP
  setup, the built-in agent, configuration, troubleshooting, architecture, benchmarks and
  releasing under `docs/`.
- Contributing guide, security policy, code of conduct, issue and pull request templates,
  and `AGENTS.md` for coding agents.
- A comparison with agent-desktop in `docs/benchmarks.md`, and a roadmap with one plan
  per piece of work in `docs/plans/`.
- `scripts/check-docs.ts`, which checks that every document has its Chinese counterpart
  and that relative links and anchors resolve.

### Changed

- `press` on a file in Finder's column, icon and gallery views selects it, as it already
  did in list view, and `extend` works there too. It used to report success and do
  nothing.
- `press` on a row or file that can't be selected falls back to a real click.
- Release archives also contain `README.zh-CN.md` and `LICENSE`.

## [0.6.0] - 2026-11-10

A speed release. The built-in agent passes 22/22 benchmark tasks at about 4 s and 2
planner calls each, against 20/22 at 9.8 s and 4 calls for 0.5.0. See
[benchmarks](docs/benchmarks.md).

### Added

- Elements carry their state (`[checked]`, `[mixed]`, `[selected]`, `[disabled]`) and
  value (`= "…"`), so callers no longer need a screenshot to read a checkbox.
- Observations report an open dialog or sheet and list its controls first. An `act`
  reply says when a dialog opens or closes.
- After a small change, an MCP `act` reply lists only what changed (`+` new, `~` changed,
  `-` gone).
- The built-in agent can finish with `done` + `expect`, checked on the screen without
  another planner call.
- Finder's Go menu opens standard folders in one step.
- `bench/perf.ts` and `bench/mcp-perf.ts` measure the helper and the MCP server without a
  model; the agent benchmark reports planner calls and time per phase.

### Changed

- Refs are stable: an element keeps its ref across observes, and a ref is never reused.
  A ref that is gone answers `unknown ref`.
- Refs start at `e101` and no longer reset on every reply. MCP callers may get change
  lists instead of the full screen; the server instructions describe both.
- The agent's batches continue past a screen change when the next steps don't depend on
  the new screen.

### Performance

- One accessibility round trip per element; the overlay no longer delays actions; fixed
  sleeps became checks. A press takes 3 ms instead of 174 ms.
- Screenshots are captured and scaled in process (no `screencapture` or `sips`).
- One shared wait for the screen to settle, with quiet re-reads.
- The Jev done check no longer adds seconds after the planner has answered.

### Fixed

- `type` without a ref inserts through accessibility into the focused native field, and
  waits for a field to take focus. Naming a new Finder folder right after cmd+shift+n
  now works.
- `open_app` and `open_url` return once the opened app is really in front, so later
  keystrokes in the batch reach it.
- Every action is refused while the screen is locked. Keystrokes used to reach the login
  field.
- A slider that moves by itself no longer keeps the screen from settling.
- `tab` after a screen change waits for a look at the new screen.

### Known limits

- Items in Finder's column and icon views can't be opened with `press`; use the Go menu
  or `open_url`.
- Web clicks in Electron apps that expose no page content are unverified.

## [0.5.0] - 2026-11-03

### Added

- MCP server instructions that explain the observe → act loop.
- `act` replies summarize what changed.
- A `screenshot` tool that needs no model key. Optional tools are hidden until their keys
  are configured.
- Observations list the app's other open windows.

### Changed

- Smaller screens and shorter waits for the screen to settle.

### Fixed

- The MCP server waits longer before reporting `did not change`, because page loads
  start late.
- The observed window is brought to the front.
- Electron apps launched from Electron hosts no longer quit on start.

## [0.4.3] - 2026-11-03

### Fixed

- Elements in web content (Electron apps, browsers) get real clicks, because those apps
  ignore the accessibility press.
- MCP callers are told when an action changed nothing.

## [0.4.2] - 2026-11-03

### Fixed

- A missing Accessibility permission is reported as such, and macOS is asked to prompt
  for it.
- Under GUI hosts, the MCP server borrows model keys from the login shell.
- Requests to the helper time out instead of hanging.
- The installer signs the installed binaries again.

## [0.4.0] - 2026-11-02

### Added

- A standalone release build (single binary plus helper, no Bun needed) and an
  installer.
- Setup for DeepSeek Harness as an MCP host.

## [0.3.0] - 2026-11-02

### Added

- MCP: target an app by name, and batch several actions in one `act`.
- `ocu doctor`.
- An action cache with parameters taken from the goal.

### Fixed

- Long lists are capped to the visible rows.
- A hint for Safari's Reader mode.

## [0.2.0] - 2026-11-02

### Added

- Screenshot fallback with a vision model: `click_visual` and `read_visual`.
- `note` and `find_text` actions.
- A guard against alternating between the same two actions.
- Harder benchmark tasks.

## [0.1.0] - 2026-11-02

First release: an accessibility-first computer-use agent for macOS, with a Swift helper,
a TypeScript core, a CLI and an MCP server.

[Unreleased]: https://github.com/kadaliao/open-computer-use/compare/v0.7.1...HEAD
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
