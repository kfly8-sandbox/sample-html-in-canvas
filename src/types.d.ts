// Minimal ambient typings for the experimental HTML-in-Canvas API
// (https://github.com/WICG/html-in-canvas). These are not part of the
// standard lib.dom typings yet, so we declare only what we call from user
// code and keep it loose enough to work on both Chromium 147+ and older
// browsers (where calls degrade to `undefined`).

interface CanvasDrawElementTransform extends DOMMatrix {}

interface CanvasRenderingContext2D {
  drawElementImage?(
    element: Element,
    dx: number,
    dy: number,
    dwidth?: number,
    dheight?: number,
  ): CanvasDrawElementTransform;
}

interface PaintEvent extends Event {
  readonly changedElements: ReadonlyArray<Element>;
}

interface HTMLCanvasElementEventMap {
  paint: PaintEvent;
}

interface HTMLCanvasElement {
  requestPaint?(): void;
}
