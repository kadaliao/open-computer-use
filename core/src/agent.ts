import { MacDriver, type Element, type Observation } from "./driver.ts";
import { decide as planDecide, type ActStep, type Expect, type Step } from "./policy.ts";
import { ask, locate, VISION_MAX } from "./vision.ts";
import { bigChange, changes, changesUI, gapAfter, isBrowser, settle, shape, waits } from "./screen.ts";
import * as cache from "./cache.ts";

/** What the loop needs from the helper. Callers that already run one (the MCP server) pass it in; tests pass a fake. */
export type Driver = Pick<MacDriver, "observe" | "act" | "screenshot">;
export type Decide = typeof planDecide;

/** Waits in ms beyond settling (screen.ts waits). Mutable so tests can shorten them. */
export const timing = {
  turnGap: 50,  // before reading the screen after steps that change it only a little (typing)
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// The agent works in the frontmost app. Settling polls are quiet (no raising, no glow).
const reader = (driver: Driver) => (quiet: boolean) => driver.observe(undefined, { quiet });

// ---- The local check for done{expect} ----
// It saves a planner round trip when the proof is solid. Whenever it is in doubt, the planner looks: a wrong
// "done" costs far more than one more call.

// Text on these roles proves nothing: controls name places you could go next, one-line fields echo what was typed.
const NO_PROOF = new Set(["Button", "MenuItem", "MenuBarItem", "MenuButton", "Link", "Tab", "CheckBox", "RadioButton",
  "PopUpButton", "Row", "Cell", "List", "Slider", "TextField", "SearchField", "ComboBox"]);
// Case, width, line breaks and digit grouping ("6,912", "6 912" vs "6912") don't matter (NFKC turns no-break spaces into
// spaces), nor invisible format marks (Calculator writes "\u200e21" and "\u200e7\u200e+\u200e7").
const norm = (s: string) => s.normalize("NFKC").replace(/\p{Cf}/gu, "").toLowerCase().replace(/(\d)[,' ](?=\d{3}(?!\d))/g, "$1").replace(/\s+/g, " ").trim();
const textOf = (e: Element) => [e.label, e.value].filter(Boolean).join(" ");
const content = (o: Observation) => (o.elements ?? []).filter((e) => !NO_PROOF.has(e.role)).map((e) => norm(textOf(e)));
// A text area's own text: its value when it has a title, else its label (the helper cuts labels at 80 characters).
const areaText = (e: Element) => e.value ?? e.label;
const areas = (o: Observation) => (o.elements ?? []).filter((e) => e.role === "TextArea");

const alnum = /[a-z0-9]/;
/**
 * `want` in `text` as a whole token: a digit or latin letter may not continue it on either side, so "444" is not in
 * "4440", "-444" or "444.5", and "port" not in "report". Chinese and Japanese have no word breaks and match anywhere.
 * Both sides are norm()ed.
 */
export function has(text: string, want: string): boolean {
  if (!want) return false;
  const num0 = /^\d/.test(want), num1 = /\d$/.test(want);
  for (let i = text.indexOf(want); i >= 0; i = text.indexOf(want, i + 1)) {
    const b = text[i - 1] ?? "", bb = text[i - 2] ?? "", a = text[i + want.length] ?? "", aa = text[i + want.length + 1] ?? "";
    if (alnum.test(want[0]) && alnum.test(b)) continue;
    if (alnum.test(want.at(-1)!) && alnum.test(a)) continue;
    if (num0 && ((b === "." && /\d/.test(bb)) || (/[-−]/.test(b) && !alnum.test(bb)))) continue;  // 1.444, -444
    if (num1 && a === "." && /\d/.test(aa)) continue;                                             // 444.5
    return true;
  }
  return false;
}

/** A sheet, dialog or alert is up now that wasn't when the batch started ("Replace it?", "Couldn't save"). */
const dialogCame = (start: Observation | undefined, now: Observation) => now.sheet !== undefined && now.sheet !== start?.sheet;
/** What the batch typed or set (type / set_value texts), and whether that was its last action. */
export type Typed = { texts: string[]; last: boolean };
/**
 * Did the batch bring `expect` on screen? It must now be in the window title or in a content element, and must not
 * have been in that place on any `seen` screen (the one the batch was planned on, and those read during it).
 * Text the batch typed itself shows up wherever it went: in an error ("“report.rtf” already exists", "No results for
 * …", "can't find the server “…”") or in the wrong document. So an expect that overlaps typed text counts only when the
 * typing was the batch's last action and a text area now holds exactly that text, which it didn't before.
 * A window or dialog that appeared during the batch (an alert, a sheet, another document) always sends the turn to
 * the planner.
 * Shorter than 2 characters is too easy to hit by chance.
 */
export function confirmed(expect: Expect | undefined, seen: Observation[], now: Observation, typed: Typed = { texts: [], last: false }): boolean {
  if (!expect || now.error || !now.elements) return false;
  const last = seen.at(-1);
  if (last && (last.app !== now.app || (last.window_id !== undefined && now.window_id !== undefined && last.window_id !== now.window_id))) return false;
  if (dialogCame(seen[0], now)) return false;
  const wants = (Array.isArray(expect) ? expect : [expect]).map((w) => norm(String(w))).filter((w) => w.length >= 2);
  const title = norm(now.window ?? ""), body = content(now);
  const titles = seen.map((o) => norm(o.window ?? "")), bodies = seen.flatMap(content);
  const ts = typed.texts.map(norm).filter((t) => t.length >= 2);
  const whole = [norm(typed.texts.at(-1) ?? ""), norm(typed.texts.join(" "))];
  return wants.some((w) => {
    if (ts.some((t) => t.includes(w) || w.includes(t))) {
      if (!typed.last) return false;
      if (seen.some((o) => areas(o).some((e) => has(norm(areaText(e)), w)))) return false;
      return areas(now).some((e) => {
        const t = norm(areaText(e));
        return has(t, w) && whole.some((x) => x === t || (e.label.length >= 80 && x.startsWith(t)));
      });
    }
    return (has(title, w) && !titles.some((t) => has(t, w))) || (body.some((t) => has(t, w)) && !bodies.some((t) => has(t, w)));
  });
}

// A goal that asks for an answer ("告诉我…", "电池还剩百分之几", "what is…", "check whether…"): expect must be the
// answer, so it has to be in the summary and must not be just words of the goal. A page or option the goal names says
// nothing about which answer is right.
const ASKS = new RegExp(["告诉", "是什么", "是多少", "多少", "几", "哪", "是否", "有没有", "吗", "呢", "查看", "看看", "看一下",
  "查一下", "检查", "确认", "读出", "读一下", "列出", "[？?]",
  "\\b(tell|what|which|who|whom|whose|when|where|whether|why|how|check|find out|show me|look up|is there|are there|read)\\b"].join("|"), "i");
export function proofOf(goal: string, done: { summary?: string; expect?: Expect }): string[] {
  const all = (Array.isArray(done.expect) ? done.expect : done.expect ? [done.expect] : []).map(String);
  if (!ASKS.test(goal)) return all;
  const g = norm(goal), s = norm(done.summary ?? "");
  return all.filter((w) => !has(g, norm(w)) && has(s, norm(w)));
}

// Numbers and quoted strings a summary states. Numbers stand alone (the 7 in "ocu7k2" is not one).
const CLAIMS = /“([^”]+)”|"([^"]+)"|「([^」]+)」|‘([^’]+)’|(?<![A-Za-z0-9.,])\d+(?:[.,]\d+)*(?![A-Za-z0-9])/g;
/**
 * The first name the goal quotes (“应用程序”, “实用工具”) that the summary and expect leave out. A goal in stages names
 * its stages; a summary that skips one says the batch stopped early ("open 应用程序, then go into 实用工具" is not done
 * once 应用程序 is open).
 */
export function skippedPart(goal: string, summary: string, expect: Expect | undefined): string | undefined {
  const said = norm([summary, ...(Array.isArray(expect) ? expect : expect ? [expect] : [])].join(" "));
  for (const m of goal.matchAll(/“([^”]+)”|"([^"]+)"|「([^」]+)」/g)) {
    const q = norm(m.slice(1).find(Boolean) ?? "");
    if (q && !has(said, q)) return q;
  }
}

/**
 * The first number or quoted string in `summary` that is in neither the goal, the final screen (any element, title
 * included) nor the history (what earlier reads and notes said). Such a summary claims something nobody has seen,
 * e.g. a guessed "电池还剩 85%" while the screen says 72%: then the planner must look.
 */
export function unseenClaim(summary: string, goal: string, now: Observation, history: string[]): string | undefined {
  const known = [goal, now.window ?? "", ...(now.elements ?? []).map(textOf), ...history].map(norm);
  for (const m of summary.matchAll(CLAIMS)) {
    const c = norm(m.slice(1).find(Boolean) ?? m[0]);
    if (c && !known.some((k) => has(k, c))) return c;
  }
}

// After the screen changed, a batch goes on with steps that don't point at an element of the old screen, and with
// those whose element is still there unchanged (kept() below); anything else waits for the planner to look.
const REFLESS = new Set(["key", "type", "menu", "open_app", "open_url", "find_text", "read_visual", "note", "done"]);
const needsLook = (step: any) => typeof step.ref === "string" || !REFLESS.has(step.action);
/**
 * Refs are stable, so a step planned on `plan` can still run on `now` when its element is there with the same
 * role and label, in the same window, no dialog came or went, and the screen changed little (select all, then press
 * Bold). Behind a new sheet the element may still be listed but must wait: then the planner looks first.
 */
function kept(step: any, plan: Observation, now: Observation): boolean {
  if (typeof step.ref !== "string" || now.error || !now.elements) return false;
  const a = plan.elements.find((e) => e.ref === step.ref), b = now.elements.find((e) => e.ref === step.ref);
  return !!a && !!b && a.role === b.role && a.label === b.label && now.sheet === plan.sheet && !bigChange(changes(plan, now), now);
}

/**
 * Per-step timing. ms is the step's share of the run, so sums over steps add up: the first step of a turn carries
 * the turn's observe (incl. settling) and model time, every step its own wait (settling mid-batch, gaps) and action.
 */
export type StepLog = { tier: string; ms: number; step: object; target?: string; error?: string; via?: string;
  obs_ms?: number; model_ms?: number; wait_ms?: number; act_ms?: number };
const timed = (t: { obs_ms?: number; model_ms?: number; wait_ms?: number; act_ms?: number }) => {
  const parts = Object.fromEntries(Object.entries(t).filter(([, v]) => v)) as typeof t;
  return { ms: Object.values(parts).reduce((a, b) => a + b, 0), ...parts };
};
/** Where a run's time went, in ms. */
export const totals = (steps: StepLog[]) => steps.reduce((a, s) => ({ obs: a.obs + (s.obs_ms ?? 0), model: a.model + (s.model_ms ?? 0),
  wait: a.wait + (s.wait_ms ?? 0), act: a.act + (s.act_ms ?? 0) }), { obs: 0, model: 0, wait: 0, act: 0 });
const fmtTime = (s: StepLog) => [s.obs_ms && `obs ${s.obs_ms}`, s.model_ms && `model ${s.model_ms}`, s.wait_ms && `wait ${s.wait_ms}`,
  s.act_ms && `act ${s.act_ms}`].filter(Boolean).join(" + ") || "0";
const clock = () => { let t = performance.now(); return () => { const n = performance.now(), d = Math.round(n - t); t = n; return d; }; };

/**
 * An action as the loop guards compare it: the ref replaced by the element's role, label and place among same-named
 * ones, so a repeat is recognised even in an app that hands out new refs on every read.
 */
const actKey = (step: any, on: Observation) => {
  const at = typeof step.ref === "string" ? cache.nthOf(on, step.ref) : null;
  return JSON.stringify(at ? { ...step, ref: `${at.target}#${at.nth}` } : step);
};
/** History for the planner, plus a key per line for the loop guards (actKey for actions). */
type Say = (line: string, key?: string) => void;
/** Track a batch's typing for confirmed(). */
const noteTyping = (t: Typed, step: any) => {
  if (step.action === "type" || step.action === "set_value") { t.texts.push(String(step.text ?? "")); t.last = true; }
  else if (step.action !== "note") t.last = false;
};

/** Replay cached steps. Returns how many ran (stops at the first element that can't be found or fails) and the screens read. */
async function replay(driver: Driver, cached: cache.CachedStep[], say: Say, record: cache.CachedStep[], steps: StepLog[], log: (s: string) => void) {
  let n = 0, needSettle = true, before: string | undefined;
  const seen: Observation[] = [], typed: Typed = { texts: [], last: false };
  for (const c of cached) {
    const lap = clock();
    // Keypad-style press runs resolve on the same read: their refs stay put while the display changes. A label
    // that only shows up after earlier keys (AC turning into C) gets one fresh read.
    const reused = !needSettle && seen.length > 0;
    let obs = needSettle ? await settle(reader(driver), { before, step: n > 0 }) : seen.at(-1) ?? await driver.observe(undefined, { quiet: true });
    let ref = c.target ? cache.resolve(obs, c.target, c.nth) : null;
    if (c.target && !ref && reused) { obs = await driver.observe(undefined, { quiet: true }); ref = cache.resolve(obs, c.target, c.nth); }
    seen.push(obs);
    const wait = lap();
    const step: any = { ...c.step };
    if (c.target) {
      if (!ref) { log(`[cache] stop: "${c.target}" not on screen`); break; }
      step.ref = ref;
    }
    before = shape(obs);
    const res = await perform(driver, step).catch((e) => ({ error: String(e) }) as Awaited<ReturnType<typeof perform>>);
    const s: StepLog = { tier: "cache", ...timed({ wait_ms: wait, act_ms: lap() }), step, target: res.target, error: res.error, via: res.via };
    steps.push(s);
    log(`[cache] ${fmtTime(s)}ms ${JSON.stringify(step)}${res.target ? ` [${res.target}]` : ""} -> ${res.error ?? "ok"}`);
    if (res.error) break;
    say(`${JSON.stringify(step)} -> ok`, actKey(step, obs));
    noteTyping(typed, step);
    record.push(c);
    // Keypad-style press runs don't need to wait for the UI between keys.
    needSettle = changesUI(step) && !(step.action === "press" && cached[n + 1]?.step.action === "press");
    n++;
  }
  return { n, seen, before, typed };
}

/** Screenshot fallback actions run here; everything else goes straight to the driver. */
async function perform(driver: Driver, step: Step): Promise<{ ok?: boolean; error?: string; target?: string; via?: string; note?: string }> {
  if (step.action === "click_visual") {
    const shot = await driver.screenshot(VISION_MAX);
    if (shot.error) return { error: shot.error };
    const p = await locate(shot, step.target).catch((e) => { throw new Error(String(e)); });
    if (!p) return { error: `vision model could not find "${step.target}"` };
    const res = await driver.act({ action: "click_at", x: p.x, y: p.y });
    return { ...res, target: `Visual "${step.target}" @${Math.round(p.x)},${Math.round(p.y)}`, via: "vision" };
  }
  if (step.action === "read_visual") {
    const shot = await driver.screenshot(VISION_MAX);
    if (shot.error) return { error: shot.error };
    return { ok: true, via: "vision", note: await ask(shot, step.question) };
  }
  if (step.action === "note") return { ok: true };
  return driver.act(step as ActStep);
}

export async function runTask(goal: string, opts: { maxSteps?: number; log?: (s: string) => void; noCache?: boolean;
    driver?: Driver; decide?: Decide } = {}) {
  const steps: StepLog[] = [];
  const log = opts.log ?? (() => {});
  const own = opts.driver ? undefined : new MacDriver();
  const driver: Driver = opts.driver ?? own!;
  const decide = opts.decide ?? planDecide;
  const history: string[] = [], keys: string[] = [];
  const say: Say = (line, key = line.split(" ")[0]) => { history.push(line); keys.push(key); };
  let turns = 0;                           // planner round trips
  let lastAct = { key: "", screen: "" };  // last action and the screen it ran on
  const record: cache.CachedStep[] = [];   // successful steps, for the cache
  let cacheable = true;
  let replayedAll = false;
  let cached: ReturnType<typeof cache.lookup> = null;
  const finish = (ok: boolean, summary: string, expect?: Expect) => {
    const fixedUp = steps.filter((s) => s.tier !== "cache").length > 1;  // the planner had to act after replay
    if (ok && cached && replayedAll && !fixedUp) cache.hit(goal);
    else if (cached) cache.forget(goal);  // the recording didn't fit this goal; the next run records afresh
    else if (ok && cacheable) cache.store(goal, record, expect ? { expect } : undefined);
    return { ok, summary, steps, turns };
  };
  try {
    const lap = clock();
    const read = reader(driver);
    const start = await driver.observe();
    let firstObs = lap();
    let obs: Observation | undefined = start;  // the screen to plan on next, when already read
    let needSettle = false;
    let before: string | undefined;  // the screen the last screen-changing action ran on
    if (!opts.noCache) cache.setStartApp(start.app);
    cached = opts.noCache ? null : cache.lookup(goal);
    if (cached) {
      const r = await replay(driver, cached.steps, say, record, steps, log);
      replayedAll = r.n === cached.steps.length;
      obs = undefined; needSettle = true; before = r.before;
      // The recorded run ended with done{expect} made of goal parameters only (cache.ts): if the replay brought that
      // text up, the task is done without a model call. The summary says only that, nothing from the old run.
      const done = cached.done, proof = done ? proofOf(goal, done) : [];
      if (replayedAll && done && proof.length) {
        lap();
        const seen = [start, ...r.seen];
        obs = await settle(read, { before, enough: (o) => confirmed(proof, seen, o, r.typed) });
        needSettle = false;
        const ok = confirmed(proof, seen, obs, r.typed);
        const summary = `replayed the steps of an earlier run; ${proof.map((p) => `"${p}"`).join(", ")} now on screen`;
        steps.push({ tier: "cache", ...timed({ wait_ms: lap() }), step: { action: "done", summary, expect: done.expect }, ...(ok ? {} : { error: "not confirmed" }) });
        if (ok) { log(`done (cache): ${summary}`); return finish(true, summary); }
      }
      say(replayedAll ? "(the steps above were replayed from a previous successful run: check the screen and reply done if the goal is achieved)"
        : "(a previous run's steps were replayed up to here; continue from the current screen)");
    }
    for (let i = 0; i < (opts.maxSteps ?? 25); i++) {
      const lap = clock();
      if (!obs) {
        if (!needSettle && i > 0) await sleep(timing.turnGap);
        obs = needSettle ? await settle(read, { before }) : await driver.observe();
      }
      const plan = obs;
      obs = undefined; needSettle = false; before = undefined;
      const screen = shape(plan);
      let pending: { obs_ms?: number; model_ms?: number } = { obs_ms: lap() + firstObs };
      firstObs = 0;
      const { steps: batch, tier } = await decide(goal, history, plan);
      turns++;
      pending.model_ms = lap();
      // The first step logged this turn carries the turn's observe and model time.
      const push = (s: Omit<StepLog, "ms" | "tier">, t: { wait_ms?: number; act_ms?: number }) => {
        const entry: StepLog = { tier, ...timed({ ...pending, ...t }), ...s };
        pending = {};
        steps.push(entry);
        return entry;
      };
      const seen = [plan];   // screens read during this batch, for the done{expect} check
      const typed: Typed = { texts: [], last: false };
      let cur = plan;        // the latest of them
      let refsOk = true;     // refs from `plan` still point where the planner thinks (no change yet, or a keypad run)
      let unsettled = false; // a screen-changing step ran and the screen hasn't visibly changed in a read since
      let stale = false;     // some step ran since `cur` was read
      // Wait for the new screen inside the batch. If it still looks as before, `unsettled` stays: the turn's own
      // settle then keeps watching the full quiet time, so a late change isn't missed.
      const look = async () => {
        cur = await settle(read, { before: unsettled ? before : undefined, step: true });
        seen.push(cur); stale = false;
        if (shape(cur) !== before) unsettled = false;
      };
      for (const [k, step] of batch.entries()) {
        // After a screen change: steps without a ref run on the settled new screen, steps with one only if their
        // element was kept; otherwise the planner looks at the screen (just read, when it settled).
        if (k > 0 && step.action !== "done" && (needsLook(step) ? !refsOk : unsettled)) {
          if (stale) await look();
          if (needsLook(step) && !kept(step, plan, cur)) { if (!unsettled) obs = cur; break; }
        }
        const wait = lap();  // the gap after the previous step, and settling
        if (step.action === "done") {
          // Right after looking at the screen, the planner's word is enough.
          const proof = proofOf(goal, step);
          if (k === 0) {
            const s = push({ step }, {});
            log(`done (${tier}, ${fmtTime(s)}ms): ${step.summary}`);
            return finish(true, step.summary, proof.length ? proof : undefined);
          }
          // At the end of a blind batch it counts only with an expected text that the batch brought on screen.
          if (!step.expect) break;
          const done = `{"action":"done","expect":${JSON.stringify(step.expect)}}`;
          if (!proof.length) {
            push({ step, error: "not accepted" }, { wait_ms: wait });
            say(`${done} -> not accepted: the goal asks for an answer you have not read yet. Read it on the screen, then reply done`);
            log(`[${i}] done not accepted: expect ${JSON.stringify(step.expect)} is not an answer`);
            break;
          }
          // Watch the full quiet time unless the text shows up: a pane may switch its title after its row lights up.
          const min = isBrowser(plan.app) ? waits.quietBrowser : waits.quiet;
          const now = await settle(read, { before: unsettled ? before : undefined, enough: (o) => confirmed(proof, seen, o, typed), min });
          const ok = confirmed(proof, seen, now, typed);
          // Even with the expected text up, the summary must cover every part the goal names, and must not state
          // numbers or names nobody has seen.
          const skipped = ok ? skippedPart(goal, step.summary, step.expect) : undefined;
          const claim = ok && !skipped ? unseenClaim(step.summary, goal, now, history) : undefined;
          const s = push({ step, ...(ok && !claim && !skipped ? {} : { error: claim || skipped ? "not accepted" : "not confirmed" }) }, { wait_ms: wait + lap() });
          if (ok && !claim && !skipped) { log(`[${i}] done (${tier}, ${fmtTime(s)}ms, ${JSON.stringify(step.expect)} on screen): ${step.summary}`); return finish(true, step.summary, proof); }
          if (skipped) say(`${done} -> not accepted: the goal also asks for "${skipped}", which your summary doesn't cover. Check the screen and do what is left`);
          else if (claim) say(`${done} -> not accepted: your summary says "${claim}", which is not on the screen. Check the screen, then reply done with what it shows`);
          else if (dialogCame(plan, now)) say(`${done} -> not confirmed: a dialog came up${now.sheet ? ` ("${now.sheet}")` : ""}. Deal with it first, then reply done when the goal is achieved`);
          else say(`${done} -> not confirmed: that text did not newly appear on screen (or it only echoes what you typed, or a new window came up). ` +
            `Check the screen: continue, or reply done (no expect needed) if the goal is achieved`);
          log(`[${i}] done not ${skipped ? `accepted: skips "${skipped}"` : claim ? `accepted: unseen "${claim}"` : `confirmed: ${JSON.stringify(step.expect)} not new on screen`}`);
          obs = now;  // just read and settled: plan on it
          unsettled = false;
          break;
        }
        // Same action on an unchanged screen already did nothing once: don't repeat it.
        const key = JSON.stringify(step), same = actKey(step, plan);
        // Ping-pong (A, B, A, B, A, ...) between two actions is a loop too.
        const recent = keys.slice(-5);
        const pingPong = recent.length === 5 && new Set(recent).size === 2 && recent[0] === recent[2] && recent[2] === recent[4] && recent[1] === same;
        if (pingPong) {
          say(`${key} -> skipped: you are alternating between the same two actions; record what you need with note, then do the remaining work`, same);
          const s = push({ step, error: "skipped (ping-pong)" }, { wait_ms: wait });
          log(`[${i}] ${tier} ${fmtTime(s)}ms ${key} -> skipped (ping-pong)`);
          break;
        }
        if (k === 0 && same === lastAct.key && screen === lastAct.screen) {
          say(`${key} -> skipped: it had no visible effect last time; choose a different action or approach`, same);
          const s = push({ step, error: "skipped (no effect last time)" }, { wait_ms: wait });
          log(`[${i}] ${tier} ${fmtTime(s)}ms ${key} -> skipped (no effect last time)`);
          break;
        }
        if (k === 0) lastAct = { key: same, screen };
        // The screen this step runs on, for the wait after it: re-read it when typing changed it since the last read,
        // or that change would pass for this step's effect.
        if (changesUI(step) && stale && !unsettled) { cur = await read(true); stale = false; }
        const ranOn = shape(cur);
        const res = await perform(driver, step).catch((e) => ({ error: String(e) }) as Awaited<ReturnType<typeof perform>>);
        const s = push({ step, target: res.target, error: res.error, via: res.via }, { wait_ms: wait, act_ms: lap() });
        if (!res.error) {
          // A ref step runs on `plan`, or on a later screen where its element was kept (same ref, role, label).
          const ref = (step as any).ref;
          const at = ref ? cache.nthOf(plan, ref) : null;
          if (ref && !at) cacheable = false;
          else if (step.action !== "note") record.push({ step: Object.fromEntries(Object.entries(step).filter(([k]) => k !== "ref")), ...(at ?? {}) });
          if (["read_visual", "find_text", "note"].includes(step.action)) cacheable = false;
        }
        const line = `${key}${res.target ? ` [${res.target}]` : ""} -> ${res.error ?? "ok"}${res.note ? `\n  answer: ${res.note}` : ""}`;
        // Nudge the planner out of loops: same action 3 times in a row.
        const repeats = keys.slice(-2).filter((k) => k === same).length;
        say(repeats === 2 ? `${line} (repeated 3 times with no progress - try a different approach)` : line, same);
        log(`[${i}] ${tier} ${fmtTime(s)}ms ${line}`);
        if (res.error) break;
        noteTyping(typed, step);
        if (step.action === "read_visual" || step.action === "find_text") break; // the planner needs the answer
        stale = true;
        if (changesUI(step)) {
          unsettled = true; before = ranOn;
          // Consecutive presses (calculator keys, a Jev sequence) keep using the refs they were planned with.
          refsOk = refsOk && step.action === "press" && batch[k + 1]?.action === "press";
        }
        // Keys and clicks are events the app handles a little later; accessibility actions are done already.
        const gap = gapAfter(step, res);
        if (gap && batch[k + 1] && batch[k + 1].action !== "done") await sleep(gap);
      }
      if (unsettled) needSettle = true;
    }
    return finish(false, "max steps reached");
  } finally { own?.close(); }
}
