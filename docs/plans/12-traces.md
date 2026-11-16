# 12. Trace recording

- **Status:** planned
- **Priority:** P2
- **Depends on:** 07 (redaction helper)
- **Size:** one session

## Why

When something goes wrong in a user's MCP session, all a bug report has is what the user
remembers and pastes. There is no record of the calls, the replies, the timings or what
the helper saw. Benchmark debugging has the same gap: `bench/run.ts` keeps a step log,
but MCP sessions keep nothing.

## What agent-desktop does

- **Where traces live.** `--trace` writes one JSONL segment per process under the
  session's `trace/` folder in `~/.agent-desktop/` (`guides/traces.mdx`,
  `sessions.mdx`).
- **Events:** `trace.meta`, `command.start/end`, `snapshot.saved`, `ref.resolve.*`,
  `actionability.check.*` and `action.artifacts`.
- **Redaction.** Text, values, names, titles, URLs, labels, descriptions and passwords
  are replaced with `{"redacted":true}`. Screenshots and exported HTML are not
  redacted, and the docs say so.
- **Export.** `trace export` writes a self-contained HTML viewer. `--screenshots` adds
  before and after images. There are limits: 32 MiB, 100k events, 4,096 directory
  entries.

## Plan

1. **Turning it on.** `OCU_TRACE=<dir>` (or `OCU_TRACE=1` for `~/.cache/ocu/traces/`)
   makes the MCP server and `ocu run` append one JSONL file per process, named
   `<start time>-<pid>.jsonl`. Each line is one event:
   - `meta`: version, macOS version, architecture, and the settings in effect (variable
     names only, never key values);
   - `call`: the MCP tool or agent step, its arguments, the reply size and kind (`same`,
     `diff` or `full`), and the time;
   - `helper`: each helper request and reply, with timing;
   - `settle`: what `OCU_SETTLE_LOG` prints today.
2. **Redaction by default.** Element labels, values, typed text and window titles are
   replaced with a short hash, so two lines can still be matched. Use the helper from
   plan 07. `OCU_TRACE_REDACT=0` keeps everything, for local debugging only. No
   screenshots in traces.
3. **Reading them.** `ocu trace [file]` prints a summary: calls, time per tool, replies
   by kind, errors by code, and the slowest settles. Skip an HTML viewer for now.
4. **Size cap:** stop writing at 20 MB per file, and say so in the last line.
5. **Bug report template:** ask for a redacted trace when the problem is reproducible.

## Done when

- A trace from a short MCP session shows every call, and no label, value or title text
  appears in it unless `OCU_TRACE_REDACT=0` is set.
- `ocu trace` summarizes it.
- Configuration, troubleshooting and the bug template are updated, in both languages.
