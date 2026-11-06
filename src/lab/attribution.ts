// Demo 1: attribute a visual diff to the component that caused it.
// Same method as experiments/02-attribution: each [data-vrt] element is drawn
// alone, so it is judged on its own pixels and on its position separately.
import pixelmatch from "pixelmatch";

import { ctx2d, el, imageToCanvas, layoutOffset, mount } from "./hic";

const W = 480;
const H = 360;
const STYLE_PROPS = ["color", "background-color", "font-size", "font-weight", "height", "width"];

interface Captured {
  whole: ImageData;
  components: Map<string, { x: number; y: number; img: ImageData; text: string; style: Record<string, string> }>;
}

async function capture(host: HTMLElement, html: string): Promise<Captured> {
  const { canvas, root, content } = await mount(host, html, W, H);
  const els = [...content.querySelectorAll<HTMLElement>("[data-vrt]")];
  els.forEach((e) => e.setAttribute("drawable", ""));
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const meta = els.map((e) => {
    const cs = getComputedStyle(e);
    const style: Record<string, string> = {};
    for (const p of STYLE_PROPS) style[p] = cs.getPropertyValue(p);
    return { e, name: e.dataset.vrt!, ...layoutOffset(e, root), w: e.offsetWidth, h: e.offsetHeight, text: e.innerText, style };
  });
  const g = ctx2d(canvas);
  g.clearRect(0, 0, W, H);
  g.drawElementImage!(root, 0, 0);
  for (const m of meta) g.drawElementImage!(m.e, m.x, m.y);
  const whole = g.getImageData(0, 0, W, H);
  const components: Captured["components"] = new Map();
  for (const m of meta) {
    g.clearRect(0, 0, W, H);
    g.drawElementImage!(m.e, 0, 0);
    components.set(m.name, {
      x: m.x,
      y: m.y,
      img: g.getImageData(0, 0, Math.max(1, m.w), Math.max(1, m.h)),
      text: m.text,
      style: m.style,
    });
  }
  return { whole, components };
}

export function setupAttribution(section: HTMLElement, beforeHtml: string, afterHtml: string): Promise<void> {
  const before = section.querySelector<HTMLTextAreaElement>("textarea.before")!;
  const after = section.querySelector<HTMLTextAreaElement>("textarea.after")!;
  const run = section.querySelector<HTMLButtonElement>("button.run")!;
  const host = section.querySelector<HTMLElement>(".hic-host")!;
  const out = section.querySelector<HTMLElement>(".output")!;
  before.value = beforeHtml.trim();
  after.value = afterHtml.trim();

  const go = async () => {
    run.disabled = true;
    try {
      const b = await capture(host, before.value);
      const a = await capture(host, after.value);
      const diff = new ImageData(W, H);
      const wholeDiff = pixelmatch(b.whole.data, a.whole.data, diff.data, W, H, { threshold: 0.1 });

      const rows: HTMLTableRowElement[] = [];
      const crops: HTMLElement[] = [];
      for (const name of new Set([...b.components.keys(), ...a.components.keys()])) {
        const cb = b.components.get(name);
        const ca = a.components.get(name);
        let verdict = "unchanged";
        let moved = "";
        let own = "";
        const detail: string[] = [];
        if (!cb || !ca) {
          verdict = cb ? "removed" : "added";
        } else {
          const dx = ca.x - cb.x;
          const dy = ca.y - cb.y;
          if (dx || dy) moved = `${dx}, ${dy}`;
          let changed = false;
          if (cb.img.width !== ca.img.width || cb.img.height !== ca.img.height) {
            changed = true;
            own = "size";
            detail.push(`size ${cb.img.width}×${cb.img.height} → ${ca.img.width}×${ca.img.height}`);
          } else {
            const d = new ImageData(cb.img.width, cb.img.height);
            const n = pixelmatch(cb.img.data, ca.img.data, d.data, cb.img.width, cb.img.height, { threshold: 0.1 });
            if (n > 0) {
              changed = true;
              own = String(n);
            }
          }
          if (changed) {
            verdict = "changed";
            if (cb.text !== ca.text) detail.push(`text “${cb.text.replace(/\n/g, "⏎")}” → “${ca.text.replace(/\n/g, "⏎")}”`);
            for (const p of STYLE_PROPS) if (cb.style[p] !== ca.style[p]) detail.push(`${p}: ${cb.style[p]} → ${ca.style[p]}`);
            crops.push(el("figure", { className: "crop" }, el("figcaption", {}, name), imageToCanvas(cb.img), el("span", { className: "arrow" }, "→"), imageToCanvas(ca.img)));
          } else if (moved) {
            verdict = "moved";
          }
        }
        const tr = el("tr", { className: `v-${verdict}` });
        for (const cell of [name, verdict, moved, own, detail.join("; ")]) tr.append(el("td", {}, cell));
        rows.push(tr);
      }

      const table = el("table", { className: "verdicts" }, el("thead", {}, el("tr", {}, ...["component", "verdict", "moved", "own diff px", "detail"].map((h) => el("th", {}, h)))), el("tbody", {}, ...rows));
      out.replaceChildren(
        el("div", { className: "row" },
          el("figure", {}, el("figcaption", {}, "After"), imageToCanvas(a.whole, 0.75)),
          el("figure", {}, el("figcaption", {}, `Whole-image diff: ${wholeDiff.toLocaleString()} px`), imageToCanvas(diff, 0.75)),
        ),
        el("h3", {}, "By component"),
        table,
        el("div", { className: "crops" }, ...crops),
      );
    } finally {
      run.disabled = false;
    }
  };
  run.addEventListener("click", go);
  return go();
}
