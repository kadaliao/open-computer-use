# MCP setup

**English** · [简体中文](mcp.zh-CN.md)

`ocu mcp` runs an MCP server over stdio. The agent that calls it (Claude Code, Codex,
Cursor, Claude Desktop, DeepSeek Harness…) does the thinking; ocu gives it a fast, exact
view of a Mac app and a way to act on it. The core tools need no model key.

- [Connect your agent](#connect-your-agent)
- [Permissions](#permissions)
- [Model keys under GUI apps](#model-keys-under-gui-apps)
- [Tools](#tools)
- [Tips for callers](#tips-for-callers)

## Connect your agent

The examples use the release install path, `~/.local/share/ocu/ocu`. JSON and TOML
configs need the full path, so replace `/Users/you` with your home folder. To run a
source checkout instead, use `bun` as the command and `/path/to/open-computer-use/core/src/mcp.ts`
as the only argument.

**Claude Code**

```sh
claude mcp add ocu -- ~/.local/share/ocu/ocu mcp
```

**Codex** (`~/.codex/config.toml`)

```toml
[mcp_servers.ocu]
command = "/Users/you/.local/share/ocu/ocu"
args = ["mcp"]
```

**Cursor, Claude Desktop and other JSON configs** (`~/.cursor/mcp.json`,
`~/Library/Application Support/Claude/claude_desktop_config.json`, …)

```json
{
  "mcpServers": {
    "ocu": {
      "command": "/Users/you/.local/share/ocu/ocu",
      "args": ["mcp"]
    }
  }
}
```

**DeepSeek Harness.** Add this to `~/.dsh/cordis.patch.yml` under `insert:`, then
restart the app:

```yaml
- id: ocu-mcp
  name: "@deepseek-ai/dsh-mcp-client"
  config:
    serverName: ocu
    transport: stdio
    command: /Users/you/.local/share/ocu/ocu
    args: [mcp]
```

To pass settings, add them to the server's environment in your host's config, for example
`"env": {"OCU_OVERLAY": "0"}` in JSON. [Configuration](configuration.md) lists them all.

## Permissions

macOS checks the app that starts the server, not ocu itself:

- **Command-line agents** (Claude Code, Codex): grant Accessibility to your terminal app.
- **GUI apps** (Claude Desktop, Cursor, DeepSeek Harness): grant Accessibility to that
  app, then quit and reopen it.

Accessibility is under System Settings > Privacy & Security > Accessibility. The
`screenshot`, `click_visual` and `read_visual` tools also need Screen Recording, in the
same place. `ocu doctor`, run from the same app, tells you what is missing.

## Model keys under GUI apps

`observe`, `act` and `screenshot` need no keys. `click_visual` and `read_visual` need a
vision key, and `run_task` needs a planner key. Each of these appears only when its key
is set, so the caller never sees a tool that would just fail.

Apps started from the Dock don't get the variables your shell sets up. If neither
`DEEPSEEK_API_KEY` nor `OCU_API_KEY` is set when the server starts, it runs your login
shell once (`$SHELL -i -l -c env`) and borrows the variables whose names end in
`_API_KEY` or `_BASE_URL`, or start with `OCU_`. They are kept in memory only and are not
written anywhere. Set `OCU_SHELL_ENV=0` to turn this off and pass keys in the server's
`env` config instead.

## Tools

The server also sends usage instructions with the observe → act loop, when to batch and
what to do when stuck, so weaker models don't have to work this out themselves.

| Tool | Needs | What it does |
| --- | --- | --- |
| `observe {app?}` | – | Returns an app's window as text ([the screen](concepts.md#the-screen)). Pass `app`: the frontmost app is usually the caller's own terminal. The app is remembered for later calls |
| `act {action, …, then?}` | – | Runs one [action](concepts.md#actions), or a [batch](concepts.md#batches) through `then`, and returns the results and [what changed](concepts.md#change-replies) |
| `screenshot` | Screen Recording | An image of the observed window, plus the formula that turns an image pixel into a screen point for `act {action:"click_at"}`. For callers that can read images |
| `click_visual {target}` | vision key | Screenshots the window, has a vision model locate the described element, and clicks it. For callers that can't read images |
| `read_visual {question}` | vision key | Asks a vision model a question about the window |
| `run_task {goal}` | planner key | Hands the whole goal to the [built-in agent](agent.md), which uses its own planner and the action cache. Returns a summary; observe again afterwards |

`run_task` uses the same helper process as the other tools, so refs keep one numbering.

## Tips for callers

The server instructions cover the following. They are repeated here for people writing
prompts or their own clients.

- Start with `observe {app: "…"}` once. After that, every `act` reply shows the new
  screen, so a separate observe is rarely needed.
- Batch predictable steps (keypad presses, select all then Bold) with `then`.
- Use `set_value` for text fields, `menu{path}` or a shortcut for commands, and
  `find_text` to read long pages.
- After `did not change`, try something else instead of repeating the action.
- After `unknown ref`, use a ref from the latest reply.
- If the element list is sparse (canvas, games), use `screenshot` then `click_at`, or
  `click_visual`.
- On an error about Accessibility permission or a locked screen, stop and tell the user.
  Retrying won't help.
- Finish by checking the result in the latest reply instead of assuming the action
  worked.

Measured: Claude Code (Sonnet) computed 789 × 36 on Calculator in 4 turns and 19 s,
using a batched `act`. Without batching the same task took 11 turns and 45 s.
