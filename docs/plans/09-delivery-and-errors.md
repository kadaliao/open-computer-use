# 09. Per-action results and error codes

- **Status:** planned
- **Priority:** P2
- **Depends on:** 04 (fixture), 03 (the press chain)
- **Size:** one session

## Why

ocu's change replies tell the caller whether the screen changed, which covered every
task in the comparison. Some things they can't tell:

- **A no-op versus a change.** Pressing a checkbox that was already on looks the same as
  a press that failed.
- **Whether the app took a value.** A field can show new text that the app hasn't
  committed. A slider can refuse an out-of-range value.
- **Whether a retry is safe.** A timeout on an unresponsive app may still deliver the
  action later. Retrying it blindly can do it twice.

Errors are free-form strings (`"unknown ref"`, `"press failed"`, `"set failed"`).
Programmatic clients, tests and the built-in agent have to match text.

## What agent-desktop does

- **Delivery** is one of `not_delivered`, `delivery_uncertain`, `delivered_unverified`,
  `delivered_verified` or `unknown`. Retry advice follows from it: `not_delivered` →
  `safe`, `unknown` → `unknown`, the rest → `unsafe`
  (`core/src/actions/delivery_semantics.rs`).
- **Postconditions** are read back after set-value, clear, type, check, uncheck, toggle,
  expand and collapse (`core/src/actions/post_action.rs`). It polls every 50 ms, up to
  400 ms.
  - A match gives `delivered_verified`, with `application_commit: not_verified`.
  - A mismatch gives `ACTION_FAILED`.
  - No evidence either way gives `delivered_unverified`, with a reason.
- **AX results are classified** (`actions/ax_mutation.rs`):
  - `APIDisabled` → permission denied;
  - `InvalidUIElement` → stale ref, not delivered;
  - `CannotComplete` → app unresponsive, uncertain;
  - `ActionUnsupported` → try the next step;
  - ambiguous results → settled by comparing state before and after (`activation_effect.rs`).
- **Idempotent `check` / `uncheck`** (`actions/toggle_state.rs`). Already in the
  requested state means `not_delivered`. Otherwise it writes `AXValue` if settable,
  settles for up to 600 ms, falls back to a press, and checks again.
- **Error codes** are a fixed set: `STALE_REF`, `AMBIGUOUS_TARGET`, `APP_UNRESPONSIVE`,
  `POLICY_DENIED`, `TIMEOUT`, `PERM_DENIED`… Each comes with `disposition.retry`.
- **AX timeout slicing.** Each call gets its own messaging timeout: min(remaining,
  250 ms) for reads, at least 250 ms for writes (`tree/properties/ax_ipc.rs`).

## Current state in ocu

- `act` replies are `{ok?, error?, target?, via?, note?}`.
- `insertText` already checks that the value changed.
- One global `AXUIElementSetMessagingTimeout(systemWide, 1.0)`.

## Plan

1. **Error codes.** Add `code` to helper errors: `unknown_ref`, `app_not_running`,
   `no_permission`, `screen_locked`, `app_unresponsive`, `not_supported`, `failed`,
   `bad_args`, `timeout`, plus `retry: "safe" | "unsafe"`.
   - Keep the human text: models read it.
   - The MCP reply shows the code next to the text.
   - The built-in agent (`agent.ts`) and `mcp.ts` switch on codes instead of strings.
2. **Classify AX results** as above, in one function used by every write.
3. **Read back postconditions** for `set_value`, `type` with a ref, checkboxes and pop-up
   buttons. Add `delivery: "verified" | "unverified" | "noop"` to the result only when
   it isn't the plain case, to keep replies short.
4. **Checkbox state.** Add `press{ref, state: true|false}`. It is idempotent: it returns
   `noop` when already in that state, and otherwise sets and verifies. This adds no new
   action name.
5. **Timeouts.** Shorter per-call AX timeouts for reads during `settle`, and longer ones
   for writes. Measure with `bench/perf.ts` that observe doesn't get slower.
6. **Docs.** Concepts (results and codes), MCP, and an "Errors in replies" table in
   troubleshooting with the codes, in both languages.

## Out of scope

agent-desktop's private-API element tokens (`_AXUIElementRemoteTokenCreate`). ocu keeps
refs alive inside one helper process and doesn't need them.

## Done when

- Fixture tests cover each code and each delivery value.
- `agent.test.ts` uses codes.
- The vs-benchmark and `bench/run.ts` show no regression in pass rate, time or reply
  size.
