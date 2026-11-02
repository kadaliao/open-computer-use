// Talks to the ocu-mac helper over line-delimited JSON.
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

import type { Shot } from "./vision.ts";

export type Element = { ref: string; role: string; label: string; f?: [number, number, number, number] };
export type Observation = { app: string; window: string; elements: Element[]; error?: string };
export type Action =
  | { action: "press"; ref: string }
  | { action: "set_value"; ref: string; text: string }
  | { action: "type"; text: string }
  | { action: "key"; key: string }
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
  observe(app?: string): Promise<Observation> { return this.call({ cmd: "observe", ...(app ? { app } : {}) }); }
  screenshot(): Promise<Shot> { return this.call({ cmd: "screenshot" }); }
  act(a: Action): Promise<{ ok?: boolean; error?: string; target?: string; via?: string; note?: string }> { return this.call({ cmd: "act", ...a }); }
  close() { this.dead ??= "closed"; this.proc.removeAllListeners("exit"); this.proc.kill(); }
}

// Compact text form of the UI: one line per interactive element, cheap for text-only models.
export const render = (o: Observation) => {
  if (o.error || !o.elements) return `error: ${o.error ?? JSON.stringify(o)}`;
  const labeled = o.elements.filter((e) => e.label).length;
  const sparse = labeled < 5 ? "\n(accessibility info is sparse here: use click_visual / read_visual)" : "";
  return `app: ${o.app} | window: ${o.window}${sparse}\n` + o.elements.map((e) => `${e.ref} ${e.role} "${e.label}"`).join("\n");
};
