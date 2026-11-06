// Experiment 02: attribute a visual diff to the component that caused it.
//
// A whole-image diff paints everything below a grown element red. Here each
// [data-vrt] element is drawn on its own (drawElementImage draws one layer,
// leaving drawable descendants out), so a component is judged on its own
// pixels and its position separately:
//   unchanged  same pixels, same place
//   moved      same pixels, different place (pushed by something else)
//   changed    its own pixels differ
//
// The output doubles as experiment 06: report.md + per-component crops are
// what an AI agent would be handed to "see" the change.
//
// Usage: npm run exp:02 [-- before.html after.html]
import fs from "node:fs";
import path from "node:path";

import pixelmatch from "pixelmatch";

import { contactSheet, fromBase64, launch, openPage, outDir, readFixture, writePng, type Rgba } from "../lib/harness.ts";

const W = 480;
const H = 360;
const STYLE_PROPS = ["color", "background-color", "font-size", "font-weight", "width", "height", "margin", "padding"];

interface Component {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  style: Record<string, string>;
  rgba: string;
}

interface Captured {
  whole: string;
  components: Component[];
}

const [beforeArg, afterArg] = process.argv.slice(2);
const beforeHtml = beforeArg ? fs.readFileSync(beforeArg, "utf8") : readFixture("02-attribution", "before.html");
const afterHtml = afterArg ? fs.readFileSync(afterArg, "utf8") : readFixture("02-attribution", "after.html");
const out = outDir("02-attribution");

const browser = await launch();
let before: Captured;
let after: Captured;
try {
  const page = await openPage(browser);
  const capture = (html: string) =>
    page.evaluate(
      ([h, w, ht, props]) => (window as any).__hic.captureComponents(h, w, ht, props),
      [html, W, H, STYLE_PROPS] as const,
    ) as Promise<Captured>;
  before = await capture(beforeHtml);
  after = await capture(afterHtml);
} finally {
  await browser.close();
}

// ---- whole-image diff, for contrast ----
const wb = fromBase64(before.whole, W, H);
const wa = fromBase64(after.whole, W, H);
const wd: Rgba = { width: W, height: H, data: Buffer.alloc(W * H * 4) };
const wholeDiff = pixelmatch(wb.data, wa.data, wd.data, W, H, { threshold: 0.1 });
writePng(path.join(out, "before.png"), wb);
writePng(path.join(out, "after.png"), wa);
writePng(path.join(out, "whole-diff.png"), wd);

// ---- per-component verdicts ----
type Verdict = "unchanged" | "moved" | "changed" | "added" | "removed";
interface Row {
  name: string;
  verdict: Verdict;
  moved?: { dx: number; dy: number };
  size?: { before: string; after: string };
  ownDiffPixels?: number;
  text?: { before: string; after: string };
  style?: Record<string, { before: string; after: string }>;
  crops?: string[];
}

const byName = (list: Component[]) => new Map(list.map((c) => [c.name, c]));
const bMap = byName(before.components);
const aMap = byName(after.components);
const names = [...new Set([...bMap.keys(), ...aMap.keys()])];
const rows: Row[] = [];

for (const name of names) {
  const b = bMap.get(name);
  const a = aMap.get(name);
  if (!b || !a) {
    rows.push({ name, verdict: b ? "removed" : "added" });
    continue;
  }
  const row: Row = { name, verdict: "unchanged" };
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  if (dx || dy) row.moved = { dx, dy };

  const bi = fromBase64(b.rgba, b.width, b.height);
  const ai = fromBase64(a.rgba, a.width, a.height);
  let own = 0;
  let diffImg: Rgba | undefined;
  if (b.width !== a.width || b.height !== a.height) {
    row.size = { before: `${b.width}x${b.height}`, after: `${a.width}x${a.height}` };
    own = -1; // not comparable pixel-for-pixel; size change is itself the change
  } else {
    diffImg = { width: b.width, height: b.height, data: Buffer.alloc(b.width * b.height * 4) };
    own = pixelmatch(bi.data, ai.data, diffImg.data, b.width, b.height, { threshold: 0.1 });
  }

  if (own !== 0) {
    row.verdict = "changed";
    if (own > 0) row.ownDiffPixels = own;
    if (b.text !== a.text) row.text = { before: b.text, after: a.text };
    const style: Record<string, { before: string; after: string }> = {};
    for (const p of STYLE_PROPS) {
      if (b.style[p] !== a.style[p]) style[p] = { before: b.style[p], after: a.style[p] };
    }
    if (Object.keys(style).length > 0) row.style = style;
    const files = [`${name}-before.png`, `${name}-after.png`];
    writePng(path.join(out, "components", files[0]), bi);
    writePng(path.join(out, "components", files[1]), ai);
    if (diffImg) {
      files.push(`${name}-diff.png`);
      writePng(path.join(out, "components", files[2]), diffImg);
    }
    row.crops = files.map((f) => `components/${f}`);
  } else if (row.moved) {
    row.verdict = "moved";
  }
  rows.push(row);
}

// Pixels of the whole-image diff that only exist because something moved.
const movedNames = new Set(rows.filter((r) => r.verdict === "moved").map((r) => r.name));
writePng(
  path.join(out, "components-sheet.png"),
  contactSheet(
    before.components.flatMap((b) => {
      const a = aMap.get(b.name);
      return a ? [fromBase64(b.rgba, b.width, b.height), fromBase64(a.rgba, a.width, a.height)] : [];
    }),
    2,
    8,
  ),
);

const report = { canvas: `${W}x${H}`, wholeDiffPixels: wholeDiff, components: rows };
fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2) + "\n");

// ---- markdown for an AI agent (experiment 06) ----
const md: string[] = [];
md.push(`# Visual diff by component`, ``);
md.push(`Whole-image diff: ${wholeDiff} px (${((wholeDiff / (W * H)) * 100).toFixed(2)}%).`, ``);
md.push(`| component | verdict | moved | own diff px | detail |`, `|---|---|---|---:|---|`);
for (const r of rows) {
  const detail: string[] = [];
  if (r.size) detail.push(`size ${r.size.before} → ${r.size.after}`);
  if (r.text) detail.push(`text "${r.text.before.replace(/\n/g, "⏎")}" → "${r.text.after.replace(/\n/g, "⏎")}"`);
  if (r.style) for (const [p, v] of Object.entries(r.style)) detail.push(`${p} ${v.before} → ${v.after}`);
  md.push(
    `| ${r.name} | ${r.verdict} | ${r.moved ? `${r.moved.dx},${r.moved.dy}` : ""} | ${r.ownDiffPixels ?? (r.size ? "size" : "")} | ${detail.join("; ")} |`,
  );
}
if (movedNames.size > 0) {
  md.push(``, `Moved without changing: ${[...movedNames].join(", ")} — their red in whole-diff.png is a consequence, not a cause.`);
}
const crops = rows.filter((r) => r.crops);
if (crops.length > 0) {
  md.push(``, `## Crops of changed components`, ``);
  for (const r of crops) md.push(`- ${r.name}: ${r.crops!.join(", ")}`);
}
fs.writeFileSync(path.join(out, "report.md"), md.join("\n") + "\n");
process.stdout.write(md.join("\n") + `\n\n→ ${path.relative(process.cwd(), out)}/\n`);
