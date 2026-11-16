# vs-agent-desktop reference scripts

The scripts behind [Compared with agent-desktop](../../../benchmarks.md#compared-with-agent-desktop)
(2026-11-16). They are kept as they ran, with paths turned into variables. [Plan 01](../../01-vs-benchmark.md)
turns them into a maintained benchmark under `core/bench/vs/`.

- `listtools.ts <command> [args…]`: connects to an MCP server and prints its tool count and the size of its
  instructions and tool schemas.
- `run.ts <runs> [taskId…]`: runs each task through headless Claude Code with one MCP server at a time and
  checks the outcome. Needs `claude` logged in, ocu installed in `~/.local/share/ocu`, and `AD_BIN` pointing at
  the agent-desktop binary (`npm install agent-desktop` in a scratch folder, then
  `node_modules/agent-desktop/bin/agent-desktop`). It drives the real desktop.
- `summary.ts`: medians per task and tool, totals, failures.

```sh
export OCU_VS_DIR=/tmp/ocu-vs AD_BIN=/tmp/ad/node_modules/agent-desktop/bin/agent-desktop
bun run.ts 2            # 4 tasks x 2 tools x 2 rounds, about 15 minutes
bun summary.ts
```
