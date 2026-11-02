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
import * as cache from "./cache.ts";

const UI_CHANGERS = ["press", "menu", "open_app", "open_url", "click_visual"];
const changesUI = (step: any) => UI_CHANGERS.includes(step.action) ||
  (step.action === "key" && (step.key.includes("+") || step.key === "return"));

/** Replay cached steps. Returns how many ran; stops at the first element that can't be found or fails. */
async function replay(driver: MacDriver, cached: cache.CachedStep[], history: string[], record: cache.CachedStep[], steps: StepLog[], log: (s: string) => void) {
  let n = 0, needSettle = true;
  for (const c of cached) {
    const t0 = performance.now();
    const obs = needSettle ? await settle(driver) : await driver.observe();
    const step: any = { ...c.step };
    if (c.target) {
      const ref = cache.resolve(obs, c.target, c.nth);
      if (!ref) { log(`[cache] stop: "${c.target}" not on screen`); break; }
      step.ref = ref;
    }
    const res = await perform(driver, step).catch((e) => ({ error: String(e) }) as Awaited<ReturnType<typeof perform>>);
    const ms = Math.round(performance.now() - t0);
    steps.push({ tier: "cache", ms, step, target: res.target, error: res.error, via: res.via });
    log(`[cache] ${ms}ms ${JSON.stringify(step)}${res.target ? ` [${res.target}]` : ""} -> ${res.error ?? "ok"}`);
    if (res.error) break;
    history.push(`${JSON.stringify(step)} -> ok`);
    record.push(c);
    // Keypad-style press runs don't need to wait for the UI between keys.
    needSettle = changesUI(step) && !(step.action === "press" && cached[n + 1]?.step.action === "press");
    n++;
  }
  return n;
}

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
  if (step.action === "note") return { ok: true };
  return driver.act(step as ActStep);
}

export type StepLog = { tier: string; ms: number; step: object; target?: string; error?: string; via?: string };

export async function runTask(goal: string, opts: { maxSteps?: number; log?: (s: string) => void; noCache?: boolean } = {}) {
  const steps: StepLog[] = [];
  const log = opts.log ?? (() => {});
  const driver = new MacDriver();
  const history: string[] = [];
  let needSettle = false;
  let lastAct = { key: "", screen: "" };  // last action and the screen it ran on
  const record: cache.CachedStep[] = [];   // successful steps, for the cache
  let cacheable = true;
  let replayedAll = false;
  let needSettleInit = false;
  if (!opts.noCache) cache.setStartApp((await driver.observe()).app);
  const cached = opts.noCache ? null : cache.lookup(goal);
  const finish = (ok: boolean, summary: string) => {
    const fixedUp = steps.filter((s) => s.tier !== "cache").length > 1;  // the planner had to act after replay
    if (ok && cached && replayedAll && !fixedUp) cache.hit(goal);
    else if (cached) cache.forget(goal);  // the recording didn't fit this goal; the next run records afresh
    else if (ok && cacheable) cache.store(goal, record);
    return { ok, summary, steps };
  };
  try {
    if (cached) {
      const n = await replay(driver, cached, history, record, steps, log);
      replayedAll = n === cached.length;
      history.push(replayedAll ? "(the steps above were replayed from a previous successful run: check the screen and reply done if the goal is achieved)"
        : "(a previous run's steps were replayed up to here; continue from the current screen)");
      needSettleInit = true;
    }
    needSettle = needSettleInit;
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
          return finish(true, step.summary);
        }
        // Same action on an unchanged screen already did nothing once: don't repeat it.
        const key = JSON.stringify(step);
        // Ping-pong (A, B, A, B, A, ...) between two actions is a loop too.
        const recent = history.slice(-5).map((h) => h.split(" ")[0]);
        const pingPong = recent.length === 5 && new Set(recent).size === 2 && recent[0] === recent[2] && recent[2] === recent[4] && recent[1] === key.split(" ")[0];
        if (pingPong) {
          history.push(`${key} -> skipped: you are alternating between the same two actions; record what you need with note, then do the remaining work`);
          log(`[${i}] ${tier} ${ms}ms ${key} -> skipped (ping-pong)`);
          break;
        }
        if (k === 0 && key === lastAct.key && screen === lastAct.screen) {
          history.push(`${key} -> skipped: it had no visible effect last time; choose a different action or approach`);
          log(`[${i}] ${tier} ${ms}ms ${key} -> skipped (no effect last time)`);
          break;
        }
        if (k === 0) lastAct = { key, screen };
        const res = await perform(driver, step).catch((e) => ({ error: String(e) }) as Awaited<ReturnType<typeof perform>>);
        steps.push({ tier, ms, step, target: res.target, error: res.error, via: res.via });
        if (!res.error) {
          const ref = (step as any).ref;
          const at = ref ? cache.nthOf(obs, ref) : null;
          if (ref && !at) cacheable = false;
          else if (step.action !== "note") record.push({ step: Object.fromEntries(Object.entries(step).filter(([k]) => k !== "ref")), ...(at ?? {}) });
          if (["read_visual", "find_text", "note"].includes(step.action)) cacheable = false;
        }
        const line = `${JSON.stringify(step)}${res.target ? ` [${res.target}]` : ""} -> ${res.error ?? "ok"}${res.note ? `\n  answer: ${res.note}` : ""}`;
        // Nudge the planner out of loops: same action 3 times in a row.
        const repeats = history.slice(-2).filter((h) => h.startsWith(JSON.stringify(step))).length;
        history.push(repeats === 2 ? `${line} (repeated 3 times with no progress - try a different approach)` : line);
        log(`[${i}] ${tier} ${ms}ms ${line}`);
        if (res.error) break;
        // These change the UI, so later actions in the batch would act on a stale screen: re-observe.
        if (step.action === "read_visual" || step.action === "find_text") break; // the planner needs the answer
        const uiChanged = changesUI(step);
        if (uiChanged) needSettle = true;
        // Consecutive presses are fine (a Jev sequence or calculator keys); anything else re-observes.
        if (uiChanged && k < batch.length - 1 &&
            !(step.action === "press" && batch[k + 1]?.action === "press")) break;
        if (batch.length > 1) await new Promise((r) => setTimeout(r, 80));
      }
      if (!needSettle) await new Promise((r) => setTimeout(r, 100));
    }
    return finish(false, "max steps reached");
  } finally { driver.close(); }
}
