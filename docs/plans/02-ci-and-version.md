# 02. CI and a version command

- **Status:** planned
- **Priority:** P0
- **Depends on:** nothing
- **Size:** one session (short)

## Why

- Nothing checks a pull request today. Tests, the typecheck, the docs check and the
  helper build all run only when someone remembers.
- There is no way to ask ocu its version. The bug template has to ask for "the release
  tag", and `ocu doctor` doesn't print one.
- The version is written in two places (`core/package.json` and the `McpServer` call in
  `core/src/mcp.ts`) and can drift.

agent-desktop runs CI on every pull request (unit tests, lint, a release dry run, and
native end-to-end jobs) and has `agent-desktop version`, which prints JSON with the OS,
target and version.

## Current state

- No `.github/workflows/`.
- `core/src/cli.ts` has no `version` or `--version`.
- `scripts/release.sh` takes the version from its argument or `git describe` and doesn't
  check it against `package.json`.

## Plan

1. **`.github/workflows/ci.yml`** on `macos-latest` (Apple silicon), for pull requests
   and pushes to `master`:
   - `oven-sh/setup-bun` with a pinned version;
   - `cd core && bun install --frozen-lockfile && bun test && bun run typecheck`;
   - `bun scripts/check-docs.ts`;
   - `cd mac && swift build -c release`.

   Pin action versions. Keep it under about 5 minutes. No end-to-end job: hosted runners
   can't grant Accessibility. agent-desktop doesn't edit the TCC database either: its
   hosted jobs run unit tests only, and native end-to-end tests run by hand
   (`workflow_dispatch`) on a self-hosted Mac where Accessibility was granted once
   (`.github/workflows/native-e2e.yml`). Plan 04 gives ocu a local end-to-end suite that
   could run the same way later.
2. **One source for the version.** `mcp.ts` reads it from `core/package.json` (a JSON
   import works with `bun build --compile`).
3. **`ocu version` and `ocu --version`** print `ocu <version> (<arch>, helper <path>)`.
   `ocu doctor` prints the same line first.
4. **Release guard.** `scripts/release.sh` fails when its tag isn't `v` plus the
   `package.json` version.
5. Update the docs that ask for a version: the README commands table, troubleshooting
   ("Reporting a bug"), CONTRIBUTING, the bug report template and SECURITY. Use
   `ocu --version` everywhere.

## Done when

- CI runs on a pull request and passes. The badge is optional.
- `ocu --version` works from a release build and from a checkout.
- `release.sh v9.9.9` fails with a clear message when `package.json` says something else.
- Docs in both languages and both changelogs are updated.
