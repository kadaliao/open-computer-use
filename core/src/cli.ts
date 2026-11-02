#!/usr/bin/env bun
import { runTask } from "./agent.ts";
import { MacDriver, render } from "./driver.ts";

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === "run" && rest.length) {
  const r = await runTask(rest.join(" "), { log: console.log });
  process.exit(r.ok ? 0 : 1);
} else if (cmd === "observe") {
  const d = new MacDriver(); console.log(render(await d.observe())); d.close();
} else {
  console.log('usage: ocu run "<goal>" | ocu observe');
}
