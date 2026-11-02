// MCP server so any harness (Claude Code, Codex, DeepSeek-based agents) can drive macOS apps.
// The calling agent supplies the intelligence; these tools give it a cheap, exact view of the UI.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { MacDriver, render, type Observation } from "./driver.ts";
import { runTask } from "./agent.ts";

const driver = new MacDriver();
const server = new McpServer({ name: "open-computer-use", version: "0.3.0" });
const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });
let lastApp: string | undefined;  // the caller's own terminal is usually frontmost, so stick to the app it chose

/** Re-read until the UI stops changing (window opened, page loaded). */
async function settled(app?: string): Promise<Observation> {
  let prev = await driver.observe(app);
  for (let t = 0; t < 2000; t += 150) {
    await new Promise((r) => setTimeout(r, 150));
    const cur = await driver.observe(app);
    if (render(cur) === render(prev)) return cur;
    prev = cur;
  }
  return prev;
}

server.tool("observe",
  "List the elements of a macOS app's focused window as `ref Role \"label\"` lines (refs reset on every observe). " +
  "Pass `app` (name or bundle id) to target an app without bringing it forward; otherwise the frontmost app (often your own terminal) is read. " +
  "The app is remembered for later calls.",
  { app: z.string().optional() },
  async ({ app }) => { if (app) lastApp = app; return text(render(await driver.observe(lastApp))); });

const one = {
  action: z.enum(["press", "set_value", "type", "key", "open_app", "open_url", "menu", "find_text", "click_at"]),
  ref: z.string().optional(), text: z.string().optional(), key: z.string().optional(), name: z.string().optional(),
  url: z.string().optional(), path: z.array(z.string()).optional(), x: z.number().optional(), y: z.number().optional(),
};
server.tool("act",
  "Perform one action, then return the updated screen (same format as observe). Refs come from the latest observe/act. " +
  "press{ref} | set_value{ref,text} | type{text, ref?} (ref = insert into that field) | key{key} e.g. \"cmd+shift+g\", \"return\" | " +
  "open_app{name} | open_url{url} | menu{path:[\"File\",\"New Folder\"]} | find_text{text} search the whole window, incl. off-screen text | " +
  "click_at{x,y} global screen point. Keyboard actions bring the observed app forward first.",
  { ...one, then: z.array(z.object(one)).optional().describe("more actions to run right after, in order, using refs from the same screen (e.g. a run of keypad presses); stops at the first error") },
  async ({ then, ...a }) => {
    if (then?.length) {
      const results = [];
      for (const x of [a, ...then]) {
        const r = await driver.act(x as any); results.push(r);
        if (r.error) break;
        await new Promise((res) => setTimeout(res, 60));
      }
      return text(`results: ${JSON.stringify(results)}\n\n${render(await settled(lastApp))}`);
    }
    if (a.action === "open_app" && a.name) lastApp = a.name;
    if (a.action === "open_url") lastApp = undefined;  // the browser comes forward
    const req: any = a.action === "find_text" ? { action: "find_text", query: a.text } : a;
    const res = await driver.act(req);
    if (a.action === "find_text") return text(JSON.stringify(res));
    const obs = await settled(lastApp);
    return text(`result: ${JSON.stringify(res)}\n\n${render(obs)}`);
  });

server.tool("click_visual", "Screenshot fallback for apps with little accessibility info (canvas, games, some Electron apps): a vision model finds the described element and clicks it.",
  { target: z.string() }, async ({ target }) => {
    const { locate } = await import("./vision.ts");
    await driver.observe(lastApp);
    const shot = await driver.screenshot();
    if ((shot as any).error) return text(`screenshot failed: ${(shot as any).error}`);
    const p = await locate(shot, target);
    if (!p) return text(`not found: ${target}`);
    const res = await driver.act({ action: "click_at", x: p.x, y: p.y });
    return text(`result: ${JSON.stringify(res)}\n\n${render(await settled(lastApp))}`);
  });

server.tool("read_visual", "Screenshot fallback: ask a vision model a question about the observed app's window.",
  { question: z.string() }, async ({ question }) => {
    const { ask } = await import("./vision.ts");
    await driver.observe(lastApp);
    return text(await ask(await driver.screenshot(), question));
  });

server.tool("run_task",
  "Hand a whole goal to the built-in agent (its own planner model, plus a cache that replays tasks it has done before). " +
  "Use when you'd rather not spend your own steps; returns a summary and the step log.",
  { goal: z.string() }, async ({ goal }) => {
    const r = await runTask(goal);
    return text(JSON.stringify({ ok: r.ok, summary: r.summary, steps: r.steps.length, tiers: [...new Set(r.steps.map((s) => s.tier))] }));
  });

await server.connect(new StdioServerTransport());
// The host closed our stdin (it quit or restarted the server): exit and take the helper with us.
const bye = () => { driver.close(); process.exit(0); };
process.stdin.on("end", bye);
process.stdin.on("close", bye);
