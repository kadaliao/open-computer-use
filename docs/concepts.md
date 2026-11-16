# Concepts

**English** · [简体中文](concepts.zh-CN.md)

The words used across ocu, and how the screen, refs, actions and replies work. MCP
callers and the built-in agent see the same screen format, so this page applies to both.

- [The screen](#the-screen)
- [Refs](#refs)
- [Actions](#actions)
- [Waiting for the screen to settle](#waiting-for-the-screen-to-settle)
- [Change replies](#change-replies)
- [Batches](#batches)

## The screen

An observation of one app's focused window, as text. The first line names the app and
the window; a few optional lines follow; then one line per element:

    app: TextEdit | window: Untitled
    dialog open: "Do you want to save the changes?" (its controls are listed first)
    other windows of this app (2): "Notes.txt", "Draft.rtf"
    e140 Button "Save"
    e141 Button "Don't Save"
    e112 CheckBox "Bold" [checked]
    e107 PopUpButton "Typeface" = "Helvetica"
    e131 TextArea "hello"

**Element lines** read `ref Role "label"`, then the element's value and state when it
has them:

- `= "..."` is the current value of a titled field, pop-up button or slider, shown when
  it differs from the label.
- `[checked]` and `[mixed]` mark checkboxes and checked menu items, `[selected]` marks
  the chosen radio button, tab, row or cell, and `[disabled]` marks a control that
  can't be used. No mark means unchecked, unselected and enabled.
- Roles are the macOS accessibility roles without the `AX` prefix: `Button`,
  `TextField`, `TextArea`, `CheckBox`, `RadioButton`, `PopUpButton`, `MenuItem`,
  `MenuButton`, `Link`, `ComboBox`, `Slider`, `Tab`, `Cell`, `Row`, `SearchField`,
  and `Text` (read-only text).

**Optional lines** under the first:

- `dialog open: "…"`: a sheet, dialog or alert is up. Its controls come first in the
  list, and it usually has to be dealt with before anything else.
- `other windows of this app (n): …`: the app has more windows. An action can open
  several at once.
- `(accessibility info is sparse here: …)`: fewer than five labeled elements, typical of
  canvas apps, games and some Electron apps. Use the [screenshot
  fallback](agent.md#screenshot-fallback).

**Long content is cut.** A long list gets a line like `showing 40 of 312 rows:
scroll{ref:"e150"} for more, or find_text`, and the element list as a whole is capped.
`find_text` searches all of the window's text, including what was cut and what is
scrolled out of view.

**Which app.** Name the app you want to read (`observe Calculator`). The app name, its
localized name (`计算器`) and its bundle id (`com.apple.calculator`) all work. ocu brings
that app's window to the front and remembers the app for later calls. Without a name it
reads the frontmost app, which under MCP is usually the caller's own terminal.

## Refs

A ref (`e112`) names one element.

- **Refs are stable.** An element keeps its ref for as long as the helper runs, and a ref
  is never reused for another element.
- **Only refs from the latest screen can be acted on.** A ref that has gone answers
  `unknown ref`. Read again and use a ref from the new screen.
- **Refs start at `e101`.** Planners that count lines instead of copying the ref used to
  press the element one line off (in 10 of 10 tries on Calculator). Refs from `e101` up
  can't be mistaken for line numbers.
- Some apps create new element objects on every read. Their refs change every time.
  Everything still works, but replies are full screens instead of change lists.

## Actions

| Action | Fields | What it does |
| --- | --- | --- |
| `press` | `ref`, `extend?` | Presses a button, link, menu item, tab, cell or row. On a table row it selects the row; `extend: true` adds it to the selection |
| `set_value` | `ref`, `text` | Sets a text field's value directly |
| `type` | `text`, `ref?` | Types text. With a `ref`, into that field; without one, into the focused field |
| `key` | `key`, `repeat?` | A key or combination: `return`, `tab`, `escape`, `space`, `delete`, arrow keys, `cmd+n`, `cmd+shift+g`… `repeat` (up to 50) presses it again |
| `scroll` | `ref?`, `direction`, `amount?` | Scrolls the element's list or the window `up` or `down`, by `amount` lines (default 10) |
| `menu` | `path` | Clicks a menu bar item by its titles, for example `["File", "New Folder"]` |
| `open_app` | `name` | Opens or switches to an app and returns once it is in front |
| `open_url` | `url` | Opens a URL with the app that handles it: a web page in the default browser, an `x-apple.systempreferences:` link in System Settings |
| `find_text` | `text` | Searches all of the window's text, including content that is off screen or cut from the list. The built-in agent's planner names this field `query` |
| `click_at` | `x`, `y` | Clicks a global screen point. Meant for after a screenshot, when the element isn't listed |

Some behavior applies to all actions:

- Keyboard actions bring the observed app to the front first.
- `type` without a `ref` inserts the text through accessibility into a focused native
  field and waits briefly for a field to take focus. Web fields get real key events.
- Elements inside web content (browsers, Electron apps) get a real click, because those
  apps ignore the accessibility press.
- Every action is refused while the screen is locked.
- Menus are often faster than buttons: `menu{path:["Go","Downloads"]}` in Finder, or a
  shortcut such as `key{key:"cmd+n"}`.

## Waiting for the screen to settle

After an action that can change the screen, ocu reads the window again every 50 ms until
it stops changing, for up to 3 s. A screen that hasn't changed at all is watched for a
while before ocu concludes the action did nothing: 600 ms, or 1.2 s in a browser, where
page loads start late. These repeat reads are quiet: they don't raise the window or draw
the overlay.

The actions that wait like this are `press`, `menu`, `open_app`, `open_url`, `click_at`,
`click_visual`, `return`, and any key combination with a modifier.

## Change replies

Over MCP, each `act` returns the action's result and then the screen in one of three
forms:

1. **`did not change`.** The action had no visible effect. The caller's screen and all
   its refs still hold. Don't repeat the action; try another element, the menu or a
   shortcut.
2. **A change list.** Only the lines that changed, in screen order. Every other ref from
   the caller's last screen is unchanged and still valid:

       changed: 1 changed. Only these lines changed (+ new, ~ changed, - gone: don't use it); every other ref from your last screen is unchanged and still valid.
       app: Calculator | window: Calculator
       ~ e103 Text "7"   (was: Text "0")

   `+` is a new element, `~` an element whose label, value or state changed, and `-` an
   element that has gone.
3. **The full screen.** Sent the first time, when another window or app comes up, when
   a dialog opens or closes, when more than 40 lines (or 40% of the screen) changed, and
   after four change lists in a row, so the caller's copy can't drift.

`observe` always returns the full screen.

## Batches

An `act` call can carry more steps in `then`, run in order:

```json
{"action":"press","ref":"e107","then":[{"action":"press","ref":"e108"},{"action":"press","ref":"e113"}]}
```

- After a step that changes the screen, the batch waits for the screen to settle before
  the next step, so keys reach a window that just opened.
- A run of presses (typing a number on a keypad) goes straight on without waiting.
- A later step whose element has gone fails with `unknown ref` instead of hitting
  something else. The batch stops at the first error.
- The reply lists every step's result, then the screen once.

The built-in agent batches too, with stricter rules about what may follow a change. See
[built-in agent](agent.md#batches-and-the-local-finish-check).
