#!/usr/bin/env bun
// Usage: bun bench/run.ts [label] [taskId...]
// Compare configs by env, e.g. `OCU_JEV=0 bun bench/run.ts deepseek-only`.
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { runTask, totals } from "../src/agent.ts";
import { MacDriver, render } from "../src/driver.ts";
import { tasks } from "./tasks.ts";
// Measure the models, not the cache (OCU_CACHE=1 to benchmark replays).
process.env.OCU_CACHE ??= "0";

// Selectors: task ids, or "hard" / "easy" for groups.
const [label = process.env.OCU_JEV === "0" ? "planner-only" : "jev+planner", ...only] = process.argv.slice(2);
const pick = (t: { id: string; hard?: boolean }) => !only.length || only.includes(t.id) ||
  (only.includes("hard") && !!t.hard) || (only.includes("easy") && !t.hard);
const sh = (c: string) => { try { execSync(c, { stdio: "pipe", timeout: 15000 }); return true; } catch { return false; } };
type Row = { id: string; pass: boolean; steps: number; turns: number; fast: number; total_ms: number;
  time: ReturnType<typeof totals>; summary: string; log: object[] };
const rows: Row[] = [];

for (const t of tasks.filter(pick)) {
  if (t.setup) { sh(t.setup); await Bun.sleep(1500); }
  const t0 = performance.now();
  let r: Awaited<ReturnType<typeof runTask>>;
  try { r = await runTask(t.goal, { maxSteps: t.hard ? 30 : 15, log: (s) => console.log(`  ${s}`) }); }
  catch (e) { r = { ok: false, summary: String(e), steps: [], turns: 0 }; }
  const total = Math.round(performance.now() - t0);
  await Bun.sleep(500);
  let pass = r.ok;
  if (pass && t.verify instanceof RegExp) {
    const d = new MacDriver(); pass = t.verify.test(render(await d.observe())); d.close();
  } else if (pass && typeof t.verify === "function") pass = t.verify(r.summary);
  else if (pass && "sh" in t.verify) pass = sh(t.verify.sh);
  const fast = r.steps.filter((s) => s.tier === "fast" || s.tier === "jev-done").length;
  // Time split (observe incl. settling before a turn / model / waits inside a batch / actions); the rest is helper start-up.
  const time = totals(r.steps);
  rows.push({ id: t.id, pass, steps: r.steps.length, turns: r.turns, fast, total_ms: total, time, summary: r.summary, log: r.steps });
  console.log(`${pass ? "PASS" : "FAIL"} ${t.id}  ${r.steps.length} steps, ${r.turns} planner calls (${fast} by Jev)  ${(total / 1000).toFixed(1)}s` +
    `  [observe ${time.obs} model ${time.model} wait ${time.wait} act ${time.act} ms]`);
  if (t.cleanup) sh(t.cleanup);
}

const passed = rows.filter((r) => r.pass).length;
const steps = rows.reduce((a, r) => a + r.steps, 0);
const sum = (f: (r: Row) => number) => rows.reduce((a, r) => a + f(r), 0);
const avg_s = (f: (r: Row) => number) => +(sum(f) / Math.max(rows.length, 1) / 1000).toFixed(2);
const summary = {
  label, date: new Date().toISOString(),
  pass_rate: `${passed}/${rows.length}`,
  avg_task_s: +(sum((r) => r.total_ms) / rows.length / 1000).toFixed(1),
  avg_turns: +(sum((r) => r.turns) / Math.max(rows.length, 1)).toFixed(2),
  avg_step_ms: Math.round(sum((r) => r.total_ms) / Math.max(steps, 1)),
  // Average seconds per task spent in each phase.
  avg_observe_s: avg_s((r) => r.time.obs), avg_model_s: avg_s((r) => r.time.model),
  avg_wait_s: avg_s((r) => r.time.wait), avg_act_s: avg_s((r) => r.time.act),
  jev_share: `${rows.reduce((a, r) => a + r.fast, 0)}/${steps}`,
};
console.log(JSON.stringify(summary, null, 2));
mkdirSync("bench/results", { recursive: true });
writeFileSync(`bench/results/${Date.now()}-${label}.json`, JSON.stringify({ summary, rows }, null, 2));
