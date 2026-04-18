// Canvas-agnostic building blocks for visual diffing. Both the browser
// (src/diff.ts) and the Playwright-driven CLI (scripts/diff.ts) depend on
// these so the two paths stay consistent.

export interface DiffRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  pixels: number;
}

export interface DiffTuning {
  threshold: number;
  dilationRadius: number;
  minRegionPixels: number;
  minRegionSide: number;
  regionPadding: number;
}

export const DEFAULT_TUNING: DiffTuning = {
  threshold: 0.3,
  dilationRadius: 3,
  minRegionPixels: 60,
  minRegionSide: 8,
  regionPadding: 3,
};

// pixelmatch paints differing pixels with a red tint; treat any pixel whose
// red channel clearly dominates as "changed".
export function buildDiffMask(
  data: Uint8ClampedArray | Uint8Array,
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

// Square-kernel dilation. Two passes (horizontal then vertical) so it runs
// in O(n * radius) rather than O(n * radius^2).
export function dilate(
  mask: Uint8Array,
  width: number,
  height: number,
  radius: number,
): Uint8Array {
  const horizontal = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const xMin = Math.max(0, x - radius);
      const xMax = Math.min(width - 1, x + radius);
      let hit = 0;
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
      const yMin = Math.max(0, y - radius);
      const yMax = Math.min(height - 1, y + radius);
      let hit = 0;
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

// Iterative 4-connected flood-fill that returns bounding boxes filtered by
// total pixel count and shortest side.
export function extractRegions(
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

// Compute regions in a single call. Returned diffPixels is the raw
// pixelmatch count — callers pass it in from their own pixelmatch run.
export function extractDiffRegions(
  diffData: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  tuning: DiffTuning = DEFAULT_TUNING,
): DiffRegion[] {
  const mask = buildDiffMask(diffData, width, height);
  const processed =
    tuning.dilationRadius > 0
      ? dilate(mask, width, height, tuning.dilationRadius)
      : mask;
  return extractRegions(
    processed,
    width,
    height,
    tuning.minRegionPixels,
    tuning.minRegionSide,
  );
}
