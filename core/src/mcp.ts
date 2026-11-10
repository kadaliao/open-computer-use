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
import { readFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { MacDriver, render, type Observation } from "./driver.ts";
import { runTask } from "./agent.ts";
import { describe, runSteps, settle, shape } from "./screen.ts";

const driver = new MacDriver();
const env = process.env;
// Optional extras: each tool below appears only when its model is configured, so a caller never
// sees a tool that would just fail. The core tools need nothing but Accessibility permission.
const hasVision = !!(env.OCU_VISION_API_KEY ?? env.STEPFUN_API_KEY);
const hasPlanner = !!(env.OCU_API_KEY ?? env.DEEPSEEK_API_KEY);

const INSTRUCTIONS = `Drive macOS apps through their accessibility tree. The loop:
1. observe{app:"<name>"} once. Always name the app: the frontmost app is usually your own host.
2. act on refs. Refs are stable: an element keeps its ref as long as it is on screen, so a ref stays usable
   until a reply marks it gone. Each act reply says what changed:
   - "did not change": the screen is as before; all refs still hold.
   - "changed: ... Only these lines changed": a short list, every other ref is unchanged and still valid:
       + e45 Button "C"                       new element
       ~ e3 Text "7"   (was: Text "0")        same element, new label, value or state
       - e2 Button "AC"                       gone: don't use e2 any more
   - otherwise the full screen (another window, a big change, and every few replies): use only refs in it.
   State follows the label: [checked], [selected], [mixed], [disabled]; = "..." is a field's current value.
   A "dialog open" line under the window means a sheet or alert is up: its controls are listed first; deal with it first.
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
- "unknown ref": that element is no longer on screen; pick one from the latest reply.
- Element missing or the list is sparse (canvas, games, some web views): ${hasVision ? "click_visual{target} / read_visual{question}, or " : ""}screenshot, then click_at{x,y} with the screen point it tells you how to compute.
- Errors about Accessibility permission or a locked screen: stop and tell the user; retrying won't help.
Finish by checking the result in the latest reply rather than assuming the action worked.`;

const server = new McpServer({ name: "open-computer-use", version: "0.6.0" }, { instructions: INSTRUCTIONS });
const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });
let lastApp: string | undefined;
let lastObs: Observation | undefined;  // what the caller last saw (its refs are the ones it may use)
let diffsInRow = 0;                    // change-only replies since the caller last got the full screen

/** The screen part of a reply: what changed since the caller's last view (see screen.ts describe). */
const show = (o: Observation) => {
  const r = describe(lastObs, o, diffsInRow);
  diffsInRow = r.kind === "diff" ? diffsInRow + 1 : r.kind === "full" ? 0 : diffsInRow;
  lastObs = o;
  return r.text;
};

/** One read of the caller's app. If it was quit (cmd+q), follow whatever is in front now instead of reporting "app not running". */
async function read(quiet: boolean): Promise<Observation> {
  const o = await driver.observe(lastApp, { quiet });
  if (lastApp && o.error?.startsWith("app not running")) { lastApp = undefined; return driver.observe(undefined, { quiet }); }
  return o;
}
/**
 * Re-read until the UI stops changing (window opened, page loaded). A web page often takes a few hundred ms to
 * start navigating, so an unchanged screen is watched a while before concluding the action did nothing: a false
 * "did not change" makes callers repeat the action. step: a wait inside a batch, before its next step.
 */
const settled = (before: string | undefined, step = false) => settle(read, { before, step });

server.tool("observe",
  "List the elements of a macOS app's focused window as `ref Role \"label\"` lines, with state ([checked], [selected], = \"value\") where there is one. " +
  "Refs are stable: an element keeps its ref while it stays on screen. " +
  "Pass `app` (name or bundle id) to target an app; its window is brought to the front. Otherwise the frontmost app (often your own terminal) is read. " +
  "The app is remembered for later calls.",
  { app: z.string().optional() },
  async ({ app }) => { if (app) lastApp = app; lastObs = await driver.observe(lastApp); diffsInRow = 0; return text(render(lastObs)); });

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
  "Perform one action, then return what changed on screen (see the server instructions; first time or after a big change, the full screen). " +
  "press{ref, extend?} (on a table row: select it; extend adds to selection) | set_value{ref,text} | type{text, ref?} (ref = insert into that field) | key{key, repeat?} e.g. \"cmd+shift+g\", \"return\" | scroll{ref?, direction, amount?} | " +
  "open_app{name} | open_url{url} | menu{path:[\"File\",\"New Folder\"]} | find_text{text} search the whole window, incl. off-screen text | " +
  "click_at{x,y} global screen point. Keyboard actions bring the observed app forward first. " +
  "Work from refs: the reply already shows the new screen (menus and popups included), so don't take your own screenshots or guess coordinates; " +
  "use the screenshot tools only when the element really isn't listed.",
  { ...one, then: z.array(z.object(one)).optional().describe("more actions to run right after, in order, with refs you already have (e.g. a run of keypad presses). " +
    "After a step that changes the screen the batch waits for it to settle; a later step whose element has gone stops the batch with \"unknown ref\". Stops at the first error") },
  async ({ then, ...a }) => {
    const { results, screen } = await runSteps([a, ...(then ?? [])], run, (before) => settled(before, true), lastObs && shape(lastObs));
    if (!then?.length && a.action === "find_text") return text(JSON.stringify(results[0]));
    const head = then?.length ? `results: ${JSON.stringify(results)}` : `result: ${JSON.stringify(results[0])}`;
    return text(`${head}\n\n${show(await settled(screen))}`);
  });

if (hasVision) server.tool("click_visual", "Screenshot fallback for apps with little accessibility info (canvas, games, some Electron apps): a vision model finds the described element and clicks it.",
  { target: z.string() }, async ({ target }) => {
    const { locate, VISION_MAX } = await import("./vision.ts");
    await driver.observe(lastApp);
    const shot = await driver.screenshot(VISION_MAX);
    if (shot.error) return text(`screenshot failed: ${shot.error}`);
    const p = await locate(shot, target);
    if (!p) return text(`not found: ${target}`);
    const res = await driver.act({ action: "click_at", x: p.x, y: p.y });
    return text(`result: ${JSON.stringify(res)}\n\n${show(await settled(lastObs ? shape(lastObs) : undefined))}`);
  });

if (hasVision) server.tool("read_visual", "Screenshot fallback: ask a vision model a question about the observed app's window.",
  { question: z.string() }, async ({ question }) => {
    const { ask, VISION_MAX } = await import("./vision.ts");
    await driver.observe(lastApp);
    return text(await ask(await driver.screenshot(VISION_MAX), question));
  });

if (hasPlanner) server.tool("run_task",
  "Hand a whole goal to the built-in agent (its own planner model, plus a cache that replays tasks it has done before). " +
  "Use when you'd rather not spend your own steps; returns a summary and the step log. Observe again afterwards: the screen has changed.",
  { goal: z.string() }, async ({ goal }) => {
    // Same helper as the other tools: no second process, and refs stay one numbering.
    const r = await runTask(goal, { driver });
    lastObs = undefined; diffsInRow = 0;  // the caller hasn't seen what the agent left on screen
    return text(JSON.stringify({ ok: r.ok, summary: r.summary, steps: r.steps.length, planner_calls: r.turns, tiers: [...new Set(r.steps.map((s) => s.tier))] }));
  });

server.tool("screenshot",
  "Image of the observed app's window, for when the element list doesn't show what you need. " +
  "To click something you see in it, call act{action:\"click_at\"} with the screen point given in the reply.",
  {}, async () => {
    await driver.observe(lastApp);
    const shot = await driver.screenshot(1280);  // the helper scales while capturing (shrink only)
    if (shot.error) return text(`screenshot failed: ${shot.error}`);
    const sx = shot.w / shot.px_w, sy = shot.h / shot.px_h;
    return { content: [
      { type: "image" as const, data: readFileSync(shot.path).toString("base64"), mimeType: "image/png" },
      { type: "text" as const, text: `Image is ${shot.px_w}x${shot.px_h}. Image pixel (px,py) is screen point x = ${shot.x} + px*${sx.toFixed(4)}, y = ${shot.y} + py*${sy.toFixed(4)}.` },
    ] };
  });

await server.connect(new StdioServerTransport());
// The host closed our stdin (it quit or restarted the server): exit and take the helper with us.
const bye = () => { driver.close(); process.exit(0); };
process.stdin.on("end", bye);
process.stdin.on("close", bye);
