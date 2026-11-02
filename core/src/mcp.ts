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
server.tool("run_task", "Let the built-in agent (fast path + planner model) complete a goal end to end.",
  { goal: z.string() }, async ({ goal }) => text(JSON.stringify(await runTask(goal))));

await server.connect(new StdioServerTransport());
