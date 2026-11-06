// Experiment 04: stop-motion capture of CSS animations with drawElementImage.
//
// Three ways to get the frames of anim.html (four animations of 1s):
//   realtime     draw on each requestAnimationFrame, as the page plays
//   seek         pause the animations, set currentTime, draw at once
//   seek+frame   same, but wait one rendering frame after seeking
// and, for contrast, page.screenshot after seeking (the usual way).
//
// Every frame is measured from its pixels (position, opacity, width, angle)
// and compared with what the CSS timing function says it should be at that
// instant, so "did we capture the frame we think we captured" is a number.
//
// Usage: npm run exp:04
import fs from "node:fs";
import path from "node:path";

import { contactSheet, fromBase64, launch, openPage, outDir, readFixture, writePng, type Rgba } from "../lib/harness.ts";

const W = 480;
const H = 220;
const FPS = 60;
const COUNT = FPS + 1; // 0..1000ms inclusive
const instants = Array.from({ length: COUNT }, (_, i) => (i * 1000) / FPS);
const html = readFixture("04-frames", "anim.html");
const out = outDir("04-frames");

interface Frame {
  atMs: number;
  animMs: number | null;
  rgba: string;
}

// ---- capture ----
const browser = await launch();
const runs: Record<string, { frames: Frame[]; drawMsPerFrame: number; wallMs: number }> = {};
let screenshotMsPerFrame = 0;
let screenshotFrames: Rgba[] = [];
try {
  const page = await openPage(browser, { width: W, height: H });
  const cap = async (name: string, opts: object) => {
    const t = Date.now();
    const r = (await page.evaluate(
      ([h, w, ht, o]) => (window as any).__hic.captureFrames(h, w, ht, o),
      [html, W, H, opts] as const,
    )) as { frames: Frame[]; drawMsPerFrame: number };
    runs[name] = { ...r, wallMs: Date.now() - t };
  };
  await cap("realtime", { mode: "realtime", count: COUNT });
  await cap("seek", { mode: "seek", instants, waitFrame: false });
  await cap("seek+frame", { mode: "seek", instants, waitFrame: true });

  // The usual way: the page itself, paused and seeked, then page.screenshot.
  const shotPage = await (await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 })).newPage();
  await shotPage.setContent(
    `<!doctype html><style>html,body{margin:0;background:#fff}</style><div style="position:relative;width:${W}px;height:${H}px;overflow:hidden">${html}</div>`,
  );
  await shotPage.evaluate(() => document.getAnimations().forEach((a) => a.pause()));
  const { PNG } = await import("pngjs");
  const t = Date.now();
  for (const at of instants) {
    await shotPage.evaluate((ms) => document.getAnimations().forEach((a) => (a.currentTime = ms)), at);
    const png = PNG.sync.read(await shotPage.screenshot({ clip: { x: 0, y: 0, width: W, height: H } }));
    screenshotFrames.push({ width: W, height: H, data: png.data });
  }
  screenshotMsPerFrame = (Date.now() - t) / instants.length;
} finally {
  await browser.close();
}

// ---- measurement from pixels ----
function bezier(x1: number, y1: number, x2: number, y2: number) {
  const b = (t: number, a: number, c: number) => 3 * a * t * (1 - t) ** 2 + 3 * c * t * t * (1 - t) + t ** 3;
  return (x: number) => {
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 50; i++) {
      const mid = (lo + hi) / 2;
      if (b(mid, x1, x2) < x) lo = mid;
      else hi = mid;
    }
    return b((lo + hi) / 2, y1, y2);
  };
}
const easeOut = bezier(0, 0, 0.58, 1);
const easeInOut = bezier(0.42, 0, 0.58, 1);

// Flatten onto white so a half-transparent pixel reads as it is shown.
function px(img: Rgba, x: number, y: number): [number, number, number] {
  const i = (y * img.width + x) * 4;
  const a = img.data[i + 3] / 255;
  return [0, 1, 2].map((c) => img.data[i + c] * a + 255 * (1 - a)) as [number, number, number];
}

function measure(img: Rgba) {
  // slide: green square's centre x on row 30
  let sx = 0;
  let sn = 0;
  for (let x = 0; x < W; x++) {
    const [r, g, b] = px(img, x, 30);
    if (g > 150 && r < 100 && b < 100) { sx += x; sn++; }
  }
  // fade: shown opacity of the blue square at its centre
  const [fr] = px(img, 40, 80);
  // grow: orange run length on row 130
  let gw = 0;
  for (let x = 0; x < W; x++) {
    const [r, g, b] = px(img, x, 130);
    if (r > 200 && g > 100 && g < 180 && b < 60) gw++;
  }
  // spin: principal axis of the red bar's pixels, in degrees [0, 180)
  let n = 0, mx = 0, my = 0;
  const pts: [number, number][] = [];
  for (let y = 140; y < H; y++) for (let x = 360; x < W; x++) {
    const [r, g, b] = px(img, x, y);
    if (r > 200 && g < 80 && b < 80) { pts.push([x, y]); mx += x; my += y; n++; }
  }
  mx /= n; my /= n;
  let sxx = 0, syy = 0, sxy = 0;
  for (const [x, y] of pts) { sxx += (x - mx) ** 2; syy += (y - my) ** 2; sxy += (x - mx) * (y - my); }
  const angle = ((((0.5 * Math.atan2(2 * sxy, sxx - syy)) * 180) / Math.PI) + 180) % 180;
  return { slideX: sn ? sx / sn : NaN, fadeOpacity: 1 - fr / 255, growW: gw, spinDeg: angle };
}

function expected(ms: number) {
  const t = Math.min(1, Math.max(0, ms / 1000));
  return {
    slideX: 20 + 20 + 300 * easeOut(t) - 0.5, // left + half width + travel; pixel centres are x+0.5
    fadeOpacity: 1 - t,
    growW: 20 + 280 * easeInOut(t),
    spinDeg: ((ms / 1000) * 360) % 180,
  };
}

const angleErr = (a: number, b: number) => { const d = Math.abs(a - b) % 180; return Math.min(d, 180 - d); };
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

interface Summary { mode: string; frames: number; distinct: number; wallMsPerFrame: number; captureMsPerFrame: number; slide: string; fade: string; grow: string; spin: string }
const summaries: Summary[] = [];
const csv: string[] = ["mode,frame,ms,slideX,slideX_exp,opacity,opacity_exp,growW,growW_exp,spinDeg,spinDeg_exp"];

function evaluate(mode: string, imgs: Rgba[], times: number[], wallMsPerFrame: number, captureMsPerFrame: number) {
  const err = { slide: [] as number[], fade: [] as number[], grow: [] as number[], spin: [] as number[] };
  imgs.forEach((img, i) => {
    const m = measure(img);
    const e = expected(times[i]);
    err.slide.push(Math.abs(m.slideX - e.slideX));
    err.fade.push(Math.abs(m.fadeOpacity - e.fadeOpacity));
    err.grow.push(Math.abs(m.growW - e.growW));
    err.spin.push(angleErr(m.spinDeg, e.spinDeg));
    csv.push([mode, i, times[i].toFixed(2), m.slideX.toFixed(1), e.slideX.toFixed(1), m.fadeOpacity.toFixed(3), e.fadeOpacity.toFixed(3), m.growW, e.growW.toFixed(1), m.spinDeg.toFixed(1), e.spinDeg.toFixed(1)].join(","));
  });
  const distinct = new Set(imgs.map((i) => i.data.toString("base64"))).size;
  const f = (xs: number[], unit: string, d = 1) => `${median(xs).toFixed(d)} / ${Math.max(...xs).toFixed(d)}${unit}`;
  summaries.push({
    mode, frames: imgs.length, distinct,
    wallMsPerFrame, captureMsPerFrame,
    slide: f(err.slide, "px"), fade: f(err.fade, "", 3), grow: f(err.grow, "px"), spin: f(err.spin, "°"),
  });
}

for (const [mode, r] of Object.entries(runs)) {
  const imgs = r.frames.map((f) => fromBase64(f.rgba, W, H));
  // Judge each frame against the animation's own clock at draw time.
  const times = r.frames.map((f) => f.animMs ?? f.atMs);
  evaluate(mode, imgs, times, r.wallMs / r.frames.length, r.drawMsPerFrame);
  if (mode === "seek+frame") {
    writePng(path.join(out, "sheet.png"), contactSheet(imgs.filter((_, i) => i % 6 === 0), 3, 6));
  }
}
evaluate("page.screenshot", screenshotFrames, instants, screenshotMsPerFrame, screenshotMsPerFrame);

// Realtime: how evenly spaced were the frames we actually got?
const rt = runs.realtime.frames;
const gaps = rt.slice(1).map((f, i) => f.atMs - rt[i].atMs);

fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, "track.csv"), csv.join("\n") + "\n");
fs.writeFileSync(path.join(out, "summary.json"), JSON.stringify({ summaries, realtimeGapsMs: gaps }, null, 2) + "\n");

const lines = [
  `# Stop-motion capture (${COUNT} frames, 0..1000ms)`,
  ``,
  `Error is measured-from-pixels vs the CSS timing function at the frame's instant: median / max.`,
  ``,
  `| mode | frames | distinct | wall ms/frame | draw+read ms/frame | slide x | fade opacity | grow width | spin angle |`,
  `|---|---:|---:|---:|---:|---|---|---|---|`,
  ...summaries.map((s) => `| ${s.mode} | ${s.frames} | ${s.distinct} | ${s.wallMsPerFrame.toFixed(1)} | ${s.captureMsPerFrame.toFixed(2)} | ${s.slide} | ${s.fade} | ${s.grow} | ${s.spin} |`),
  ``,
  `realtime frame gaps: min ${Math.min(...gaps).toFixed(1)}ms, max ${Math.max(...gaps).toFixed(1)}ms, median ${median(gaps).toFixed(1)}ms`,
];
process.stdout.write(lines.join("\n") + `\n\n→ ${path.relative(process.cwd(), out)}/\n`);
fs.writeFileSync(path.join(out, "summary.md"), lines.join("\n") + "\n");
