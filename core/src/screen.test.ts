// Act replies (what changed) and settling, without a helper.
import { beforeEach, describe as group, expect, test } from "bun:test";
import type { Element, Observation } from "./driver.ts";
import { describe, FULL_AFTER, gapAfter, runSteps, settle, shape, waits } from "./screen.ts";

const el = (ref: string, role: string, label: string, more: Partial<Element> = {}): Element => ({ ref, role, label, ...more });
const scr = (els: Element[], window = "计算器", window_id = 7, app = "计算器"): Observation => ({ app, window, window_id, elements: els });
const keypad = () => [el("e1", "Text", "0"), ...[..."0123456789"].map((d, i) => el(`e${i + 2}`, "Button", d)),
  el("e20", "Button", "全部清除"), el("e21", "Button", "等于")];

group("act replies", () => {
  test("a small change lists only what changed and says the other refs still hold", () => {
    const a = scr(keypad()), b = scr(keypad().map((e) => (e.ref === "e1" ? { ...e, label: "7" } : e)));
    const r = describe(a, b);
    expect(r.kind).toBe("diff");
    expect(r.text).toContain("every other ref from your last screen is unchanged and still valid");
    expect(r.text).toContain('~ e1 Text "7"   (was: Text "0")');
    expect(r.text).toContain("app: 计算器 | window: 计算器");
    expect(r.text).not.toContain('e9 Button "7"');  // unchanged lines are left out
  });

  test("new and gone elements are marked, in screen order", () => {
    const a = scr(keypad());
    const b = scr([...keypad().filter((e) => e.ref !== "e20"), el("e40", "Button", "清除")]);
    const t = describe(a, b).text.split("\n");
    expect(t).toContain('+ e40 Button "清除"');
    expect(t).toContain('- e20 Button "全部清除"');
    expect(t[0]).toStartWith("changed: 1 new, 1 gone.");
  });

  test("state and value changes show as ~ with the old line", () => {
    const a = scr([el("e50", "CheckBox", "粗体"), el("e51", "PopUpButton", "字样", { value: "常规体" }), ...keypad()], "未命名");
    const b = scr([el("e50", "CheckBox", "粗体", { state: ["checked"] }), el("e51", "PopUpButton", "字样", { value: "粗体" }), ...keypad()], "未命名");
    const r = describe(a, b);
    expect(r.kind).toBe("diff");
    expect(r.text).toContain('~ e50 CheckBox "粗体" [checked]   (was: CheckBox "粗体")');
    expect(r.text).toContain('~ e51 PopUpButton "字样" = "粗体"   (was: PopUpButton "字样" = "常规体")');
  });

  test("a big change sends the whole screen", () => {
    const a = scr(keypad());
    const b = scr([el("e50", "Text", "x"), ...Array.from({ length: 10 }, (_, i) => el(`e${60 + i}`, "Button", `n${i}`)), ...keypad().slice(0, 5)]);
    const r = describe(a, b);
    expect(r.kind).toBe("full");
    expect(r.text).toContain("Full screen below; refs that are not in it are gone.");
    expect(r.text).toContain('e61 Button "n1"');
  });

  test("another window with the same title is told apart by window_id", () => {
    const doc = [el("e3", "TextArea", "")];
    const r = describe(scr(doc, "未命名", 7, "文本编辑"), scr([el("e9", "TextArea", "")], "未命名", 12, "文本编辑"));
    expect(r.kind).toBe("full");
    expect(r.text).toStartWith("changed: now in 文本编辑 | 未命名 (another window). Use only the refs below.");
  });

  test("after several change-only replies the next one is the full screen", () => {
    const a = scr(keypad()), b = scr(keypad().map((e) => (e.ref === "e1" ? { ...e, label: "7" } : e)));
    expect(describe(a, b, FULL_AFTER - 1).kind).toBe("diff");
    expect(describe(a, b, FULL_AFTER).kind).toBe("full");
  });

  test("nothing changed: say so, and don't repeat the list", () => {
    const r = describe(scr(keypad()), scr(keypad()));
    expect(r.kind).toBe("same");
    expect(r.text).toStartWith("did not change: the action probably had no effect.");
    expect(r.text).toContain("all its refs still hold");
    expect(r.text).not.toContain("Button");
  });

  test("an app that hands out fresh refs on every read gets full lists", () => {
    const renumber = (els: Element[], k: number) => els.map((e, i) => ({ ...e, ref: `e${k + i}` }));
    const same = describe(scr(renumber(keypad(), 100)), scr(renumber(keypad(), 200)));
    expect(same.kind).toBe("full");
    expect(same.text).toContain("did not change");
    expect(same.text).toContain("renumbered its elements: use only the refs below");
    const changed = keypad().map((e) => (e.ref === "e1" ? { ...e, label: "7" } : e));
    expect(describe(scr(renumber(keypad(), 100)), scr(renumber(changed, 200))).kind).toBe("full");
  });

  test("first sight and errors are full", () => {
    expect(describe(undefined, scr(keypad())).kind).toBe("full");
    expect(describe({ app: "", window: "", elements: [], error: "the screen is locked" }, scr(keypad())).kind).toBe("full");
    expect(describe(scr(keypad()), { app: "", window: "", elements: [], error: "app not running: X" }).text).toContain("error: app not running");
  });

  test("shape ignores refs but not labels, state or the window", () => {
    const k = keypad();
    expect(shape(scr(k))).toBe(shape(scr(k.map((e, i) => ({ ...e, ref: `e${300 + i}` })))));
    expect(shape(scr(k))).not.toBe(shape(scr(k.map((e) => (e.ref === "e2" ? { ...e, state: ["disabled"] } : e)))));
    expect(shape(scr(k, "A"))).not.toBe(shape(scr(k, "B")));
  });

  test("events get a short gap before the next step, accessibility actions none", () => {
    expect(gapAfter({ action: "press" }, {})).toBe(0);
    expect(gapAfter({ action: "set_value" }, {})).toBe(0);
    expect(gapAfter({ action: "type" }, { via: "ax" })).toBe(0);
    expect(gapAfter({ action: "type" }, { via: "keyboard" })).toBeGreaterThan(0);
    expect(gapAfter({ action: "press" }, { via: "click" })).toBeGreaterThan(0);
    expect(gapAfter({ action: "key" }, {})).toBeGreaterThan(0);
  });
});

group("settle", () => {
  beforeEach(() => { Object.assign(waits, { poll: 10, quiet: 120, quietBrowser: 120, quietStep: 40, max: 600 }); });
  /** A screen that turns into `after` once `at` ms have passed; records which reads were quiet. */
  function app(at: number, after = scr([el("e1", "Text", "7")])) {
    const t0 = performance.now(), reads: boolean[] = [];
    const read = async (quiet: boolean) => { reads.push(quiet); return performance.now() - t0 >= at ? after : scr([el("e1", "Text", "0")]); };
    return { read, reads, t0 };
  }
  const before = shape(scr([el("e1", "Text", "0")]));

  test("returns soon after the change, with only the first read non-quiet", async () => {
    const a = app(0);
    const o = await settle(a.read, { before });
    expect(o.elements[0].label).toBe("7");
    expect(performance.now() - a.t0).toBeLessThan(100);
    expect(a.reads[0]).toBe(false);
    expect(a.reads.slice(1).every((q) => q)).toBe(true);
  });

  test("keeps watching an unchanged screen for the quiet time, so a late change is caught", async () => {
    const late = app(70);
    expect((await settle(late.read, { before })).elements[0].label).toBe("7");
    const never = app(10_000);
    await settle(never.read, { before });
    expect(performance.now() - never.t0).toBeGreaterThanOrEqual(120);
    const step = app(10_000);
    await settle(step.read, { before, step: true });  // inside a batch: the shorter quiet time
    expect(performance.now() - step.t0).toBeLessThan(110);
  });

  test("a slider that moves by itself (a playing video) doesn't keep the screen from settling", async () => {
    let t = 0;
    const read = async () => scr([el("e1", "Slider", "播放位置", { value: String(t++) }), el("e2", "Button", "暂停")], "Video", 4, "QuickTime Player");
    const t0 = performance.now();
    await settle(read);
    expect(performance.now() - t0).toBeLessThan(100);  // not the 600 ms maximum
    // The reply still reports a slider that moved (here as the full list: two lines is a small screen).
    const a = await read(), b = await read();
    const r = describe(a, b);
    expect(r.kind).not.toBe("same");
    expect(r.text).toContain(`Slider "播放位置" = "${b.elements[0].value}"`);
  });

  test("stops as soon as `enough` holds", async () => {
    const a = app(0);
    await settle(a.read, { before, enough: (o) => o.elements[0].label === "7" });
    expect(a.reads.length).toBe(1);
  });
});

group("MCP batches (act then:[...])", () => {
  const recorder = (fail?: string) => {
    const log: string[] = [];
    const run = async (st: { action: string; key?: string; ref?: string }) => { log.push(`run ${st.action} ${st.key ?? st.ref ?? ""}`.trim());
      return fail && st.ref === fail ? { error: "unknown ref" } : { ok: true }; };
    const wait = async (before: string | undefined) => { log.push(`wait ${before === undefined ? "?" : "known"}`); return scr([el("e9", "TextArea", "")], "未命名 2", 9); };
    return { log, run, wait };
  };
  test("keypad presses go straight on; a key combo waits for the screen before the next step", async () => {
    const k = recorder();
    await runSteps([{ action: "press", ref: "e1" }, { action: "press", ref: "e2" }, { action: "press", ref: "e3" }], k.run, k.wait, "s");
    expect(k.log).toEqual(["run press e1", "run press e2", "run press e3"]);
    const n = recorder();
    const r = await runSteps([{ action: "key", key: "cmd+n" }, { action: "type" }], n.run, n.wait, "s");
    expect(n.log).toEqual(["run key cmd+n", "wait known", "run type"]);
    expect(r.screen).toBe(shape(scr([el("e9", "TextArea", "")], "未命名 2", 9)));  // the final wait starts from there
  });
  test("stops at the first error", async () => {
    const k = recorder("e2");
    const r = await runSteps([{ action: "press", ref: "e1" }, { action: "press", ref: "e2" }, { action: "press", ref: "e3" }], k.run, k.wait);
    expect(r.results.length).toBe(2);
    expect(k.log).not.toContain("run press e3");
  });
});
