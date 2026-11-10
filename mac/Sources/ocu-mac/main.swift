// ocu-mac: macOS driver for open-computer-use. Line-delimited JSON over stdio.
// Requests: {"id":1,"cmd":"observe"} | {"id":2,"cmd":"act","action":"press","ref":"e3"} | ...
// Also draws an overlay: a virtual cursor that flies along a curve to the target,
// a click ripple, and a glow around the target window / element. Disable with OCU_OVERLAY=0.
import AppKit
import ApplicationServices
import ImageIO
import ScreenCaptureKit

// MARK: - Accessibility

let interactiveRoles: Set<String> = ["AXButton", "AXTextField", "AXTextArea", "AXCheckBox", "AXRadioButton",
  "AXPopUpButton", "AXMenuItem", "AXMenuButton", "AXLink", "AXComboBox", "AXSlider", "AXTab", "AXCell", "AXRow",
  "AXSearchField", "AXStaticText"]
var currentWindow: AXUIElement?
var currentApp: NSRunningApplication?  // the app we observed; keyboard input is sent to it
let systemWide = AXUIElementCreateSystemWide()

func attr(_ e: AXUIElement, _ name: String) -> AnyObject? {
  var v: AnyObject?
  return AXUIElementCopyAttributeValue(e, name as CFString, &v) == .success ? v : nil
}

/// Several attributes in one round trip to the app (each attribute read is an IPC call; trees have hundreds
/// of nodes). Missing attributes come back as nil.
func attrs(_ e: AXUIElement, _ names: [String]) -> [AnyObject?] {
  var out: CFArray?
  let err = AXUIElementCopyMultipleAttributeValues(e, names as CFArray, [], &out)
  // An element that is gone or an app that doesn't answer gets nothing; reading the attributes one by one
  // would only wait out the timeout once per attribute. Any other refusal: read them one by one.
  if err == .invalidUIElement || err == .cannotComplete { return names.map { _ in nil } }
  guard err == .success, let vals = out as [AnyObject]?, vals.count == names.count else { return names.map { attr(e, $0) } }
  return vals.map { v in
    if v is NSNull { return nil }
    if CFGetTypeID(v) == AXValueGetTypeID(), AXValueGetType(v as! AXValue) == .axError { return nil }
    return v
  }
}

func rect(_ p: AnyObject?, _ s: AnyObject?) -> CGRect? {
  guard let p, let s, CFGetTypeID(p) == AXValueGetTypeID(), CFGetTypeID(s) == AXValueGetTypeID() else { return nil }
  var pt = CGPoint.zero, sz = CGSize.zero
  AXValueGetValue(p as! AXValue, .cgPoint, &pt)
  AXValueGetValue(s as! AXValue, .cgSize, &sz)
  return CGRect(origin: pt, size: sz)
}

/// Frame in AX (top-left origin) global coordinates.
func frame(_ e: AXUIElement) -> CGRect? {
  let v = attrs(e, [kAXPositionAttribute, kAXSizeAttribute])
  return rect(v[0], v[1])
}

/// What one tree walk needs to know about a node, read in a single call.
struct Node {
  static let names = [kAXRoleAttribute, kAXTitleAttribute, kAXDescriptionAttribute, kAXValueAttribute, kAXHelpAttribute,
    kAXPlaceholderValueAttribute, kAXPositionAttribute, kAXSizeAttribute, kAXChildrenAttribute, kAXEnabledAttribute,
    kAXSelectedAttribute, kAXMenuItemMarkCharAttribute]
  let role, title, desc, help, placeholder, mark: String
  let value: AnyObject?
  let frame: CGRect?
  let children: [AXUIElement]
  let enabled, selected: Bool?
  init(_ e: AXUIElement) {
    let v = attrs(e, Node.names)
    let s = { (i: Int) in v[i] as? String ?? "" }
    role = s(0); title = s(1); desc = s(2); value = v[3]; help = s(4); placeholder = s(5)
    frame = rect(v[6], v[7]); children = v[8] as? [AXUIElement] ?? []
    enabled = v[9] as? Bool; selected = v[10] as? Bool; mark = s(11)
  }
  var label: String { [title, desc, value as? String ?? "", help, placeholder].first { !$0.isEmpty } ?? "" }
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
func innerText(_ kids: [AXUIElement], depth: Int = 1, into acc: inout [String]) {
  for c in kids {
    if depth > 4 || acc.count >= 3 { return }
    let v = attrs(c, [kAXRoleAttribute, kAXValueAttribute, kAXChildrenAttribute])
    if ["AXStaticText", "AXTextField"].contains(v[0] as? String ?? ""), let s = v[1] as? String, !s.isEmpty { acc.append(s); continue }
    innerText(v[2] as? [AXUIElement] ?? [], depth: depth + 1, into: &acc)
  }
}

// MARK: - Refs

/// An element the caller can act on, with what we learned about it while walking down to it,
/// so acting needs no climbing back up the tree.
struct Target {
  let el: AXUIElement
  let role: String
  let info: String          // "Button 7", echoed back as the act's target
  let web: Bool             // inside a web area: pages ignore AXPress, so it gets a real click
  let row: AXUIElement?     // the table row it sits in (itself, or up to 3 levels up)
}
// Refs are stable: an element keeps its number across observes for the helper's whole life, a new element
// gets a fresh one, and a number is never handed to a different element. This only works for apps that keep
// their element objects between reads (CFEqual/CFHash); for one that makes new ones each time, every read
// brings new numbers. Only refs listed by the latest observe can be acted on; others answer "unknown ref".
var live: [String: Target] = [:]
var refNumbers: [AXUIElement: Int] = [:]
var nextRef = 0
func number(_ e: AXUIElement) -> Int {
  if let n = refNumbers[e] { return n }
  nextRef += 1; refNumbers[e] = nextRef; return nextRef
}

/// Element state the tree knows, so callers needn't take a screenshot to see whether a box is ticked.
func state(_ n: Node) -> [String] {
  var s: [String] = []
  let v = (n.value as? NSNumber)?.intValue
  switch n.role {
  case "AXCheckBox": if v == 1 { s.append("checked") } else if v == 2 { s.append("mixed") }
  case "AXRadioButton": if v == 1 || n.selected == true { s.append("selected") }  // also tabs
  case "AXMenuItem": if !n.mark.isEmpty { s.append("checked") }
  default: if n.selected == true { s.append("selected") }
  }
  if n.enabled == false && n.role != "AXStaticText" { s.append("disabled") }
  return s
}
// Roles whose value says something the label doesn't when the label came from the title or description
// ("字体" = "Helvetica", a titled text field's contents, a slider's position).
let valueRoles: Set<String> = ["AXTextField", "AXTextArea", "AXSearchField", "AXComboBox", "AXPopUpButton", "AXMenuButton", "AXSlider"]

/// One element per line in the caller's view: a text area's line breaks would split its entry.
func oneLine(_ s: String) -> String { s.contains(where: \.isNewline) ? s.split(whereSeparator: \.isNewline).joined(separator: " ") : s }

func item(_ e: AXUIElement, _ n: Node, role: String, label raw: String, web: Bool, row: AXUIElement?) -> [String: Any]? {
  let ref = "e\(number(e))"
  if live[ref] != nil { return nil }  // reached twice in one walk
  let label = oneLine(raw)
  let r = String(role.dropFirst(2)).replacingOccurrences(of: "StaticText", with: "Text")
  live[ref] = Target(el: e, role: role, info: "\(r) \(label)", web: web, row: row)
  var it: [String: Any] = ["ref": ref, "role": r, "label": label]
  if let f = n.frame { it["f"] = [Int(f.minX), Int(f.minY), Int(f.width), Int(f.height)] }
  if valueRoles.contains(role), !(n.title.isEmpty && n.desc.isEmpty) {
    let v = (n.value as? String) ?? (n.value as? NSNumber)?.stringValue ?? ""
    if !v.isEmpty && v != raw { it["value"] = oneLine(String(v.prefix(60))) }
  }
  let st = state(n)
  if !st.isEmpty { it["state"] = st }
  return it
}

struct Walk { var depth = 0, inRow = false, web = false, row: AXUIElement? = nil, rowDepth = 0 }

var collectDeadline = Date.distantFuture  // observe gives up after a few seconds on huge or slow apps
func collect(_ e: AXUIElement, _ w: Walk, out: inout [[String: Any]]) {
  if w.depth > 40 || out.count > 400 || Date() > collectDeadline { return }
  let n = Node(e)
  let role = n.role
  var next = w; next.depth += 1
  if role == "AXWebArea" { next.web = true }
  if role == "AXRow" { next.row = e; next.rowDepth = w.depth }
  // A row already carries its cells' text in its label, so the cells themselves would only repeat it
  // (Finder lists 5 lines per file otherwise). Buttons and checkboxes inside rows are still listed.
  let cellish = ["AXCell", "AXStaticText", "AXTextField", "AXImage"].contains(role)
  if interactiveRoles.contains(role) && !(w.inRow && cellish) {
    var l = String(n.label.prefix(80))
    if role == "AXRow" && l.isEmpty { var t: [String] = []; innerText(n.children, into: &t); l = String(t.joined(separator: " | ").prefix(80)) }
    if role == "AXRow" && !l.isEmpty { next.inRow = true }
    // Static text is only useful as context when it says something.
    if !(["AXStaticText", "AXCell"].contains(role) && l.isEmpty) {
      let row = next.row.flatMap { next.depth - 1 - next.rowDepth <= 3 ? $0 : nil }
      if let it = item(e, n, role: role, label: l, web: w.web, row: row) { out.append(it) }
    }
  }
  // Long lists (hundreds of notes, files, messages) would use up the element budget and hide the rest of
  // the window, so only their visible rows (or the first 30) are listed.
  var kids = n.children
  if ["AXTable", "AXOutline", "AXList"].contains(role) {
    var count: CFIndex = 0
    let total = AXUIElementGetAttributeValueCount(e, kAXRowsAttribute as CFString, &count) == .success ? count : kids.count
    let v = attrs(e, [kAXVisibleRowsAttribute, kAXVisibleChildrenAttribute])
    if let vis = v[0] as? [AXUIElement], !vis.isEmpty { kids = vis }
    else if let vis = v[1] as? [AXUIElement], !vis.isEmpty { kids = vis }
    kids = Array(kids.prefix(30))
    // Say so when rows are hidden, so the caller scrolls instead of assuming the list is complete.
    if total > kids.count {
      let ref = "e\(number(e))"
      let l = "showing \(kids.count) of \(total) rows: scroll{ref:\"\(ref)\"} for more, or find_text"
      if live[ref] == nil {
        live[ref] = Target(el: e, role: role, info: "List \(l)", web: w.web, row: nil)
        out.append(["ref": ref, "role": "List", "label": l])
      }
    }
  }
  for c in kids { collect(c, next, out: &out) }
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

/// Whether the app is the active one (receives keystrokes), as the app itself reports it: ~0.05 ms, and right
/// after activation, unlike NSRunningApplication.isActive. (The system-wide focused-application attribute fails
/// while some apps, e.g. System Settings, are in front.)
func isFrontmost(_ a: NSRunningApplication) -> Bool {
  (attr(AXUIElementCreateApplication(a.processIdentifier), kAXFrontmostAttribute) as? Bool) == true
}

/// Poll until `ok()` holds, at most `timeout` seconds. Returns whether it held.
@discardableResult func waitFor(_ timeout: TimeInterval, _ ok: () -> Bool) -> Bool {
  let end = Date().addingTimeInterval(timeout)
  while !ok() { if Date() >= end { return false }; usleep(10_000) }
  return true
}

let isWindow = { (role: String) in ["AXWindow", "AXSheet", "AXDialog"].contains(role) }

func screenLocked() -> Bool {
  (CGSessionCopyCurrentDictionary() as? [String: Any])?["CGSSessionScreenIsLocked"] as? Bool == true
}
let lockedError = "the screen is locked, so no app windows can be read or used. Ask the user to unlock the Mac; retrying won't help."

func observe(_ appName: String? = nil, quiet: Bool = false) -> [String: Any] {
  live = [:]
  if !AXIsProcessTrusted() { return ["error": noPermission] }
  // A locked screen hides every window from accessibility (only menu bars remain), which looks like a broken app.
  if screenLocked() { return ["error": lockedError] }
  var target: NSRunningApplication? = nil
  if let n = appName, !n.isEmpty {
    target = runningApp(n)
    if target == nil { return ["error": "app not running: \(n)"] }
  }
  guard let app = target ?? frontmostApp() else { return ["error": "no frontmost app"] }
  currentApp = app
  let root = AXUIElementCreateApplication(app.processIdentifier)
  var els: [[String: Any]] = []
  let r = attrs(root, [kAXFocusedWindowAttribute, kAXMainWindowAttribute, kAXWindowsAttribute, kAXMenuBarAttribute])
  let windows = r[2] as? [AXUIElement] ?? []
  // Background apps often report no focused window; fall back to the main or first window so we never
  // walk the whole app (its closed menus alone would use up the element budget).
  // Some apps answer with the application element itself when no window is open: only accept real windows.
  let candidates = [r[0], r[1]].compactMap { $0.map { $0 as! AXUIElement } } + windows
  var info: [AXUIElement: [AnyObject?]] = [:]  // role, title, position, size
  let winInfo = { (w: AXUIElement) -> [AnyObject?] in
    if let i = info[w] { return i }
    let i = attrs(w, [kAXRoleAttribute, kAXTitleAttribute, kAXPositionAttribute, kAXSizeAttribute]); info[w] = i; return i }
  let win = candidates.first { isWindow(winInfo($0)[0] as? String ?? "") }
  currentWindow = win
  // Bring the chosen window to the front so the user sees what the agent is working on. Repeated reads
  // while waiting for the screen to settle pass quiet, so they don't re-raise or redraw anything.
  if !quiet { bringForward() }
  collectDeadline = Date().addingTimeInterval(3)
  if let w = win { collect(w, Walk(), out: &els) }
  // Menu bar items are reachable even when the window has little to offer. Only an open menu's items are
  // listed: closed menus would add hundreds of lines nobody asked for (menu{path} reaches them anyway).
  if let bar = r[3] {
    for mi in (attr(bar as! AXUIElement, kAXChildrenAttribute) as? [AXUIElement] ?? []).dropFirst() {
      let n = Node(mi)
      if let it = item(mi, n, role: "AXMenuBarItem", label: n.label, web: false, row: nil) { els.append(it) }
      if n.selected == true { collect(mi, Walk(), out: &els) }
    }
  }
  if !quiet, let w = win, let f = rect(winInfo(w)[2], winInfo(w)[3]) { Overlay.shared.glowWindow(f) }
  let title = win.map { winInfo($0)[1] as? String ?? "" } ?? "(no open window: open one with key cmd+n or a menu)"
  // Other windows of the app, so the caller knows what's behind the focused one (e.g. a pile of info windows).
  let others = windows.filter { w in isWindow(winInfo(w)[0] as? String ?? "") && !(win.map { CFEqual($0, w) } ?? false) }
    .map { winInfo($0)[1] as? String ?? "" }
  // The registry only has to outlive the screens a caller still remembers; forget the rest when it gets big.
  if refNumbers.count > 20000 { let keep = Set(live.values.map(\.el)); refNumbers = refNumbers.filter { keep.contains($0.key) } }
  var res: [String: Any] = ["app": app.localizedName ?? "", "window": title, "elements": els, "others": others]
  if let w = win { res["window_id"] = number(w) }  // same number = same window (titles repeat: "Untitled")
  return res
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
  let names = [kAXTitleAttribute, kAXDescriptionAttribute, kAXValueAttribute, kAXHelpAttribute, kAXPlaceholderValueAttribute, kAXChildrenAttribute]
  let read = { (e: AXUIElement) -> (String, [AXUIElement]) in
    let v = attrs(e, names)
    return (v[0..<5].compactMap { $0 as? String }.first { !$0.isEmpty } ?? "", v[5] as? [AXUIElement] ?? [])
  }
  func texts(_ e: AXUIElement, _ depth: Int, _ acc: inout [String]) {
    if depth > 6 || acc.count > 30 { return }
    let (l, kids) = read(e); if !l.isEmpty { acc.append(l) }
    for c in kids { texts(c, depth + 1, &acc) }
  }
  // Climb up to 3 ancestors until the context says more than the hit itself (e.g. table header -> row).
  func walk(_ e: AXUIElement, _ depth: Int, _ ancestors: [AXUIElement]) {
    visited += 1
    if depth > 80 || visited > 20000 || hits.count >= 40 { return }
    let (l, kids) = read(e)
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
    for c in kids { walk(c, depth + 1, next) }
  }
  walk(win as! AXUIElement, 0, [])
  return ["hits": hits, "truncated": hits.count >= 40]
}

// MARK: - Screenshot

func writePNG(_ img: CGImage, _ path: String) -> Bool {
  guard let d = CGImageDestinationCreateWithURL(URL(fileURLWithPath: path) as CFURL, "public.png" as CFString, 1, nil) else { return false }
  CGImageDestinationAddImage(d, img, nil)
  return CGImageDestinationFinalize(d)
}

var shareable: SCShareableContent?  // window list for ScreenCaptureKit; fetched again when a window is missing

/// Capture one window in process with ScreenCaptureKit, at most `maxSide` pixels on its longer side.
@available(macOS 14.0, *)
func captureWindow(_ wid: CGWindowID, size: CGSize, maxSide: Int?) -> CGImage? {
  let done = DispatchSemaphore(value: 0)
  var img: CGImage?
  Task {
    defer { done.signal() }
    for fresh in [false, true] {
      if fresh || shareable == nil { shareable = try? await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true) }
      guard let w = shareable?.windows.first(where: { $0.windowID == wid }) else { continue }
      let filter = SCContentFilter(desktopIndependentWindow: w)
      let cfg = SCStreamConfiguration()
      let scale = CGFloat(filter.pointPixelScale)
      var px = CGSize(width: size.width * scale, height: size.height * scale)
      if let m = maxSide, m > 0, max(px.width, px.height) > CGFloat(m) {
        let k = CGFloat(m) / max(px.width, px.height); px = CGSize(width: px.width * k, height: px.height * k)
      }
      cfg.width = max(1, Int(px.width.rounded())); cfg.height = max(1, Int(px.height.rounded()))
      cfg.showsCursor = false
      cfg.ignoreShadowsSingleWindow = true  // like screencapture -o
      img = try? await SCScreenshotManager.captureImage(contentFilter: filter, configuration: cfg)
      if img != nil { return }  // else the cached window list may be stale: fetch it again once
    }
  }
  return done.wait(timeout: .now() + 3) == .success ? img : nil
}

/// Capture the observed app's front window. Returns file path, the window frame (global, top-left origin,
/// in points) and the image size in pixels, so callers can map image coordinates back to the screen.
/// `maxSide` shrinks the image (never enlarges it) so its longer side is at most that many pixels.
func screenshot(maxSide: Int? = nil) -> [String: Any] {
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
  var res: [String: Any] = ["path": path, "x": b["X"] ?? 0, "y": b["Y"] ?? 0, "w": b["Width"] ?? 0, "h": b["Height"] ?? 0]
  // In process first: no screencapture process to spawn, and the scaling is done during capture.
  if #available(macOS 14.0, *), let img = captureWindow(CGWindowID(wid), size: CGSize(width: b["Width"] ?? 0, height: b["Height"] ?? 0), maxSide: maxSide),
     writePNG(img, path) {
    res["px_w"] = img.width; res["px_h"] = img.height; res["via"] = "sck"
    return res
  }
  let p = Process()
  p.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture")
  p.arguments = ["-x", "-o", "-l", "\(wid)", path]
  do { try p.run(); p.waitUntilExit() } catch { return ["error": "\(error)"] }
  guard let src = CGImageSourceCreateWithURL(URL(fileURLWithPath: path) as CFURL, nil),
        var img = CGImageSourceCreateImageAtIndex(src, 0, nil) else { return ["error": "capture failed (Screen Recording permission?)"] }
  if let m = maxSide, m > 0, max(img.width, img.height) > m,
     let small = CGImageSourceCreateThumbnailAtIndex(src, 0, [kCGImageSourceCreateThumbnailFromImageAlways: true,
       kCGImageSourceThumbnailMaxPixelSize: m, kCGImageSourceCreateThumbnailWithTransform: true] as CFDictionary),
     writePNG(small, path) { img = small }
  res["px_w"] = img.width; res["px_h"] = img.height; res["via"] = "screencapture"
  return res
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

/// Whether the observed window is its app's focused window. Compared by identity, or by title and frame
/// for apps that hand out new element objects on every read. An app without a real focused window counts
/// as fine: there is nothing to compare, and raising wouldn't change that.
func windowInFront() -> Bool {
  guard let w = currentWindow, let app = currentApp,
        let f = attr(AXUIElementCreateApplication(app.processIdentifier), kAXFocusedWindowAttribute) else { return true }
  let fw = f as! AXUIElement
  if CFEqual(fw, w) { return true }
  let names = [kAXRoleAttribute, kAXTitleAttribute, kAXPositionAttribute, kAXSizeAttribute]
  let a = attrs(fw, names), b = attrs(w, names)
  if !isWindow(a[0] as? String ?? "") { return true }
  return (a[1] as? String) == (b[1] as? String) && rect(a[2], a[3]) != nil && rect(a[2], a[3]) == rect(b[2], b[3])
}

/// Bring the observed app and window to the front, so input lands there and the user sees what the agent
/// works on. Free when they already are in front (no re-ordering, no waiting); otherwise raises, activates
/// and waits until the app holds keyboard focus. Returns true when it had to bring something forward.
@discardableResult func bringForward() -> Bool {
  guard let app = currentApp else { return false }
  let appFront = isFrontmost(app)
  if appFront && windowInFront() { return false }
  let raise = {
    guard let w = currentWindow else { return }
    AXUIElementSetAttributeValue(w, kAXMainAttribute as CFString, kCFBooleanTrue)
    AXUIElementPerformAction(w, kAXRaiseAction as CFString)
  }
  raise()
  if !appFront {
    app.activate()
    waitFor(0.5) { isFrontmost(app) }
    if !windowInFront() { raise() }
  }
  // Short: a window that never reports as focused (odd apps) must not cost every action much.
  waitFor(0.15) { windowInFront() }
  return true
}

/// Make sure keystrokes land in the app we observed, not whatever holds system focus.
@discardableResult func focusTarget() -> Bool {
  guard bringForward() else { return false }
  // Focus is reported a little before the window takes key events.
  usleep(50_000)
  return true
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
  if let f = frame(node) { Overlay.shared.point(at: f, click: true) }
  return AXUIElementPerformAction(node, kAXPressAction as CFString) == .success ? nil : "press failed"
}

func clickAt(_ p: CGPoint) {
  CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: p, mouseButton: .left)?.post(tap: .cghidEventTap)
  usleep(20_000)
  for t in [CGEventType.leftMouseDown, .leftMouseUp] {
    CGEvent(mouseEventSource: nil, mouseType: t, mouseCursorPosition: p, mouseButton: .left)?.post(tap: .cghidEventTap)
  }
}

/// Focused or main window of an app we just brought up, so later input in the same batch goes there.
func frontWindow(_ a: NSRunningApplication) -> AXUIElement? {
  let v = attrs(AXUIElementCreateApplication(a.processIdentifier), [kAXFocusedWindowAttribute, kAXMainWindowAttribute])
  return v.lazy.compactMap { $0.map { $0 as! AXUIElement } }.first
}

func act(_ r: [String: Any]) -> [String: Any] {
  let action = r["action"] as? String ?? ""
  if !AXIsProcessTrusted() && !["open_app", "open_url"].contains(action) { return ["error": noPermission] }
  // Keys and clicks would land on the lock screen (typed text in its password field).
  if screenLocked() { return ["error": lockedError] }
  let ref = r["ref"] as? String
  let t = ref.flatMap { live[$0] }
  let el = t?.el
  var res: [String: Any] = [:]
  if let t { res["target"] = t.info }
  lazy var f = el.flatMap(frame)
  // The cursor flies there while the action already runs; it never holds the action up.
  if Overlay.shared.enabled, let f { Overlay.shared.point(at: f, click: action == "press") }

  switch action {
  case "press":
    guard let t, let el else { return ["error": "unknown ref"] }
    // A file name or cell in a table: AXPress on it does nothing, so select its row instead.
    // extend:true adds the row to the current selection (like cmd-click).
    if ["AXRow", "AXCell", "AXStaticText", "AXTextField", "AXImage"].contains(t.role), let row = t.row,
       let table = attr(row, kAXParentAttribute).map({ $0 as! AXUIElement }) {
      var rows = (r["extend"] as? Bool) == true ? (attr(table, kAXSelectedRowsAttribute) as? [AXUIElement]) ?? [] : []
      if !rows.contains(where: { CFEqual($0, row) }) { rows.append(row) }
      if AXUIElementSetAttributeValue(table, kAXSelectedRowsAttribute as CFString, rows as CFArray) == .success {
        res["via"] = "select"; res["selected"] = rows.count
        break
      }
    }
    // Plain text reports success for AXPress but does nothing, so click it for real.
    let isText = t.role == "AXStaticText"
    // Web content (Electron apps, browsers) often answers AXPress with "success" and ignores it:
    // pages listen for mouse events. Click those for real.
    if t.web, let f, f.width > 0 {
      // A click that lands while the app is still coming forward gets lost, so give activation time.
      // focusTarget already waited until the app and window report focus (Safari takes clicks right then,
      // 5 of 5); the margin is for Electron apps, where this was first seen. Free when already in front.
      if focusTarget() { usleep(150_000) }
      let saved = CGEvent(source: nil)?.location
      clickAt(CGPoint(x: f.midX, y: f.midY))
      if let saved { usleep(30_000); CGWarpMouseCursorPosition(saved) }
      res["via"] = "click"
    } else if isText || AXUIElementPerformAction(el, kAXPressAction as CFString) != .success {
      // Some elements (cells, rows, text) have no press action; fall back to a real click at their center.
      guard let f else { return ["error": "press failed"] }
      clickAt(CGPoint(x: f.midX, y: f.midY))
    }
  case "set_value":
    guard let el, let t = r["text"] as? String else { return ["error": ref != nil && el == nil ? "unknown ref" : "bad args"] }
    AXUIElementSetAttributeValue(el, kAXFocusedAttribute as CFString, kCFBooleanTrue)
    if AXUIElementSetAttributeValue(el, kAXValueAttribute as CFString, t as CFString) != .success { return ["error": "set failed"] }
  case "type":
    let text = r["text"] as? String ?? ""
    if ref != nil && el == nil { return ["error": "unknown ref"] }
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
    if ref != nil && el == nil { return ["error": "unknown ref"] }
    let win = currentWindow.flatMap(frame)
    var area = f ?? win
    if let e = el, let p = attr(e, kAXParentAttribute).map({ $0 as! AXUIElement }),
       (attr(p, kAXRoleAttribute) as? String) == "AXScrollArea", let pf = frame(p) { area = pf }
    if let w = win, let g = area { area = g.intersection(w).isNull ? w : g.intersection(w) }
    guard let area else { return ["error": "nothing to scroll"] }
    focusTarget()
    let lines = Int32(((r["amount"] as? Int) ?? 10)) * ((r["direction"] as? String) == "up" ? 1 : -1)
    let at = CGPoint(x: area.midX, y: area.midY)
    let saved = CGEvent(source: nil)?.location
    CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: at, mouseButton: .left)?.post(tap: .cghidEventTap)
    usleep(15_000)
    let wheel = CGEvent(scrollWheelEvent2Source: nil, units: .line, wheelCount: 1, wheel1: lines, wheel2: 0, wheel3: 0)
    wheel?.location = at  // routed by its own position, not wherever the cursor is when it's delivered
    wheel?.post(tap: .cghidEventTap)
    // With its own position the wheel landed even with no wait at all (System Settings list, Safari page);
    // a short one is left for apps that look at the live cursor position instead.
    usleep(30_000)
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
    Overlay.shared.point(at: CGRect(x: x - 12, y: y - 12, width: 24, height: 24), click: true)
    // Same as web clicks: a click during activation gets lost.
    if focusTarget() { usleep(100_000) }
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
    var up: NSRunningApplication?
    for _ in 0..<40 { if let a = runningApp(name) { up = a; break }; Thread.sleep(forTimeInterval: 0.2) }
    guard let a = up else { return ["error": "\(name) was launched but is not running (it quit on start or is still loading); retry once with open_app, then report it"] }
    // Later keystrokes in the same batch must go to this app, not the one observed before: wait until it
    // is in front with a window (an app that opens none gets the full 0.6 s).
    waitFor(0.6) { isFrontmost(a) && frontWindow(a) != nil }
    currentApp = a
    currentWindow = frontWindow(a)
  case "open_url":
    guard let u = URL(string: r["url"] as? String ?? "") else { return ["error": "bad url"] }
    // Wait until the app that handles the URL is in front and its window shows something new (a new tab or
    // page title), at most the second this used to sleep, so the next read doesn't see the old screen.
    let handler = NSWorkspace.shared.urlForApplication(toOpen: u).flatMap { Bundle(url: $0)?.bundleIdentifier }
    let appNow = { handler.flatMap { NSRunningApplication.runningApplications(withBundleIdentifier: $0).first } }
    let titleNow = { () -> String? in appNow().flatMap(frontWindow).flatMap { attr($0, kAXTitleAttribute) as? String } }
    let before = titleNow()
    NSWorkspace.shared.open(u)
    waitFor(1.0) { guard let a = appNow(), isFrontmost(a), let t = titleNow() else { return false }; return t != before }
    // Later keystrokes in the same batch go to the browser, not the app observed before.
    if let a = appNow() { currentApp = a; currentWindow = frontWindow(a) }
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
  var ripples: [(at: CGPoint, t: CGFloat)] = []
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
    for (r, t) in ripples where t > 0 {
      let rad = 8 + 26 * (1 - t)
      accent.withAlphaComponent(t * 0.8).setStroke()
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

  // A glow refresh made every observe ~8 ms slower even with nothing to redraw (measured with Finder), so a
  // glow that is already lit is only refreshed (to push back the clear) once a second. Caller's thread only.
  var glowSent: (rect: CGRect, at: Date)?
  func glowWindow(_ axFrame: CGRect) {
    guard enabled else { return }
    let g = toView(axFrame)
    if let s = glowSent, s.rect == g, Date().timeIntervalSince(s.at) < 1 { return }
    glowSent = (g, Date())
    onMain {
      if self.view.windowGlow != g { self.view.windowGlow = g; self.view.elementGlow = nil; self.view.needsDisplay = true }
      self.scheduleClear()
    }
  }

  var flight: Timer?
  var owedRipple: CGPoint?  // click target of the flight in progress
  /// Fly the virtual cursor along a curve to the element, highlight it, and ripple there for a click.
  /// Returns at once: the action doesn't wait for the animation. A newer target takes over a flight still
  /// in progress (the earlier click still gets its ripple, where it happened).
  func point(at axFrame: CGRect, click: Bool = false) {
    let target = toView(axFrame)
    let end = CGPoint(x: target.midX, y: target.midY)
    onMain {
      self.flight?.invalidate()
      if let p = self.owedRipple { self.ripple(at: p) }
      self.owedRipple = click ? end : nil
      self.view.elementGlow = nil  // lit when the cursor arrives, so both land together
      let start = self.view.cursor ?? CGPoint(x: end.x - 160, y: end.y - 120)
      let dx = end.x - start.x, dy = end.y - start.y
      let dist = max(hypot(dx, dy), 1)
      // Control point pushed sideways from the midpoint gives the arc.
      let bend = min(dist * 0.3, 140)
      let ctrl = CGPoint(x: (start.x + end.x) / 2 - dy / dist * bend, y: (start.y + end.y) / 2 + dx / dist * bend)
      let duration = min(0.08 + Double(dist) / 4000, 0.22)
      let t0 = CACurrentMediaTime()
      self.flight = Timer.scheduledTimer(withTimeInterval: 1.0 / 120, repeats: true) { timer in
        let raw = min((CACurrentMediaTime() - t0) / duration, 1)
        let t = CGFloat(raw < 0.5 ? 4 * raw * raw * raw : 1 - pow(-2 * raw + 2, 3) / 2)  // ease in-out
        let u = 1 - t
        self.view.cursor = CGPoint(x: u * u * start.x + 2 * u * t * ctrl.x + t * t * end.x,
                                   y: u * u * start.y + 2 * u * t * ctrl.y + t * t * end.y)
        self.view.needsDisplay = true
        if raw >= 1 {
          timer.invalidate(); self.flight = nil
          self.view.elementGlow = target
          if let p = self.owedRipple { self.owedRipple = nil; self.ripple(at: p) }
          self.scheduleClear()
        }
      }
    }
  }

  var rippling: Timer?
  func ripple(at p: CGPoint) {  // main thread
    view.ripples.append((p, 1))
    guard rippling == nil else { return }
    rippling = Timer.scheduledTimer(withTimeInterval: 1.0 / 60, repeats: true) { timer in
      for i in self.view.ripples.indices { self.view.ripples[i].t -= 0.06 }
      self.view.ripples.removeAll { $0.t <= 0 }
      self.view.needsDisplay = true
      if self.view.ripples.isEmpty { timer.invalidate(); self.rippling = nil }
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
AXUIElementSetMessagingTimeout(systemWide, 1.0)

let app = NSApplication.shared
app.setActivationPolicy(.accessory)  // no Dock icon, never steals focus
Overlay.shared.setup()

Thread.detachNewThread {
  // Hosts built on Electron (DeepSeek Harness, VS Code...) set this for their child processes. Passed on
  // to an app we open, it makes Electron apps (WorkBuddy, Slack...) start as plain Node and quit at once.
  for k in ["ELECTRON_RUN_AS_NODE", "ELECTRON_NO_ATTACH_CONSOLE"] { unsetenv(k) }
  while let line = readLine() {
    guard let req = (try? JSONSerialization.jsonObject(with: Data(line.utf8))) as? [String: Any] else { continue }
    var res: [String: Any]
    switch req["cmd"] as? String {
    case "trust": res = ["trusted": AXIsProcessTrusted()]
    // quiet: a repeat read while waiting for the screen to settle; don't raise the window or redraw the glow.
    case "observe": res = observe(req["app"] as? String, quiet: (req["quiet"] as? Bool) == true)
    // max: longest image side in pixels (shrinks only).
    case "screenshot": res = screenshot(maxSide: (req["max"] as? NSNumber)?.intValue)
    default: res = act(req)
    }
    res["id"] = req["id"] ?? NSNull()
    let data = try! JSONSerialization.data(withJSONObject: res)
    print(String(data: data, encoding: .utf8)!)
    fflush(stdout)
  }
  exit(0)
}
app.run()
