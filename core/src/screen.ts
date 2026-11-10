// The screen as callers see it, shared by the built-in agent (agent.ts) and the MCP server (mcp.ts):
// waiting until it settles after an action, and telling a caller what an action changed.
import { render, renderElement, renderHead, type Element, type Observation } from "./driver.ts";

const env = process.env;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const isBrowser = (app = "") => /safari|chrome|edge|firefox|arc|浏览器/i.test(app);

/** An element's line without its ref. */
const line = (e: Element) => renderElement(e).slice(e.ref.length + 1);
/**
 * The screen without refs. Two reads that match here show the same thing, even from an app that hands out new
 * element objects (so new refs) on every read; comparing full renders would never see such a screen settle.
 */
export const shape = (o: Observation) =>
  o.error || !o.elements ? `error: ${o.error ?? ""}` : `${renderHead(o)}\n${o.elements.map(line).join("\n")}`;

/** Waits in ms. Mutable so tests can shorten them. */
export const waits = {
  poll: 50,           // between reads; a quiet read costs 15-60 ms
  quiet: 600,         // an unchanged screen means "the action did nothing" only after this long,
  quietBrowser: 1200, // or this long in a browser, where page loads start late
  quietStep: 300,     // the same inside a batch, before the next step (browsers keep quietBrowser)
  max: 3000,
};

/**
 * Re-read the UI until it stops changing (window opened, page loaded), up to waits.max.
 * read(quiet): one observation. The first read may bring the window forward; the polls after it are quiet
 * (no raising, no glow), and the last one decides which refs can be acted on.
 * before: shape() of the screen the action ran on. While the screen still equals it, the action may just be
 * slow to show (page loads start late), so "nothing changed" is accepted only after the quiet time.
 * enough: stop as soon as this holds (an expected text is up).
 */
export async function settle(read: (quiet: boolean) => Promise<Observation>,
    opts: { before?: string; enough?: (o: Observation) => boolean; step?: boolean } = {}): Promise<Observation> {
  const t0 = performance.now(), { before, enough } = opts;
  let prev = await read(false), was = shape(prev), stable = 0, reads = 1, why = "max";
  let first = before !== undefined && was !== before ? Math.round(performance.now() - t0) : -1;
  const quiet = isBrowser(prev.app) ? waits.quietBrowser : opts.step ? waits.quietStep : waits.quiet;
  while (performance.now() - t0 < waits.max) {
    if (enough?.(prev)) { why = "enough"; break; }
    const moved = before === undefined || was !== before;
    if (moved ? stable >= 1 : stable >= 2 && performance.now() - t0 >= quiet) { why = moved ? "stable" : "unchanged"; break; }
    await sleep(waits.poll);
    const cur = await read(true), now = shape(cur);
    reads++;
    stable = now === was ? stable + 1 : 0;
    if (first < 0 && before !== undefined && now !== before) first = Math.round(performance.now() - t0);
    prev = cur; was = now;
  }
  // For tuning the waits: when the change first showed and why the wait ended.
  if (env.OCU_SETTLE_LOG) process.stderr.write(`settle: ${why} after ${Math.round(performance.now() - t0)} ms, ${reads} reads, first change at ${first < 0 ? "-" : `${first} ms`}\n`);
  return prev;
}

const CHANGERS = ["press", "menu", "open_app", "open_url", "click_visual", "click_at"];
/** Actions after which the screen is expected to change (so refs may be gone and the next step must wait). */
export const changesUI = (a: { action: string; key?: string }) => CHANGERS.includes(a.action) ||
  (a.action === "key" && !!a.key && (a.key.includes("+") || a.key === "return"));
/**
 * Pause before the next step of a batch. Accessibility actions (AXPress, set value, inserted text) are done
 * when they return; keys, clicks and scrolls are events the app handles later, so give it a moment.
 */
export const gapAfter = (a: { action: string }, res: { via?: string }) =>
  ["key", "click_at", "scroll"].includes(a.action) || res.via === "keyboard" || res.via === "click" ? 40 : 0;

/**
 * Run a caller's batch (MCP act{..., then}) in order, stopping at the first error. Before the step after a
 * screen-changing one, wait for the screen to settle: keys must reach a window that just opened, and a ref that
 * went away must fail ("unknown ref") instead of hitting something else. Runs of presses (keypads) go straight on.
 * Returns the results and the shape of the last screen read (for the final settle's `before`).
 */
export async function runSteps<S extends { action: string; key?: string }, R extends { error?: string; via?: string }>(steps: S[],
    run: (s: S) => Promise<R>, wait: (before: string | undefined) => Promise<Observation>, screen?: string) {
  const results: R[] = [];
  for (const [k, s] of steps.entries()) {
    const r = await run(s);
    results.push(r);
    const next = steps[k + 1];
    if (r.error || !next) break;
    if (changesUI(s) && !(s.action === "press" && next.action === "press")) screen = shape(await wait(screen));
    else { const gap = gapAfter(s, r); if (gap) await sleep(gap); }
  }
  return { results, screen };
}

// ---- What changed, for act replies ----

export type Changes = { other: boolean; added: Element[]; gone: Element[]; changed: [before: Element, now: Element][] };
const otherWindow = (a: Observation, b: Observation) => a.app !== b.app ||
  (a.window_id !== undefined && b.window_id !== undefined ? a.window_id !== b.window_id : a.window !== b.window);
/** Refs are stable, so elements are matched by ref: new refs, refs that went away, refs whose line changed. */
export function changes(prev: Observation, cur: Observation): Changes {
  const was = new Map(prev.elements.map((e) => [e.ref, e])), now = new Set(cur.elements.map((e) => e.ref));
  const added: Element[] = [], changed: [Element, Element][] = [];
  for (const e of cur.elements) {
    const p = was.get(e.ref);
    if (!p) added.push(e); else if (renderElement(p) !== renderElement(e)) changed.push([p, e]);
  }
  return { other: otherWindow(prev, cur), added, gone: prev.elements.filter((e) => !now.has(e.ref)), changed };
}
/** Too much changed for a list of changes to be easier to follow than the whole screen. */
export const bigChange = (c: Changes, cur: Observation) => {
  const n = c.added.length + c.gone.length + c.changed.length;
  return c.other || n > 40 || n > 0.4 * cur.elements.length;
};
const count = (c: Changes) => [c.added.length && `${c.added.length} new`, c.changed.length && `${c.changed.length} changed`,
  c.gone.length && `${c.gone.length} gone`].filter(Boolean).join(", ");

/** After this many change-only replies in a row the next one repeats the full screen, so the caller's copy can't drift. */
export const FULL_AFTER = 4;
const NO_EFFECT = "did not change: the action probably had no effect. Don't repeat it; try another element, menu{path}, a shortcut key, or screenshot.";

/**
 * The screen part of an act reply, given what the caller saw last (`prev`) and how many change-only replies it has
 * had in a row. A reply is one of:
 * - "same": nothing changed; the caller's screen and all its refs still hold.
 * - "diff": only the changed lines (+ new, ~ changed, - gone); every other ref is unchanged.
 * - "full": the whole screen (first sight, another window, a big change, or every FULL_AFTER+1 replies).
 * Readers are often small models, so each reply says in words which refs still hold.
 */
export function describe(prev: Observation | undefined, cur: Observation, diffsInRow = 0): { kind: "same" | "diff" | "full"; text: string } {
  const full = (head: string) => ({ kind: "full" as const, text: `${head}${head ? "\n" : ""}${render(cur)}` });
  if (!prev || prev.error || !prev.elements || cur.error || !cur.elements) return full("");
  const c = changes(prev, cur);
  // Before the no-change test: a new window can look exactly like the old one ("Untitled", empty).
  if (c.other) return full(`changed: now in ${cur.app} | ${cur.window}${cur.window === prev.window && cur.app === prev.app ? " (another window)" : ""}. Use only the refs below.`);
  if (shape(prev) === shape(cur)) {
    if (render(prev) === render(cur)) return { kind: "same", text: `${NO_EFFECT}\nThe screen is the same as in your last reply, and all its refs still hold.\n${renderHead(cur)}` };
    return full(`${NO_EFFECT}\nThis app renumbered its elements: use only the refs below.`);
  }
  const what = count(c) || "only the window line";
  if (bigChange(c, cur) || diffsInRow >= FULL_AFTER) return full(`changed: ${what}. Full screen below; refs that are not in it are gone.`);
  // New and changed lines in screen order (so their place among the others shows), then the gone ones.
  const added = new Set(c.added), was = new Map(c.changed.map(([p, n]) => [n, p]));
  const lines = [
    ...cur.elements.flatMap((e) => added.has(e) ? [`+ ${renderElement(e)}`] : was.has(e) ? [`~ ${renderElement(e)}   (was: ${line(was.get(e)!)})`] : []),
    ...c.gone.map((e) => `- ${renderElement(e)}`),
  ];
  return { kind: "diff", text: `changed: ${what}. Only these lines changed (+ new, ~ changed, - gone: don't use it); ` +
    `every other ref from your last screen is unchanged and still valid.\n${renderHead(cur)}${lines.length ? `\n${lines.join("\n")}` : ""}` };
}
