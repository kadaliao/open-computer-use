# 05. Electron apps and dense windows

- **Status:** planned
- **Priority:** P1
- **Depends on:** 01 (Electron task), 04 (web view checks) help but aren't required
- **Size:** one or two sessions

## Why

- Many apps people want to drive are Electron or Chromium-based: Slack, VS Code, Notion,
  Obsidian, Discord, DeepSeek Harness itself. Today they often come back as "accessibility
  info is sparse here", and the caller falls back to screenshots and coordinates. That
  throws away ocu's main advantage.
- Dense windows hit the element budget: `collect` stops at 400 elements, depth 40, or
  3 s. The caller then sees part of the window and has only `find_text` to get at the
  rest.

## What agent-desktop does

- **Detecting Chromium apps.** An app is Chromium-based when its bundle has
  `Contents/Frameworks/Electron Framework.framework` or `Chromium Embedded
  Framework.framework` (`crates/macos/src/system/renderer_kind.rs`).
- **Turning on their accessibility tree.** It sets `AXManualAccessibility = true` on the
  application element, falling back to `AXEnhancedUserInterface = true` with a 2 s
  settle, and reads the attribute back to confirm (`tree/renderer_probe.rs`,
  `system/renderer_activation.rs`).
- **Drilling into dense windows.**
  - `snapshot --skeleton` reads at most 3 levels. A container cut at the boundary gets
    `children_count`, and a ref if it is identifiable.
  - `snapshot --root REF` re-reads only that subtree (default depth 10, maximum 50) and
    replaces that region's refs.
  - A drill is all or nothing: an incomplete read is a `TIMEOUT`, not a partial list.
  - Children are read in pages of 128, with up to 3 attempts across `AXChildren`,
    `AXChildrenInNavigationOrder` and `AXContents` (`tree/query/child_source.rs`).
- **Their own guidance** is to map dense apps first and then drill into one region.

## Current state in ocu

- No Chromium detection and no `AXManualAccessibility`.
- `inWebArea` marks elements under `AXWebArea`, so `press` clicks them for real.
- `renderHead` adds the "sparse" line when fewer than 5 elements are labeled.
- `collect` reads only `kAXChildrenAttribute`. The caps are `out.count > 400`,
  `w.depth > 40` and a 3 s `collectDeadline`. Lists show only visible rows (or the
  first 30), plus a "showing N of M rows" line.

## Plan

1. **Chromium accessibility.** On the first observe of an app, detect Chromium as
   agent-desktop does. Set `AXManualAccessibility` (or `AXEnhancedUserInterface`), wait
   until the tree fills in (poll the element count for up to 2 s), and cache the result
   per process.
   - Note in `observe` output when ocu turned it on, once.
   - Set `OCU_ELECTRON_A11Y=0` to skip it.
   - Measure the memory and CPU cost on one big app: Chromium builds its whole
     accessibility tree once this is on.
2. **Child reads.** Fall back to `AXChildrenInNavigationOrder`, then `AXContents`, when
   `AXChildren` is empty or fails for a container that should have children.
3. **Drill-down without new tools.** `observe {app, root: "e123"}` lists only that
   element's subtree, with its own budget, and keeps refs stable as today.
   - When the budget cuts a window, say so in the head line, the way lists already do:
     `(showing 400 elements; observe{root:"e…"} on a region for more)`.
   - Name the biggest cut containers there, so the caller knows where to drill.
   - Change replies stay relative to what the caller last saw (`lastObs` in `mcp.ts`).
     Decide whether a drill read replaces it or is merged in, and test it.
4. **Bench.** Add an Electron task to `core/bench/tasks.ts` and to the vs-benchmark (for
   example: open a file in VS Code with its command palette, or send a message to
   yourself in Slack), skipped when the app isn't installed. Add a dense-window task
   (System Settings > Privacy & Security, or a long Safari page).

## Out of scope

Chrome DevTools Protocol access. agent-desktop's `launch --cdp` opens an unauthenticated
loopback DevTools port and leaves page-level control to another tool. ocu stays
accessibility-only.

## Done when

- In at least two Electron apps that are sparse today, observe lists their controls and
  `press` and `type` work on them. Record before and after element counts.
- `observe{root}` is documented in concepts and MCP docs (both languages), and covered
  by tests in `screen.test.ts` / `driver.test.ts` where it touches the core.
- The new bench tasks pass, and the "sparse" fallback note in troubleshooting is
  updated.
