# AGENTS.md

Notes for coding agents working on this repository. People should start with
[CONTRIBUTING.md](CONTRIBUTING.md); the details live in [docs/](docs/architecture.md).

## Layout

- `mac/Sources/ocu-mac/main.swift`: the Swift helper. It reads the accessibility tree,
  sends input, takes screenshots and draws the overlay, speaking line-delimited JSON
  over stdio.
- `core/src/`: the TypeScript core, run with Bun. `cli.ts` (commands), `mcp.ts` (MCP
  server), `driver.ts` (helper client, refs, rendering), `screen.ts` (settle, change
  replies, batches), `agent.ts` (built-in agent), `policy.ts` (planner prompt, model
  tiers), `cache.ts`, `vision.ts`, `doctor.ts`.
- `core/bench/`: benchmarks against real apps. `scripts/`: release, install, docs check.

## Commands

```sh
(cd mac && swift build -c release)          # build the helper
cd core && bun install
bun test && bun run typecheck               # unit tests and types; no permissions needed
bun src/cli.ts observe <app>                # try the helper on a real app
bun bench/run.ts smoke <task ids>           # agent benchmark; drives real apps
bun ../scripts/check-docs.ts                # doc pairs, links and anchors
```

Benchmarks and `observe` act on the real desktop. Don't run them unless the task calls
for it.

## Rules

- The screen format, the MCP tool descriptions, the server instructions in `mcp.ts` and
  the planner prompt in `policy.ts` are prompts that models depend on. Change them
  deliberately and keep them consistent with each other and with `docs/concepts.md`.
- Don't loosen the agent's local finish check (`confirmed`, `proofOf`, `unseenClaim` in
  `agent.ts`); add tests to `agent.test.ts` for any change to it.
- Never print or log key values. Variable names only.
- Performance claims need numbers from `core/bench/`, before and after.
- Comments explain why, and cite measurements where a number came from one.
- Commits: conventional prefixes with the area as scope, such as `fix(agent):` or
  `perf(helper):`.
- The version lives in `core/package.json` and in the `McpServer` call in
  `core/src/mcp.ts`. Change both.

## Planned work

[docs/roadmap.md](docs/roadmap.md) lists the plans in order. To implement one, follow
[docs/plans/README.md](docs/plans/README.md): read the plan, check it against the code,
measure before and after, and update the plan's status and both roadmap files when done.

## Docs

English is the main language. Every page in `docs/`, plus `README`, `CHANGELOG` and
`CONTRIBUTING`, has a Chinese twin named `*.zh-CN.md`. Update both in the same change,
and add user-visible changes under *Unreleased* / *未发布* in both changelogs.
`SECURITY.md`, `CODE_OF_CONDUCT.md` and the `.github` templates hold both languages in
one file; plans in `docs/plans/` are English only. Run `bun scripts/check-docs.ts` before
finishing.
