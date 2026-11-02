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

const BIN = process.env.OCU_MAC_BIN ?? fileURLToPath(new URL("../../mac/.build/release/ocu-mac", import.meta.url));

export class MacDriver {
  private proc = spawn(BIN, [], { stdio: ["pipe", "pipe", "inherit"] });
  private pending = new Map<number, (v: any) => void>();
  private nextId = 1;
  constructor() {
    createInterface({ input: this.proc.stdout! }).on("line", (l) => {
      const msg = JSON.parse(l);
      this.pending.get(msg.id)?.(msg);
      this.pending.delete(msg.id);
    });
  }
  call(req: object): Promise<any> {
    const id = this.nextId++;
    return new Promise((res) => {
      this.pending.set(id, res);
      this.proc.stdin!.write(JSON.stringify({ id, ...req }) + "\n");
    });
  }
  observe(app?: string): Promise<Observation> { return this.call({ cmd: "observe", ...(app ? { app } : {}) }); }
  screenshot(): Promise<Shot> { return this.call({ cmd: "screenshot" }); }
  act(a: Action): Promise<{ ok?: boolean; error?: string; target?: string; via?: string; note?: string }> { return this.call({ cmd: "act", ...a }); }
  close() { this.proc.kill(); }
}

// Compact text form of the UI: one line per interactive element, cheap for text-only models.
export const render = (o: Observation) => {
  if (o.error || !o.elements) return `error: ${o.error ?? JSON.stringify(o)}`;
  const labeled = o.elements.filter((e) => e.label).length;
  const sparse = labeled < 5 ? "\n(accessibility info is sparse here: use click_visual / read_visual)" : "";
  return `app: ${o.app} | window: ${o.window}${sparse}\n` + o.elements.map((e) => `${e.ref} ${e.role} "${e.label}"`).join("\n");
};
