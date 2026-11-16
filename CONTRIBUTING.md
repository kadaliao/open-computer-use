# Contributing to open-computer-use

**English** · [简体中文](CONTRIBUTING.zh-CN.md)

Thanks for helping. ocu drives real apps on people's Macs, so most of this guide is
about checking changes on a real desktop, not only in tests.

- [Ways to help](#ways-to-help)
- [Development setup](#development-setup)
- [Checking a change](#checking-a-change)
- [Conventions](#conventions)
- [Documentation in two languages](#documentation-in-two-languages)
- [Pull requests](#pull-requests)

## Ways to help

- **Report a bug** with the bug report template. Include the ocu version, your macOS
  version, how you ran it (CLI, or MCP and which host), the output of `ocu doctor`, and
  the goal or tool calls. Remove anything private from screen text and screenshots.
- **Report an app that doesn't work well**: what you tried, what the screen looked like
  (`ocu observe <app>`), and what happened.
- **Add a benchmark task** for something ocu should handle (see `core/bench/tasks.ts`).
  A task that fails today is a useful contribution on its own.
- **Fix or improve something.** For anything bigger than a small fix, open an issue
  first so we can agree on the approach. Planned work is on the [roadmap](docs/roadmap.md),
  each item with a plan in `docs/plans/`.
- **Improve the docs, or the Chinese or English wording.**

Security problems go through [SECURITY.md](SECURITY.md), not a public issue.

## Development setup

Requirements: macOS 13 or later, the Xcode command line tools (Swift 5.9 or later), and
[Bun](https://bun.sh).

```sh
git clone https://github.com/kadaliao/open-computer-use.git
cd open-computer-use
(cd mac && swift build -c release)   # the helper: mac/.build/release/ocu-mac
(cd core && bun install)
bun core/src/cli.ts doctor
```

From a checkout, `bun core/src/cli.ts` takes the same commands as `ocu`. Grant
Accessibility to the terminal you develop in. Read [architecture](docs/architecture.md)
before changing the helper, the screen format or the agent loop.

## Checking a change

**Every change:**

```sh
cd core
bun test               # unit tests, a few seconds, no permissions needed
bun run typecheck      # tsc --noEmit
```

**Helper changes:** rebuild with `swift build -c release` in `mac/`, then try the change
on real apps with `bun src/cli.ts observe <app>`.

**Behavior and speed changes** need a benchmark on a real Mac (see
[benchmarks](docs/benchmarks.md)):

```sh
cd core
bun bench/run.ts smoke <task ids>   # the tasks your change affects
bun bench/perf.ts after             # helper timing, if you touched the helper
bun bench/mcp-perf.ts after         # MCP timing and reply size, if you touched replies
```

Run the same commands on `master` first, so you can compare. Put the before and after
numbers in the pull request.

## Conventions

- **Commits** use [conventional commit](https://www.conventionalcommits.org/) prefixes
  with the area as scope: `feat(helper):`, `fix(agent):`, `perf(mcp):`, `docs:`. Areas
  include `helper`, `screen`, `agent`, `policy`, `mcp`, `cache`, `bench`.
- **Comments say why**, especially for waits, thresholds and workarounds for a specific
  app. If a number came from a measurement, say so: "(DeepSeek pressed the wrong key in
  10 of 10 tries)".
- **The screen format and the MCP tool descriptions are an interface.** Models are
  prompted with them. Change them on purpose, update the server instructions, the
  planner prompt and [concepts](docs/concepts.md), and note it under *Changed* in the
  changelog.
- **The local finish check must not get looser.** A change that lets the agent finish
  on weaker proof needs tests in `agent.test.ts` showing what it still rejects.
- **Never print key values**, in `doctor`, logs or errors. Variable names are fine.
- **Don't commit** `core/bench/results/`, `dist/`, or screenshots of your own desktop.

## Documentation in two languages

English is the main language. Every document readers browse comes in two files: English
`name.md` and Chinese `name.zh-CN.md`, each linking to the other at the top. Update both
in the same pull request. If you can only write one language, say so in the pull
request, and a maintainer will add the other before merging.

Files GitHub treats specially (`SECURITY.md`, `CODE_OF_CONDUCT.md`, and the issue and
pull request templates) hold both languages in one file. Plans in `docs/plans/` are
working documents and are written in English only.

Run the docs check before you push. It finds missing translations and broken links or
anchors:

```sh
bun scripts/check-docs.ts
```

## Pull requests

- Keep each pull request to one change.
- Fill in the template: what changed, how you checked it, and the numbers for behavior
  or speed changes.
- Add a line under *Unreleased* in `CHANGELOG.md` and *未发布* in `CHANGELOG.zh-CN.md`
  for anything a user would notice.
- Update the docs that describe what you changed.

Releases are cut by the maintainer; see [releasing](docs/releasing.md).

By taking part you agree to follow the [code of conduct](CODE_OF_CONDUCT.md).
