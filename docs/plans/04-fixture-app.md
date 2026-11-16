# 04. A fixture app and local end-to-end tests

- **Status:** planned
- **Priority:** P1. Plans 03, 06, 07, 09 and 10 are easier to get right with it.
- **Depends on:** nothing
- **Size:** one session

## Why

The helper (`mac/Sources/ocu-mac/main.swift`, about 1,000 lines) has no tests. Its
behavior is checked only through bench tasks on real apps, which:

- change with every macOS version and UI language;
- can't tell whether an action took effect, only whether the screen changed;
- need a model, cost money and take minutes.

Work on selection, opening, background input, password fields and menus needs a fast,
deterministic way to check what each action did.

## What agent-desktop does

`tests/fixture-app/*.swift` is a small SwiftUI and AppKit app, built with `swiftc` into
`AgentDeskFixture.app` (`com.agentdesktop.fixture`). Every control writes what happened
to it ("button A pressed", "field = hello", "row 3 selected") to a status label, and the
harness reads that label back through accessibility. A first gate checks that semantic
actions take effect while the fixture never becomes frontmost (`tests/e2e/`,
`safe-semantic.sh`). The suite runs locally, or on a self-hosted Mac with Accessibility
granted.

## Plan

1. **`tests/fixture/`**: a one-file AppKit app (built with `swiftc`, no Xcode project),
   bundle id `dev.ocu.fixture`. It needs:
   - buttons, a checkbox, radio buttons, a pop-up button, a slider;
   - a text field, a secure text field, and a text area;
   - a table and an outline with 200 rows, plus a browser (column view) of fake folders;
   - a tab view;
   - a menu bar menu with shortcuts, and a context menu;
   - a sheet, an alert and a popover;
   - a web view showing a local HTML page with a link, a button and an input.

   Every event is written to a `Text "status: …"` element and appended to a log file
   given by an environment variable.
2. **`tests/e2e/run.ts`** (Bun): builds the helper and the fixture, launches the fixture,
   drives the helper directly over its JSON protocol, and checks the status line or log
   after each action. One test per action and control. The output says which test
   failed, with the helper's reply.
3. **Disturbance checks.** Record the frontmost app and pointer position around each
   action, so plan 06 can assert "this action didn't take focus".
4. **Documentation.** `CONTRIBUTING.md` (both languages): how to run it, and that the
   terminal needs Accessibility. Point `AGENTS.md` to it.

## Out of scope

Running it in CI; that needs a self-hosted Mac (see plan 02).

## Done when

- `bun tests/e2e/run.ts` builds everything, runs in under a minute, and passes on
  today's helper. Known gaps (opening items in the browser, password fields) are marked
  as expected failures, with the plan that fixes each.
- Contributing docs in both languages describe it.
