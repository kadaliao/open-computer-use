#!/usr/bin/env bun
// Micro-benchmark of the helper itself (no models involved): how long observe / act / screenshot take.
// Usage: bun bench/perf.ts [label]      Results: bench/results/perf-<time>-<label>.json
// Opens Calculator, Finder, Safari, System Settings, TextEdit and Notes; leaves them open.
// OCU_MAC_BIN=<path> measures another helper build (e.g. an older one, for before/after numbers).
import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { MacDriver, type Observation } from "../src/driver.ts";

const label = process.argv[2] ?? "run";
const sh = (c: string) => { try { execSync(c, { stdio: "pipe", timeout: 15000 }); } catch {} };
const stats = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return { p50: Math.round(s[Math.floor(s.length / 2)]), min: Math.round(s[0]), max: Math.round(s[s.length - 1]) };
};
async function time<T>(n: number, f: () => Promise<T>) {
  const xs: number[] = []; let last: T | undefined;
  for (let i = 0; i < n; i++) { const t = performance.now(); last = await f(); xs.push(performance.now() - t); }
  return { ...stats(xs), last: last as T };
}

sh("open -a Calculator"); sh("open ~/Documents"); sh("open -a Safari https://en.wikipedia.org/wiki/Alan_Turing");
sh("open 'x-apple.systempreferences:com.apple.wifi-settings-extension'"); sh("open -a TextEdit"); sh("open -a Notes");
await Bun.sleep(4000);

const out: Record<string, unknown> = {};
const d = new MacDriver();
// quiet: a settle-style repeat read (no raise, no glow). Older helpers ignore the flag.
const quiet = (app: string): Promise<Observation> => d.observe(app, { quiet: true });

// 1. observe: one full read of the window, per app.
for (const app of ["Calculator", "Finder", "Safari", "System Settings", "TextEdit"]) {
  await d.observe(app); await Bun.sleep(400);  // first call brings it forward
  const r = await time(8, () => d.observe(app));
  out[`observe ${app}`] = { p50: r.p50, min: r.min, max: r.max, elements: r.last.elements?.length ?? r.last.error };
  const q = await time(8, () => quiet(app));
  out[`observe ${app} (quiet)`] = { p50: q.p50, min: q.min, max: q.max };
}

// 1b. Do refs survive a second read? (same ref, role and label in two reads in a row, the app untouched)
for (const app of ["Calculator", "Finder", "Safari", "System Settings", "TextEdit", "Notes"]) {
  await d.observe(app); await Bun.sleep(400);
  const a = await quiet(app), b = await quiet(app);
  const key = (e: Observation["elements"][number]) => `${e.ref} ${e.role} ${e.label}`;
  const seen = new Set((a.elements ?? []).map(key));
  out[`stable refs ${app}`] = { same: (b.elements ?? []).filter((e) => seen.has(key(e))).length, of: b.elements?.length ?? 0 };
}
// Across a real change: a System Settings page switch. Of the elements on both pages (same role + label,
// e.g. the sidebar), how many kept their ref? (With refs renumbered per read, only those before the change do.)
for (const [to, back] of [[/蓝牙|Bluetooth/, /Wi.Fi|无线局域网/]]) {
  const key = (e: Observation["elements"][number]) => `${e.role} ${e.label}`;
  const before = await d.observe("System Settings");
  const row = before.elements.find((e) => to.test(e.label) && e.role === "Row");
  if (!row) break;
  await d.act({ action: "press", ref: row.ref }); await Bun.sleep(1500);
  const after = await quiet("System Settings");
  const had = new Map(before.elements.map((e) => [e.ref, key(e)])), labels = new Set(before.elements.map(key));
  const common = after.elements.filter((e) => labels.has(key(e)));
  out["refs kept across a page change"] = { same: common.filter((e) => had.get(e.ref) === key(e)).length, of: common.length, page: `${before.window} -> ${after.window}` };
  const home = after.elements.find((e) => back.test(e.label) && e.role === "Row");
  if (home) { await d.act({ action: "press", ref: home.ref }); await Bun.sleep(800); }
}

// 2. act: a button press on Calculator (overlay animation included), then a 6-press batch.
async function presses(drv: MacDriver, tag: string) {
  const calc = await drv.observe("Calculator");
  const digit = (n: string) => calc.elements.find((e) => e.role === "Button" && e.label === n)?.ref;
  const clear = calc.elements.find((e) => e.role === "Button" && /^(AC|C|全部清除|清除)$/i.test(e.label))?.ref;
  if (!digit("1")) return;
  const r = await time(6, () => drv.act({ action: "press", ref: digit("1")! }));
  out[`act press (single)${tag}`] = { p50: r.p50, min: r.min, max: r.max };
  const t = performance.now();
  for (const n of ["7", "8", "9", "3", "6", "5"]) await drv.act({ action: "press", ref: digit(n)! });
  out[`act press x6 (spread over the keypad)${tag}`] = { total: Math.round(performance.now() - t) };
  if (clear) await drv.act({ action: "press", ref: clear });
}
await presses(d, "");
const k = await time(5, () => d.act({ action: "key", key: "escape" }));
out["act key"] = { p50: k.p50, min: k.min, max: k.max };

// Same presses with the overlay off (OCU_OVERLAY=0): what the helper itself costs.
process.env.OCU_OVERLAY = "0";
const plain = new MacDriver();
delete process.env.OCU_OVERLAY;
await presses(plain, " overlay off");
plain.close();

// 3. find_text over a long page.
await d.observe("Safari");
const f = await time(3, () => d.act({ action: "find_text", query: "Born" }));
out["find_text Safari"] = { p50: f.p50, min: f.min, max: f.max, found: !!f.last.note && f.last.note !== "no text found" };

// 4. screenshot of a window, ready to send to a model. The helper shrinks the image while capturing (max = longest
// side), so only the base64 is left to do here. (Before 0.6 this was screencapture + two sips runs: "screenshot + prepare".)
await d.observe("Safari");
const m = await time(4, async () => {
  const shot: any = await d.screenshot(1280);
  return shot.error ? shot : { b64: readFileSync(shot.path).toString("base64").length, px: `${shot.px_w}x${shot.px_h}`, via: shot.via };
});
out["screenshot max=1280 + base64"] = { p50: m.p50, min: m.min, max: m.max, ok: !(m.last as any).error, px: (m.last as any).px, via: (m.last as any).via };

d.close();
console.table(out);
mkdirSync("bench/results", { recursive: true });
writeFileSync(`bench/results/perf-${Date.now()}-${label}.json`, JSON.stringify({ label, date: new Date().toISOString(), out }, null, 2));
