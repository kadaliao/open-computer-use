#!/usr/bin/env bun
import { runTask, totals } from "./agent.ts";
import { MacDriver, render } from "./driver.ts";

const args = process.argv.slice(2);
const noCache = args.includes("--no-cache");
const [cmd, ...rest] = args.filter((a) => a !== "--no-cache");
if (cmd === "run" && rest.length) {
  const t0 = performance.now();
  const r = await runTask(rest.join(" "), { log: console.log, noCache });
  const t = totals(r.steps);
  console.log(`${r.ok ? "done" : "failed"} in ${((performance.now() - t0) / 1000).toFixed(1)}s, ${r.turns} planner calls ` +
    `(observe ${t.obs} + model ${t.model} + wait ${t.wait} + actions ${t.act} ms)`);
  process.exit(r.ok ? 0 : 1);
} else if (cmd === "observe") {
  const d = new MacDriver(); console.log(render(await d.observe(rest[0]))); d.close();
} else if (cmd === "mcp") {
  await import("./mcp.ts");
} else if (cmd === "doctor") {
  await (await import("./doctor.ts")).doctor();
} else if (cmd === "cache") {
  const { existsSync, readFileSync, rmSync } = await import("node:fs");
  const file = process.env.OCU_CACHE_FILE ?? `${process.env.HOME}/.cache/ocu/actions.json`;
  if (rest[0] === "clear") { rmSync(file, { force: true }); console.log("cache cleared"); }
  else {
    const db = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
    for (const [k, e] of Object.entries<any>(db)) console.log(`${String(e.hits).padStart(3)} hits  ${e.steps.length} steps  ${k}`);
    console.log(`(${Object.keys(db).length} entries in ${file})`);
  }
} else {
  console.log('usage: ocu run "<goal>" [--no-cache] | ocu observe [app] | ocu mcp | ocu doctor | ocu cache [clear]');
}
