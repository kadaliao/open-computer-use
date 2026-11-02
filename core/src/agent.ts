import { MacDriver, render, type Observation } from "./driver.ts";

/** Re-read the UI until two reads in a row match (page loaded, window opened), up to maxMs. */
async function settle(driver: MacDriver, maxMs = 2000): Promise<Observation> {
  const t0 = performance.now();
  let prev = await driver.observe();
  while (performance.now() - t0 < maxMs) {
    await new Promise((r) => setTimeout(r, 150));
    const cur = await driver.observe();
    if (render(cur) === render(prev)) return cur;
    prev = cur;
  }
  return prev;
}
import { decide, type ActStep, type Step } from "./policy.ts";
import { ask, locate } from "./vision.ts";

/** Screenshot fallback actions run here; everything else goes straight to the driver. */
async function perform(driver: MacDriver, step: Step): Promise<{ ok?: boolean; error?: string; target?: string; via?: string; note?: string }> {
  if (step.action === "click_visual") {
    const shot = await driver.screenshot();
    if (shot.error) return { error: shot.error };
    const p = await locate(shot, step.target).catch((e) => { throw new Error(String(e)); });
    if (!p) return { error: `vision model could not find "${step.target}"` };
    const res = await driver.act({ action: "click_at", x: p.x, y: p.y });
    return { ...res, target: `Visual "${step.target}" @${Math.round(p.x)},${Math.round(p.y)}`, via: "vision" };
  }
  if (step.action === "read_visual") {
    const shot = await driver.screenshot();
    if (shot.error) return { error: shot.error };
    return { ok: true, via: "vision", note: await ask(shot, step.question) };
  }
  return driver.act(step as ActStep);
}

export type StepLog = { tier: string; ms: number; step: object; target?: string; error?: string; via?: string };

export async function runTask(goal: string, opts: { maxSteps?: number; log?: (s: string) => void } = {}) {
  const steps: StepLog[] = [];
  const log = opts.log ?? (() => {});
  const driver = new MacDriver();
  const history: string[] = [];
  let needSettle = false;
  let lastAct = { key: "", screen: "" };  // last action and the screen it ran on
  try {
    for (let i = 0; i < (opts.maxSteps ?? 25); i++) {
      const t0 = performance.now();
      const obs = needSettle ? await settle(driver) : await driver.observe();
      needSettle = false;
      const screen = render(obs);
      const { steps: batch, tier } = await decide(goal, history, obs);
      const ms = Math.round(performance.now() - t0);
      for (const [k, step] of batch.entries()) {
        // "done" only counts right after looking at the screen, never at the end of a blind batch.
        if (step.action === "done" && k > 0) break;
        if (step.action === "done") {
          steps.push({ tier, ms, step });
          log(`done (${tier}, ${ms}ms): ${step.summary}`);
          return { ok: true, summary: step.summary, steps };
        }
        // Same action on an unchanged screen already did nothing once: don't repeat it.
        const key = JSON.stringify(step);
        if (k === 0 && key === lastAct.key && screen === lastAct.screen) {
          history.push(`${key} -> skipped: it had no visible effect last time; choose a different action or approach`);
          log(`[${i}] ${tier} ${ms}ms ${key} -> skipped (no effect last time)`);
          break;
        }
        if (k === 0) lastAct = { key, screen };
        const res = await perform(driver, step).catch((e) => ({ error: String(e) }) as Awaited<ReturnType<typeof perform>>);
        steps.push({ tier, ms, step, target: res.target, error: res.error, via: res.via });
        const line = `${JSON.stringify(step)}${res.target ? ` [${res.target}]` : ""} -> ${res.error ?? "ok"}${res.note ? `\n  answer: ${res.note}` : ""}`;
        // Nudge the planner out of loops: same action 3 times in a row.
        const repeats = history.slice(-2).filter((h) => h.startsWith(JSON.stringify(step))).length;
        history.push(repeats === 2 ? `${line} (repeated 3 times with no progress - try a different approach)` : line);
        log(`[${i}] ${tier} ${ms}ms ${line}`);
        if (res.error) break;
        // These change the UI, so later actions in the batch would act on a stale screen: re-observe.
        if (step.action === "read_visual") break; // the planner needs to see the answer
        const changesUI = ["press", "menu", "open_app", "open_url", "click_visual"].includes(step.action) ||
          (step.action === "key" && (step.key.includes("+") || step.key === "return"));
        if (changesUI) needSettle = true;
        // Consecutive presses are fine (a Jev sequence or calculator keys); anything else re-observes.
        if (changesUI && k < batch.length - 1 &&
            !(step.action === "press" && batch[k + 1]?.action === "press")) break;
        if (batch.length > 1) await new Promise((r) => setTimeout(r, 80));
      }
      if (!needSettle) await new Promise((r) => setTimeout(r, 100));
    }
    return { ok: false, summary: "max steps reached", steps };
  } finally { driver.close(); }
}
