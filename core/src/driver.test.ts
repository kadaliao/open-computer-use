// Ref translation between the helper and callers (no helper process needed).
import { expect, test } from "bun:test";
import { callerRefs, toCaller, toHelper } from "./driver.ts";

test("callers see refs from e101, the helper gets its own numbers back", () => {
  expect(toCaller("e1")).toBe("e101");
  expect(toHelper("e101")).toBe("e1");
  expect(toHelper(toCaller("e57"))).toBe("e57");
  expect(toHelper("e5")).toBe("e-95");  // below e101: not a ref the helper ever handed out, so "unknown ref"
  expect(toHelper("x")).toBe("x");
  const o = callerRefs({ app: "a", window: "w", elements: [{ ref: "e3", role: "List", label: 'showing 14 of 27 rows: scroll{ref:"e3"} for more, or find_text' }] });
  expect(o.elements[0]).toMatchObject({ ref: "e103", label: 'showing 14 of 27 rows: scroll{ref:"e103"} for more, or find_text' });
  expect(callerRefs({ app: "", window: "", elements: undefined as any, error: "locked" }).error).toBe("locked");
});
