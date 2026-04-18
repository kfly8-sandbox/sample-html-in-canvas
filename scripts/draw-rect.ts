// Draws a 1px rectangle outline directly onto an RGBA buffer. The CLI runs
// entirely in Node and has no canvas2d context, so we rasterise bounding
// boxes by hand.

export type RGBA = readonly [number, number, number, number];

export function drawRectOutline(
  data: Uint8Array | Uint8ClampedArray | Buffer,
  width: number,
  height: number,
  x: number,
  y: number,
  w: number,
  h: number,
  color: RGBA,
): void {
  const x0 = Math.max(0, x);
  const y0 = Math.max(0, y);
  const x1 = Math.min(width - 1, x + w - 1);
  const y1 = Math.min(height - 1, y + h - 1);
  if (x1 < x0 || y1 < y0) return;

  for (let px = x0; px <= x1; px++) {
    setPixel(data, width, px, y0, color);
    setPixel(data, width, px, y1, color);
  }
  for (let py = y0; py <= y1; py++) {
    setPixel(data, width, x0, py, color);
    setPixel(data, width, x1, py, color);
  }
}

export function fillRect(
  data: Uint8Array | Uint8ClampedArray | Buffer,
  width: number,
  height: number,
  x: number,
  y: number,
  w: number,
  h: number,
  color: RGBA,
): void {
  const x0 = Math.max(0, x);
  const y0 = Math.max(0, y);
  const x1 = Math.min(width - 1, x + w - 1);
  const y1 = Math.min(height - 1, y + h - 1);
  const [r, g, b, a] = color;
  const alpha = a / 255;
  for (let py = y0; py <= y1; py++) {
    for (let px = x0; px <= x1; px++) {
      const i = (py * width + px) * 4;
      // Source-over blend.
      const invA = 1 - alpha;
      data[i] = Math.round(r * alpha + data[i] * invA);
      data[i + 1] = Math.round(g * alpha + data[i + 1] * invA);
      data[i + 2] = Math.round(b * alpha + data[i + 2] * invA);
      data[i + 3] = Math.max(data[i + 3], a);
    }
  }
}

function setPixel(
  data: Uint8Array | Uint8ClampedArray | Buffer,
  width: number,
  x: number,
  y: number,
  color: RGBA,
): void {
  const i = (y * width + x) * 4;
  data[i] = color[0];
  data[i + 1] = color[1];
  data[i + 2] = color[2];
  data[i + 3] = color[3];
}
