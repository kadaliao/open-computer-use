#!/usr/bin/env bun
// Draws the ocu vs agent-desktop comparison chart shown in the README and docs/benchmarks.
// Usage: bun docs/assets/vs-chart.ts      Writes docs/assets/vs-agent-desktop-{en,zh}-{light,dark}.svg
// After a new comparison run, change the numbers in `rows` and `note`, then run it again.
import { writeFileSync } from "node:fs";

type Lang = "en" | "zh";
const ocu = "ocu 0.7.0", other = "agent-desktop 1.3.1";
// [metric, ocu, agent-desktop, shown as, how much better]
const rows: { name: Record<Lang, string>; a: number; b: number; fmt: (n: number) => string; gain: Record<Lang, string> }[] = [
  { name: { en: "Time", zh: "耗时" }, a: 84, b: 173, fmt: (n) => `${n} s`, gain: { en: "faster", zh: "更快" } },
  { name: { en: "Tool calls", zh: "工具调用" }, a: 29, b: 73, fmt: (n) => `${n}`, gain: { en: "fewer", zh: "更少" } },
  { name: { en: "Input tokens", zh: "输入 token" }, a: 270, b: 2145, fmt: (n) => `${n.toLocaleString("en-US")}k`, gain: { en: "fewer", zh: "更少" } },
  { name: { en: "Cost", zh: "费用" }, a: 0.24, b: 0.95, fmt: (n) => `$${n.toFixed(2)}`, gain: { en: "cheaper", zh: "更省" } },
];
const title: Record<Lang, string> = {
  en: "Same model, same four tasks: ocu vs agent-desktop",
  zh: "同一个模型，同样四个任务：ocu 对比 agent-desktop",
};
const note: Record<Lang, string> = {
  en: "Totals over 8 runs each, all 16 passed. Claude Code with Sonnet 5.5, MacBook Pro M1 Max, 2026-11-16. Shorter is better.",
  zh: "各 8 次运行的合计，16 次全部通过。Claude Code + Sonnet 5.5，MacBook Pro M1 Max，2026-11-16。越短越好。",
};
// Ink and surface follow GitHub's light and dark pages; the image itself is transparent.
const themes = {
  light: { ink: "#0b0b0b", ink2: "#52514e", muted: "#898781", grid: "#e1e0d9", a: "#2a78d6", b: "#898781" },
  dark: { ink: "#f0efec", ink2: "#c3c2b7", muted: "#898781", grid: "#2c2c2a", a: "#3987e5", b: "#898781" },
};

const W = 820, left = 24, barX = 150, barW = 440, gainX = W - 24, rowH = 66, top = 92, barH = 14;
const font = `-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Noto Sans CJK SC', 'Microsoft YaHei', sans-serif`;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
// A bar with a square start and a rounded end.
const bar = (x: number, y: number, w: number, fill: string) => {
  const r = 4, v = Math.max(w, r * 2);
  return `<path d="M${x},${y}h${v - r}a${r},${r} 0 0 1 ${r},${r}v${barH - r * 2}a${r},${r} 0 0 1 -${r},${r}h-${v - r}z" fill="${fill}"/>`;
};

function draw(lang: Lang, t: (typeof themes)["light"]) {
  const H = top + rows.length * rowH + 40;
  const out: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="${font}" role="img" aria-label="${esc(title[lang])}">`,
    `<text x="${left}" y="32" font-size="18" font-weight="600" fill="${t.ink}">${esc(title[lang])}</text>`,
    // Legend
    `<rect x="${left}" y="52" width="12" height="12" rx="3" fill="${t.a}"/><text x="${left + 18}" y="63" font-size="13" fill="${t.ink2}">${ocu}</text>`,
    `<rect x="${left + 110}" y="52" width="12" height="12" rx="3" fill="${t.b}"/><text x="${left + 128}" y="63" font-size="13" fill="${t.ink2}">${other}</text>`,
  ];
  rows.forEach((r, i) => {
    const y = top + i * rowH, max = Math.max(r.a, r.b), times = (r.b / r.a).toFixed(1);
    const wa = (r.a / max) * barW, wb = (r.b / max) * barW;
    out.push(
      `<line x1="${left}" x2="${W - left}" y1="${y - 10}" y2="${y - 10}" stroke="${t.grid}"/>`,
      `<text x="${left}" y="${y + 27}" font-size="14" font-weight="600" fill="${t.ink}">${esc(r.name[lang])}</text>`,
      bar(barX, y + 4, wa, t.a),
      `<text x="${barX + Math.max(wa, 8) + 8}" y="${y + 16}" font-size="13" font-weight="600" fill="${t.ink}">${esc(r.fmt(r.a))}</text>`,
      bar(barX, y + 4 + barH + 6, wb, t.b),
      `<text x="${barX + wb + 8}" y="${y + 16 + barH + 6}" font-size="13" fill="${t.ink2}">${esc(r.fmt(r.b))}</text>`,
      `<text x="${gainX}" y="${y + 24}" font-size="22" font-weight="700" fill="${t.ink}" text-anchor="end">${times}×</text>`,
      `<text x="${gainX}" y="${y + 42}" font-size="12" fill="${t.ink2}" text-anchor="end">${esc(r.gain[lang])}</text>`,
    );
  });
  out.push(`<text x="${left}" y="${H - 14}" font-size="12" fill="${t.muted}">${esc(note[lang])}</text>`, `</svg>`);
  return out.join("\n") + "\n";
}

for (const lang of ["en", "zh"] as const)
  for (const [name, t] of Object.entries(themes))
    writeFileSync(new URL(`vs-agent-desktop-${lang}-${name}.svg`, import.meta.url), draw(lang, t));
