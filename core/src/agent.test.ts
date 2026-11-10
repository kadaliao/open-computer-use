// The agent loop against a scripted fake app and a scripted planner: no helper, no network.
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Action, Element, Observation } from "./driver.ts";
import { confirmed, runTask, timing, type Decide, type Driver } from "./agent.ts";
import { decide } from "./policy.ts";
import { waits } from "./screen.ts";
import type { Step } from "./policy.ts";

// Never touch the user's cache; short waits so the suite runs in a few seconds.
const dir = mkdtempSync(join(tmpdir(), "ocu-test-"));
process.env.OCU_CACHE_FILE = join(dir, "actions.json");
afterAll(() => rmSync(dir, { recursive: true, force: true }));
beforeEach(() => { Object.assign(waits, { poll: 10, quiet: 80, quietBrowser: 80, quietStep: 80, max: 600 }); timing.turnGap = 0; });

/** A scripted app. Tests describe the screen as elements; `onAct` changes it. */
class Fake implements Driver {
  log: string[] = [];
  quiet: boolean[] = [];  // per read: was it a quiet (settle) read
  closed = false;
  constructor(public app: string, public window: string, public els: Element[],
    public onAct: (a: Action, f: Fake) => object | void = () => {}) {}
  el(ref: string) { return this.els.find((e) => e.ref === ref); }
  async observe(_app?: string, opts: { quiet?: boolean } = {}): Promise<Observation> {
    this.log.push("observe");
    this.quiet.push(!!opts.quiet);
    return structuredClone({ app: this.app, window: this.window, elements: this.els });
  }
  async act(a: Action) {
    this.log.push(`${a.action}${"ref" in a && a.ref ? ` ${a.ref}` : ""}`);
    if ("ref" in a && a.ref && !this.el(a.ref)) return { error: "unknown ref" };
    return { ok: true, ...(this.onAct(a, this) ?? {}) };
  }
  async screenshot() { return { error: "no screenshots in tests" } as any; }
  close() { this.closed = true; }
}
const later = (ms: number, f: () => void) => (ms ? setTimeout(f, ms) : f());
const el = (ref: string, role: string, label: string): Element => ({ ref, role, label });

/** Scripted planner: one batch per call; records what each call was shown. */
function planner(...turns: (Step[] | ((history: string[], obs: Observation) => Step[]))[]) {
  const calls: { history: string[]; obs: Observation }[] = [];
  const decide: Decide = async (_goal, history, obs) => {
    const t = turns[calls.length];
    calls.push({ history: [...history], obs: structuredClone(obs) });
    if (!t) throw new Error(`unexpected planner call #${calls.length}`);
    await new Promise((r) => setTimeout(r, 5));  // some model time, for the timing log
    return { steps: typeof t === "function" ? t(history, obs) : t, tier: "planner" };
  };
  return { decide, calls };
}

/** Notes: "new note" adds an empty note whose body takes keyboard focus, `lag` ms after the press. */
function notes(lag = 0, newRef = "e1") {
  let focused: Element | undefined;
  return new Fake("备忘录", "备忘录", [el(newRef, "Button", "新建备忘录"), el("e2", "Row", "购物清单"), el("e9", "TextArea", "购物清单 牛奶")], (a, f) => {
    if (a.action === "press" && a.ref === newRef) later(lag, () => {
      focused = el("e10", "TextArea", "");
      f.els = [f.els[0], el("e3", "Row", "新备忘录"), f.els[1], focused];
    });
    if (a.action === "type" && !("ref" in a && a.ref) && focused) focused.label += a.text;
    if (a.action === "set_value") f.el(a.ref)!.label = a.text;
  });
}

/** Calculator with a display that groups digits like the real one ("6,912"). relabel: AC reads "清除" while there is input. */
function calculator(display = "0", relabel = false) {
  const keys = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d, i) => el(`e${i + 1}`, "Button", d));
  const ops: Record<string, string> = { 加: "+", 乘: "*", 等于: "=", 全部清除: "C" };
  const opEls = Object.keys(ops).map((o, i) => el(`e${i + 20}`, "Button", o));
  const shown = el("e30", "Text", display);
  let expr = "";
  return new Fake("计算器", "计算器", [shown, ...keys, ...opEls], (a, f) => {
    if (a.action !== "press") return;
    const k = f.el(a.ref)!.label, op = k === "清除" ? "C" : ops[k];
    if (op === "C") expr = "";
    else if (op === "=") expr = String(Function(`return (${expr})`)());
    else expr += op ?? k;
    const last = expr.match(/[\d.]+$/)?.[0];  // an operator leaves the display alone
    if (last || op === "C") shown.label = Number(last ?? 0).toLocaleString("en-US");
    if (relabel) f.els.find((e) => e.ref === "e20")!.label = expr ? "清除" : "全部清除";
  });
}
const press = (ref: string): Step => ({ action: "press", ref });
const keyRefs = (f: Fake, labels: string[]) => labels.map((l) => press(f.els.find((e) => e.label === l)!.ref));

describe("batching past a screen change", () => {
  test("goes on with steps that need no ref, after the screen settles", async () => {
    const f = notes(40);  // the new note shows up late
    const old = f.el("e9")!;
    const p = planner([press("e1"), { action: "type", text: "hello" }, { action: "done", summary: "new note", expect: "hello" }]);
    const r = await runTask("new note hello", { driver: f, decide: p.decide, noCache: true });
    expect(r.ok).toBe(true);
    expect(p.calls.length).toBe(1);
    expect(r.turns).toBe(1);
    // The typing waited for the new note instead of landing nowhere; the old note is untouched.
    expect(f.el("e10")?.label).toBe("hello");
    expect(old.label).toBe("购物清单 牛奶");
    const iPress = f.log.indexOf("press e1"), iType = f.log.indexOf("type");
    expect(f.log.slice(iPress, iType).filter((x) => x === "observe").length).toBeGreaterThanOrEqual(2);
    expect(f.closed).toBe(false);  // a driver passed in belongs to the caller
    // Timing: model time is on the first step only (sums don't double count); waiting for the note is on the type step.
    expect(r.steps.map((s) => !!s.model_ms)).toEqual([true, false, false]);
    expect(r.steps[1].wait_ms).toBeGreaterThanOrEqual(30);
    expect(r.steps.reduce((a, s) => a + s.ms, 0)).toBeGreaterThanOrEqual(r.steps[0].model_ms! + r.steps[1].wait_ms!);
  });

  test("stops at the first step that needs a ref", async () => {
    const f = notes();
    const p = planner(
      [press("e1"), { action: "set_value", ref: "e10", text: "hello" }, { action: "done", summary: "x", expect: "hello" }],
      [{ action: "set_value", ref: "e10", text: "hello" }, { action: "done", summary: "new note", expect: "hello" }]);
    const r = await runTask("new note hello", { driver: f, decide: p.decide, noCache: true });
    expect(r.ok).toBe(true);
    expect(p.calls.length).toBe(2);
    expect(p.calls[1].history.length).toBe(1);
    expect(p.calls[1].history[0]).toStartWith('{"action":"press","ref":"e1"}');
    expect(p.calls[1].obs.elements.some((e) => e.ref === "e10")).toBe(true);  // planned on the new screen
    expect(f.log.filter((x) => x.startsWith("set_value")).length).toBe(1);
  });

  test("a run of presses keeps its refs and doesn't wait between keys", async () => {
    const f = calculator();
    const p = planner([...keyRefs(f, ["3", "7", "乘", "1", "2", "等于"]), { action: "done", summary: "37 × 12 = 444", expect: "444" }]);
    const r = await runTask("37*12", { driver: f, decide: p.decide, noCache: true });
    expect(r).toMatchObject({ ok: true, summary: "37 × 12 = 444", turns: 1 });
    const presses = f.log.map((x, i) => [x, i] as const).filter(([x]) => x.startsWith("press"));
    expect(f.log.slice(presses[0][1], presses.at(-1)![1]).includes("observe")).toBe(false);
  });
});

describe("refs after a screen change", () => {
  // TextEdit-like: select all changes nothing visible, bold ticks the box; "Save" opens a big sheet.
  const editor = () => new Fake("文本编辑", "未命名", [el("e5", "CheckBox", "粗体"), el("e6", "Button", "存储"), el("e11", "TextArea", "")], (a, f) => {
    const ref = (a as { ref?: string }).ref;
    if (a.action === "type" && ref) f.el(ref)!.label += a.text;
    if (a.action === "press" && ref === "e5") f.el("e5")!.state = ["checked"];
    if (a.action === "press" && ref === "e6") f.els = [...f.els, ...Array.from({ length: 12 }, (_, i) => el(`e${30 + i}`, "Button", `sheet ${i}`))];
    if (a.action === "key" && a.key === "cmd+r") f.el("e5")!.label = "Bold";
  });

  test("a step whose element is still there unchanged runs in the same batch", async () => {
    const f = editor();
    const p = planner([{ action: "type", ref: "e11", text: "ocu bold" } as Step, { action: "key", key: "cmd+a" }, press("e5")], [{ action: "done", summary: "bold" }]);
    const r = await runTask("bold", { driver: f, decide: p.decide, noCache: true });
    expect(r.ok).toBe(true);
    expect(p.calls[0].history).toEqual([]);
    expect(p.calls[1].history.length).toBe(3);  // all three ran in the first turn
    expect(f.el("e5")!.state).toEqual(["checked"]);
  });

  test("after a big change, or when the element's label changed, the planner looks first", async () => {
    const big = editor();
    // (press after press is the keypad case and goes straight on, so the second step here is a set_value.)
    const p1 = planner([press("e6"), { action: "set_value", ref: "e11", text: "x" }], [{ action: "done", summary: "x" }]);
    await runTask("save", { driver: big, decide: p1.decide, noCache: true });
    expect(big.log.filter((x) => x.startsWith("set_value")).length).toBe(0);
    expect(p1.calls[1].obs.elements.length).toBeGreaterThan(10);  // planned on the screen with the sheet
    const renamed = editor();
    const p2 = planner([{ action: "key", key: "cmd+r" }, press("e5")], [{ action: "done", summary: "x" }]);
    await runTask("rename", { driver: renamed, decide: p2.decide, noCache: true });
    expect(renamed.log.filter((x) => x === "press e5").length).toBe(0);
  });

  test("settling reads are quiet after the first", async () => {
    const f = notes(30);
    const p = planner([press("e1"), { action: "type", text: "hello" }, { action: "done", summary: "s", expect: "hello" }]);
    await runTask("x", { driver: f, decide: p.decide, noCache: true });
    expect(f.quiet.filter((q) => q).length).toBeGreaterThan(f.quiet.filter((q) => !q).length);
  });

  test("a page that starts loading late after return is still waited for", async () => {
    // set_value changes the screen first; the wait after return must not take that for the page load.
    const f = new Fake("Safari浏览器", "Apple", [el("e3", "TextField", "智能搜索栏"), el("e4", "Text", "iPhone")], (a, f) => {
      if (a.action === "set_value") f.el("e3")!.value = a.text;
      if (a.action === "key") setTimeout(() => { f.window = "Example Domain"; f.els = [f.els[0], el("e9", "Text", "Example Domain")]; }, 50);
    });
    const p = planner([{ action: "set_value", ref: "e3", text: "example.com" }, { action: "key", key: "return" },
      { action: "done", summary: "opened", expect: "Example Domain" }]);
    expect(await runTask("open example.com", { driver: f, decide: p.decide, noCache: true })).toMatchObject({ ok: true, turns: 1 });
  });
});

describe("done with expect", () => {
  test("finishes without another planner call when the text is new on screen", async () => {
    const f = calculator();
    const p = planner([...keyRefs(f, ["1", "2", "3", "4", "加", "5", "6", "7", "8", "等于"]), { action: "done", summary: "6912", expect: "6912" }]);
    const r = await runTask("1234+5678", { driver: f, decide: p.decide, noCache: true });
    expect(r).toMatchObject({ ok: true, turns: 1 });  // display says "6,912": grouping doesn't matter
  });

  test("falls back to the planner when the text is absent", async () => {
    const f = calculator();
    const p = planner([...keyRefs(f, ["3", "7", "乘", "1", "2", "等于"]), { action: "done", summary: "445", expect: "445" }],
      [{ action: "done", summary: "37 × 12 = 444" }]);
    const r = await runTask("37*12", { driver: f, decide: p.decide, noCache: true });
    expect(r).toMatchObject({ ok: true, summary: "37 × 12 = 444", turns: 2 });
    expect(p.calls[1].history.at(-1)).toContain("not confirmed");
    expect(p.calls[1].obs.elements[0].label).toBe("444");  // planned on the screen the check read
    expect(r.steps.find((s) => (s.step as Step).action === "done")!.error).toBe("not confirmed");
  });

  test("falls back when the text was already on screen before the batch", async () => {
    const f = calculator("444");
    const p = planner([...keyRefs(f, ["全部清除", "3", "7", "乘", "1", "2", "等于"]), { action: "done", summary: "444", expect: "444" }],
      [{ action: "done", summary: "37 × 12 = 444" }]);
    const r = await runTask("37*12", { driver: f, decide: p.decide, noCache: true });
    expect(r).toMatchObject({ ok: true, turns: 2 });
  });

  test("without expect, done after other steps waits for a look", async () => {
    const f = calculator();
    const p = planner([...keyRefs(f, ["3", "加", "4", "等于"]), { action: "done", summary: "7" }], [{ action: "done", summary: "3 + 4 = 7" }]);
    const r = await runTask("3+4", { driver: f, decide: p.decide, noCache: true });
    expect(r).toMatchObject({ ok: true, summary: "3 + 4 = 7", turns: 2 });
  });

  test("counts a new window title, but not a button that names the next page", async () => {
    const settings = () => new Fake("系统设置", "Wi-Fi", [el("e1", "Row", "通用"), el("e2", "Row", "蓝牙")], (a, f) => {
      if (a.action !== "press") return;
      if (a.ref === "e2") { f.window = "蓝牙"; f.els = f.els.slice(0, 2); }
      if (a.ref === "e1") { f.window = "通用"; f.els = [...f.els.slice(0, 2), el("e20", "Button", "关于本机")]; }
      if (a.ref === "e20") { f.window = "关于本机"; f.els = [...f.els.slice(0, 2), el("e21", "Text", "Mac mini")]; }
    });
    const bt = planner([press("e2"), { action: "done", summary: "open", expect: "蓝牙" }]);
    expect(await runTask("bluetooth", { driver: settings(), decide: bt.decide, noCache: true })).toMatchObject({ ok: true, turns: 1 });
    const about = planner([press("e1"), { action: "done", summary: "open", expect: "关于本机" }],
      [press("e20"), { action: "done", summary: "open", expect: "关于本机" }]);
    expect(await runTask("about", { driver: settings(), decide: about.decide, noCache: true })).toMatchObject({ ok: true, turns: 2 });
  });

  test("for a goal that asks something, expect must be the answer, not a page the goal names", async () => {
    const goal = "打开外观页面，告诉我当前外观是浅色、深色还是自动";
    const settings = () => new Fake("系统设置", "Wi-Fi", [el("e1", "Row", "外观")], (a, f) => {
      f.window = "外观"; f.els = [f.els[0], el("e2", "Text", "外观"), el("e3", "RadioButton", "浅色"), el("e4", "RadioButton", "深色")];
    });
    for (const guess of [{ summary: "已打开外观页面", expect: "外观" }, { summary: "当前外观为深色", expect: "深色" }]) {
      const p = planner([press("e1"), { action: "done", ...guess }], [{ action: "done", summary: "当前外观为浅色" }]);
      const r = await runTask(goal, { driver: settings(), decide: p.decide, noCache: true });
      expect(r).toMatchObject({ ok: true, summary: "当前外观为浅色", turns: 2 });
      expect(p.calls[1].history.at(-1)).toContain("not accepted");
      expect(p.calls[1].obs.window).toBe("外观");
    }
    // A computed answer is fine: it is in the summary and not in the goal.
    const f = calculator();
    const calc = planner([...keyRefs(f, ["3", "7", "乘", "1", "2", "等于"]), { action: "done", summary: "37 × 12 = 444", expect: "444" }]);
    expect(await runTask("用计算器算 37 乘以 12，把结果告诉我", { driver: f, decide: calc.decide, noCache: true })).toMatchObject({ ok: true, turns: 1 });
  });

  test("text that an earlier step of the batch already brought up doesn't prove the last step", async () => {
    // type, select all, bold: the typed text is on the screen read before cmd+b, so it can't prove the bold.
    // (driver.ts's Action type doesn't list type's optional ref yet; the helper takes it.)
    const f = new Fake("文本编辑", "未命名", [el("e5", "CheckBox", "粗体"), el("e11", "TextArea", "")], (a, f) => {
      const ref = (a as { ref?: string }).ref;
      if (a.action === "type" && ref) f.el(ref)!.label += a.text;
    });
    const p = planner([{ action: "type", ref: "e11", text: "ocu bold" } as Step, { action: "key", key: "cmd+a" }, { action: "key", key: "cmd+b" },
      { action: "done", summary: "bold", expect: "ocu bold" }], [{ action: "done", summary: "bold" }]);
    const r = await runTask("type and bold", { driver: f, decide: p.decide, noCache: true });
    expect(r).toMatchObject({ ok: true, turns: 2 });
    expect(p.calls[1].history.at(-1)).toContain("not confirmed");
  });

  test("confirmed: what counts", () => {
    const o = (window: string, els: Element[]): Observation => ({ app: "x", window, elements: els });
    const before = o("a", [el("e1", "Text", "0"), el("e2", "Button", "Save")]);
    expect(confirmed("6912", [before], o("a", [el("e1", "Text", "6,912")]))).toBe(true);
    expect(confirmed("6,912", [before], o("a", [el("e1", "Text", "6 912")]))).toBe(true);
    expect(confirmed("ＡＢＣ  def", [before], o("a", [el("e1", "TextArea", "abc\ndef")]))).toBe(true);  // width, case, line breaks
    expect(confirmed(["Downloads", "下载"], [before], o("Downloads", []))).toBe(true);
    expect(confirmed("x", [before], o("x", []))).toBe(false);  // too short to mean anything
    expect(confirmed("Save as", [before], o("a", [el("e3", "Button", "Save as")]))).toBe(false);  // a control
    expect(confirmed("hello", [before], o("a", [el("e3", "TextField", "hello")]))).toBe(false);  // echo of typing
    expect(confirmed("hello", [o("a", [el("e1", "TextArea", "hello")])], o("a", [el("e1", "TextArea", "hello world")]))).toBe(false);  // was there
    expect(confirmed("", [before], o("a", []))).toBe(false);
  });
});

describe("action cache", () => {
  test("records a run that batched past a screen change and replays it without the planner", async () => {
    const first = planner([press("e1"), { action: "type", text: "hello" }, { action: "done", summary: "note: hello", expect: "hello" }]);
    const r1 = await runTask('new note "hello"', { driver: notes(), decide: first.decide });
    expect(r1.ok).toBe(true);
    const db = JSON.parse(readFileSync(process.env.OCU_CACHE_FILE!, "utf8"));
    const entry = db['[备忘录] new note {0}'];
    expect(entry.steps).toEqual([{ step: { action: "press" }, target: "Button 新建备忘录", nth: 0 }, { step: { action: "type", text: "{0}" } }]);
    expect(entry.done).toEqual({ summary: "note: {0}", expect: ["{0}"] });
    // Another parameter, and the button has another ref this time.
    const f = notes(30, "e7");
    const none = planner();
    const r2 = await runTask('new note "world"', { driver: f, decide: none.decide });
    expect(r2).toMatchObject({ ok: true, summary: "note: world", turns: 0 });
    expect(f.el("e10")?.label).toBe("world");
    expect(r2.steps.every((s) => s.tier === "cache")).toBe(true);
    expect(JSON.parse(readFileSync(process.env.OCU_CACHE_FILE!, "utf8"))['[备忘录] new note {0}'].hits).toBe(1);
  });

  test("keypad replay with other numbers asks the planner when the recorded result doesn't show", async () => {
    const f1 = calculator();
    const first = planner([...keyRefs(f1, ["3", "7", "乘", "1", "2", "等于"]), { action: "done", summary: "37 × 12 = 444", expect: "444" }]);
    expect((await runTask("算 37 乘以 12", { driver: f1, decide: first.decide })).ok).toBe(true);
    const again = planner();
    expect(await runTask("算 37 乘以 12", { driver: calculator(), decide: again.decide })).toMatchObject({ ok: true, turns: 0 });
    const f3 = calculator();
    const other = planner([{ action: "done", summary: "37 × 13 = 481" }]);
    const r3 = await runTask("算 37 乘以 13", { driver: f3, decide: other.decide });
    expect(r3).toMatchObject({ ok: true, summary: "37 × 13 = 481", turns: 1 });
    expect(f3.els[0].label).toBe("481");  // the keys were re-spelled for the new numbers
    expect(other.calls[0].history.at(-1)).toContain("replayed from a previous successful run");
  });

  test("a key whose label shows up only after earlier keys is found on a fresh read", async () => {
    const f1 = calculator("0", true);
    // Recorded as "Button 清除": the planner pressed it on the screen after the first key.
    const first = planner([press("e2")], [press("e20"), press("e5"), press("e3"), press("e21"), { action: "done", summary: "42", expect: "42" }]);
    expect(await runTask("clear test", { driver: f1, decide: first.decide })).toMatchObject({ ok: true, turns: 2 });
    expect(JSON.stringify(JSON.parse(readFileSync(process.env.OCU_CACHE_FILE!, "utf8"))["[计算器] clear test"].steps)).toContain("Button 清除");
    const f2 = calculator("0", true);
    const r = await runTask("clear test", { driver: f2, decide: planner().decide });
    expect(r).toMatchObject({ ok: true, turns: 0 });
    expect(f2.els[0].label).toBe("42");
  });
});

describe("loop guards", () => {
  test("an action that had no effect is not repeated", async () => {
    const f = new Fake("App", "w", [el("e5", "Button", "Dead"), el("e6", "Text", "status")]);
    const p = planner([press("e5")], [press("e5")], [{ action: "done", summary: "gave up" }]);
    await runTask("x", { driver: f, decide: p.decide, noCache: true });
    expect(f.log.filter((x) => x === "press e5").length).toBe(1);
    expect(p.calls[2].history.at(-1)).toContain("skipped: it had no visible effect");
  });

  test("ping-pong between two actions is cut", async () => {
    const f = new Fake("App", "start", [el("e1", "Tab", "A"), el("e2", "Tab", "B")], (a, f) => { if (a.action === "press") f.window = f.el(a.ref)!.label; });
    const p = planner(...[1, 2, 1, 2, 1, 2].map((n) => [press(`e${n}`)]), [{ action: "done", summary: "stop" }]);
    await runTask("x", { driver: f, decide: p.decide, noCache: true });
    expect(f.log.filter((x) => x.startsWith("press")).length).toBe(5);
    expect(p.calls[6].history.at(-1)).toContain("alternating between the same two actions");
  });

  test("the third identical action in a row is flagged", async () => {
    let n = 0;
    const f = new Fake("App", "w", [el("e1", "Button", "+1"), el("e2", "Text", "0")], (a, f) => { f.els[1].label = String(++n); });
    const p = planner([press("e1")], [press("e1")], [press("e1")], [{ action: "done", summary: "3" }]);
    await runTask("x", { driver: f, decide: p.decide, noCache: true });
    expect(p.calls[3].history.at(-1)).toContain("repeated 3 times");
  });
});

describe("decide", () => {
  // Planner and Jev judge behind a fake fetch; nothing leaves the machine.
  async function withFetch(planReply: string, jev: "hang" | number, f: (calls: { planner: number; jevAborted: boolean }) => Promise<void>) {
    const saved = { fetch: globalThis.fetch, key: process.env.TYPESAFE_API_KEY, jev: process.env.OCU_JEV };
    const calls = { planner: 0, jevAborted: false };
    process.env.TYPESAFE_API_KEY = "test"; delete process.env.OCU_JEV;
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      if (String(url).includes("/systemone")) {
        if (jev !== "hang") return Response.json({ answers: { done: { noul: jev } } });
        return new Promise((_, rej) => init.signal!.addEventListener("abort", () => { calls.jevAborted = true; rej(new Error("aborted")); }));
      }
      calls.planner++;
      return Response.json({ choices: [{ message: { content: planReply } }] });
    }) as typeof fetch;
    try { await f(calls); } finally {
      globalThis.fetch = saved.fetch;
      if (saved.key === undefined) delete process.env.TYPESAFE_API_KEY; else process.env.TYPESAFE_API_KEY = saved.key;
      if (saved.jev !== undefined) process.env.OCU_JEV = saved.jev;
    }
  }
  const screen: Observation = { app: "x", window: "w", elements: [el("e1", "Button", "Go")] };

  test("doesn't wait long for a slow Jev done-check once the planner has answered", () =>
    withFetch('{"action":"press","ref":"e1"}', "hang", async (calls) => {
      const t0 = performance.now();
      const r = await decide("goal", ["earlier step -> ok"], screen);
      expect(r.steps).toEqual([press("e1")]);
      expect(performance.now() - t0).toBeLessThan(1000);  // the judge's own timeout is 3 s
      expect(calls.jevAborted).toBe(true);
    }));

  test("a confident judge re-asks the planner, unless the batch already ends with done", async () => {
    await withFetch('{"action":"press","ref":"e1"}', 0.99, async (calls) => {
      const r = await decide("goal", ["earlier step -> ok"], screen);
      expect(calls.planner).toBe(2);
      expect(r.tier).toBe("planner+jev");
    });
    await withFetch('{"action":"press","ref":"e1"}\n{"action":"done","summary":"s","expect":"Gone"}', 0.99, async (calls) => {
      const r = await decide("goal", ["earlier step -> ok"], screen);
      expect(calls.planner).toBe(1);
      expect(r.steps.length).toBe(2);
    });
  });
});
