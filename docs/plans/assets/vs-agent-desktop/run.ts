// Head-to-head: the same Claude model drives the same tasks through ocu's MCP server or agent-desktop's.
// Usage: OCU_VS_DIR=<work dir> AD_BIN=<agent-desktop binary> bun run.ts <runs> [taskId...]
// Reference script from the 2026-11-16 comparison (docs/benchmarks.md). Plan 01 turns it into core/bench/vs/.
// Appends one JSON line per run to $OCU_VS_DIR/results.jsonl and keeps each run's stream-json log in logs/.
import { execSync, spawn } from "node:child_process";
import { appendFileSync, writeFileSync } from "node:fs";

const S = process.env.OCU_VS_DIR ?? `${process.cwd()}/vs-work`;
const REPO = new URL("../../../../", import.meta.url).pathname;  // docs/plans/assets/vs-agent-desktop -> repo root
process.env.OCU_MAC_BIN = `${process.env.HOME}/.local/share/ocu/ocu-mac`;
process.env.OCU_OVERLAY = "0";
const { MacDriver, render } = await import(`${REPO}core/src/driver.ts`);

const noKeys = { DEEPSEEK_API_KEY: "", OCU_API_KEY: "", STEPFUN_API_KEY: "", OCU_VISION_API_KEY: "", OCU_SHELL_ENV: "0" };
const servers = {
  ocu: { command: `${process.env.HOME}/.local/share/ocu/ocu`, args: ["mcp"], env: noKeys },
  "agent-desktop": { command: process.env.AD_BIN ?? "agent-desktop", args: ["mcp"] },
} as const;
type Tool = keyof typeof servers;
for (const [name, cfg] of Object.entries(servers)) writeFileSync(`${S}/${name}.json`, JSON.stringify({ mcpServers: { [name]: cfg } }));

type Task = { id: string; prompt: string; setup: string; app?: string; verify: (answer: string, screen: string) => boolean };
const tasks: Task[] = [
  { id: "calc-mul", prompt: "用计算器算 789 乘以 36，把结果告诉我。",
    setup: "pkill -x Calculator; sleep 1; open -a Calculator; sleep 2", app: "com.apple.calculator",
    verify: (a) => /28[,，\s]?404/.test(a) },
  { id: "settings-about", prompt: "打开系统设置，进入“通用”里的“关于本机”页面。",
    setup: "open 'x-apple.systempreferences:com.apple.wifi-settings-extension'; sleep 2.5", app: "com.apple.systempreferences",
    verify: (_, s) => /window: (关于本机|About)/.test(s) },
  { id: "safari-link", prompt: "在 Safari 打开 example.com，然后点击页面上的链接。",
    setup: "open -a Safari https://www.apple.com/cn/; sleep 3", app: "com.apple.Safari",
    verify: (_, s) => /iana/i.test(s) && !/window: Example Domain\s*$/m.test(s) },
  { id: "finder-utilities", prompt: "在访达里打开“应用程序”文件夹，再进入其中的“实用工具”文件夹。",
    setup: "open ~/Documents; sleep 2", app: "com.apple.finder",
    verify: (_, s) => /window: (实用工具|Utilities)/.test(s) },
];

const sh = (c: string) => { try { execSync(c, { stdio: "ignore", timeout: 20000 }); } catch {} };

async function runOne(tool: Tool, task: Task) {
  sh(task.setup);
  const args = ["-p", task.prompt, "--model", "sonnet", "--tools", "", "--strict-mcp-config", "--mcp-config", `${S}/${tool}.json`,
    "--allowedTools", `mcp__${tool}`, "--setting-sources", "", "--no-session-persistence", "--max-turns", "40",
    "--output-format", "stream-json", "--verbose"];
  const t0 = performance.now();
  const p = spawn("claude", args, { cwd: `${S}/empty`, env: { ...process.env, ENABLE_TOOL_SEARCH: "false" }, stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  p.stdout.on("data", (b) => (out += b));
  const killer = setTimeout(() => p.kill("SIGTERM"), 300_000);
  await new Promise((r) => p.on("close", r));
  clearTimeout(killer);
  const wall = Math.round(performance.now() - t0);

  let calls = 0, resultChars = 0, images = 0, toolNames: string[] = [], toolsOffered = 0, final: any = null;
  const sizes: number[] = [];
  for (const line of out.split("\n")) {
    let m: any; try { m = JSON.parse(line); } catch { continue; }
    if (m.type === "system" && m.subtype === "init") toolsOffered = m.tools?.length ?? 0;
    if (m.type === "assistant") for (const c of m.message?.content ?? []) if (c.type === "tool_use") { calls++; toolNames.push(String(c.name).split("__").pop()!); }
    if (m.type === "user") for (const c of m.message?.content ?? []) if (c.type === "tool_result") {
      const parts = typeof c.content === "string" ? [{ type: "text", text: c.content }] : c.content ?? [];
      let n = 0;
      for (const p of parts) { if (p.type === "text") n += p.text.length; if (p.type === "image") images++; }
      resultChars += n; sizes.push(n);
    }
    if (m.type === "result") final = m;
  }
  // Check the real outcome with a neutral read of the app (no overlay).
  let screen = "";
  if (task.app) { const d = new MacDriver(); try { screen = render(await d.observe(task.app)); } catch (e) { screen = String(e); } d.close(); }
  const answer = final?.result ?? "";
  const u = final?.usage ?? {};
  const row = {
    tool, task: task.id, pass: task.verify(answer, screen), wall_ms: wall, api_ms: final?.duration_api_ms, turns: final?.num_turns,
    tool_calls: calls, tools: toolNames.join(" "), result_chars: resultChars, max_result_chars: Math.max(0, ...sizes), images, tools_offered: toolsOffered,
    input_tokens: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
    uncached_tokens: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0), output_tokens: u.output_tokens ?? 0,
    cost_usd: final?.total_cost_usd, stop: final?.subtype ?? "killed", answer: answer.slice(0, 160), screen_head: screen.split("\n")[0],
  };
  appendFileSync(`${S}/results.jsonl`, JSON.stringify(row) + "\n");
  writeFileSync(`${S}/logs/${tool}-${task.id}-${Date.now()}.jsonl`, out);
  console.log(`${row.pass ? "PASS" : "FAIL"} ${tool.padEnd(13)} ${task.id.padEnd(17)} ${(wall / 1000).toFixed(1)}s turns=${row.turns} calls=${calls} ` +
    `result=${resultChars}ch tokens=${row.input_tokens}/${row.output_tokens} $${row.cost_usd?.toFixed(3)} [${row.tools}]`);
  return row;
}

execSync(`mkdir -p ${S}/logs ${S}/empty`);  // runs start in an empty folder: no project CLAUDE.md
const [runsArg = "1", ...only] = process.argv.slice(2);
const pick = tasks.filter((t) => !only.length || only.includes(t.id));
for (let r = 0; r < Number(runsArg); r++)
  for (const task of pick)
    for (const tool of (r % 2 === 0 ? ["ocu", "agent-desktop"] : ["agent-desktop", "ocu"]) as Tool[]) await runOne(tool, task);
process.exit(0);
