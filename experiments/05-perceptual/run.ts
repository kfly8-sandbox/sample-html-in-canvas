// Experiment 05: diff after a perceptual transform.
//
// Each before/after pair is drawn once with drawElementImage, then redrawn
// through canvas filters (GPU in Chrome): blur ("squint"), grayscale, and
// colour-vision-deficiency simulation. pixelmatch runs on every filtered
// pair. The question: how far does the diff move under each lens?
//   - a change that vanishes under a CVD filter is carried by colour alone
//   - a change that vanishes under blur is sub-pixel noise, not layout
//
// Usage: npm run exp:05
import fs from "node:fs";
import path from "node:path";

import pixelmatch from "pixelmatch";

import { contactSheet, fromBase64, launch, openPage, outDir, writePng, type Rgba } from "../lib/harness.ts";

const W = 320;
const H = 120;
const FILTERS = ["none", "blur(1px)", "blur(2px)", "grayscale(1)", "cvd-protanopia", "cvd-deuteranopia", "cvd-tritanopia"];

const base = (body: string) =>
  `<div style="padding:16px;font:15px/1.4 system-ui;color:#222">${body}</div>`;
const badge = (bg: string, label = "Status") =>
  `<span style="display:inline-block;padding:6px 14px;border-radius:999px;background:${bg};color:#fff;font-weight:600">${label}</span>`;
const para = `The quick brown fox jumps over the lazy dog.`;

const CASES: { name: string; why: string; before: string; after: string }[] = [
  {
    name: "red→green badge",
    why: "state shown by hue alone (error → ok)",
    before: base(badge("#d32f2f")),
    after: base(badge("#388e3c")),
  },
  {
    name: "blue→purple badge",
    why: "hue change on the blue–yellow axis",
    before: base(badge("#1e88e5")),
    after: base(badge("#8e24aa")),
  },
  {
    name: "red→green + icon",
    why: "same hue change, but the label changes too",
    before: base(badge("#d32f2f", "✕ Failed")),
    after: base(badge("#388e3c", "✓ Passed")),
  },
  {
    name: "text #333→#777",
    why: "contrast loss, no hue",
    before: base(`<p style="margin:0;color:#333">${para}</p>`),
    after: base(`<p style="margin:0;color:#777">${para}</p>`),
  },
  {
    name: "letter-spacing +0.05px",
    why: "sub-pixel rendering change nobody can see",
    before: base(`<p style="margin:0">${para}</p>`),
    after: base(`<p style="margin:0;letter-spacing:0.05px">${para}</p>`),
  },
  {
    name: "text 1px down",
    why: "a real but tiny layout shift",
    before: base(`<p style="margin:0">${para}</p>`),
    after: base(`<p style="margin:1px 0 0">${para}</p>`),
  },
  {
    name: "box 12px right",
    why: "a clear layout change",
    before: base(`<div style="width:120px;height:40px;background:#334155;border-radius:6px"></div>`),
    after: base(`<div style="width:120px;height:40px;background:#334155;border-radius:6px;margin-left:12px"></div>`),
  },
];

const out = outDir("05-perceptual");
const browser = await launch();
type Rendered = Record<string, string>;
const rendered: { before: Rendered; after: Rendered }[] = [];
try {
  const page = await openPage(browser);
  const render = (html: string) =>
    page.evaluate(
      ([h, w, ht, f]) => (window as any).__hic.renderFiltered(h, w, ht, f),
      [html, W, H, FILTERS] as const,
    ) as Promise<Rendered>;
  for (const c of CASES) rendered.push({ before: await render(c.before), after: await render(c.after) });
} finally {
  await browser.close();
}

const table: Record<string, Record<string, number>> = {};
const sheetImgs: Rgba[] = [];
CASES.forEach((c, ci) => {
  table[c.name] = {};
  for (const f of FILTERS) {
    const b = fromBase64(rendered[ci].before[f], W, H);
    const a = fromBase64(rendered[ci].after[f], W, H);
    const d: Rgba = { width: W, height: H, data: Buffer.alloc(W * H * 4) };
    table[c.name][f] = pixelmatch(b.data, a.data, d.data, W, H, { threshold: 0.1 });
    if (ci < 3 && (f === "none" || f === "cvd-deuteranopia")) sheetImgs.push(b, a);
  }
});
// Rows: red→green, blue→purple, red→green+icon; columns: before/after as seen, before/after deuteranopia.
writePng(path.join(out, "cvd-sheet.png"), contactSheet(sheetImgs, 4, 6));

const short = (f: string) => f.replace("cvd-", "").replace("grayscale(1)", "gray");
const lines = [
  `# Diff under perceptual filters (${W}x${H}, pixelmatch threshold 0.1)`,
  ``,
  `Differing pixels per filter; (n%) is relative to the unfiltered diff.`,
  ``,
  `| case | why | ${FILTERS.map(short).join(" | ")} |`,
  `|---|---|${FILTERS.map(() => "---:").join("|")}|`,
  ...CASES.map((c) => {
    const raw = table[c.name].none;
    const cells = FILTERS.map((f) => {
      const v = table[c.name][f];
      return f === "none" || raw === 0 ? `${v}` : `${v} (${Math.round((v / raw) * 100)}%)`;
    });
    return `| ${c.name} | ${c.why} | ${cells.join(" | ")} |`;
  }),
];
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, "summary.md"), lines.join("\n") + "\n");
fs.writeFileSync(path.join(out, "summary.json"), JSON.stringify(table, null, 2) + "\n");
process.stdout.write(lines.join("\n") + `\n\n→ ${path.relative(process.cwd(), out)}/\n`);
