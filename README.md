# open-computer-use

A lightweight macOS computer-use agent that works from the accessibility tree first.

- `mac/`: a Swift helper (`ocu-mac`) that reads the accessibility tree and sends input over stdio JSON.
- `core/`: the TypeScript core. It runs the agent loop and also exposes it as a CLI and an MCP server.

## Build
    cd mac && swift build -c release
    cd ../core && bun install

## Use
    bun src/cli.ts observe
    DEEPSEEK_API_KEY=... bun src/cli.ts run "新建一条备忘录写 hello"
    bun src/mcp.ts      # register as an MCP server (stdio)

## Config (environment variables)
- `OCU_BASE_URL` / `OCU_MODEL` / `OCU_API_KEY`: any OpenAI-compatible planner. Defaults to DeepSeek `deepseek-chat`.
- `OCU_FAST_URL`: optional fast decision server, such as a Jev adapter. The agent POSTs `{goal, observation}` and expects `{step, confidence}` back. If the reply is missing or below `OCU_FAST_MIN_CONF` (default 0.8), it falls back to the planner.

The terminal or app that runs this needs Accessibility permission.
- `OCU_FAST_MODEL`: a fast model behind an OpenAI-compatible API, such as `jev@latest`. Defaults to aihubmix (`OCU_FAST_BASE_URL`), using `AIHUBMIX_API_KEY`. If it fails, times out, or replies `defer`, the agent hands the step to the planner.
- `TYPESAFE_API_KEY`: when set, the official Jev (`https://api.typesafe.ai/v1/systemone`, model `OCU_JEV_MODEL`, default `jev-latest`) is the first tier. Jev is a classifier, so it only chooses which element to press next. When it answers `other` or its confidence is below the threshold, the step goes to the planner. Set `OCU_JEV=0` to turn it off.

## Overlay
While it runs, ocu-mac draws an overlay: a virtual cursor that moves along a curve to each target, a click ripple, and an orange glow around the target window and element. Set `OCU_OVERLAY=0` to turn it off.

## Benchmark
    cd core && bun bench/run.ts                     # Jev + planner
    OCU_JEV=0 bun bench/run.ts planner-only         # planner only
    bun bench/run.ts smoke notes-new calc-add       # run selected tasks
Results are saved to `core/bench/results/`. Tasks are in `core/bench/tasks.ts`; each one is checked against the real screen afterwards.
