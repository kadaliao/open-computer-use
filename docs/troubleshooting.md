# Troubleshooting

**English** · [简体中文](troubleshooting.zh-CN.md)

Start with `ocu doctor`, run from the same app that runs ocu. It checks Accessibility,
Screen Recording, and which planner, Jev and vision keys answer.

- [Permissions](#permissions)
- [Installing and starting](#installing-and-starting)
- [MCP](#mcp)
- [Errors in replies](#errors-in-replies)
- [Known limits](#known-limits)
- [Reporting a bug](#reporting-a-bug)

## Permissions

**"Accessibility: not granted".** Grant Accessibility to the app that starts ocu, in
System Settings > Privacy & Security > Accessibility, then quit and reopen that app.
For the command line that is your terminal. Under MCP it is the host: Claude Desktop,
Cursor, DeepSeek Harness, or the terminal running Claude Code or Codex.

**Granted, but reading an app fails.** `doctor` prints the error. A locked screen,
or an app that is still launching, are the usual causes.

**"Screen Recording" fails.** Only `screenshot`, `click_visual` and `read_visual` need
it. Grant it in the same settings page and reopen the app.

## Installing and starting

**`ocu: command not found`.** The installer links `~/.local/bin/ocu`. Add `~/.local/bin`
to your `PATH`, or run `~/.local/share/ocu/ocu`.

**ocu is killed right after it starts (exit 137).** macOS kills a signed binary that was
overwritten in place. Install with `install.sh`, which removes the old files first and
signs the new ones, instead of copying over them.

**"helper not built"** (source checkout). Run `swift build -c release` in `mac/`.

**"ocu-mac did not answer … within 20s".** The app being read is not responding. Try
again once it responds, or raise `OCU_CALL_TIMEOUT_MS`.

## MCP

**`click_visual`, `read_visual` or `run_task` are missing.** They appear only when their
keys are set. GUI apps don't get your shell's variables; the server borrows them from
your login shell when it can (see [model keys under GUI
apps](mcp.md#model-keys-under-gui-apps)). If your keys are set somewhere a login shell
doesn't read, put them in the server's `env` config.

**The caller reads its own terminal.** Pass `app` to `observe`. Without it, ocu reads the
frontmost app.

**The overlay gets in the way.** Set `OCU_OVERLAY=0` in the server's environment.

## Errors in replies

| Reply | Meaning | What to do |
| --- | --- | --- |
| `unknown ref` | That element is no longer on screen | Use a ref from the latest reply |
| `did not change` | The action had no visible effect | Pick another element, use the menu or a shortcut. Don't repeat it |
| `accessibility info is sparse here` | The app exposes little to accessibility (canvas, games, some Electron apps) | `screenshot` then `click_at`, or `click_visual` / `read_visual` |
| `… was launched but is not running` | The app quit on start or is still loading | Retry `open_app` once, then report it |
| `no app named …` | macOS couldn't find an app by that name | Use the name the app has in the Applications folder |

## Known limits

- **Electron apps that expose no page content.** Clicks on web content in them are
  unverified.
- **Safari Reader mode** hides parts of a page (a Wikipedia infobox, for example) from
  `find_text`. Turn it off with View > Hide Reader, then search again.
- **Calculators** apply operator precedence and have no parentheses. Press `=` to get
  intermediate results first.
- **Release builds** are for Apple silicon only. Build from source on an Intel Mac.

## Reporting a bug

Open an issue with the [bug report
template](https://github.com/kadaliao/open-computer-use/issues/new/choose). Include:

- the ocu version (the release tag, or `git rev-parse --short HEAD` for a checkout) and
  your macOS version;
- how you ran it: the CLI, or MCP and which host;
- the output of `ocu doctor`;
- the goal or the tool calls, and what happened.

Screen text, screenshots and the action cache show what was on your screen. Remove
anything private before you post them.
