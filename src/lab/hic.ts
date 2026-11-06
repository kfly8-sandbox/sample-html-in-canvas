// Shared HTML-in-Canvas helpers for the experiments page.
//
// Shipped API (Chrome 157): the canvas needs `layoutsubtree content="drawable"`
// and every element passed to drawElementImage needs `drawable`. A drawable
// descendant is not painted when its ancestor is drawn; each is its own layer.
// (The Playwright experiments in experiments/lib/runtime.js do the same in
// plain JS, because they are injected into a page rather than bundled.)

export const raf = (): Promise<number> => new Promise((r) => requestAnimationFrame(r));

export async function frames(n: number): Promise<void> {
  for (let i = 0; i < n; i++) await raf();
}

export function isSupported(): boolean {
  const g = document.createElement("canvas").getContext("2d");
  return typeof g?.drawElementImage === "function";
}

/** Show the unsupported-browser banner (#support-banner) and return false, or return true. */
export function guard(): boolean {
  if (isSupported()) return true;
  const banner = document.getElementById("support-banner");
  if (banner) {
    banner.textContent =
      "ctx.drawElementImage is not available in this browser. Use Chrome 157+ (or Chromium 147+ with chrome://flags/#canvas-draw-element).";
    banner.classList.remove("hidden");
    banner.classList.add("error");
  }
  return false;
}

/**
 * A drawable canvas holding `html` in a drawable root of the given size.
 *
 * The canvas subtree is ordinary DOM, so the page's own CSS applies to it
 * (this page's `.lab button` rule recoloured the fixture's button and hid a
 * real change). The HTML therefore goes into the root's shadow root, which
 * page selectors cannot reach; inherited properties are reset on the root.
 * Drawable elements inside the shadow root can still be drawn on their own.
 */
export async function mount(
  host: HTMLElement,
  html: string,
  width: number,
  height: number,
): Promise<{ canvas: HTMLCanvasElement; root: HTMLElement; content: ShadowRoot }> {
  let canvas = host.querySelector<HTMLCanvasElement>("canvas.hic-src");
  if (!canvas) {
    canvas = document.createElement("canvas");
    canvas.className = "hic-src";
    canvas.setAttribute("layoutsubtree", "");
    canvas.setAttribute("content", "drawable");
    host.appendChild(canvas);
  }
  canvas.width = width;
  canvas.height = height;
  // drawElementImage scales by bitmap size / CSS size: a 480px bitmap shown
  // at 240px CSS draws everything at 2x. Pin the CSS size to the bitmap.
  canvas.style.cssText = `display:block;width:${width}px;height:${height}px;max-width:none`;
  const root = document.createElement("div");
  root.setAttribute("drawable", "");
  // Same starting point as the Playwright harness: a blank page in system-ui.
  root.style.cssText = `width:${width}px;height:${height}px;background:#fff;color:#000;font:16px/normal system-ui;position:relative;overflow:hidden;text-align:left;letter-spacing:normal`;
  const content = root.attachShadow({ mode: "open" });
  content.innerHTML = html;
  canvas.replaceChildren(root);
  await frames(2);
  return { canvas, root, content };
}

export function ctx2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const g = canvas.getContext("2d", { willReadFrequently: true });
  if (!g) throw new Error("2d context unavailable");
  return g;
}

/** Position relative to `root` from layout. A drawable element's
 *  getBoundingClientRect is where it was last drawn, not where layout put it. */
export function layoutOffset(el: HTMLElement, root: HTMLElement): { x: number; y: number } {
  let x = 0;
  let y = 0;
  for (let n: HTMLElement | null = el; n && n !== root; n = n.offsetParent as HTMLElement | null) {
    x += n.offsetLeft;
    y += n.offsetTop;
  }
  return { x, y };
}

export function imageToCanvas(img: ImageData, scale = 1): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  ctx2d(c).putImageData(img, 0, 0);
  c.style.width = `${img.width * scale}px`;
  return c;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...children);
  return e;
}
