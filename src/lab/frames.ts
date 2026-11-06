// Demo 2: stop-motion capture of CSS animations.
// Same method as experiments/04-frames: pause, seek, wait one rendering frame,
// draw. Drawing right after the seek returns the last painted state, and a
// draw inside a requestAnimationFrame callback shows the previous frame.
import { ctx2d, el, mount, raf } from "./hic";

const W = 480;
const H = 220;
const FPS = 60;
const COUNT = FPS + 1;

function bezier(x1: number, y1: number, x2: number, y2: number) {
  const b = (t: number, a: number, c: number) => 3 * a * t * (1 - t) ** 2 + 3 * c * t * t * (1 - t) + t ** 3;
  return (x: number) => {
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 40; i++) {
      const m = (lo + hi) / 2;
      if (b(m, x1, x2) < x) lo = m;
      else hi = m;
    }
    return b((lo + hi) / 2, y1, y2);
  };
}
const easeOut = bezier(0, 0, 0.58, 1);
const expectedSlideX = (ms: number) => 40 + 300 * easeOut(Math.min(1, Math.max(0, ms / 1000))) - 0.5;

/** Centre x of the green slide square on row 30, read from the pixels. */
function slideX(img: ImageData): number {
  let sum = 0;
  let n = 0;
  for (let x = 0; x < img.width; x++) {
    const i = (30 * img.width + x) * 4;
    if (img.data[i + 1] > 150 && img.data[i] < 100 && img.data[i + 2] < 100 && img.data[i + 3] > 200) {
      sum += x;
      n++;
    }
  }
  return n ? sum / n : NaN;
}

type Mode = "seek" | "seek-now" | "realtime";

async function capture(host: HTMLElement, html: string, mode: Mode) {
  const { canvas, root, content } = await mount(host, html, W, H);
  const g = ctx2d(canvas);
  const grab = () => {
    g.clearRect(0, 0, W, H);
    g.drawElementImage!(root, 0, 0);
    return g.getImageData(0, 0, W, H);
  };
  const anims = content.getAnimations();
  const shots: { ms: number; img: ImageData }[] = [];
  if (mode === "realtime") {
    anims.forEach((a) => { a.cancel(); a.play(); });
    for (let i = 0; i < COUNT; i++) {
      await raf();
      shots.push({ ms: Number(anims[0]?.currentTime ?? 0), img: grab() });
    }
  } else {
    anims.forEach((a) => a.pause());
    for (let i = 0; i < COUNT; i++) {
      const ms = (i * 1000) / FPS;
      anims.forEach((a) => (a.currentTime = ms));
      if (mode === "seek") await raf();
      shots.push({ ms, img: grab() });
    }
  }
  return shots;
}

function chart(series: { name: string; cls: string; pts: [number, number][] }[]): SVGSVGElement {
  const NS = "http://www.w3.org/2000/svg";
  const w = 480;
  const h = 200;
  const pad = 30;
  const sx = (ms: number) => pad + (ms / 1000) * (w - pad - 10);
  const sy = (x: number) => h - pad - ((x - 30) / 320) * (h - pad - 10);
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  svg.classList.add("chart");
  const add = (tag: string, attrs: Record<string, string | number>, text?: string) => {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
    if (text) e.textContent = text;
    svg.appendChild(e);
    return e;
  };
  add("line", { x1: pad, y1: h - pad, x2: w - 10, y2: h - pad, class: "axis" });
  add("line", { x1: pad, y1: 10, x2: pad, y2: h - pad, class: "axis" });
  add("text", { x: w - 10, y: h - 8, "text-anchor": "end", class: "label" }, "time (ms) →");
  add("text", { x: pad + 4, y: 20, class: "label" }, "slide x (px)");
  const curve: string[] = [];
  for (let ms = 0; ms <= 1000; ms += 10) curve.push(`${sx(ms)},${sy(expectedSlideX(ms))}`);
  add("polyline", { points: curve.join(" "), class: "expected" });
  for (const s of series) for (const [ms, x] of s.pts) if (Number.isFinite(x)) add("circle", { cx: sx(ms), cy: sy(x), r: 2.4, class: s.cls });
  return svg;
}

export function setupFrames(section: HTMLElement, animHtml: string): Promise<void> {
  const host = section.querySelector<HTMLElement>(".hic-host")!;
  const run = section.querySelector<HTMLButtonElement>("button.run")!;
  const out = section.querySelector<HTMLElement>(".output")!;

  const go = async () => {
    run.disabled = true;
    try {
      const seek = await capture(host, animHtml, "seek");
      const now = await capture(host, animHtml, "seek-now");
      const realtime = await capture(host, animHtml, "realtime");

      const err = (shots: typeof seek) => {
        const e = shots.map((s) => Math.abs(slideX(s.img) - expectedSlideX(s.ms))).sort((a, b) => a - b);
        return `median ${e[e.length >> 1].toFixed(1)}px, max ${e[e.length - 1].toFixed(1)}px`;
      };
      const distinct = (shots: typeof seek) => new Set(shots.map((s) => slideX(s.img).toFixed(1))).size;

      // Scrubber over the seek capture.
      const view = document.createElement("canvas");
      view.width = W;
      view.height = H;
      const vg = ctx2d(view);
      const label = el("span", { className: "mono" });
      const slider = el("input", { type: "range", min: "0", max: String(COUNT - 1), value: "0" });
      const show = (i: number) => {
        vg.putImageData(seek[i].img, 0, 0);
        label.textContent = `frame ${i} · ${seek[i].ms.toFixed(1)}ms · slide x ${slideX(seek[i].img).toFixed(1)}px (expected ${expectedSlideX(seek[i].ms).toFixed(1)})`;
      };
      slider.addEventListener("input", () => show(Number(slider.value)));
      show(0);

      let playing = 0;
      const play = el("button", { type: "button", textContent: "▶ play captured frames" });
      play.addEventListener("click", async () => {
        const token = ++playing;
        for (let i = 0; i < COUNT && token === playing; i++) {
          slider.value = String(i);
          show(i);
          await raf();
        }
      });

      const strip = document.createElement("canvas");
      const step = 6;
      const n = Math.ceil(COUNT / step);
      const sw = W / 4;
      const sh = H / 4;
      strip.width = n * (sw + 4);
      strip.height = sh;
      const sg = ctx2d(strip);
      const tmp = document.createElement("canvas");
      tmp.width = W;
      tmp.height = H;
      for (let k = 0; k < n; k++) {
        ctx2d(tmp).putImageData(seek[k * step].img, 0, 0);
        sg.drawImage(tmp, k * (sw + 4), 0, sw, sh);
      }

      out.replaceChildren(
        el("div", { className: "row" }, el("figure", {}, view, el("div", { className: "controls" }, slider, play), label)),
        el("h3", {}, "Film strip (every 100ms)"),
        el("div", { className: "scroll" }, strip),
        el("h3", {}, "Measured from pixels vs the ease-out curve"),
        chart([
          { name: "realtime", cls: "pt-realtime", pts: realtime.map((s) => [s.ms, slideX(s.img)]) },
          { name: "seek", cls: "pt-seek", pts: seek.map((s) => [s.ms, slideX(s.img)]) },
        ]),
        el("table", { className: "verdicts" },
          el("thead", {}, el("tr", {}, ...["mode", "distinct positions", "slide-x error", ""].map((h) => el("th", {}, h)))),
          el("tbody", {},
            el("tr", {}, el("td", {}, el("span", { className: "dot pt-seek" }), "seek + wait 1 frame"), el("td", {}, String(distinct(seek))), el("td", {}, err(seek)), el("td", {}, "exact")),
            el("tr", {}, el("td", {}, "seek, draw at once"), el("td", {}, String(distinct(now))), el("td", {}, err(now)), el("td", {}, "draws the last painted state")),
            el("tr", {}, el("td", {}, el("span", { className: "dot pt-realtime" }), "draw inside rAF"), el("td", {}, String(distinct(realtime))), el("td", {}, err(realtime)), el("td", {}, "one frame behind")),
          ),
        ),
      );
    } finally {
      run.disabled = false;
    }
  };
  run.addEventListener("click", go);
  return go();
}
