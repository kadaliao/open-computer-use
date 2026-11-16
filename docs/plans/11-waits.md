# 11. Waiting for a condition

- **Status:** planned
- **Priority:** P2
- **Depends on:** nothing
- **Size:** one session (short)

## Why

ocu waits for the screen to settle after each action, for at most 3 s
(`waits.max` in `core/src/screen.ts`). Downloads, exports, builds, slow page loads and
"Installing…" sheets take longer. Callers then poll with `observe` and spend a turn and
a full screen each time, or give up early.

## What agent-desktop does

- **`wait` with predicates** (`commands/wait.mdx`): a duration; an element `exists`,
  `enabled`, `visible`, `actionable` or has a given `value`; a window; a text, with a
  count; a menu open or closed; a notification; or an event (`window-opened`,
  `window-closed`, `app-launched`, `app-terminated`, `focus-changed`,
  `surface-appeared`, `surface-dismissed`). It polls about every 100 ms, with a 30 s
  default timeout.
- **Post-action waits:** `--wait-for SEL` / `--wait-for-gone SEL` on actions, where a
  selector is `role:text`.
- A wait that times out keeps the action's own delivery result, so the action never
  looks safe to retry.

## Plan

1. **A `wait` action**, usable alone or as a step in a batch:
   - `wait{text?, gone?, ref?, state?, timeout?}`;
   - `text`: wait until it appears in the window title or content (the same token
     matching as the agent's local finish check in `agent.ts`). With `gone: true`, wait
     until it disappears;
   - `ref` + `state` (`enabled`, `checked`, `selected`): wait for that element's state;
   - timeout defaults to 30 s, maximum 120 s. Poll with quiet reads, backing off from
     100 ms to 500 ms;
   - the reply is the normal change reply, plus `waited_ms` and `met: true|false`.
2. **Built-in agent.** The planner prompt gets the action, with an example ("after
   clicking Export, wait for 'Export complete'"), and `waits` that time out tell the
   planner instead of failing the run.
3. **Tests** in `screen.test.ts` with fake observations (appearing text, disappearing
   text, timeout), and one fixture test.
4. **Docs:** the concepts actions table, MCP and the planner prompt, in both languages.

## Done when

- A bench task with a slow step (for example, Safari loading a large page, or a sheet
  that stays up a few seconds) passes with one `wait` instead of repeated observes.
- The unit tests cover the cases above.
