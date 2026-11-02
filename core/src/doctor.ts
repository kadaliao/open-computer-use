// `ocu doctor`: check permissions and which model endpoints actually answer, then suggest a working setup.
// Key values are never printed, only the variable names.
import { existsSync } from "node:fs";
import { BIN, MacDriver } from "./driver.ts";

const env = process.env;
const ok = (s: string) => console.log(`  ✓ ${s}`);
const bad = (s: string) => console.log(`  ✗ ${s}`);

async function chat(base: string, key: string | undefined, model: string, maxTokens = 1500) {
  if (!key) return { ok: false, why: "no key" };
  const t = performance.now();
  try {
    const r = await fetch(`${base}/chat/completions`, {
      method: "POST", signal: AbortSignal.timeout(25000),
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, max_tokens: maxTokens, messages: [{ role: "user", content: "Reply with: ok" }] }),
    });
    const ms = Math.round(performance.now() - t);
    return r.ok ? { ok: true, ms } : { ok: false, why: `HTTP ${r.status}` };
  } catch (e) { return { ok: false, why: String(e).slice(0, 60) }; }
}

export async function doctor() {
  console.log("permissions");
  const bin = BIN;
  if (!existsSync(bin)) { bad(`helper not built: ${bin} (cd mac && swift build -c release)`); return; }
  const d = new MacDriver();
  const obs = await d.observe();
  if (obs.error || obs.elements.length === 0) bad(`Accessibility: cannot read ${obs.app || "the front app"} - grant it to your terminal in System Settings > Privacy & Security > Accessibility`);
  else ok(`Accessibility (${obs.app}: ${obs.elements.length} elements)`);
  const shot = await d.screenshot();
  if (shot.error) bad(`Screen Recording: ${shot.error} - needed only for click_visual / read_visual`);
  else ok("Screen Recording");
  d.close();

  console.log("planner (required)");
  const pBase = env.OCU_BASE_URL ?? "https://api.deepseek.com", pModel = env.OCU_MODEL ?? "deepseek-chat";
  const p = await chat(pBase, env.OCU_API_KEY ?? env.DEEPSEEK_API_KEY, pModel, 20);
  p.ok ? ok(`${pModel} @ ${pBase} (${p.ms}ms)`) : bad(`${pModel} @ ${pBase}: ${p.why} - set OCU_BASE_URL / OCU_API_KEY / OCU_MODEL (any OpenAI-compatible chat model)`);

  console.log("fast judge (optional)");
  if (!env.TYPESAFE_API_KEY || env.OCU_JEV === "0") console.log("  - Jev off (set TYPESAFE_API_KEY to enable)");
  else {
    const t = performance.now();
    const r = await fetch(`${env.TYPESAFE_BASE_URL ?? "https://api.typesafe.ai"}/v1/systemone`, {
      method: "POST", signal: AbortSignal.timeout(10000),
      headers: { "content-type": "application/json", authorization: `Bearer ${env.TYPESAFE_API_KEY}` },
      body: JSON.stringify({ model: env.OCU_JEV_MODEL ?? "jev-latest", state: "screen: a button labeled OK", questions: { q: { type: "noul", instructions: "Is there a button?" } } }),
    }).catch((e) => ({ ok: false, status: String(e) }) as any);
    r.ok ? ok(`Jev (${Math.round(performance.now() - t)}ms)`) : bad(`Jev: ${r.status}`);
  }

  console.log("vision fallback (optional)");
  const candidates = [
    { name: "configured", base: env.OCU_VISION_BASE_URL, key: env.OCU_VISION_API_KEY, model: env.OCU_VISION_MODEL },
    { name: "StepFun step-gui", base: "https://api.stepfun.com/v1", key: env.STEPFUN_API_KEY, model: "step-gui", keyVar: "STEPFUN_API_KEY" },
    { name: "aihubmix qwen3-vl-plus", base: "https://aihubmix.com/v1", key: env.AIHUBMIX_API_KEY, model: "qwen3-vl-plus", keyVar: "AIHUBMIX_API_KEY" },
    { name: "DashScope qwen3-vl-plus", base: "https://dashscope.aliyuncs.com/compatible-mode/v1", key: env.DASHSCOPE_API_KEY, model: "qwen3-vl-plus", keyVar: "DASHSCOPE_API_KEY" },
  ].filter((c) => c.base && c.key && c.model);
  let working: (typeof candidates)[number] | undefined;
  for (const c of candidates) {
    const r = await chat(c.base!, c.key, c.model!);
    r.ok ? ok(`${c.name}: ${c.model} (${r.ms}ms)`) : bad(`${c.name}: ${r.why}`);
    if (r.ok && !working) working = c;
  }
  if (!candidates.length) console.log("  - no vision key found (STEPFUN_API_KEY, AIHUBMIX_API_KEY or DASHSCOPE_API_KEY)");
  else if (working && working.name !== "configured" && working.model !== "step-gui" && !env.OCU_VISION_MODEL) {
    console.log(`\nsuggested vision setup:\n  export OCU_VISION_BASE_URL=${working.base}\n  export OCU_VISION_API_KEY=$${working.keyVar}\n  export OCU_VISION_MODEL=${working.model}\n  export OCU_VISION_READ_MODEL=${working.model === "step-gui" ? "step-1o-turbo-vision" : working.model}`);
  }
}
