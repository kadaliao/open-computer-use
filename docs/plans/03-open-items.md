# 03. Opening items in Finder and other file views

- **Status:** done (0.7.0)
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

## Outcome

Shipped (2026-11-16, macOS 26, Finder in English):

- **What the views look like** (step 1). The same in Finder and in open and save panels:

  | View | A file is | Selection lives on | `AXOpen` on |
  | --- | --- | --- | --- |
  | list | `AXOutline > AXRow > AXCell > AXTextField` | `AXSelectedRows` of the outline | the text field |
  | column | `AXBrowser > … > AXList > AXGroup > AXTextField` | `AXSelectedChildren` of the list, set to the group | the text field |
  | icon, gallery | `AXList > AXList > AXGroup > AXImage` | `AXSelectedChildren` of the outer list, set to the group | the image |

  The file's element is the one with an `AXFilename` attribute. Icon and gallery view
  expose only the files that are visible. `AXOpen` always answers with error -25205, also
  when it opens the item, and in list view it opened an item that wasn't selected in only
  2 of 4 tries (a selected one every time), so `open` selects first and ignores the result.
- **`press`** selects through the container (`select()` in `main.swift`), checks that the
  item then reports `AXSelected`, and reports `"via":"select"`; `extend` works in every
  view. When nothing takes the selection, a row, file or text gets a real click instead
  of a silent `AXPress`.
- **`open{ref}`**: select, then `AXOpen` on the item or on an element inside its row
  (`"via":"open"`); with no `AXOpen`, cmd+down on the selection (`"via":"key"`); else a
  double click (`"via":"double-click"`). It is in the MCP `act` enum and instructions,
  the planner prompt and `docs/concepts`. Still three core tools.
- **Listing.** Files in column, icon and gallery view are listed as `Cell "name"` (a name
  being edited stays a `TextField`). List view keeps its `Row` lines.

Numbers, built-in agent with DeepSeek, one run each, the five tasks `finder-open-icon`,
`finder-open-list`, `finder-open-column`, `panel-open-folder` and `finder-utilities`:

| | Pass | Avg task | Avg planner calls |
| --- | --- | --- | --- |
| before (f14942c) | 3/5 | 12.0 s | 10.4 |
| after | 5/5 | 3.6 s | 2.8 |

Before, the icon and column tasks failed (nothing listed to press; `press` without
effect), and list view passed only after the model found cmd+down by itself. No task used
a screenshot after the change.

Left out or changed:

- The new bench tasks open a folder made for the run instead of Applications > Utilities,
  so that the Go menu can't stand in for the file list. The view is set with AppleScript
  in setup, not with cmd+1/2/3.
- The agent-desktop comparison (plan 01) has not been run again, so "no screenshot in the
  vs-benchmark Finder task" is shown only by `finder-utilities` here (2 planner calls, no
  screenshot).
- The cmd+down and double-click fallbacks of `open` have no app that exercises them yet;
  only the `AXOpen` path was seen running.
- A file that is scrolled out of sight in icon or gallery view is not listed, and those
  lists give no "showing N of M" line. `find_text` doesn't reach it either.
- No debug flag in the helper: the hierarchy was dumped with a throwaway script.
