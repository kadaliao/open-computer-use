# 06. Working without taking focus

- **Status:** planned
- **Priority:** P1. This is agent-desktop's biggest advantage over ocu.
- **Depends on:** 04 (to check), 01 (disturbance numbers)
- **Size:** two sessions. Ship the measurement and the policy first, then move actions
  over one by one.

## Why

Today ocu takes over the screen. Every non-quiet `observe` raises the app and its window
(`bringForward`). Keys, typing that falls back to the keyboard, menus, scrolling, web
clicks and `click_at` all bring the app forward first (`focusTarget`). Web clicks and
`click_at` also move the pointer, though it is put back afterwards.

Under MCP the user usually works in another window while their agent runs; the agent's
own terminal is frontmost. Each raise interrupts them and can send their typing into the
wrong app.

## What agent-desktop does

- **Interaction policy:** two switches, `allow_focus_steal` and `allow_cursor_move`.
  - Headless (both off) is the default; `--headed` turns both on.
  - A headless action with no semantic path fails with `POLICY_DENIED` or
    `ACTION_NOT_SUPPORTED`. It never falls back to physical input quietly
    (`crates/core/src/actions/interaction_policy.rs`).
- **Semantic paths it uses on macOS without focus:**
  - **press:** `AXPress` (and the rest of the chain in plan 03).
  - **set-value:** set `AXValue`, or step with `AXIncrement`/`AXDecrement`.
  - **type:** write `AXSelectedText`.
  - **focus:** set `AXFocused`.
  - **scroll:** `AXScrollToVisible`, `AXScroll*ByPage`, or the scroll bar's `AXValue`.
  - **native menus:** `AXPress` on the menu items, without activating the app.
  - **double-click:** `AXOpen` only.
- **Keys** (`system/key_dispatch.rs`):
  - A shortcut with modifiers is resolved to the menu item whose
    `AXMenuItemCmdChar`/`AXMenuItemCmdModifiers` match, and that item is pressed. The
    search is capped at 2,048 nodes, depth 8.
  - A bare `return` or `escape` becomes `AXConfirm` / `AXCancel` on the focused element.
  - Anything else goes to the app's process with `CGEventPostToPid`, after waiting up to
    500 ms for the app to report a focused element.
  - Quitting combinations need `--force`.
- **Headed input checks focus first.** The window must be main and the app frontmost.
  It sets `AXFocused`, polls up to 500 ms until the focused element is the target, and
  checks again before every chunk of typed text (`actions/physical_keyboard.rs`).
- **One input at a time.** A per-user `flock` serializes dispatch between processes
  (`session/interaction_lease.rs`).

## Current state in ocu

- `bringForward()` / `focusTarget()` in `main.swift`. `observe` calls `bringForward()`
  unless `quiet`.
- `type` already inserts through `AXSelectedText` (`insertText`) when it can. A comment
  above `send()` records why keys go to the frontmost app: "Posting straight to the
  app's pid drops typed text in apps like Notes."
- `menu` calls `focusTarget()` before `pressMenu`, which then uses `AXPress`.
- Web content: `press` does `focusTarget()` and a real click, because pages ignore
  `AXPress`.

## Plan

1. **Measure first.** Using plan 04's fixture and the vs-benchmark disturbance numbers,
   list, per action, whether it changes the frontmost app or moves the pointer today.
2. **A policy setting:** `OCU_FOCUS` = `background`, `when-needed` (proposed default) or
   `always` (today's behavior).
   - **background:** never take focus or move the pointer. An action with no semantic
     path fails with a clear error naming the action, and the MCP instructions tell
     callers what to do.
   - **when-needed:** semantic paths in the background. Physical input brings the app
     forward, and the reply says so (`"via":"click", "focus":"took"`), so the caller and
     the user know.
   - **always:** today's behavior, for users who want to watch.

   Decide with the maintainer whether `observe` should still raise in `when-needed`. The
   overlay glow only helps when the window is visible.
3. **Move actions to semantic paths**, one per commit, each with a fixture test:
   - `observe` without raising;
   - `menu` without `focusTarget`;
   - `key` with modifiers resolved to a menu item;
   - `return` / `escape` as `AXConfirm` / `AXCancel` where the focused element supports
     them;
   - `scroll` through scroll bar values or `AXScrollToVisible`;
   - `set_value` with `AXIncrement`/`AXDecrement` for steppers and sliders;
   - other keys through `CGEventPostToPid`. Test this per app class first: it failed in
     Notes for typed text, and may work for single keys.
4. **Web content.** Try `AXPress` first and confirm with the screen diff that something
   changed before falling back to a real click. Pages that react to `AXPress` (some do
   via accessibility clicks) then never take focus.
5. **Optionally give focus back.** After an MCP `act` that had to take focus, return it
   to the app that had it before (`OCU_FOCUS_RESTORE=1`). Measure whether this helps or
   just flickers.
6. **Docs.** Concepts (a "focus" section), configuration, MCP and README safety text,
   all in both languages. Mark it in the changelog under *Changed*, because default
   behavior changes.

## Out of scope

Running inside a VM or sandbox (agent-desktop has macOS VM sandboxes). Worth a separate
plan later if users want isolation.

## Done when

- The fixture suite shows `press`, `set_value`, `type` (native fields), `menu`,
  shortcut keys with a menu equivalent, and `scroll` running without changing the
  frontmost app or moving the pointer.
- The vs-benchmark disturbance count drops, and pass rate and turns don't get worse.
- `OCU_FOCUS=background` refuses physical input with a clear message.
