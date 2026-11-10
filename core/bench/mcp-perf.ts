#!/usr/bin/env bun
// What an MCP caller pays per tool call, with no model in the loop: time and reply size (≈ tokens it must read).
// Usage: bun bench/mcp-perf.ts [label]      Results: bench/results/mcp-perf-<time>-<label>.json
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const label = process.argv[2] ?? "run";
const sh = (c: string) => { try { execSync(c, { stdio: "pipe", timeout: 15000 }); } catch {} };
sh("open -a Calculator"); sh("open -a Safari https://example.com"); sh("open 'x-apple.systempreferences:com.apple.wifi-settings-extension'");
await Bun.sleep(3000);

const t0 = performance.now();
const client = new Client({ name: "mcp-perf", version: "0" });
await client.connect(new StdioClientTransport({ command: "bun", args: ["src/mcp.ts"], env: { ...process.env, OCU_SHELL_ENV: "0" } as Record<string, string> }));
// kind: what the reply showed of the screen (full list, changes only, or "did not change").
const out: Record<string, { ms: number; chars: number; kind?: string; note?: string }> = { "server start": { ms: Math.round(performance.now() - t0), chars: 0 } };

async function call(name: string, tool: string, args: Record<string, unknown>) {
  const t = performance.now();
  const r: any = await client.callTool({ name: tool, arguments: args });
  const txt = (r.content ?? []).map((c: any) => c.text ?? `<${c.type} ${c.data?.length ?? 0}b>`).join("\n");
  const kind = /Only these lines changed/.test(txt) ? "diff" : /^did not change/m.test(txt) && !/renumbered/.test(txt) ? "same" : "full";
  out[name] = { ms: Math.round(performance.now() - t), chars: txt.length, ...(tool === "act" ? { kind } : {}) };
  return txt as string;
}
const refOf = (screen: string, role: string, label: RegExp) => {
  // A line may end in ` = "value"` or ` [state]` after the label.
  for (const l of screen.split("\n")) { const m = l.match(/(e\d+) (\w+) "(.*?)"(?: = "| \[|$)/); if (m && m[2] === role && label.test(m[3])) return m[1]; }
};

// Calculator: one press, a batch of 7 presses, and an action that changes nothing.
// Refs are stable and act replies may list only changes, so buttons are looked up on the observed screen.
let s = await call("observe Calculator", "observe", { app: "Calculator" });
const calc = s;
const b = (n: string) => refOf(calc, "Button", new RegExp(`^${n}$`));
const clear = refOf(calc, "Button", /^(AC|C|全部清除|清除)$/i);
if (clear) s = await call("act press (clear)", "act", { action: "press", ref: clear });
s = await call("act press (one digit)", "act", { action: "press", ref: b("7") });
const seq = ["8", "9", "5", "1", "2", "3"].map((n) => ({ action: "press", ref: b(n) }));
s = await call("act batch of 6 presses", "act", { ...seq[0], then: seq.slice(1) });
out["act batch of 6 presses"].note = /789,?5123|7,895,123/.test(s) ? "display correct" : "DISPLAY WRONG";
s = await call("act key with no effect (shift)", "act", { action: "key", key: "escape" });
await call("act key with no effect, again", "act", { action: "key", key: "escape" });

// System Settings: a page change, i.e. a large UI change.
s = await call("observe System Settings", "observe", { app: "System Settings" });
const row = refOf(s, "Row", /蓝牙|Bluetooth/) ?? refOf(s, "Text", /蓝牙|Bluetooth/) ?? refOf(s, "Button", /蓝牙|Bluetooth/);
if (row) { s = await call("act press (settings page change)", "act", { action: "press", ref: row }); out["act press (settings page change)"].note = /window: (蓝牙|Bluetooth)/.test(s) ? "page opened" : "PAGE NOT OPENED"; }

// Safari: big tree, a link click that loads a page, find_text, screenshot.
s = await call("observe Safari", "observe", { app: "Safari" });
await call("act find_text", "act", { action: "find_text", text: "Example" });
await call("screenshot", "screenshot", {});
const link = refOf(s, "Link", /./);
if (link) { s = await call("act press (web link, page load)", "act", { action: "press", ref: link }); out["act press (web link, page load)"].note = /iana/i.test(s) ? "navigated" : "NOT NAVIGATED"; }

await client.close();
console.table(out);
const total = Object.entries(out).filter(([k]) => k !== "server start").reduce((a, [, v]) => ({ ms: a.ms + v.ms, chars: a.chars + v.chars }), { ms: 0, chars: 0 });
console.log(`total: ${total.ms} ms, ${total.chars} chars`);
mkdirSync("bench/results", { recursive: true });
writeFileSync(`bench/results/mcp-perf-${Date.now()}-${label}.json`, JSON.stringify({ label, date: new Date().toISOString(), total, out }, null, 2));
process.exit(0);
