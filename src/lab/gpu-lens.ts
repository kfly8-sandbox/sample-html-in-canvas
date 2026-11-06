// Demo 3: diff through a colour-vision lens, computed on the GPU.
//
// Both canvases are uploaded as WebGL2 textures. One fragment shader applies
// the colour-vision-deficiency matrix (Machado et al. 2009, severity 1.0, in
// linear RGB), quantises back to 8 bits, and runs pixelmatch's YIQ colour
// delta per pixel. The CPU path does the same arithmetic in JS and calls
// pixelmatch itself, so the two counts can be checked against each other.
import pixelmatch from "pixelmatch";

import { ctx2d, el, mount } from "./hic";

export const W = 320;
export const H = 120;
const THRESHOLD = 0.1;

const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];
export const LENSES: Record<string, number[]> = {
  none: IDENTITY,
  protanopia: [0.152286, 1.052583, -0.204868, 0.114503, 0.786281, 0.099216, -0.003882, -0.048116, 1.051998],
  deuteranopia: [0.367322, 0.860646, -0.227968, 0.280085, 0.672501, 0.047413, -0.01182, 0.04294, 0.968881],
  tritanopia: [1.255528, -0.076749, -0.178779, -0.078411, 0.930809, 0.147602, 0.004733, 0.691367, 0.3039],
};

const VERT = `#version 300 es
in vec2 p;
void main() { gl_Position = vec4(p, 0.0, 1.0); }`;

// mode 0: diff (red = differs, faded after image otherwise)
// mode 1 / 2: the lens applied to before / after
const FRAG = `#version 300 es
precision highp float;
uniform sampler2D uBefore;
uniform sampler2D uAfter;
uniform mat3 uLens;
uniform float uMaxDelta;
uniform int uMode;
out vec4 outColor;

vec3 toLinear(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
vec3 toSrgb(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
// Lens, then back to 8-bit values (0..255) exactly as the CPU path rounds.
vec3 lens(vec3 c) { return floor(clamp(toSrgb(clamp(uLens * toLinear(c), 0.0, 1.0)), 0.0, 1.0) * 255.0 + 0.5); }

float yiq_y(vec3 c) { return dot(c, vec3(0.29889531, 0.58662247, 0.11448223)); }
float yiq_i(vec3 c) { return dot(c, vec3(0.59597799, -0.27417610, -0.32180189)); }
float yiq_q(vec3 c) { return dot(c, vec3(0.21147017, -0.52261711, 0.31114694)); }

void main() {
  ivec2 xy = ivec2(gl_FragCoord.xy);
  vec3 a = lens(texelFetch(uBefore, xy, 0).rgb);
  vec3 b = lens(texelFetch(uAfter, xy, 0).rgb);
  if (uMode == 1) { outColor = vec4(a / 255.0, 1.0); return; }
  if (uMode == 2) { outColor = vec4(b / 255.0, 1.0); return; }
  float dy = yiq_y(a) - yiq_y(b);
  float di = yiq_i(a) - yiq_i(b);
  float dq = yiq_q(a) - yiq_q(b);
  float delta = 0.5053 * dy * dy + 0.299 * di * di + 0.1957 * dq * dq;
  if (delta > uMaxDelta) { outColor = vec4(1.0, 0.0, 0.0, 1.0); return; }
  float g = 1.0 - 0.1 * (1.0 - yiq_y(b) / 255.0);
  outColor = vec4(g, g, g, 1.0);
}`;

export class GpuLens {
  readonly gl: WebGL2RenderingContext;
  readonly renderer: string;
  private prog: WebGLProgram;
  private tex: WebGLTexture[];
  private canvas: HTMLCanvasElement;

  constructor() {
    this.canvas = document.createElement("canvas");
    this.canvas.width = W;
    this.canvas.height = H;
    const gl = this.canvas.getContext("webgl2", { preserveDrawingBuffer: true, antialias: false });
    if (!gl) throw new Error("WebGL2 is not available");
    this.gl = gl;
    const dbg = gl.getExtension("WEBGL_debug_renderer_info");
    this.renderer = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));

    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader");
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? "link");
    this.prog = prog;
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "p");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    this.tex = [0, 1].map((unit) => {
      const t = gl.createTexture()!;
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    });
    gl.uniform1i(gl.getUniformLocation(prog, "uBefore"), 0);
    gl.uniform1i(gl.getUniformLocation(prog, "uAfter"), 1);
    gl.uniform1f(gl.getUniformLocation(prog, "uMaxDelta"), 35215 * THRESHOLD * THRESHOLD);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  }

  /** Upload the two source canvases. Row 0 of the texture is the canvas top. */
  upload(before: TexImageSource, after: TexImageSource): void {
    const gl = this.gl;
    [before, after].forEach((src, unit) => {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, this.tex[unit]);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, src);
    });
  }

  /** Run one pass and read it back (rows come out top-first: see upload). */
  run(lens: number[], mode: 0 | 1 | 2): ImageData {
    const gl = this.gl;
    // mat3 uniforms are column-major; our matrices are written row by row.
    gl.uniformMatrix3fv(gl.getUniformLocation(this.prog, "uLens"), true, new Float32Array(lens));
    gl.uniform1i(gl.getUniformLocation(this.prog, "uMode"), mode);
    gl.viewport(0, 0, W, H);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    const px = new Uint8ClampedArray(W * H * 4);
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return new ImageData(px, W, H);
  }

  diffCount(lens: number[]): { count: number; image: ImageData } {
    const image = this.run(lens, 0);
    let count = 0;
    for (let i = 0; i < image.data.length; i += 4) if (image.data[i] === 255 && image.data[i + 1] === 0) count++;
    return { count, image };
  }
}

// ---- CPU reference: same arithmetic in JS, then pixelmatch itself ----
const toLin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toSrgb = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);
const clamp = (v: number) => Math.min(1, Math.max(0, v));

export function applyLensCpu(img: ImageData, m: number[]): ImageData {
  const out = new ImageData(img.width, img.height);
  for (let i = 0; i < img.data.length; i += 4) {
    const r = toLin(img.data[i] / 255);
    const g = toLin(img.data[i + 1] / 255);
    const b = toLin(img.data[i + 2] / 255);
    for (let k = 0; k < 3; k++) {
      const v = clamp(m[3 * k] * r + m[3 * k + 1] * g + m[3 * k + 2] * b);
      out.data[i + k] = Math.floor(clamp(toSrgb(v)) * 255 + 0.5);
    }
    out.data[i + 3] = 255;
  }
  return out;
}

export function diffCountCpu(before: ImageData, after: ImageData, lens: number[]): number {
  const a = applyLensCpu(before, lens);
  const b = applyLensCpu(after, lens);
  // includeAA: true turns pixelmatch's anti-aliasing detection off, which the shader does not do.
  return pixelmatch(a.data, b.data, undefined, W, H, { threshold: THRESHOLD, includeAA: true });
}

// ---- UI ----
export interface LensCase {
  name: string;
  why: string;
  before: string;
  after: string;
}

async function draw(host: HTMLElement, html: string): Promise<{ canvas: HTMLCanvasElement; img: ImageData }> {
  const { canvas, root } = await mount(host, html, W, H);
  const g = ctx2d(canvas);
  g.clearRect(0, 0, W, H);
  g.drawElementImage!(root, 0, 0);
  const copy = document.createElement("canvas");
  copy.width = W;
  copy.height = H;
  ctx2d(copy).drawImage(canvas, 0, 0);
  return { canvas: copy, img: g.getImageData(0, 0, W, H) };
}

const asCanvas = (img: ImageData) => {
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  ctx2d(c).putImageData(img, 0, 0);
  return c;
};

const time = <T>(f: () => T, n: number): { value: T; ms: number } => {
  let value = f();
  const t = performance.now();
  for (let i = 0; i < n; i++) value = f();
  return { value, ms: (performance.now() - t) / n };
};

export function setupGpuLens(section: HTMLElement, cases: LensCase[]): Promise<void> {
  const host = section.querySelector<HTMLElement>(".hic-host")!;
  const caseSel = section.querySelector<HTMLSelectElement>("select.case")!;
  const lensSel = section.querySelector<HTMLSelectElement>("select.lens")!;
  const runAll = section.querySelector<HTMLButtonElement>("button.run-all")!;
  const out = section.querySelector<HTMLElement>(".output")!;
  const all = section.querySelector<HTMLElement>(".all")!;
  const info = section.querySelector<HTMLElement>(".renderer")!;

  let gpu: GpuLens;
  try {
    gpu = new GpuLens();
  } catch (e) {
    info.textContent = `WebGL2 unavailable: ${(e as Error).message}`;
    return Promise.resolve();
  }
  info.textContent = `WebGL renderer: ${gpu.renderer}`;

  cases.forEach((c, i) => caseSel.append(el("option", { value: String(i), textContent: `${c.name} — ${c.why}` })));
  Object.keys(LENSES).forEach((k) => lensSel.append(el("option", { value: k, textContent: k })));
  lensSel.value = "deuteranopia";

  const show = async () => {
    const c = cases[Number(caseSel.value)];
    const lens = LENSES[lensSel.value];
    const b = await draw(host, c.before);
    const a = await draw(host, c.after);
    gpu.upload(b.canvas, a.canvas);
    const seenBefore = gpu.run(lens, 1);
    const seenAfter = gpu.run(lens, 2);
    const g = time(() => { gpu.upload(b.canvas, a.canvas); return gpu.diffCount(lens); }, 20);
    const cpu = time(() => diffCountCpu(b.img, a.img, lens), 20);
    const raw = gpu.diffCount(LENSES.none).count;
    const pct = raw ? Math.round((g.value.count / raw) * 100) : 0;
    out.replaceChildren(
      el("div", { className: "row" },
        el("figure", {}, el("figcaption", {}, "Before (as drawn)"), asCanvas(b.img)),
        el("figure", {}, el("figcaption", {}, "After (as drawn)"), asCanvas(a.img)),
      ),
      el("div", { className: "row" },
        el("figure", {}, el("figcaption", {}, `Before through ${lensSel.value} (GPU)`), asCanvas(seenBefore)),
        el("figure", {}, el("figcaption", {}, `After through ${lensSel.value} (GPU)`), asCanvas(seenAfter)),
        el("figure", {}, el("figcaption", {}, "Diff (GPU)"), asCanvas(g.value.image)),
      ),
      el("p", { className: "big" },
        `${g.value.count.toLocaleString()} px differ through ${lensSel.value}`,
        lensSel.value === "none" ? "" : ` — ${pct}% of the ${raw.toLocaleString()} px without a lens`,
      ),
      el("p", { className: "mono" },
        `GPU ${g.value.count} px in ${g.ms.toFixed(2)} ms (upload + shader + readback) · ` +
          `CPU ${cpu.value} px in ${cpu.ms.toFixed(2)} ms (JS lens + pixelmatch) · ` +
          (g.value.count === cpu.value ? "counts match" : `counts differ by ${Math.abs(g.value.count - cpu.value)}`),
      ),
    );
  };

  const table = async () => {
    runAll.disabled = true;
    try {
      const lensNames = Object.keys(LENSES);
      const rows: HTMLTableRowElement[] = [];
      let mismatches = 0;
      for (const c of cases) {
        const b = await draw(host, c.before);
        const a = await draw(host, c.after);
        gpu.upload(b.canvas, a.canvas);
        const raw = gpu.diffCount(LENSES.none).count;
        const cells = lensNames.map((k) => {
          const n = gpu.diffCount(LENSES[k]).count;
          if (n !== diffCountCpu(b.img, a.img, LENSES[k])) mismatches++;
          const td = el("td", { className: "num" }, k === "none" ? String(n) : `${n} (${raw ? Math.round((n / raw) * 100) : 0}%)`);
          if (k !== "none" && raw > 0 && n / raw < 0.3) td.classList.add("hot");
          return td;
        });
        rows.push(el("tr", {}, el("td", {}, c.name), ...cells));
      }
      all.replaceChildren(
        el("table", { className: "verdicts" },
          el("thead", {}, el("tr", {}, el("th", {}, "case"), ...lensNames.map((k) => el("th", {}, k)))),
          el("tbody", {}, ...rows),
        ),
        el("p", { className: "mono" }, mismatches === 0 ? "GPU and CPU counts match in every cell." : `GPU and CPU counts differ in ${mismatches} cells.`),
      );
    } finally {
      runAll.disabled = false;
    }
  };

  caseSel.addEventListener("change", show);
  lensSel.addEventListener("change", show);
  runAll.addEventListener("click", table);
  return show().then(table);
}
