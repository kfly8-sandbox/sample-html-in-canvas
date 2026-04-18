import pixelmatch from "pixelmatch";
import {
  DEFAULT_TUNING,
  extractDiffRegions,
  type DiffRegion,
  type DiffTuning,
} from "./diff-core";

export type { DiffRegion } from "./diff-core";

export interface DiffResult {
  diffPixels: number;
  totalPixels: number;
  ratio: number;
  regions: DiffRegion[];
}

export type DiffOptions = Partial<DiffTuning>;

export function diffCanvases(
  before: HTMLCanvasElement,
  after: HTMLCanvasElement,
  diff: HTMLCanvasElement,
  options: DiffOptions = {},
): DiffResult {
  const tuning: DiffTuning = { ...DEFAULT_TUNING, ...options };
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
    { threshold: tuning.threshold, includeAA: false, alpha: 0.3 },
  );

  diffCtx.putImageData(diffImg, 0, 0);

  const regions = extractDiffRegions(diffImg.data, width, height, tuning);

  drawRegionOverlay(diffCtx, regions, tuning.regionPadding, width, height);

  const totalPixels = width * height;
  return {
    diffPixels,
    totalPixels,
    ratio: totalPixels === 0 ? 0 : diffPixels / totalPixels,
    regions,
  };
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
