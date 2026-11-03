// MCP server so any harness (Claude Code, Codex, DeepSeek-based agents) can drive macOS apps.
// The calling agent supplies the intelligence; these tools give it a cheap, exact view of the UI.
import { spawnSync } from "node:child_process";
// GUI hosts (DeepSeek Harness, Claude desktop...) don't inherit keys set up by an interactive shell.
// Borrow model keys from the user's shell once, in memory only.
if (!process.env.DEEPSEEK_API_KEY && !process.env.OCU_API_KEY && process.env.OCU_SHELL_ENV !== "0") {
  const sh = process.env.SHELL || "/bin/zsh";
  const r = spawnSync(sh, ["-i", "-l", "-c", "env"], { encoding: "utf8", timeout: 8000, stdio: ["ignore", "pipe", "ignore"] });
  for (const line of (r.stdout ?? "").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && /(_API_KEY|_BASE_URL)$|^OCU_/.test(m[1]) && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { MacDriver, render, type Element, type Observation } from "./driver.ts";
import { runTask } from "./agent.ts";

const driver = new MacDriver();
const env = process.env;
// Optional extras: each tool below appears only when its model is configured, so a caller never
// sees a tool that would just fail. The core tools need nothing but Accessibility permission.
const hasVision = !!(env.OCU_VISION_API_KEY ?? env.STEPFUN_API_KEY);
const hasPlanner = !!(env.OCU_API_KEY ?? env.DEEPSEEK_API_KEY);

const INSTRUCTIONS = `Drive macOS apps through their accessibility tree. The loop:
1. observe{app:"<name>"} once. Always name the app: the frontmost app is usually your own host.
2. act on refs from the latest reply. Each act reply starts with what changed, then the full new screen.
   Refs are renumbered on every reply: never reuse a ref from an older reply.
3. Batch predictable steps with act{..., then:[...]} (e.g. typing a number on a keypad).
Picking an action:
- Text fields: set_value{ref,text} (or type{text,ref}); press return with key{key:"return"} if needed.
- Commands are often faster through menu{path:[...]} or a shortcut key{key:"cmd+n"} than through buttons.
- Long pages: find_text{text} searches the whole window, including off-screen content.
- Lists: a "showing N of M rows" line means rows are hidden: scroll{ref,direction} it, or find_text.
- Table rows (files in Finder, mails): press{ref} on a row or its name selects it; press{ref, extend:true} adds it to the selection.
- Repeated keys: key{key:"down", repeat:5} instead of listing the same key many times.
- Finder sizes: select the folder and use cmd+i; with many files selected, use cmd+ctrl+i (one summary window), not cmd+i (one window per file).
- Open things with open_app / open_url instead of clicking around Finder or the Dock.
When stuck:
- Watch "other windows of this app": an action may open several windows at once. Close extras in one batch or with a "close all" shortcut instead of one per step.
- "did not change" means the action had no effect: pick a different element, try the menu or a shortcut. Don't repeat the same action.
- Element missing or the list is sparse (canvas, games, some web views): ${hasVision ? "click_visual{target} / read_visual{question}, or " : ""}screenshot, then click_at{x,y} with the screen point it tells you how to compute.
- Errors about Accessibility permission or a locked screen: stop and tell the user; retrying won't help.
Finish by checking the result in the latest reply rather than assuming the action worked.`;

const server = new McpServer({ name: "open-computer-use", version: "0.4.0" }, { instructions: INSTRUCTIONS });
const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });
let lastApp: string | undefined;
let lastObs: Observation | undefined;  // what the caller last saw

const key = (e: Element) => `${e.role} "${e.label}"`;
/** Lead with what changed, so the caller doesn't have to compare two long lists itself. */
function summarize(prev: Observation | undefined, cur: Observation): string {
  if (!prev || prev.error || cur.error || !prev.elements || !cur.elements) return "";
  if (prev.app !== cur.app || prev.window !== cur.window) return `changed: now in ${cur.app} | ${cur.window}\n`;
  const before = new Map<string, number>();
  for (const e of prev.elements) before.set(key(e), (before.get(key(e)) ?? 0) + 1);
  const added: Element[] = [];
  for (const e of cur.elements) {
    const n = before.get(key(e)) ?? 0;
    if (n > 0) before.set(key(e), n - 1); else added.push(e);
  }
  const gone = [...before.values()].reduce((a, b) => a + b, 0);
  if (!added.length && !gone) return "";
  const shown = added.slice(0, 12).map((e) => `  ${e.ref} ${key(e)}`).join("\n");
  return `changed: ${added.length} new, ${gone} gone${added.length ? `\n${shown}${added.length > 12 ? "\n  ..." : ""}` : ""}\n`;
}
const show = (o: Observation) => {
  const r = render(o);
  const same = lastObs !== undefined && r === render(lastObs);
  const head = same
    ? "did not change: the action probably had no effect. Don't repeat it; try another element, menu{path}, a shortcut key, or screenshot.\n"
    : summarize(lastObs, o);
  lastObs = o;
  return `${head}\n${r}`;
};

/**
 * Re-read until the UI stops changing (window opened, page loaded). A web page often takes a few hundred ms
 * to start navigating, so when nothing has changed yet keep watching for a while before concluding the
 * action did nothing: a false "did not change" makes callers repeat the action.
 */
async function settled(app?: string): Promise<Observation> {
  // The app was quit (cmd+q): follow whatever is in front now instead of reporting "app not running".
  const read = async () => {
    const o = await driver.observe(app);
    if (app && o.error?.startsWith("app not running")) { lastApp = app = undefined; return driver.observe(); }
    return o;
  };
  const before = lastObs ? render(lastObs) : undefined;
  const t0 = Date.now();
  let prev = await read(), stable = 0;
  // A change that holds for one more read is done. With no change at all, keep watching a little longer
  // for late starters (page loads), but not so long that every no-op costs seconds.
  const isBrowser = /safari|chrome|edge|firefox|arc|浏览器/i.test(prev.app ?? "");
  while (Date.now() - t0 < 4000) {
    await new Promise((r) => setTimeout(r, 100));
    const cur = await read();
    stable = render(cur) === render(prev) ? stable + 1 : 0;
    prev = cur;
    const moved = render(cur) !== before;
    if (moved ? stable >= 1 : stable >= 2 && Date.now() - t0 >= (isBrowser ? 1200 : 600)) break;
  }
  return prev;
}

server.tool("observe",
  "List the elements of a macOS app's focused window as `ref Role \"label\"` lines (refs reset on every observe). " +
  "Pass `app` (name or bundle id) to target an app; its window is brought to the front. Otherwise the frontmost app (often your own terminal) is read. " +
  "The app is remembered for later calls.",
  { app: z.string().optional() },
  async ({ app }) => { if (app) lastApp = app; lastObs = await driver.observe(lastApp); return text(render(lastObs)); });

const one = {
  action: z.enum(["press", "set_value", "type", "key", "open_app", "open_url", "menu", "find_text", "click_at", "scroll"]),
  ref: z.string().optional(), text: z.string().optional(), key: z.string().optional(), name: z.string().optional(),
  url: z.string().optional(), path: z.array(z.string()).optional(), x: z.number().optional(), y: z.number().optional(),
  repeat: z.number().int().min(1).max(50).optional(), extend: z.boolean().optional(),
  direction: z.enum(["up", "down"]).optional(), amount: z.number().int().optional(),
};
/** Run one action, keeping track of which app later calls should read. */
async function run(a: any) {
  if (a.action === "open_app" && a.name) lastApp = a.name;
  if (a.action === "open_url") lastApp = undefined;  // the browser comes forward
  return driver.act(a.action === "find_text" ? { action: "find_text", query: a.text } : a);
}
server.tool("act",
  "Perform one action, then return the updated screen (same format as observe). Refs come from the latest observe/act. " +
  "press{ref, extend?} (on a table row: select it; extend adds to selection) | set_value{ref,text} | type{text, ref?} (ref = insert into that field) | key{key, repeat?} e.g. \"cmd+shift+g\", \"return\" | scroll{ref?, direction, amount?} | " +
  "open_app{name} | open_url{url} | menu{path:[\"File\",\"New Folder\"]} | find_text{text} search the whole window, incl. off-screen text | " +
  "click_at{x,y} global screen point. Keyboard actions bring the observed app forward first. " +
  "Work from refs: the reply already shows the new screen (menus and popups included), so don't take your own screenshots or guess coordinates; " +
  "use the screenshot tools only when the element really isn't listed.",
  { ...one, then: z.array(z.object(one)).optional().describe("more actions to run right after, in order, using refs from the same screen (e.g. a run of keypad presses); stops at the first error") },
  async ({ then, ...a }) => {
    if (then?.length) {
      const results = [];
      for (const x of [a, ...then]) {
        const r = await run(x); results.push(r);
        if (r.error) break;
        await new Promise((res) => setTimeout(res, 60));
      }
      return text(`results: ${JSON.stringify(results)}\n\n${show(await settled(lastApp))}`);
    }
    const res = await run(a);
    if (a.action === "find_text") return text(JSON.stringify(res));
    const obs = await settled(lastApp);
    return text(`result: ${JSON.stringify(res)}\n\n${show(obs)}`);
  });

if (hasVision) server.tool("click_visual", "Screenshot fallback for apps with little accessibility info (canvas, games, some Electron apps): a vision model finds the described element and clicks it.",
  { target: z.string() }, async ({ target }) => {
    const { locate } = await import("./vision.ts");
    await driver.observe(lastApp);
    const shot = await driver.screenshot();
    if ((shot as any).error) return text(`screenshot failed: ${(shot as any).error}`);
    const p = await locate(shot, target);
    if (!p) return text(`not found: ${target}`);
    const res = await driver.act({ action: "click_at", x: p.x, y: p.y });
    return text(`result: ${JSON.stringify(res)}\n\n${show(await settled(lastApp))}`);
  });

if (hasVision) server.tool("read_visual", "Screenshot fallback: ask a vision model a question about the observed app's window.",
  { question: z.string() }, async ({ question }) => {
    const { ask } = await import("./vision.ts");
    await driver.observe(lastApp);
    return text(await ask(await driver.screenshot(), question));
  });

if (hasPlanner) server.tool("run_task",
  "Hand a whole goal to the built-in agent (its own planner model, plus a cache that replays tasks it has done before). " +
  "Use when you'd rather not spend your own steps; returns a summary and the step log.",
  { goal: z.string() }, async ({ goal }) => {
    const r = await runTask(goal);
    return text(JSON.stringify({ ok: r.ok, summary: r.summary, steps: r.steps.length, tiers: [...new Set(r.steps.map((s) => s.tier))] }));
  });

server.tool("screenshot",
  "Image of the observed app's window, for when the element list doesn't show what you need. " +
  "To click something you see in it, call act{action:\"click_at\"} with the screen point given in the reply.",
  {}, async () => {
    await driver.observe(lastApp);
    const shot = await driver.screenshot();
    if (shot.error) return text(`screenshot failed: ${shot.error}`);
    const { prepare } = await import("./vision.ts");
    const img = prepare(shot.path, Math.min(1280, Math.max(shot.px_w, shot.px_h)));  // shrink only
    const sx = shot.w / img.w, sy = shot.h / img.h;
    return { content: [
      { type: "image" as const, data: img.b64, mimeType: "image/png" },
      { type: "text" as const, text: `Image is ${img.w}x${img.h}. Image pixel (px,py) is screen point x = ${shot.x} + px*${sx.toFixed(4)}, y = ${shot.y} + py*${sy.toFixed(4)}.` },
    ] };
  });

await server.connect(new StdioServerTransport());
// The host closed our stdin (it quit or restarted the server): exit and take the helper with us.
const bye = () => { driver.close(); process.exit(0); };
process.stdin.on("end", bye);
process.stdin.on("close", bye);
