// ocu-mac: macOS driver for open-computer-use. Line-delimited JSON over stdio.
// Requests: {"id":1,"cmd":"observe"} | {"id":2,"cmd":"act","action":"press","ref":"e3"} | ...
// Also draws an overlay: a virtual cursor that flies along a curve to the target,
// a click ripple, and a glow around the target window / element. Disable with OCU_OVERLAY=0.
import AppKit
import ApplicationServices

// MARK: - Accessibility

let interactiveRoles: Set<String> = ["AXButton", "AXTextField", "AXTextArea", "AXCheckBox", "AXRadioButton",
  "AXPopUpButton", "AXMenuItem", "AXMenuButton", "AXLink", "AXComboBox", "AXSlider", "AXTab", "AXCell", "AXRow",
  "AXSearchField", "AXStaticText"]
var refs: [String: AXUIElement] = [:]
var refInfo: [String: String] = [:]
var currentWindow: AXUIElement?
var currentApp: NSRunningApplication?  // the app we observed; keyboard input is sent to it

func attr(_ e: AXUIElement, _ name: String) -> AnyObject? {
  var v: AnyObject?
  return AXUIElementCopyAttributeValue(e, name as CFString, &v) == .success ? v : nil
}

/// Frame in AX (top-left origin) global coordinates.
func frame(_ e: AXUIElement) -> CGRect? {
  guard let p = attr(e, kAXPositionAttribute), let s = attr(e, kAXSizeAttribute) else { return nil }
  var pt = CGPoint.zero, sz = CGSize.zero
  AXValueGetValue(p as! AXValue, .cgPoint, &pt)
  AXValueGetValue(s as! AXValue, .cgSize, &sz)
  return CGRect(origin: pt, size: sz)
}

func label(_ e: AXUIElement) -> String {
  [kAXTitleAttribute, kAXDescriptionAttribute, kAXValueAttribute, kAXHelpAttribute, kAXPlaceholderValueAttribute]
    .compactMap { attr(e, $0) as? String }.first { !$0.isEmpty } ?? ""
}

/// Match the localized name ("计算器"), the bundle file name ("Calculator") or the bundle id.
func runningApp(_ name: String) -> NSRunningApplication? {
  let n = name.lowercased()
  let names = { (a: NSRunningApplication) -> [String] in
    [a.localizedName, a.bundleURL?.deletingPathExtension().lastPathComponent, a.bundleIdentifier].compactMap { $0?.lowercased() } }
  let apps = NSWorkspace.shared.runningApplications.filter { $0.activationPolicy == .regular }
  return apps.first { names($0).contains(n) } ?? apps.first { names($0).contains { $0.contains(n) } }
}

/// Texts inside an element (e.g. a table row's cells), for labelling rows that have no title of their own.
func innerText(_ e: AXUIElement, depth: Int = 0, into acc: inout [String]) {
  if depth > 4 || acc.count >= 3 { return }
  let role = attr(e, kAXRoleAttribute) as? String ?? ""
  if ["AXStaticText", "AXTextField"].contains(role), let v = attr(e, kAXValueAttribute) as? String, !v.isEmpty { acc.append(v); return }
  for c in (attr(e, kAXChildrenAttribute) as? [AXUIElement]) ?? [] { innerText(c, depth: depth + 1, into: &acc) }
}

/// The table row an element sits in (itself, or an ancestor a few levels up).
func enclosingRow(_ e: AXUIElement) -> AXUIElement? {
  var node: AXUIElement? = e
  for _ in 0..<4 {
    guard let n = node else { return nil }
    if (attr(n, kAXRoleAttribute) as? String) == "AXRow" { return n }
    node = attr(n, kAXParentAttribute).map { $0 as! AXUIElement }
  }
  return nil
}

var collectDeadline = Date.distantFuture  // observe gives up after a few seconds on huge or slow apps
func collect(_ e: AXUIElement, depth: Int, out: inout [[String: Any]], inRow: Bool = false) {
  if depth > 40 || out.count > 400 || Date() > collectDeadline { return }
  let role = attr(e, kAXRoleAttribute) as? String ?? ""
  // A row already carries its cells' text in its label, so the cells themselves would only repeat it
  // (Finder lists 5 lines per file otherwise). Buttons and checkboxes inside rows are still listed.
  let cellish = ["AXCell", "AXStaticText", "AXTextField", "AXImage"].contains(role)
  var rowLabelled = false
  if interactiveRoles.contains(role) && !(inRow && cellish) {
    var l = String(label(e).prefix(80))
    if role == "AXRow" && l.isEmpty { var t: [String] = []; innerText(e, into: &t); l = String(t.joined(separator: " | ").prefix(80)) }
    if role == "AXRow" && !l.isEmpty { rowLabelled = true }
    // Static text is only useful as context when it says something.
    if !(["AXStaticText", "AXCell"].contains(role) && l.isEmpty) {
      let ref = "e\(refs.count)"
      refs[ref] = e
      let r = String(role.dropFirst(2)).replacingOccurrences(of: "StaticText", with: "Text")
      refInfo[ref] = "\(r) \(l)"
      var item: [String: Any] = ["ref": ref, "role": r, "label": l]
      if let f = frame(e) { item["f"] = [Int(f.minX), Int(f.minY), Int(f.width), Int(f.height)] }
      out.append(item)
    }
  }
  // Long lists (hundreds of notes, files, messages) would use up the element budget and hide the rest of
  // the window, so only their visible rows (or the first 30) are listed.
  var kids = (attr(e, kAXChildrenAttribute) as? [AXUIElement]) ?? []
  if ["AXTable", "AXOutline", "AXList"].contains(role) {
    let total = (attr(e, kAXRowsAttribute) as? [AXUIElement])?.count ?? kids.count
    if let vis = attr(e, kAXVisibleRowsAttribute) as? [AXUIElement], !vis.isEmpty { kids = vis }
    else if let vis = attr(e, kAXVisibleChildrenAttribute) as? [AXUIElement], !vis.isEmpty { kids = vis }
    kids = Array(kids.prefix(30))
    // Say so when rows are hidden, so the caller scrolls instead of assuming the list is complete.
    if total > kids.count {
      let ref = "e\(refs.count)"; refs[ref] = e
      let l = "showing \(kids.count) of \(total) rows: scroll{ref:\"\(ref)\"} for more, or find_text"
      refInfo[ref] = "List \(l)"
      out.append(["ref": ref, "role": "List", "label": l])
    }
  }
  for c in kids { collect(c, depth: depth + 1, out: &out, inRow: inRow || rowLabelled) }
}

// NSWorkspace.frontmostApplication goes stale without a run loop; the window list is reliable.
func frontmostApp() -> NSRunningApplication? {
  let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
  for w in list where (w[kCGWindowLayer as String] as? Int) == 0 {
    if let pid = w[kCGWindowOwnerPID as String] as? pid_t, pid != getpid(),
       let app = NSRunningApplication(processIdentifier: pid), app.activationPolicy == .regular { return app }
  }
  return NSWorkspace.shared.frontmostApplication
}

func observe(_ appName: String? = nil) -> [String: Any] {
  refs = [:]; refInfo = [:]
  if !AXIsProcessTrusted() { return ["error": noPermission] }
  // A locked screen hides every window from accessibility (only menu bars remain), which looks like a broken app.
  if let d = CGSessionCopyCurrentDictionary() as? [String: Any], (d["CGSSessionScreenIsLocked"] as? Bool) == true {
    return ["error": "the screen is locked, so no app windows can be read or used. Ask the user to unlock the Mac; retrying won't help."]
  }
  var target: NSRunningApplication? = nil
  if let n = appName, !n.isEmpty {
    target = runningApp(n)
    if target == nil { return ["error": "app not running: \(n)"] }
  }
  guard let app = target ?? frontmostApp() else { return ["error": "no frontmost app"] }
  currentApp = app
  let root = AXUIElementCreateApplication(app.processIdentifier)
  var els: [[String: Any]] = []
  // Background apps often report no focused window; fall back to the main or first window so we never
  // walk the whole app (its closed menus alone would use up the element budget).
  // Some apps answer with the application element itself when no window is open: only accept real windows.
  let isWindow = { (e: AXUIElement) in ["AXWindow", "AXSheet", "AXDialog"].contains(attr(e, kAXRoleAttribute) as? String ?? "") }
  let candidates = [attr(root, kAXFocusedWindowAttribute), attr(root, kAXMainWindowAttribute)].compactMap { $0.map { $0 as! AXUIElement } }
    + ((attr(root, kAXWindowsAttribute) as? [AXUIElement]) ?? [])
  let win = candidates.first(where: isWindow)
  currentWindow = win
  // Bring the chosen window to the front so the user sees what the agent is working on.
  raiseTarget()
  collectDeadline = Date().addingTimeInterval(3)
  if let w = win { collect(w, depth: 0, out: &els) }
  // Menu bar items are reachable even when the window has little to offer. Only an open menu's items are
  // listed: closed menus would add hundreds of lines nobody asked for (menu{path} reaches them anyway).
  if let bar = attr(root, kAXMenuBarAttribute) {
    for item in (attr(bar as! AXUIElement, kAXChildrenAttribute) as? [AXUIElement] ?? []).dropFirst() {
      let ref = "e\(refs.count)"; refs[ref] = item
      let l = label(item); refInfo[ref] = "MenuBarItem \(l)"
      els.append(["ref": ref, "role": "MenuBarItem", "label": l])
      if (attr(item, kAXSelectedAttribute) as? Bool) == true { collect(item, depth: 0, out: &els) }
    }
  }
  if let w = win, let f = frame(w) { Overlay.shared.glowWindow(f) }
  let title = win.map { attr($0, kAXTitleAttribute) as? String ?? "" } ?? "(no open window: open one with key cmd+n or a menu)"
  // Other windows of the app, so the caller knows what's behind the focused one (e.g. a pile of info windows).
  let others = ((attr(root, kAXWindowsAttribute) as? [AXUIElement]) ?? [])
    .filter { w in isWindow(w) && !(win.map { CFEqual($0, w) } ?? false) }
    .map { attr($0, kAXTitleAttribute) as? String ?? "" }
  return ["app": app.localizedName ?? "", "window": title, "elements": els, "others": others]
}

// MARK: - Text search

/// Search the whole front window (no element cap) for text containing `query`.
/// Each hit returns the text of its parent group, so "Born" also brings "23 June 1912".
func findText(_ query: String) -> [String: Any] {
  guard let app = currentApp ?? frontmostApp() else { return ["error": "no app"] }
  let root = AXUIElementCreateApplication(app.processIdentifier)
  guard let win = attr(root, kAXFocusedWindowAttribute) else { return ["error": "no window"] }
  let q = query.lowercased()
  var hits: [String] = []
  var visited = 0
  func texts(_ e: AXUIElement, _ depth: Int, _ acc: inout [String]) {
    if depth > 6 || acc.count > 30 { return }
    let l = label(e); if !l.isEmpty { acc.append(l) }
    for c in (attr(e, kAXChildrenAttribute) as? [AXUIElement]) ?? [] { texts(c, depth + 1, &acc) }
  }
  // Climb up to 3 ancestors until the context says more than the hit itself (e.g. table header -> row).
  func walk(_ e: AXUIElement, _ depth: Int, _ ancestors: [AXUIElement]) {
    visited += 1
    if depth > 80 || visited > 20000 || hits.count >= 40 { return }
    let l = label(e)
    if !l.isEmpty && l.lowercased().contains(q) {
      var joined = l
      for a in ancestors.suffix(3).reversed() {
        var ctx: [String] = []
        texts(a, 0, &ctx)
        var seen = Set<String>()
        joined = ctx.filter { seen.insert($0).inserted }.joined(separator: " | ")
        if joined.count >= l.count + 30 { break }
      }
      if !hits.contains(where: { $0.hasPrefix(String(joined.prefix(300))) }) { hits.append(String(joined.prefix(300))) }
    }
    let next = ancestors.count > 3 ? Array(ancestors.suffix(3)) + [e] : ancestors + [e]
    for c in (attr(e, kAXChildrenAttribute) as? [AXUIElement]) ?? [] { walk(c, depth + 1, next) }
  }
  walk(win as! AXUIElement, 0, [])
  return ["hits": hits, "truncated": hits.count >= 40]
}

// MARK: - Screenshot

/// Capture the observed app's front window. Returns file path, the window frame (global, top-left origin,
/// in points) and the image size in pixels, so callers can map image coordinates back to the screen.
func screenshot() -> [String: Any] {
  guard let app = currentApp ?? frontmostApp() else { return ["error": "no app"] }
  let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
  let mine = list.filter { ($0[kCGWindowOwnerPID as String] as? pid_t) == app.processIdentifier && ($0[kCGWindowLayer as String] as? Int) == 0 }
  let area = { (w: [String: Any]) -> CGFloat in let b = w[kCGWindowBounds as String] as? [String: CGFloat] ?? [:]; return (b["Width"] ?? 0) * (b["Height"] ?? 0) }
  // Prefer the window we observed (matched by frame); otherwise the biggest one, not some tiny helper window.
  let target = currentWindow.flatMap(frame)
  let match = target.flatMap { t in mine.first { w in
    let b = w[kCGWindowBounds as String] as? [String: CGFloat] ?? [:]
    return abs((b["X"] ?? 0) - t.minX) < 2 && abs((b["Y"] ?? 0) - t.minY) < 2 && abs((b["Width"] ?? 0) - t.width) < 2 } }
  guard let w = match ?? mine.max(by: { area($0) < area($1) }),
        let wid = w[kCGWindowNumber as String] as? Int,
        let b = w[kCGWindowBounds as String] as? [String: CGFloat] else { return ["error": "no window"] }
  let path = NSTemporaryDirectory() + "ocu-shot-\(getpid()).png"
  let p = Process()
  p.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture")
  p.arguments = ["-x", "-o", "-l", "\(wid)", path]
  do { try p.run(); p.waitUntilExit() } catch { return ["error": "\(error)"] }
  guard let img = NSImage(contentsOfFile: path), let rep = img.representations.first else { return ["error": "capture failed (Screen Recording permission?)"] }
  return ["path": path, "x": b["X"] ?? 0, "y": b["Y"] ?? 0, "w": b["Width"] ?? 0, "h": b["Height"] ?? 0,
          "px_w": rep.pixelsWide, "px_h": rep.pixelsHigh]
}

// MARK: - Input

let keyCodes: [String: CGKeyCode] = [
  "a": 0, "s": 1, "d": 2, "f": 3, "h": 4, "g": 5, "z": 6, "x": 7, "c": 8, "v": 9, "b": 11, "q": 12, "w": 13, "e": 14,
  "r": 15, "y": 16, "t": 17, "1": 18, "2": 19, "3": 20, "4": 21, "6": 22, "5": 23, "=": 24, "9": 25, "7": 26, "-": 27,
  "8": 28, "0": 29, "]": 30, "o": 31, "u": 32, "[": 33, "i": 34, "p": 35, "l": 37, "j": 38, "'": 39, "k": 40, ";": 41,
  "\\": 42, ",": 43, "/": 44, "n": 45, "m": 46, ".": 47, "`": 50,
  "return": 36, "enter": 36, "tab": 48, "space": 49, "delete": 51, "backspace": 51, "escape": 53, "esc": 53,
  "forwarddelete": 117, "home": 115, "end": 119, "pageup": 116, "pagedown": 121,
  "left": 123, "right": 124, "down": 125, "up": 126]

/// Make sure keystrokes land in the app we observed, not whatever holds system focus.
func focusTarget() {
  guard let app = currentApp else { return }
  // Always activate: the cached frontmost/isActive values can be stale.
  app.activate()
  if let w = currentWindow { AXUIElementPerformAction(w, kAXRaiseAction as CFString) }
  Thread.sleep(forTimeInterval: 0.1)
}

/// Activate the observed app and raise the observed window above the app's other windows.
func raiseTarget() {
  guard let app = currentApp else { return }
  if let w = currentWindow {
    AXUIElementSetAttributeValue(w, kAXMainAttribute as CFString, kCFBooleanTrue)
    AXUIElementPerformAction(w, kAXRaiseAction as CFString)
  }
  if !app.isActive { app.activate(); Thread.sleep(forTimeInterval: 0.15) }
}

// Input goes through the normal system path; focusTarget() has already put the observed app in front.
// (Posting straight to the app's pid drops typed text in apps like Notes.)
func send(_ ev: CGEvent?) { ev?.post(tap: .cghidEventTap) }

/// Press modifiers down for real and release them afterwards: flags on the key event alone can leave
/// the system thinking a modifier is still held (selection kept extending, later clicks shift-clicked).
func postKey(_ code: CGKeyCode, flags: CGEventFlags = []) {
  let mods: [(CGEventFlags, CGKeyCode)] = [(.maskCommand, 55), (.maskShift, 56), (.maskAlternate, 58), (.maskControl, 59)].filter { flags.contains($0.0) }
  var held: CGEventFlags = []
  func post(_ k: CGKeyCode, _ down: Bool) {
    let ev = CGEvent(keyboardEventSource: nil, virtualKey: k, keyDown: down); ev?.flags = held; send(ev)
  }
  for (f, k) in mods { held.insert(f); post(k, true) }
  post(code, true); post(code, false)
  for (f, k) in mods.reversed() { held.remove(f); post(k, false) }
}

/// Click a menu item by its title path, e.g. ["前往", "下载"]. Matches titles exactly first, then by prefix.
func pressMenu(_ path: [String]) -> String? {
  guard let app = currentApp, !path.isEmpty else { return "no app or empty path" }
  let root = AXUIElementCreateApplication(app.processIdentifier)
  guard let bar = attr(root, kAXMenuBarAttribute) else { return "no menu bar" }
  var node = bar as! AXUIElement
  for (i, name) in path.enumerated() {
    var kids = attr(node, kAXChildrenAttribute) as? [AXUIElement] ?? []
    // A menu bar item / submenu item holds its items inside an AXMenu child.
    if i > 0, let menu = kids.first(where: { (attr($0, kAXRoleAttribute) as? String) == "AXMenu" }) {
      kids = attr(menu, kAXChildrenAttribute) as? [AXUIElement] ?? []
    }
    let titled = kids.map { ($0, (attr($0, kAXTitleAttribute) as? String ?? "").trimmingCharacters(in: .whitespaces)) }
    guard let hit = titled.first(where: { $0.1 == name }) ?? titled.first(where: { !$0.1.isEmpty && $0.1.hasPrefix(name) }) else {
      let options = titled.map(\.1).filter { !$0.isEmpty }.prefix(30).joined(separator: ", ")
      return "menu item '\(name)' not found; options: \(options)"
    }
    node = hit.0
  }
  if let f = frame(node) { Overlay.shared.moveCursor(to: f); Overlay.shared.ripple() }
  return AXUIElementPerformAction(node, kAXPressAction as CFString) == .success ? nil : "press failed"
}

func inWebArea(_ e: AXUIElement) -> Bool {
  var node: AXUIElement? = e
  for _ in 0..<40 {
    guard let n = node else { return false }
    if (attr(n, kAXRoleAttribute) as? String) == "AXWebArea" { return true }
    node = attr(n, kAXParentAttribute).map { $0 as! AXUIElement }
  }
  return false
}

func clickAt(_ p: CGPoint) {
  CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: p, mouseButton: .left)?.post(tap: .cghidEventTap)
  usleep(20_000)
  for t in [CGEventType.leftMouseDown, .leftMouseUp] {
    CGEvent(mouseEventSource: nil, mouseType: t, mouseCursorPosition: p, mouseButton: .left)?.post(tap: .cghidEventTap)
  }
}

func act(_ r: [String: Any]) -> [String: Any] {
  let action = r["action"] as? String ?? ""
  if !AXIsProcessTrusted() && !["open_app", "open_url"].contains(action) { return ["error": noPermission] }
  let ref = r["ref"] as? String
  let el = ref.flatMap { refs[$0] }
  var res: [String: Any] = [:]
  if let ref, let info = refInfo[ref] { res["target"] = info }
  if let el, let f = frame(el) { Overlay.shared.moveCursor(to: f) }

  switch r["action"] as? String {
  case "press":
    guard let el else { return ["error": "unknown ref"] }
    Overlay.shared.ripple()
    // A file name or cell in a table: AXPress on it does nothing, so select its row instead.
    // extend:true adds the row to the current selection (like cmd-click).
    let role = attr(el, kAXRoleAttribute) as? String ?? ""
    if ["AXRow", "AXCell", "AXStaticText", "AXTextField", "AXImage"].contains(role), let row = enclosingRow(el),
       let table = attr(row, kAXParentAttribute).map({ $0 as! AXUIElement }) {
      var rows = (r["extend"] as? Bool) == true ? (attr(table, kAXSelectedRowsAttribute) as? [AXUIElement]) ?? [] : []
      if !rows.contains(where: { CFEqual($0, row) }) { rows.append(row) }
      if AXUIElementSetAttributeValue(table, kAXSelectedRowsAttribute as CFString, rows as CFArray) == .success {
        res["via"] = "select"; res["selected"] = rows.count
        break
      }
    }
    // Plain text reports success for AXPress but does nothing, so click it for real.
    let isText = (attr(el, kAXRoleAttribute) as? String) == "AXStaticText"
    // Web content (Electron apps, browsers) often answers AXPress with "success" and ignores it:
    // pages listen for mouse events. Click those for real.
    if inWebArea(el), let f = frame(el), f.width > 0 {
      // A click that lands while the app is still coming forward gets lost, so give activation time.
      let wasFront = frontmostApp()?.processIdentifier == currentApp?.processIdentifier
      focusTarget()
      if !wasFront { Thread.sleep(forTimeInterval: 0.35) }
      Thread.sleep(forTimeInterval: 0.1)
      let saved = CGEvent(source: nil)?.location
      clickAt(CGPoint(x: f.midX, y: f.midY))
      if let saved { usleep(30_000); CGWarpMouseCursorPosition(saved) }
      res["via"] = "click"
    } else if isText || AXUIElementPerformAction(el, kAXPressAction as CFString) != .success {
      // Some elements (cells, rows, text) have no press action; fall back to a real click at their center.
      guard let f = frame(el) else { return ["error": "press failed"] }
      clickAt(CGPoint(x: f.midX, y: f.midY))
    }
  case "set_value":
    guard let el, let t = r["text"] as? String else { return ["error": "bad args"] }
    AXUIElementSetAttributeValue(el, kAXFocusedAttribute as CFString, kCFBooleanTrue)
    if AXUIElementSetAttributeValue(el, kAXValueAttribute as CFString, t as CFString) != .success { return ["error": "set failed"] }
  case "type":
    let text = r["text"] as? String ?? ""
    if let el {
      // Insert at the caret through accessibility: no dependence on keyboard focus.
      AXUIElementSetAttributeValue(el, kAXFocusedAttribute as CFString, kCFBooleanTrue)
      let before = attr(el, kAXValueAttribute) as? String
      if AXUIElementSetAttributeValue(el, kAXSelectedTextAttribute as CFString, text as CFString) == .success,
         (attr(el, kAXValueAttribute) as? String) != before {
        res["via"] = "ax"
        break
      }
    }
    focusTarget()
    res["via"] = "keyboard"
    for ch in text.utf16 {
      for down in [true, false] {
        let ev = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: down)
        var c = ch
        ev?.keyboardSetUnicodeString(stringLength: 1, unicodeString: &c)
        ev?.flags = []
        send(ev)
      }
    }
  case "key":
    // "return", "cmd+n", "cmd+shift+left" ...
    let parts = (r["key"] as? String ?? "").lowercased().split(separator: "+").map(String.init)
    var flags: CGEventFlags = []
    for m in parts.dropLast() {
      switch m {
      case "cmd", "command": flags.insert(.maskCommand)
      case "shift": flags.insert(.maskShift)
      case "alt", "option": flags.insert(.maskAlternate)
      case "ctrl", "control": flags.insert(.maskControl)
      default: break
      }
    }
    guard let k = parts.last.flatMap({ keyCodes[$0] }) else { return ["error": "unknown key"] }
    focusTarget()
    let times = max(1, min(50, (r["repeat"] as? Int) ?? 1))
    for i in 0..<times { if i > 0 { usleep(30_000) }; postKey(k, flags: flags) }
  case "scroll":
    // Scroll wheel over the element (or the observed window). direction: down/up, amount in pages-ish lines.
    // A table's own frame spans all its rows (mostly off-screen): aim at the visible part of it.
    let win = currentWindow.flatMap(frame)
    var f = el.flatMap(frame) ?? win
    if let e = el, let p = attr(e, kAXParentAttribute).map({ $0 as! AXUIElement }),
       (attr(p, kAXRoleAttribute) as? String) == "AXScrollArea", let pf = frame(p) { f = pf }
    if let w = win, let g = f { f = g.intersection(w).isNull ? w : g.intersection(w) }
    guard let f else { return ["error": "nothing to scroll"] }
    focusTarget()
    let lines = Int32(((r["amount"] as? Int) ?? 10)) * ((r["direction"] as? String) == "up" ? 1 : -1)
    let saved = CGEvent(source: nil)?.location
    CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: CGPoint(x: f.midX, y: f.midY), mouseButton: .left)?.post(tap: .cghidEventTap)
    usleep(30_000)
    CGEvent(scrollWheelEvent2Source: nil, units: .line, wheelCount: 1, wheel1: lines, wheel2: 0, wheel3: 0)?.post(tap: .cghidEventTap)
    usleep(150_000)
    if let saved { CGWarpMouseCursorPosition(saved) }
  case "find_text":
    let found = findText(r["query"] as? String ?? "")
    if let err = found["error"] { return ["error": err] }
    let hits = found["hits"] as? [String] ?? []
    res["note"] = hits.isEmpty ? "no text found" : hits.joined(separator: "\n")
      + ((found["truncated"] as? Bool) == true ? "\n(only the first \(hits.count) hits; use a more specific text)" : "")
  case "click_at":
    // Global point (top-left origin). Real click; the user's cursor is put back afterwards.
    guard let x = r["x"] as? Double, let y = r["y"] as? Double else { return ["error": "click_at needs x,y"] }
    let pt = CGPoint(x: x, y: y)
    Overlay.shared.moveCursor(to: CGRect(x: x - 12, y: y - 12, width: 24, height: 24))
    Overlay.shared.ripple()
    focusTarget()
    let saved = CGEvent(source: nil)?.location
    clickAt(pt)
    if let saved { usleep(30_000); CGWarpMouseCursorPosition(saved) }
    res["target"] = "Point \(Int(x)),\(Int(y))"
  case "menu":
    guard let path = r["path"] as? [String] else { return ["error": "menu needs path"] }
    focusTarget()
    if let err = pressMenu(path) { return ["error": err] }
    res["target"] = "Menu " + path.joined(separator: " > ")
  case "open_app":
    let name = r["name"] as? String ?? ""
    let p = Process()
    p.executableURL = URL(fileURLWithPath: "/usr/bin/open")
    p.arguments = ["-a", name]
    do { try p.run(); p.waitUntilExit() } catch { return ["error": "\(error)"] }
    if p.terminationStatus != 0 { return ["error": "no app named \(name)"] }
    // `open` succeeds even when the app dies on launch, so wait until it is really running (Electron apps
    // take a few seconds) and say so if it never shows up.
    var up = false
    for _ in 0..<40 { if runningApp(name) != nil { up = true; break }; Thread.sleep(forTimeInterval: 0.2) }
    if !up { return ["error": "\(name) was launched but is not running (it quit on start or is still loading); retry once with open_app, then report it"] }
    Thread.sleep(forTimeInterval: 0.6)
    // Later keystrokes in the same batch must go to this app, not the one observed before.
    if let a = runningApp(name) ?? frontmostApp() {
      currentApp = a
      let root = AXUIElementCreateApplication(a.processIdentifier)
      currentWindow = [kAXFocusedWindowAttribute, kAXMainWindowAttribute].lazy.compactMap { attr(root, $0).map { $0 as! AXUIElement } }.first
    }
  case "open_url":
    guard let u = URL(string: r["url"] as? String ?? "") else { return ["error": "bad url"] }
    NSWorkspace.shared.open(u)
    Thread.sleep(forTimeInterval: 1.0)
  default: return ["error": "unknown action"]
  }
  res["ok"] = true
  return res
}

// MARK: - Overlay

final class OverlayView: NSView {
  var cursor: CGPoint?            // view coordinates
  var windowGlow: CGRect?
  var elementGlow: CGRect?
  var rippleAt: CGPoint?
  var rippleT: CGFloat = 0
  let accent = NSColor(calibratedRed: 0.95, green: 0.55, blue: 0.2, alpha: 1)

  override func draw(_ dirty: NSRect) {
    if let w = windowGlow {
      for (i, a) in [(0, 0.9), (3, 0.35), (7, 0.15)] {
        accent.withAlphaComponent(a).setStroke()
        let p = NSBezierPath(roundedRect: w.insetBy(dx: CGFloat(-i), dy: CGFloat(-i)), xRadius: 12, yRadius: 12)
        p.lineWidth = 3; p.stroke()
      }
    }
    if let e = elementGlow {
      accent.withAlphaComponent(0.18).setFill()
      let p = NSBezierPath(roundedRect: e.insetBy(dx: -3, dy: -3), xRadius: 6, yRadius: 6)
      p.fill(); accent.setStroke(); p.lineWidth = 2; p.stroke()
    }
    if let r = rippleAt, rippleT > 0 {
      let rad = 8 + 26 * (1 - rippleT)
      accent.withAlphaComponent(rippleT * 0.8).setStroke()
      let p = NSBezierPath(ovalIn: CGRect(x: r.x - rad, y: r.y - rad, width: rad * 2, height: rad * 2))
      p.lineWidth = 3; p.stroke()
    }
    if let c = cursor {
      // Arrow cursor with its tip at c.
      let pts: [CGPoint] = [(0, 0), (0, -20), (5, -15), (9, -24), (12, -23), (8, -14), (15, -14)].map { CGPoint(x: c.x + $0.0, y: c.y + $0.1) }
      let path = NSBezierPath(); path.move(to: pts[0]); pts.dropFirst().forEach { path.line(to: $0) }; path.close()
      NSGraphicsContext.current?.saveGraphicsState()
      let sh = NSShadow(); sh.shadowBlurRadius = 4; sh.shadowColor = .black.withAlphaComponent(0.4); sh.set()
      accent.setFill(); path.fill()
      NSGraphicsContext.current?.restoreGraphicsState()
      NSColor.white.setStroke(); path.lineWidth = 1.5; path.stroke()
    }
  }
}

final class Overlay {
  static let shared = Overlay()
  let enabled = ProcessInfo.processInfo.environment["OCU_OVERLAY"] != "0"
  var window: NSWindow!
  var view: OverlayView!
  var primaryHeight: CGFloat = 0
  var origin: CGPoint = .zero   // overlay window origin in Cocoa global coords

  func setup() {
    guard enabled else { return }
    primaryHeight = NSScreen.screens.first?.frame.height ?? 0
    let union = NSScreen.screens.reduce(CGRect.null) { $0.union($1.frame) }
    origin = union.origin
    window = NSWindow(contentRect: union, styleMask: .borderless, backing: .buffered, defer: false)
    window.isOpaque = false
    window.backgroundColor = .clear
    window.ignoresMouseEvents = true
    window.level = .screenSaver
    window.hasShadow = false
    window.collectionBehavior = [.canJoinAllSpaces, .stationary, .fullScreenAuxiliary]
    view = OverlayView(frame: CGRect(origin: .zero, size: union.size))
    window.contentView = view
    window.orderFrontRegardless()
  }

  /// AX rect (top-left origin) -> overlay view rect (bottom-left origin).
  func toView(_ r: CGRect) -> CGRect {
    CGRect(x: r.minX - origin.x, y: primaryHeight - r.maxY - origin.y, width: r.width, height: r.height)
  }

  func onMain(_ f: @escaping () -> Void) { if enabled { DispatchQueue.main.async(execute: f) } }

  /// The helper outlives each action, so clear the highlight once things go quiet;
  /// otherwise it sits on a window the agent has long since left.
  var activity = 0
  func scheduleClear() {
    activity += 1
    let mine = activity
    DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
      guard mine == self.activity else { return }
      self.view.windowGlow = nil; self.view.elementGlow = nil; self.view.cursor = nil
      self.view.needsDisplay = true
    }
  }

  func glowWindow(_ axFrame: CGRect) {
    onMain { self.view.windowGlow = self.toView(axFrame); self.view.elementGlow = nil; self.view.needsDisplay = true; self.scheduleClear() }
  }

  /// Fly the virtual cursor along a curved path to the element and highlight it. Blocks until done.
  func moveCursor(to axFrame: CGRect) {
    guard enabled else { return }
    let target = toView(axFrame)
    let end = CGPoint(x: target.midX, y: target.midY)
    let done = DispatchSemaphore(value: 0)
    DispatchQueue.main.async {
      self.view.elementGlow = nil  // lit when the cursor arrives, so both land together
      let start = self.view.cursor ?? CGPoint(x: end.x - 160, y: end.y - 120)
      let dx = end.x - start.x, dy = end.y - start.y
      let dist = max(hypot(dx, dy), 1)
      // Control point pushed sideways from the midpoint gives the arc.
      let bend = min(dist * 0.3, 140)
      let ctrl = CGPoint(x: (start.x + end.x) / 2 - dy / dist * bend, y: (start.y + end.y) / 2 + dx / dist * bend)
      let duration = min(0.15 + Double(dist) / 3000, 0.4)
      let t0 = CACurrentMediaTime()
      Timer.scheduledTimer(withTimeInterval: 1.0 / 120, repeats: true) { timer in
        let raw = min((CACurrentMediaTime() - t0) / duration, 1)
        let t = CGFloat(raw < 0.5 ? 4 * raw * raw * raw : 1 - pow(-2 * raw + 2, 3) / 2)  // ease in-out
        let u = 1 - t
        self.view.cursor = CGPoint(x: u * u * start.x + 2 * u * t * ctrl.x + t * t * end.x,
                                   y: u * u * start.y + 2 * u * t * ctrl.y + t * t * end.y)
        self.view.needsDisplay = true
        if raw >= 1 { self.view.elementGlow = target; timer.invalidate(); self.scheduleClear(); done.signal() }
      }
    }
    done.wait()
  }

  func ripple() {
    onMain {
      guard let c = self.view.cursor else { return }
      self.view.rippleAt = c
      self.view.rippleT = 1
      Timer.scheduledTimer(withTimeInterval: 1.0 / 60, repeats: true) { timer in
        self.view.rippleT -= 0.06
        self.view.needsDisplay = true
        if self.view.rippleT <= 0 { timer.invalidate() }
      }
    }
  }
}

// MARK: - Main

// Without permission macOS returns empty trees, not errors. Ask once, which adds the launching app
// (terminal, DeepSeek Harness, ...) to System Settings > Accessibility, so the user only has to tick it.
if !AXIsProcessTrustedWithOptions([kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary) {
  FileHandle.standardError.write("ocu-mac: Accessibility permission missing for the app that launched ocu\n".data(using: .utf8)!)
}
let noPermission = "Accessibility permission is missing for the app that launched ocu (e.g. DeepSeek Harness or your terminal). Tick it in System Settings > Privacy & Security > Accessibility, then restart that app. Until then nothing can be read or pressed."

// A hung app would otherwise block each AX call for 6 s.
AXUIElementSetMessagingTimeout(AXUIElementCreateSystemWide(), 1.0)

let app = NSApplication.shared
app.setActivationPolicy(.accessory)  // no Dock icon, never steals focus
Overlay.shared.setup()

Thread.detachNewThread {
  // Hosts built on Electron (DeepSeek Harness, VS Code...) set this for their child processes. Passed on
  // to an app we open, it makes Electron apps (WorkBuddy, Slack...) start as plain Node and quit at once.
  for k in ["ELECTRON_RUN_AS_NODE", "ELECTRON_NO_ATTACH_CONSOLE"] { unsetenv(k) }
  while let line = readLine() {
    guard let req = (try? JSONSerialization.jsonObject(with: Data(line.utf8))) as? [String: Any] else { continue }
    let cmd = req["cmd"] as? String
    var res: [String: Any] = cmd == "trust" ? ["trusted": AXIsProcessTrusted()] : cmd == "observe" ? observe(req["app"] as? String) : cmd == "screenshot" ? screenshot() : act(req)
    res["id"] = req["id"] ?? NSNull()
    let data = try! JSONSerialization.data(withJSONObject: res)
    print(String(data: data, encoding: .utf8)!)
    fflush(stdout)
  }
  exit(0)
}
app.run()
