// Talks to the ocu-mac helper over line-delimited JSON.
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

import type { Shot } from "./vision.ts";

/**
 * One listed element. Refs are stable: the same element keeps its ref across observes (in apps that keep their
 * element objects), and a ref is never reused for another element. Only refs from the latest observe can be acted on.
 * value: what a titled field, pop-up button or slider holds, when it differs from the label.
 * state: any of "checked", "mixed", "selected", "disabled" (absent = unchecked / unselected / enabled).
 */
export type Element = { ref: string; role: string; label: string; f?: [number, number, number, number]; value?: string; state?: string[] };
/**
 * window_id: the stable number of the observed window, so two windows with the same title can be told apart.
 * sheet: set while a sheet, dialog or alert is up in (or as) the observed window: its title or first text, or "".
 * Its controls come first in `elements`.
 */
export type Observation = { app: string; window: string; window_id?: number; sheet?: string; elements: Element[]; others?: string[]; error?: string };
export type Action =
  | { action: "press"; ref: string; extend?: boolean }
  | { action: "set_value"; ref: string; text: string }
  | { action: "type"; text: string; ref?: string }
  | { action: "key"; key: string; repeat?: number }
  | { action: "scroll"; ref?: string; direction?: "up" | "down"; amount?: number }
  | { action: "open_app"; name: string }
  | { action: "open_url"; url: string }
  | { action: "menu"; path: string[] }
  | { action: "click_at"; x: number; y: number }
  | { action: "find_text"; query: string };

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
// Release build: ocu-mac sits next to the compiled `ocu` binary. Dev: the Swift build output.
const besideExe = join(dirname(process.execPath), "ocu-mac");
export const BIN = process.env.OCU_MAC_BIN ??
  (existsSync(besideExe) ? besideExe : fileURLToPath(new URL("../../mac/.build/release/ocu-mac", import.meta.url)));

export class MacDriver {
  private proc = spawn(BIN, [], { stdio: ["pipe", "pipe", "pipe"] });
  private pending = new Map<number, { res: (v: any) => void; rej: (e: Error) => void }>();
  private nextId = 1;
  private stderr = "";
  private dead?: string;
  constructor() {
    createInterface({ input: this.proc.stdout! }).on("line", (l) => {
      let msg: any; try { msg = JSON.parse(l); } catch { return; }
      this.pending.get(msg.id)?.res(msg);
      this.pending.delete(msg.id);
    });
    this.proc.stderr!.on("data", (b) => { this.stderr += b; process.stderr.write(b); });
    const fail = (why: string) => {
      this.dead = `ocu-mac (${BIN}) ${why}${this.stderr ? `: ${this.stderr.trim()}` : ""}`;
      for (const p of this.pending.values()) p.rej(new Error(this.dead));
      this.pending.clear();
    };
    this.proc.on("error", (e) => fail(`could not start: ${e.message}`));
    this.proc.on("exit", (code, sig) => fail(`exited (${sig ?? code})`));
  }
  call(req: object, timeoutMs = Number(process.env.OCU_CALL_TIMEOUT_MS ?? 20000)): Promise<any> {
    if (this.dead) return Promise.reject(new Error(this.dead));
    const id = this.nextId++;
    return new Promise((res, rej) => {
      const t = setTimeout(() => { this.pending.delete(id); rej(new Error(`ocu-mac did not answer ${JSON.stringify(req).slice(0, 60)} within ${timeoutMs / 1000}s`)); }, timeoutMs);
      this.pending.set(id, { res: (v) => { clearTimeout(t); res(v); }, rej: (e) => { clearTimeout(t); rej(e); } });
      this.proc.stdin!.write(JSON.stringify({ id, ...req }) + "\n");
    });
  }
  trusted(): Promise<boolean> { return this.call({ cmd: "trust" }, 5000).then((r) => !!r.trusted); }
  /** quiet: a repeat read while waiting for the screen to settle (no raising, no glow). */
  observe(app?: string, opts: { quiet?: boolean } = {}): Promise<Observation> {
    return this.call({ cmd: "observe", ...(app ? { app } : {}), ...(opts.quiet ? { quiet: true } : {}) });
  }
  /** max: longest side of the image in pixels (the helper only shrinks). */
  screenshot(max?: number): Promise<Shot> { return this.call({ cmd: "screenshot", ...(max ? { max } : {}) }); }
  act(a: Action): Promise<{ ok?: boolean; error?: string; target?: string; via?: string; note?: string }> {
    return this.call({ cmd: "act", ...a }).then(({ id: _, ...r }) => r);  // the request id means nothing to callers
  }
  close() { this.dead ??= "closed"; this.proc.removeAllListeners("exit"); this.proc.kill(); }
}

/** One element as a line: `e12 CheckBox "粗体" [checked]`, `e7 PopUpButton "字体" = "Helvetica"`. */
export const renderElement = (e: Element) =>
  `${e.ref} ${e.role} "${e.label}"${e.value !== undefined ? ` = "${e.value}"` : ""}${e.state?.length ? ` [${e.state.join(", ")}]` : ""}`;

/** The lines above the element list: app and window, the app's other windows, a note when the list is sparse. */
export const renderHead = (o: Observation) => {
  const labeled = o.elements.filter((e) => e.label).length;
  const sparse = labeled < 5 ? "\n(accessibility info is sparse here: use click_visual / read_visual)" : "";
  const n = o.others?.length ?? 0;
  const others = n ? `\nother windows of this app (${n}): ${o.others!.slice(0, 8).map((t) => `"${t}"`).join(", ")}${n > 8 ? ", ..." : ""}` : "";
  const sheet = o.sheet !== undefined ? `\ndialog open${o.sheet ? `: "${o.sheet}"` : ""} (its controls are listed first)` : "";
  return `app: ${o.app} | window: ${o.window}${sheet}${others}${sparse}`;
};
// Compact text form of the UI: one line per interactive element, cheap for text-only models.
export const render = (o: Observation) => {
  if (o.error || !o.elements) return `error: ${o.error ?? JSON.stringify(o)}`;
  return `${renderHead(o)}\n` + o.elements.map(renderElement).join("\n");
};
