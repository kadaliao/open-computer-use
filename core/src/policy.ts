// Tiered decision: fast path first (Jev endpoint or local rules), LLM planner as fallback.
import type { Action, Observation } from "./driver.ts";
import { render } from "./driver.ts";

export type Step = Action | { action: "done"; summary: string }
  | { action: "click_visual"; target: string } | { action: "read_visual"; question: string };
export type ActStep = Exclude<Step, { action: "done" } | { action: "click_visual" } | { action: "read_visual" }>;
type Msg = { role: "system" | "user" | "assistant"; content: string };

const env = process.env;
const SYSTEM = `You operate a macOS computer through its accessibility tree.
Each turn you see the goal, history and the current interactive elements (ref role "label").
Reply with JSON action objects only, one per line. Send several in a row when you can do them without
looking at the screen in between (e.g. pressing calculator keys, or set_value then key return); otherwise send one.
Actions:
{"action":"press","ref":"e3"} {"action":"set_value","ref":"e2","text":"..."} {"action":"type","text":"..."}
{"action":"key","key":"return"} (keys: return tab escape space delete up down left right, combos like "cmd+n", "cmd+shift+left")
{"action":"menu","path":["前往","下载"]} (click a menu-bar menu item by its titles; MenuBarItem elements list the top menus)
{"action":"open_app","name":"Notes"} {"action":"open_url","url":"https://..."}
{"action":"click_visual","target":"the blue Send button at the bottom right"} (screenshot + vision model; use only when the element is missing from the list)
{"action":"read_visual","question":"What does the chat window say?"} (screenshot + vision model; the answer appears in history)
{"action":"done","summary":"..."}
Rules: "type" inserts text; always pass the "ref" of the target text field/area when you can.
Only reply done when the current screen shows the result (e.g. the typed text is visible in a field's label); never assume. Elements with role Text are read-only context.
Prefer the menu action over guessing keyboard shortcuts. If an action had no visible effect, do not repeat it; try another way. Reply done as soon as the goal is visibly achieved; put any answer the goal asks for in summary.`;

// Tier 1: optional fast decision model (e.g. a Jev server). Expected to return {step, confidence}.
async function fastPath(goal: string, history: string[], obs: Observation, signal?: AbortSignal): Promise<Step[] | null> {
  if (env.TYPESAFE_API_KEY && env.OCU_JEV !== "0" && env.OCU_JEV_PRESS === "1") return jev(goal, history, obs, signal);
  if (env.OCU_FAST_MODEL) return fastModel(goal, obs).then((s) => (s ? [s] : null));
  if (!env.OCU_FAST_URL) return null;
  try {
    const r = await fetch(env.OCU_FAST_URL, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ goal, observation: obs }), signal: AbortSignal.timeout(1500),
    });
    const { step, confidence } = (await r.json()) as { step: Step; confidence: number };
    return confidence >= Number(env.OCU_FAST_MIN_CONF ?? 0.8) ? [step] : null;
  } catch { return null; }
}

// Tier 1a: official TypeSafe Jev. It is a classifier, so we ask it which elements to press next.
// One request carries several questions ("1st press", "2nd press", ...) so a sequence like calculator
// keys comes back in one round trip. "other" means typing / opening apps / finishing: planner's job.
const PRESSABLE = new Set(["Button", "MenuItem", "MenuButton", "Link", "Tab", "CheckBox", "RadioButton", "PopUpButton", "Cell", "Row"]);
const JEV_SEQ = Number(env.OCU_JEV_SEQ ?? 2); // answers past the 2nd press get unreliable
async function jev(goal: string, history: string[], obs: Observation, signal?: AbortSignal): Promise<Step[] | null> {
  const opts = obs.elements.filter((e) => PRESSABLE.has(e.role) && e.label).slice(0, 60);
  if (!opts.length) return null;
  const criteria: Record<string, string | null> = { other: null };
  for (const e of opts) criteria[e.ref] = `${e.role} ${e.label}`;
  const ord = ["1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th"];
  const questions: Record<string, object> = {};
  for (let k = 0; k < JEV_SEQ; k++) questions[`p${k}`] = { type: "choice", criteria,
    instructions: `Assuming the earlier presses in this sequence succeed and the screen does not change, which element is the ${ord[k]} one to press from now to progress toward the goal? Pick 'other' if at that point typing, opening an app, anything else is needed, or the goal is already done.` };
  try {
    const r = await fetch(`${env.TYPESAFE_BASE_URL ?? "https://api.typesafe.ai"}/v1/systemone`, {
      method: "POST", signal: AbortSignal.any([AbortSignal.timeout(Number(env.OCU_FAST_TIMEOUT_MS ?? 3000)), ...(signal ? [signal] : [])]),
      headers: { "content-type": "application/json", authorization: `Bearer ${env.TYPESAFE_API_KEY}` },
      body: JSON.stringify({
        model: env.OCU_JEV_MODEL ?? "jev-latest",
        state: `goal: ${goal}\nhistory:\n${history.slice(-5).join("\n") || "(none)"}\nscreen:\n${render(obs)}`,
        questions,
      }),
    });
    if (!r.ok) return null;
    const answers = ((await r.json()) as any).answers as Record<string, { choice: string; confidence: number }>;
    const min = Number(env.OCU_FAST_MIN_CONF ?? 0.8);
    const seq: Step[] = [];
    for (let k = 0; k < JEV_SEQ; k++) {
      const a = answers[`p${k}`];
      if (!a || a.choice === "other" || a.confidence < min) break;
      seq.push({ action: "press", ref: a.choice });
    }
    return seq.length ? seq : null;
  } catch { return null; }
}

// Tier 1b: a fast chat model behind an OpenAI-compatible API (e.g. jev@latest on aihubmix).
async function fastModel(goal: string, obs: Observation): Promise<Step | null> {
  try {
    const base = env.OCU_FAST_BASE_URL ?? "https://aihubmix.com/v1";
    const r = await fetch(`${base}/chat/completions`, {
      method: "POST", signal: AbortSignal.timeout(Number(env.OCU_FAST_TIMEOUT_MS ?? 3000)),
      headers: { "content-type": "application/json", authorization: `Bearer ${env.OCU_FAST_API_KEY ?? env.AIHUBMIX_API_KEY}` },
      body: JSON.stringify({ model: env.OCU_FAST_MODEL, temperature: 0, messages: [
        { role: "system", content: SYSTEM + '\nIf unsure, reply {"action":"defer"}.' },
        { role: "user", content: `goal: ${goal}\n\nscreen:\n${render(obs)}` }] }),
    });
    if (!r.ok) return null;
    const text: string = ((await r.json()) as any).choices[0].message.content;
    const step = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
    return step.action && step.action !== "defer" ? step : null;
  } catch { return null; }
}

/** Pull every top-level JSON object out of the model's reply (it may send a batch). */
export function parseSteps(text: string): Step[] {
  const out: Step[] = [];
  let depth = 0, start = -1, inStr = false, esc = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === "{") { if (depth++ === 0) start = i; }
    else if (c === "}" && depth > 0 && --depth === 0) {
      try { const s = JSON.parse(text.slice(start, i + 1)); if (typeof s?.action === "string") out.push(s); } catch {}
    }
  }
  return out;
}

// Tier 2: any OpenAI-compatible chat model (DeepSeek by default).
async function planner(messages: Msg[], signal?: AbortSignal): Promise<Step[]> {
  const base = env.OCU_BASE_URL ?? "https://api.deepseek.com";
  const r = await fetch(`${base}/chat/completions`, {
    method: "POST", signal,
    headers: { "content-type": "application/json", authorization: `Bearer ${env.OCU_API_KEY ?? env.DEEPSEEK_API_KEY}` },
    body: JSON.stringify({ model: env.OCU_MODEL ?? "deepseek-chat", messages, temperature: 0 }),
  });
  if (!r.ok) throw new Error(`planner ${r.status}: ${await r.text()}`);
  const data = (await r.json()) as any;
  const text: string = data.choices[0].message.content ?? "";
  const steps = parseSteps(text);
  if (!steps.length) throw new Error(`planner returned no JSON action: ${text.slice(0, 200)}`);
  return steps;
}

/** Jev as a fast yes/no judge: probability that the goal is already achieved on this screen. */
async function jevDone(goal: string, history: string[], obs: Observation, signal: AbortSignal): Promise<number> {
  if (!env.TYPESAFE_API_KEY || env.OCU_JEV === "0") return 0;
  try {
    const r = await fetch(`${env.TYPESAFE_BASE_URL ?? "https://api.typesafe.ai"}/v1/systemone`, {
      method: "POST", signal: AbortSignal.any([AbortSignal.timeout(Number(env.OCU_FAST_TIMEOUT_MS ?? 3000)), signal]),
      headers: { "content-type": "application/json", authorization: `Bearer ${env.TYPESAFE_API_KEY}` },
      body: JSON.stringify({
        model: env.OCU_JEV_MODEL ?? "jev-latest",
        state: `goal: ${goal}\nactions so far:\n${history.slice(-6).join("\n") || "(none)"}\nscreen now:\n${render(obs)}`,
        questions: { done: { type: "noul", instructions: "Does the current screen show that the goal has been fully achieved (nothing left to do)?" } },
      }),
    });
    if (!r.ok) return 0;
    return ((await r.json()) as any).answers.done.noul ?? 0;
  } catch { return 0; }
}

// Each turn the planner and the Jev judges start together.
// - Jev press mode (OCU_JEV_PRESS=1): a confident Jev press wins unless the planner lands within a short grace.
// - Jev done check: if Jev is confident the goal is met and the planner wants to keep acting,
//   ask the planner once more with that hint, so it wraps up instead of wandering.
const GRACE_MS = Number(env.OCU_PLANNER_GRACE_MS ?? 400);
const DONE_MIN = Number(env.OCU_JEV_DONE_MIN ?? 0.9);
export async function decide(goal: string, history: string[], obs: Observation): Promise<{ steps: Step[]; tier: string }> {
  const user = `goal: ${goal}\nhistory:\n${history.join("\n") || "(none)"}\n\nscreen:\n${render(obs)}`;
  const msgs: Msg[] = [{ role: "system", content: SYSTEM }, { role: "user", content: user }];
  const ctl = new AbortController();
  const plan = planner(msgs, ctl.signal).catch(() => (ctl.signal.aborted ? [] : planner(msgs))); // one retry
  plan.catch(() => {});
  let planDone = false;
  plan.then(() => { planDone = true; }, () => {});
  const doneP = history.length ? jevDone(goal, history, obs, ctl.signal) : Promise.resolve(0);

  const fast = await fastPath(goal, history, obs);
  if (fast) {
    if (!planDone) await Promise.race([plan.catch(() => {}), new Promise((r) => setTimeout(r, GRACE_MS))]);
    if (planDone) { const p = await plan.catch(() => []); if (p.length) return { steps: p, tier: "planner" }; }
    ctl.abort();
    return { steps: fast, tier: "fast" };
  }

  const steps = await plan;
  if (steps[0]?.action === "done") return { steps, tier: "planner" };
  const pDone = await doneP;
  if (pDone < DONE_MIN) return { steps, tier: "planner" };
  const hint = `${user}\n\nNote: a verifier is ${Math.round(pDone * 100)}% sure the goal is already achieved on this screen. ` +
    `If it is, reply {"action":"done","summary":"..."} (include any answer the goal asks for); otherwise continue.`;
  const again = await planner([{ role: "system", content: SYSTEM }, { role: "user", content: hint }]).catch(() => steps);
  return { steps: again, tier: again[0]?.action === "done" ? "jev-done" : "planner" };
}
