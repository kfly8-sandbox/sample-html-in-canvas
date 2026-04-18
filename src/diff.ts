import pixelmatch from "pixelmatch";

export interface DiffRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  pixels: number;
}

export interface DiffResult {
  diffPixels: number;
  totalPixels: number;
  ratio: number;
  regions: DiffRegion[];
}

export interface DiffOptions {
  // Passed to pixelmatch; higher = more permissive.
  threshold?: number;
  // Dilation radius (in px) applied to the diff mask before region
  // extraction. Merges nearby differing pixels into a single region.
  dilationRadius?: number;
  // Regions smaller than this pixel count are discarded as noise.
  minRegionPixels?: number;
  // Regions whose shorter bounding-box side is below this (px) are
  // discarded — filters out thin slivers from e.g. 2-4px border-radius
  // corner differences.
  minRegionSide?: number;
  // Outward padding applied to each bounding box when drawn.
  regionPadding?: number;
}

const DEFAULTS: Required<DiffOptions> = {
  threshold: 0.3,
  dilationRadius: 3,
  minRegionPixels: 60,
  minRegionSide: 8,
  regionPadding: 3,
};

export function diffCanvases(
  before: HTMLCanvasElement,
  after: HTMLCanvasElement,
  diff: HTMLCanvasElement,
  options: DiffOptions = {},
): DiffResult {
  const opts = { ...DEFAULTS, ...options };
  const width = before.width;
  const height = before.height;

  if (after.width !== width || after.height !== height) {
    throw new Error("before/after canvases must have identical dimensions");
  }
  diff.width = width;
  diff.height = height;

  const beforeCtx = before.getContext("2d");
  const afterCtx = after.getContext("2d");
  const diffCtx = diff.getContext("2d");
  if (!beforeCtx || !afterCtx || !diffCtx) {
    throw new Error("Failed to acquire 2D context for diff");
  }

  const beforeImg = beforeCtx.getImageData(0, 0, width, height);
  const afterImg = afterCtx.getImageData(0, 0, width, height);
  const diffImg = diffCtx.createImageData(width, height);

  const diffPixels = pixelmatch(
    beforeImg.data,
    afterImg.data,
    diffImg.data,
    width,
    height,
    { threshold: opts.threshold, includeAA: false, alpha: 0.3 },
  );

  diffCtx.putImageData(diffImg, 0, 0);

  const mask = buildDiffMask(diffImg.data, width, height);
  const dilated =
    opts.dilationRadius > 0
      ? dilate(mask, width, height, opts.dilationRadius)
      : mask;
  const regions = extractRegions(
    dilated,
    width,
    height,
    opts.minRegionPixels,
    opts.minRegionSide,
  );

  drawRegionOverlay(diffCtx, regions, opts.regionPadding, width, height);

  const totalPixels = width * height;
  return {
    diffPixels,
    totalPixels,
    ratio: totalPixels === 0 ? 0 : diffPixels / totalPixels,
    regions,
  };
}

// pixelmatch paints differing pixels with a red tint. We treat any pixel
// whose red channel dominates the green channel as "changed".
function buildDiffMask(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): Uint8Array {
  const mask = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    if (r > 150 && r - g > 50 && r - b > 50) mask[p] = 1;
  }
  return mask;
}

// Square-kernel dilation using two passes (horizontal then vertical).
function dilate(
  mask: Uint8Array,
  width: number,
  height: number,
  radius: number,
): Uint8Array {
  const horizontal = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      let hit = 0;
      const xMin = Math.max(0, x - radius);
      const xMax = Math.min(width - 1, x + radius);
      for (let xx = xMin; xx <= xMax; xx++) {
        if (mask[row + xx]) {
          hit = 1;
          break;
        }
      }
      horizontal[row + x] = hit;
    }
  }
  const out = new Uint8Array(mask.length);
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      let hit = 0;
      const yMin = Math.max(0, y - radius);
      const yMax = Math.min(height - 1, y + radius);
      for (let yy = yMin; yy <= yMax; yy++) {
        if (horizontal[yy * width + x]) {
          hit = 1;
          break;
        }
      }
      out[y * width + x] = hit;
    }
  }
  return out;
}

// Iterative flood-fill over a 4-connected mask. Returns bounding boxes of
// regions larger than `minPixels`.
function extractRegions(
  mask: Uint8Array,
  width: number,
  height: number,
  minPixels: number,
  minSide: number,
): DiffRegion[] {
  const visited = new Uint8Array(mask.length);
  const regions: DiffRegion[] = [];
  const stack: number[] = [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const seed = y * width + x;
      if (!mask[seed] || visited[seed]) continue;

      let minX = x;
      let maxX = x;
      let minY = y;
      let maxY = y;
      let count = 0;

      stack.push(seed);
      visited[seed] = 1;

      while (stack.length > 0) {
        const idx = stack.pop()!;
        const py = (idx / width) | 0;
        const px = idx - py * width;
        count++;
        if (px < minX) minX = px;
        if (px > maxX) maxX = px;
        if (py < minY) minY = py;
        if (py > maxY) maxY = py;

        if (px > 0) {
          const n = idx - 1;
          if (mask[n] && !visited[n]) {
            visited[n] = 1;
            stack.push(n);
          }
        }
        if (px < width - 1) {
          const n = idx + 1;
          if (mask[n] && !visited[n]) {
            visited[n] = 1;
            stack.push(n);
          }
        }
        if (py > 0) {
          const n = idx - width;
          if (mask[n] && !visited[n]) {
            visited[n] = 1;
            stack.push(n);
          }
        }
        if (py < height - 1) {
          const n = idx + width;
          if (mask[n] && !visited[n]) {
            visited[n] = 1;
            stack.push(n);
          }
        }
      }

      const bw = maxX - minX + 1;
      const bh = maxY - minY + 1;
      if (count >= minPixels && Math.min(bw, bh) >= minSide) {
        regions.push({
          x: minX,
          y: minY,
          width: bw,
          height: bh,
          pixels: count,
        });
      }
    }
  }

  regions.sort((a, b) => b.pixels - a.pixels);
  return regions;
}

function drawRegionOverlay(
  ctx: CanvasRenderingContext2D,
  regions: DiffRegion[],
  padding: number,
  width: number,
  height: number,
): void {
  if (regions.length === 0) return;
  ctx.save();
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(255, 64, 96, 0.95)";
  ctx.fillStyle = "rgba(255, 64, 96, 0.1)";
  for (const r of regions) {
    const x = Math.max(0, r.x - padding);
    const y = Math.max(0, r.y - padding);
    const w = Math.min(width - x, r.width + padding * 2);
    const h = Math.min(height - y, r.height + padding * 2);
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  }
  ctx.restore();
}
