// Action cache: "goal pattern -> actions that worked". A repeat task replays without calling any model.
// Quoted strings and numbers in the goal become parameters, so "note 'abc'" also serves "note 'xyz'".
// Element refs change between runs, so steps store the element's "Role label" and are resolved again on replay.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import type { Observation } from "./driver.ts";

const env = process.env;
const FILE = env.OCU_CACHE_FILE ?? join(homedir(), ".cache", "ocu", "actions.json");
export const cacheEnabled = () => env.OCU_CACHE !== "0";

export type CachedStep = { step: Record<string, any>; target?: string; nth?: number; spell?: number; prefix?: string };
type Entry = { steps: CachedStep[]; hits: number; saved: string };

const PARAM = /"[^"]+"|'[^']+'|“[^”]+”|「[^」]+」|-?\d+(?:\.\d+)?/g;

/** Goal -> (pattern, params). Pattern is the cache key. */
// Recorded steps depend on where the run started (cmd+n means something else in another app), so the key includes it.
let startApp = "";
export const setStartApp = (app: string) => { startApp = app; };
export function pattern(goal: string): { key: string; params: string[] } {
  const params: string[] = [];
  const key = (startApp ? `[${startApp}] ` : "") + goal.trim().replace(PARAM, (m) => {
    const v = /^["'“「]/.test(m) ? m.slice(1, -1) : m;
    params.push(v);
    return `{${params.length - 1}}`;
  });
  return { key, params };
}

// Put {i} placeholders into recorded text, and fill them back on replay. Longest params first.
const templ = (s: string, params: string[]) =>
  params.map((p, i) => [p, i] as const).sort((a, b) => b[0].length - a[0].length)
    .reduce((acc, [p, i]) => (p.length > 0 ? acc.split(p).join(`{${i}}`) : acc), s);
const fill = (s: string, params: string[]) => s.replace(/\{(\d+)\}/g, (m, i) => params[+i] ?? m);
const mapStrings = (o: Record<string, any>, f: (s: string) => string) =>
  Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === "string" && k !== "action" && k !== "ref" ? f(v) : Array.isArray(v) ? v.map((x) => (typeof x === "string" ? f(x) : x)) : v]));

function load(): Record<string, Entry> {
  try { return JSON.parse(readFileSync(FILE, "utf8")); } catch { return {}; }
}
function save(db: Record<string, Entry>) {
  mkdirSync(dirname(FILE), { recursive: true });
  writeFileSync(FILE, JSON.stringify(db, null, 1));
}

/** Steps for this goal with parameters filled in, or null. */
export function lookup(goal: string): CachedStep[] | null {
  if (!cacheEnabled() || !existsSync(FILE)) return null;
  const { key, params } = pattern(goal);
  const e = load()[key];
  if (!e) return null;
  return e.steps.flatMap((s): CachedStep[] =>
    s.spell !== undefined
      ? [...(params[s.spell] ?? "")].map((ch) => ({ step: { action: "press" }, target: `${s.prefix}${ch}`, nth: 0 }))
      : [{ ...s, step: mapStrings(s.step, (x) => fill(x, params)), target: s.target && fill(s.target, params) }]);
}

// Reading steps produce answers that change from run to run; replaying them blindly would be wrong.
const UNCACHEABLE = new Set(["read_visual", "find_text", "note"]);

/** Remember a successful run. Steps that errored or were skipped are not passed in. */
export function store(goal: string, steps: CachedStep[]) {
  if (!cacheEnabled() || !steps.length || steps.some((s) => UNCACHEABLE.has(s.step.action))) return;
  const { key, params } = pattern(goal);
  const db = load();
  db[key] = {
    steps: spell(steps, params).map((s) => ({ ...s, step: mapStrings(s.step, (x) => templ(x, params)), target: s.target && templ(s.target, params) })),
    hits: db[key]?.hits ?? 0, saved: new Date().toISOString(),
  };
  save(db);
}

/** Keypad input: presses "Button 3", "Button 7" that spell a goal parameter "37" become one {spell} step. */
function spell(steps: CachedStep[], params: string[]): CachedStep[] {
  const out: CachedStep[] = [];
  for (let i = 0; i < steps.length; ) {
    let matched = false;
    for (const [pi, p] of params.entries()) {
      if (p.length < 2) continue;  // single characters are handled by plain templating
      const run = steps.slice(i, i + p.length);
      const prefix = run[0]?.target?.slice(0, -1);
      if (run.length === p.length && prefix !== undefined &&
          run.every((s, k) => s.step.action === "press" && s.target === prefix + p[k])) {
        out.push({ step: { action: "press" }, spell: pi, prefix });
        i += p.length; matched = true; break;
      }
    }
    if (!matched) out.push(steps[i++]);
  }
  return out;
}

export function hit(goal: string) {
  const db = load(); const e = db[pattern(goal).key];
  if (e) { e.hits++; save(db); }
}
export function forget(goal: string) {
  const db = load(); delete db[pattern(goal).key]; save(db);
}

/** Which occurrence of "Role label" a ref is, so duplicates (two "OK" buttons) resolve the same way. */
export function nthOf(obs: Observation, ref: string): { target: string; nth: number } | null {
  const el = obs.elements.find((e) => e.ref === ref);
  if (!el) return null;
  const target = `${el.role} ${el.label}`;
  const same = obs.elements.filter((e) => `${e.role} ${e.label}` === target);
  return { target, nth: same.indexOf(el) };
}
/** Find the current ref for a recorded element. */
export function resolve(obs: Observation, target: string, nth = 0): string | null {
  const same = obs.elements.filter((e) => `${e.role} ${e.label}` === target);
  return (same[nth] ?? same[0])?.ref ?? null;
}
