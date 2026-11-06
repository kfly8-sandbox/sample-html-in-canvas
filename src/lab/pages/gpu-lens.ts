// Entry for gpu-lens.html.
import { setupGpuLens, type LensCase } from "../gpu-lens";
import { guard } from "../hic";

const base = (body: string) => `<div style="padding:16px;font:15px/1.4 system-ui;color:#222">${body}</div>`;
const badge = (bg: string, label = "Status") =>
  `<span style="display:inline-block;padding:6px 14px;border-radius:999px;background:${bg};color:#fff;font-weight:600">${label}</span>`;
const para = "The quick brown fox jumps over the lazy dog.";

// Same pairs as experiments/05-perceptual.
const CASES: LensCase[] = [
  { name: "red→green badge", why: "state shown by hue alone", before: base(badge("#d32f2f")), after: base(badge("#388e3c")) },
  { name: "blue→purple badge", why: "hue change on the blue–yellow axis", before: base(badge("#1e88e5")), after: base(badge("#8e24aa")) },
  { name: "red→green + label", why: "same hue change, label changes too", before: base(badge("#d32f2f", "✕ Failed")), after: base(badge("#388e3c", "✓ Passed")) },
  { name: "text #333→#777", why: "contrast loss, no hue", before: base(`<p style="margin:0;color:#333">${para}</p>`), after: base(`<p style="margin:0;color:#777">${para}</p>`) },
  { name: "box 12px right", why: "a layout change", before: base(`<div style="width:120px;height:40px;background:#334155;border-radius:6px"></div>`), after: base(`<div style="width:120px;height:40px;background:#334155;border-radius:6px;margin-left:12px"></div>`) },
];

if (guard()) void setupGpuLens(document.getElementById("demo")!, CASES);
