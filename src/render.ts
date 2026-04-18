// Renders an HTML string onto a <canvas layoutsubtree> using the experimental
// `ctx.drawElementImage()` API.
//
// Why we don't use the `paint` event here:
//   The `paint` event is designed as a long-lived handler ("re-rasterise
//   whenever the subtree changes"). Treating it as a one-shot "await next
//   paint" signal is fragile — it only fires when the subtree actually
//   changes, and in Chromium 147/148 combining it with `innerHTML` re-assign
//   on an element that was already drawn leaves dangling internal refs,
//   which can crash the tab on the 2nd render. Instead we recreate the
//   subtree from scratch and wait two animation frames before drawing.

export class DrawElementUnsupportedError extends Error {
  constructor() {
    super(
      "ctx.drawElementImage is not available. Enable " +
        "chrome://flags/#canvas-draw-element and use Chromium 147+.",
    );
    this.name = "DrawElementUnsupportedError";
  }
}

export function isDrawElementSupported(): boolean {
  const probe = document.createElement("canvas").getContext("2d");
  return typeof probe?.drawElementImage === "function";
}

export interface RenderTarget {
  canvas: HTMLCanvasElement;
  // Updated in place on each render so callers keep referring to the live
  // subtree root without needing to re-query the DOM.
  root: HTMLElement;
}

export async function renderHtmlToCanvas(
  target: RenderTarget,
  html: string,
): Promise<void> {
  const { canvas } = target;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Failed to acquire 2D context");
  if (typeof ctx.drawElementImage !== "function") {
    throw new DrawElementUnsupportedError();
  }

  // Always build a fresh root element. Reusing the old root (even via
  // innerHTML re-assign) can leave stale references inside the experimental
  // drawElementImage implementation.
  const freshRoot = document.createElement("div");
  freshRoot.innerHTML = html;
  canvas.replaceChildren(freshRoot);
  target.root = freshRoot;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Two frames: first commits layout for the newly inserted subtree, second
  // makes sure paint has happened before we rasterise.
  await nextFrame();
  await nextFrame();

  ctx.drawElementImage(freshRoot, 0, 0);
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}
