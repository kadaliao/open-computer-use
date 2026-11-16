#!/usr/bin/env bun
// Checks the docs: every English page has its Chinese counterpart (name.md <-> name.zh-CN.md), and every
// relative link points to a file that exists and, with #anchor, to a heading in it.
// Usage: bun scripts/check-docs.ts   (exit 1 on problems)
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
// Pages that come in two files. SECURITY.md, CODE_OF_CONDUCT.md, AGENTS.md and .github templates are single files.
const paired = (rel: string) => /^(README|CHANGELOG|CONTRIBUTING)\.md$/.test(rel) || /^docs\/[^/]+\.md$/.test(rel);
const skip = new Set([".git", "node_modules", ".build", "dist", "results"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (skip.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith(".md")) out.push(p);
  }
  return out;
}

/** GitHub's heading anchors: lowercase, drop punctuation and symbols, spaces to "-", "-1" for repeats. */
function anchors(md: string): Set<string> {
  const seen = new Map<string, number>(), out = new Set<string>();
  let fenced = false;
  for (const line of md.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    const m = !fenced && line.match(/^#{1,6}\s+(.*?)\s*#*\s*$/);
    if (!m) continue;
    const text = m[1].replace(/`/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/<[^>]+>/g, "");
    const base = text.toLowerCase().replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, "").replace(/ /g, "-");
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    out.add(n ? `${base}-${n}` : base);
  }
  return out;
}

const files = walk(root);
const problems: string[] = [];
const cache = new Map<string, Set<string>>();
const anchorsOf = (p: string) => cache.get(p) ?? cache.set(p, anchors(readFileSync(p, "utf8"))).get(p)!;

for (const file of files) {
  const rel = relative(root, file);
  if (rel.endsWith(".zh-CN.md")) {
    const en = rel.replace(/\.zh-CN\.md$/, ".md");
    if (!existsSync(join(root, en))) problems.push(`${rel}: no English page ${en}`);
  } else if (paired(rel) && !existsSync(join(root, rel.replace(/\.md$/, ".zh-CN.md")))) {
    problems.push(`${rel}: no Chinese page ${rel.replace(/\.md$/, ".zh-CN.md")}`);
  }

  const md = readFileSync(file, "utf8").replace(/^(```|~~~)[\s\S]*?^\1/gm, "");  // links in code blocks don't count
  const links = [...md.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g), ...md.matchAll(/(?:href|src)="([^"]+)"/g)].map((m) => m[1]);
  for (const link of links) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(link)) continue;  // http:, https:, mailto:
    const [path, anchor] = link.split("#");
    const target = path ? resolve(dirname(file), decodeURI(path)) : file;
    if (!existsSync(target)) { problems.push(`${rel}: broken link ${link}`); continue; }
    if (anchor && target.endsWith(".md") && !anchorsOf(target).has(decodeURIComponent(anchor).toLowerCase()))
      problems.push(`${rel}: no heading for #${anchor} in ${relative(root, target)}`);
  }
}

if (problems.length) {
  console.log(problems.join("\n"));
  console.log(`\n${problems.length} problem(s) in ${files.length} files`);
  process.exit(1);
}
console.log(`docs ok: ${files.length} files`);
