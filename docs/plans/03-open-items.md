# 03. Opening items in Finder and other file views

- **Status:** planned
- **Priority:** P0. The comparison showed it.
- **Depends on:** 01 (to measure), but can start without it
- **Size:** one session

## Why

In the 2026-11-16 comparison, ocu's model reached Applications in Finder but couldn't
enter Utilities:

- Finder was in **column view**. The folder names there were listed as
  `TextField "Utilities"`, not as rows.
- `press` on that ref returned `{"target":"TextField Utilities","ok":true}` without
  `"via":"select"`, and the screen did not change.
- The model then needed `cmd+o`, a `screenshot` and `click_at`: 2 extra calls and an
  image, every time.

agent-desktop opened the same folder with one `click`. This is already listed under
known limits in `docs/troubleshooting.md` ("Items in Finder's column and icon views
can't be opened with `press`").

## What agent-desktop does

Its `click` is a chain of fallbacks, tried in order until one has a visible effect
([`crates/macos/src/actions/chain/chain_defs.rs`](https://github.com/vercel-labs/agent-desktop/blob/main/crates/macos/src/actions/chain/chain_defs.rs)):

1. a real click (in headed mode only);
2. `AXPress`, then a read of `AXSelected`. A press that "succeeded" without selecting
   counts as delivered without effect, and the chain goes on;
3. `AXOpen`;
4. activating a descendant;
5. writing `AXSelectedRows`, `AXSelectedCells` or `AXSelectedChildren` on the container;
6. `AXConfirm`.

A headless double-click is `AXOpen` only. Copy the chain-with-checks idea, not the whole
chain: ocu only needs the steps that work for the file views found in step 1 below.

## Current state

- `mac/Sources/ocu-mac/main.swift`, `act` → `case "press"`. For `AXRow`, `AXCell`,
  `AXStaticText`, `AXTextField` and `AXImage` targets that have a `row`, it sets
  `kAXSelectedRowsAttribute` on the row's parent. Otherwise it uses `AXPress`, and
  falls back to a real click only when `AXPress` fails or the element is static text.
- `collect` sets `Walk.row` only on `AXRow` and passes it down three levels at most.
  Column-view items evidently don't get a row, or their row's parent doesn't take
  `AXSelectedRows`.
- `AXPress` on a `TextField` reports success and does nothing, so no fallback runs.

## Plan

1. **Look first.** Dump the accessibility hierarchy of Finder's four views (icon, list,
   column, gallery) and of an open/save panel. Use Accessibility Inspector, or a debug
   flag that prints roles, actions (`AXUIElementCopyActionNames`) and parents for a ref.
   Write down for each view: what element a file name is, what its row/cell/list
   container is, and which actions it supports (`AXOpen`? `AXPress`?).
2. **`press` = a single click.** A single click on a file item selects it, and in column
   view selecting a folder shows its contents, which is what the user means.
   - Find the selectable container for each view (row in an outline or browser column,
     item in an icon view list) and select through it.
   - Report `"via":"select"`.
   - If no container is found, fall back to a real click on the item, as for web
     content, instead of a silent `AXPress`.
3. **An `open` action = a double click.** Add `open{ref}` to the actions: use `AXOpen`
   when the item offers it, else select it and send `cmd+down` (Finder's "Open"), else
   double-click. Add it to the MCP `act` enum and description, the planner prompt in
   `policy.ts`, and `docs/concepts.md`. Keep the tool count at three.
4. **Show file items as what they are.** List an item's name field as `Row` or `Cell`
   with its name, not `TextField`, unless it is being edited (it has focus). Models
   don't press text fields.
5. **Tests.** Unit tests for anything in the core. Bench tasks in `core/bench/tasks.ts`:
   open Utilities from Applications in column, list and icon view each (set the view
   with `cmd+3`, `cmd+2`, `cmd+1` in setup). Also an open/save panel: choose a folder.

## Out of scope

Drag and drop, and renaming files.

## Done when

- The new bench tasks pass in all three views.
- In the vs-benchmark Finder task, ocu needs no screenshot.
- The Finder line is removed from known limits in both troubleshooting files, and the
  `open` action is documented in both languages, with a changelog entry.
