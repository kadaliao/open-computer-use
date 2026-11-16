// Summarize ../results.jsonl: per task and tool, pass rate and medians; then totals per tool.
const S = process.env.OCU_VS_DIR ?? `${process.cwd()}/vs-work`;
const rows = (await Bun.file(`${S}/results.jsonl`).text()).trim().split("\n").map((l) => JSON.parse(l));
const med = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : NaN; };
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const tasks = [...new Set(rows.map((r) => r.task))];
const tools = ["ocu", "agent-desktop"];
console.log("| task | tool | pass | wall s (median) | turns | tool calls | reply chars | input tokens | cost $ |");
console.log("|---|---|---|---|---|---|---|---|---|");
for (const t of tasks) for (const tool of tools) {
  const g = rows.filter((r) => r.task === t && r.tool === tool);
  if (!g.length) continue;
  console.log(`| ${t} | ${tool} | ${g.filter((r) => r.pass).length}/${g.length} | ${(med(g.map((r) => r.wall_ms)) / 1000).toFixed(1)} | ${med(g.map((r) => r.turns))} | ${med(g.map((r) => r.tool_calls))} | ${Math.round(med(g.map((r) => r.result_chars)))} | ${Math.round(med(g.map((r) => r.input_tokens)) / 1000)}k | ${med(g.map((r) => r.cost_usd)).toFixed(3)} |`);
}
console.log("\nTotals per tool (all runs):");
for (const tool of tools) {
  const g = rows.filter((r) => r.tool === tool);
  console.log(`${tool}: runs ${g.length}, pass ${g.filter((r) => r.pass).length}, wall ${(sum(g.map((r) => r.wall_ms)) / 1000).toFixed(0)}s, ` +
    `tool calls ${sum(g.map((r) => r.tool_calls))}, reply chars ${sum(g.map((r) => r.result_chars))}, images ${sum(g.map((r) => r.images))}, ` +
    `input tokens ${Math.round(sum(g.map((r) => r.input_tokens)) / 1000)}k (uncached ${Math.round(sum(g.map((r) => r.uncached_tokens)) / 1000)}k), ` +
    `output ${sum(g.map((r) => r.output_tokens))}, cost $${sum(g.map((r) => r.cost_usd ?? 0)).toFixed(2)}`);
}
console.log("\nFailures:");
for (const r of rows.filter((r) => !r.pass)) console.log(`- ${r.tool} ${r.task} (${r.stop}, ${(r.wall_ms / 1000).toFixed(0)}s): ${r.screen_head} | ${r.answer.replace(/\n/g, " ").slice(0, 120)}`);
