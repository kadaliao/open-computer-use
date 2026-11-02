// MCP server so any harness (Claude Code, Codex, DeepSeek-based agents) can use it.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { MacDriver, render } from "./driver.ts";
import { runTask } from "./agent.ts";

const driver = new MacDriver();
const server = new McpServer({ name: "open-computer-use", version: "0.1.0" });
const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });

server.tool("observe", "List interactive elements of the frontmost macOS window (refs reset each call).", {},
  async () => text(render(await driver.observe())));
server.tool("act", "Perform one action. Refs come from the latest observe.", {
  action: z.enum(["press", "set_value", "type", "key", "open_app", "open_url", "menu"]),
  ref: z.string().optional(), text: z.string().optional(), key: z.string().optional(), name: z.string().optional(), url: z.string().optional(), path: z.array(z.string()).optional(),
}, async (a) => text(JSON.stringify(await driver.act(a as any))));
server.tool("click_visual", "Screenshot fallback: find an element by description with a vision model and click it.",
  { target: z.string() }, async ({ target }) => {
    const { locate } = await import("./vision.ts");
    await driver.observe();
    const shot = await driver.screenshot();
    const p = await locate(shot, target);
    if (!p) return text(`not found: ${target}`);
    return text(JSON.stringify(await driver.act({ action: "click_at", x: p.x, y: p.y })));
  });
server.tool("read_visual", "Screenshot fallback: ask a vision model a question about the front window.",
  { question: z.string() }, async ({ question }) => {
    const { ask } = await import("./vision.ts");
    await driver.observe();
    return text(await ask(await driver.screenshot(), question));
  });
server.tool("run_task", "Let the built-in agent (fast path + planner model) complete a goal end to end.",
  { goal: z.string() }, async ({ goal }) => text(JSON.stringify(await runTask(goal))));

await server.connect(new StdioServerTransport());
