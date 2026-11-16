# 10. Context menus, popovers, menu bar extras and windows

- **Status:** planned
- **Priority:** P2
- **Depends on:** 04 (fixture has a context menu and a popover)
- **Size:** one session

## Why

ocu sees the focused window, its sheets and dialogs, and the app's open menu bar menu.
It has no way to:

- open or read a **context menu** (right-click);
- read a **popover** reliably (a calendar picker, a toolbar popover);
- use **menu bar extras** (Wi-Fi, Bluetooth, battery, third-party status items);
- pick **one of several windows**. The comparison's Finder runs had three windows; ocu
  only reports `other windows of this app (3): …`.

## What agent-desktop does

- **Sheets, popovers and alerts:** looks at the focused window and its direct children
  for role or subrole `AXSheet` / `AXPopover`. An alert is `AXSheet` or subrole
  `AXDialog`/`AXAlert` (`tree/surfaces.rs`).
- **Context menus:**
  - Finding an open one: the app's `AXMenus`, then a search under the focused element
    and the app's children (at most 2,048 nodes).
  - Opening one: `right-click` tries `AXShowMenu` on the element, then on its selection,
    a selected-items menu button, its first children and up to 3 ancestors. Before each
    try it checks whether a menu is already open, so it never opens two. If
    `AXShowMenu` enters modal menu tracking, it reports `APP_UNRESPONSIVE` with
    `retry: unsafe`.
- **Menu bar extras:** `AXExtrasMenuBar`, found through the host processes
  (`ControlCenter`, `SystemUIServer`, `MenuBarAgent`). They are always on screen, so
  reading them needs no focus (`tree/shell_surface.rs`).
- **Actions report surfaces:** after an action, `data.surfaces` names any menu, sheet or
  popover that opened.
- **Windows:** `list-windows` gives window ids, and `--window-id` targets one.
- **Notification Center** needs headed mode and Automation permission, and restores the
  previous app afterwards.

## Plan

1. **Popovers.** In `observe`, also walk `AXPopover` children of the window (and popover
   windows of the app), listed first like sheets. Add a `popover open` head line.
   Change replies treat it like a dialog: a full screen when it opens or closes.
2. **Context menus.**
   - `menu{ref, path?}`: with a `ref`, open that element's context menu with
     `AXShowMenu` (fallbacks as above, with the already-open check). With a `path`,
     press that item.
   - Without a path, the reply lists the open menu's items.
   - While a context menu is open, `observe` lists its items first.
3. **Menu bar extras.** `observe{app:"menu bar"}` lists the extras with refs. `press`
   opens one, and its menu is then listed. This needs no focus.
4. **Windows.** `observe{app, window}` takes a title or the `window_id` shown in the head
   line, and later calls stay on that window. The "other windows" line shows each
   window's id, so callers can pick one.
5. **Docs** in both languages (concepts, MCP), MCP server instructions, and the planner
   prompt.

## Out of scope

Notification Center (headed only, needs Automation permission). The Dock: `open_app`
covers what it is used for.

## Done when

- Fixture tests: a context menu opened and an item pressed; a popover listed and
  closed; a second window targeted.
- On a real Mac: turn Bluetooth off and on from the menu bar extra, and pick a date in
  Calendar's popover.
