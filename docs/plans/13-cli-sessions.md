# 13. Using ocu from the shell

- **Status:** planned
- **Priority:** P3
- **Depends on:** 09 (error codes make shell use scriptable)
- **Size:** one or two sessions

## Why

Agents without MCP, plus scripts and cron jobs, can only use `ocu observe` and
`ocu run`. They can't act on a ref from the shell, because refs live in the helper
process, and that process ends with each command.

agent-desktop is CLI-first. Every command works from the shell and prints a JSON
envelope. Sessions keep state between commands. A skill teaches agents the loop:
`agent-desktop skills get desktop`, installable with `npx skills add`.

## What agent-desktop does

- **State lives on disk.** Under `~/.agent-desktop/` (`AGENT_DESKTOP_HOME`, mode 700):
  `latest_snapshot_id`, `snapshots/<id>/refmap.json`, and per-session folders under
  `sessions/`.
- **Choosing a session.** `--session` or `AGENT_DESKTOP_SESSION`; `session gc --ended`
  cleans up (`sessions.mdx`).
- **Refs survive between processes.** They are resolved again in each process, through
  private-API element tokens or a recount by role, id and name.

## Plan

1. **A background server instead of on-disk refs.** `ocu serve` keeps one helper alive
   and listens on a Unix socket in `$TMPDIR/ocu-<uid>/` (mode 700). It speaks the same
   tools as MCP. It exits after 10 minutes idle.
2. **CLI commands** that start the server if needed and forward to it:
   - `ocu observe <app>` and `ocu act '<json>'`, with the same text replies as MCP, or
     `--json`;
   - `ocu screenshot <file>`;
   - exit codes follow the error codes from plan 09.
3. **One caller at a time.** The server serializes calls, so two scripts can't interleave
   input.
4. **An agent guide.** `ocu guide` prints the MCP server instructions adapted for the
   shell. Add a Claude Code skill (`skills/ocu/SKILL.md`), plus a short snippet for
   `AGENTS.md` files, in the README.
5. **Docs** in both languages: README commands, a shell section in MCP setup (or its own
   page), and configuration.

## Out of scope

Private AX token APIs, and a JSON envelope format for every reply. Keep the text replies
that make ocu cheap.

## Done when

- From a plain shell, `ocu observe Calculator`, `ocu act` with a run of presses, and
  `ocu observe` again work, with refs stable across the commands.
- An agent with only a shell tool (for example `claude -p --tools Bash`) completes the
  Calculator task from the guide.
