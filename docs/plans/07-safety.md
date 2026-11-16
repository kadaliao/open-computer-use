# 07. Password fields and protected apps

- **Status:** planned
- **Priority:** P1. Small, and it closes risks before more people use ocu.
- **Depends on:** 04 (fixture has a secure field)
- **Size:** one session (short)

## Why

ocu reads screens and types for a model.

- **Password fields** are dropped from the list today (`AXSecureTextField` is not in
  `interactiveRoles`). So a model can't target one on purpose, but `type` without a ref
  can still land in a focused password field.
- **Nothing refuses** to act on the login window, the Dock, Keychain Access or a password
  manager.
- `SECURITY.md` promises that ocu doesn't read or send more than it should. These are
  the places where that is easiest to break.

## What agent-desktop does

- **Secure fields:** a field with role or subrole `AXSecureTextField` never has its
  `AXValue` read. It is listed with the state `secure`. Writing into it is allowed, but
  the value is never echoed back, and verification reports `secure_field` instead of
  comparing values (`tree/properties/node_attribute_names.rs`, `actions/post_state.rs`).
- **Protected processes:** `loginwindow`, `windowserver`, `dock`, `launchd` and `finder`
  can't be closed by `close-app` (`system/app/app_ops.rs`). The list is hardcoded.
- **Traces** replace `text`, `value`, `name`, `title`, `url`, `label`, `description` and
  `password` with `{"redacted":true}`.
- Quitting key combinations need `--force`.

## Plan

1. **List secure fields** as `e… SecureTextField "Password"`, never with a value. Make
   sure no path reads their value: `observe`, `find_text`, `innerText` and the change
   replies.
2. **Typing into them** works only with an explicit `ref` to the secure field. `type`
   without a ref refuses when the focused element is secure ("pass the ref of the
   password field"). The reply never repeats the text.
3. **Protected apps.** Refuse `observe` and `act` for `loginwindow` and `WindowServer`.
   ocu has no quit action, so agent-desktop's close-app list has nothing to protect
   here. Add a user list, `OCU_DENY_APPS` (names or bundle ids), refused entirely, for
   password managers and banking apps. Suggest it in the README safety section.
4. **Quitting.** Keep `cmd+q` allowed, because agents legitimately quit apps. Make sure
   the reply says plainly that the observed app quit (today `mcp.ts` silently follows
   the next frontmost app). agent-desktop requires `--force` for such keys; add
   friction like that only if a real incident shows it is needed.
5. **Redaction for later traces** (plan 12): a helper that blanks secure values and
   labels from any log line.
6. Tests in the fixture suite: the secure field's value never appears, typing works with
   a ref and is refused without one, and denied apps are refused.

## Done when

- The fixture shows secure fields listed without values, and every refusal above works.
- `SECURITY.md`, configuration, concepts and README safety text are updated in both
  languages, with changelog entries.
