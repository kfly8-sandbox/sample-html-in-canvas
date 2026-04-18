// CLI: render two HTML snippets into a flag-enabled Chromium via Playwright,
// then compute a visual diff with pixelmatch + connected-components region
// extraction, and write before.png / after.png / diff.png to disk.
//
// Usage: tsx scripts/diff.ts <before.html> <after.html> [options]

import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

import {
  DEFAULT_TUNING,
  extractDiffRegions,
  type DiffRegion,
} from "../src/diff-core.ts";
import { drawRectOutline, fillRect } from "./draw-rect.ts";

interface CliOptions {
  beforePath: string;
  afterPath: string;
  outDir: string;
  width: number;
  height: number;
  json: boolean;
  channel?: string;
  keepOpen: boolean;
}

function parseCli(): CliOptions {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      before: { type: "string" },
      after: { type: "string" },
      "out-dir": { type: "string", short: "o" },
      width: { type: "string" },
      height: { type: "string" },
      json: { type: "boolean" },
      channel: { type: "string" },
      "keep-open": { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
  });

  if (values.help) {
    printHelp();
    process.exit(0);
  }

  const beforePath = values.before ?? positionals[0];
  const afterPath = values.after ?? positionals[1];
  if (!beforePath || !afterPath) {
    printHelp();
    process.exit(1);
  }

  return {
    beforePath,
    afterPath,
    outDir: values["out-dir"] ?? "./diff-out",
    width: Number(values.width ?? 480),
    height: Number(values.height ?? 320),
    json: Boolean(values.json),
    channel: values.channel,
    keepOpen: Boolean(values["keep-open"]),
  };
}

function printHelp(): void {
  process.stdout.write(`Usage: tsx scripts/diff.ts <before.html> <after.html> [options]

Renders two HTML snippets in a flag-enabled Chromium (drawElementImage
API) and writes a visual diff to the output directory.

Options:
  -o, --out-dir <dir>    Output directory (default: ./diff-out)
      --width <px>       Canvas width (default: 480)
      --height <px>      Canvas height (default: 320)
      --channel <name>   Playwright browser channel (e.g. chrome-canary)
      --json             Emit machine-readable JSON on stdout
      --keep-open        Leave the browser open for debugging
  -h, --help             Show this help
`);
}

interface RenderedBuffers {
  supported: boolean;
  beforeBase64: string;
  afterBase64: string;
}

async function renderInBrowser(
  beforeHtml: string,
  afterHtml: string,
  opts: CliOptions,
): Promise<RenderedBuffers> {
  const browser = await chromium.launch({
    headless: !opts.keepOpen,
    channel: opts.channel,
    args: [
      "--enable-blink-features=CanvasDrawElement",
      "--enable-features=CanvasDrawElement",
    ],
  });
  try {
    const context = await browser.newContext({
      viewport: {
        width: Math.max(opts.width + 40, 800),
        height: Math.max(opts.height * 2 + 80, 600),
      },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();

    await page.setContent(
      `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
  body { margin: 0; padding: 0; background: #fff; font-family: system-ui; }
  canvas { display: block; background: #fff; }
</style></head><body>
  <canvas id="before" width="${opts.width}" height="${opts.height}" layoutsubtree></canvas>
  <canvas id="after"  width="${opts.width}" height="${opts.height}" layoutsubtree></canvas>
</body></html>`,
    );

    const runtimePath = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "browser-render.js",
    );
    await page.addScriptTag({ path: runtimePath });

    // The heavy lifting lives in browser-render.js; the callback here is
    // tiny so tsx/esbuild has nothing to wrap with __name.
    const result = (await page.evaluate(
      ([b, a]: [string, string]) =>
        (window as unknown as {
          __htmlInCanvasRender: (
            b: string,
            a: string,
          ) => Promise<RenderedBuffers>;
        }).__htmlInCanvasRender(b, a),
      [beforeHtml, afterHtml] as [string, string],
    )) as RenderedBuffers;

    if (opts.keepOpen) {
      await new Promise<void>((resolve) => {
        process.stderr.write(
          "[--keep-open] browser left open. Ctrl-C to close.\n",
        );
        process.on("SIGINT", () => resolve());
      });
    }

    return result;
  } finally {
    if (!opts.keepOpen) await browser.close();
  }
}

function writePng(filepath: string, rgba: Uint8Array, w: number, h: number): void {
  const png = new PNG({ width: w, height: h });
  rgba.length === png.data.length
    ? (png.data = Buffer.from(rgba))
    : Buffer.from(rgba).copy(png.data);
  fs.writeFileSync(filepath, PNG.sync.write(png));
}

async function main(): Promise<void> {
  const opts = parseCli();

  if (!Number.isFinite(opts.width) || !Number.isFinite(opts.height)) {
    throw new Error("--width and --height must be integers");
  }

  const beforeHtml = fs.readFileSync(opts.beforePath, "utf8");
  const afterHtml = fs.readFileSync(opts.afterPath, "utf8");

  const rendered = await renderInBrowser(beforeHtml, afterHtml, opts);
  if (!rendered.supported) {
    process.stderr.write(
      "drawElementImage is not available in this Chromium.\n" +
        "  - Playwright's bundled Chromium may predate 147.\n" +
        "  - Try: npx playwright install chromium, or --channel chrome-canary.\n",
    );
    process.exit(2);
  }

  const { width, height } = opts;
  const beforeBuf = Buffer.from(rendered.beforeBase64, "base64");
  const afterBuf = Buffer.from(rendered.afterBase64, "base64");

  if (beforeBuf.length !== width * height * 4) {
    throw new Error(
      `unexpected before buffer size: got ${beforeBuf.length}, expected ${width * height * 4}`,
    );
  }

  // Matches the browser Diff Canvas:
  //   1. pixelmatch with alpha=0.3 — non-diff pixels become semi-transparent
  //      copies of the Before image, diff pixels are opaque red.
  //   2. The page CSS paints the canvas on a #000 background, so the
  //      semi-transparent pixels appear dark on screen. We replicate that
  //      by flattening the RGBA buffer onto black for the PNG.
  //   3. Region overlay (tinted fill + outline) drawn on top.
  const diffBuf = Buffer.alloc(beforeBuf.length);
  const diffPixels = pixelmatch(beforeBuf, afterBuf, diffBuf, width, height, {
    threshold: DEFAULT_TUNING.threshold,
    includeAA: false,
    alpha: 0.3,
  });

  const regions = extractDiffRegions(diffBuf, width, height, DEFAULT_TUNING);

  flattenOntoBlack(diffBuf);
  paintRegionOverlay(
    diffBuf,
    width,
    height,
    regions,
    DEFAULT_TUNING.regionPadding,
  );

  fs.mkdirSync(opts.outDir, { recursive: true });
  const beforeOut = path.join(opts.outDir, "before.png");
  const afterOut = path.join(opts.outDir, "after.png");
  const diffOut = path.join(opts.outDir, "diff.png");
  writePng(beforeOut, beforeBuf, width, height);
  writePng(afterOut, afterBuf, width, height);
  writePng(diffOut, diffBuf, width, height);

  const totalPixels = width * height;
  const ratio = totalPixels === 0 ? 0 : diffPixels / totalPixels;
  const summary = {
    width,
    height,
    before: path.resolve(beforeOut),
    after: path.resolve(afterOut),
    diff: path.resolve(diffOut),
    diffPixels,
    totalPixels,
    ratio,
    regions,
  };

  if (opts.json) {
    process.stdout.write(JSON.stringify(summary, null, 2) + "\n");
  } else {
    process.stdout.write(
      `before → ${summary.before}\n` +
        `after  → ${summary.after}\n` +
        `diff   → ${summary.diff}\n` +
        `diff pixels: ${diffPixels.toLocaleString()} / ${totalPixels.toLocaleString()} (${(ratio * 100).toFixed(2)}%)\n` +
        `regions: ${regions.length}\n`,
    );
  }
}

function paintRegionOverlay(
  data: Buffer,
  width: number,
  height: number,
  regions: DiffRegion[],
  padding: number,
): void {
  for (const r of regions) {
    const x = Math.max(0, r.x - padding);
    const y = Math.max(0, r.y - padding);
    const w = Math.min(width - x, r.width + padding * 2);
    const h = Math.min(height - y, r.height + padding * 2);
    // Light tint on top of the spliced-in After content, then a crisp outline.
    fillRect(data, width, height, x, y, w, h, [255, 64, 96, 18]);
    drawRectOutline(data, width, height, x, y, w, h, [255, 64, 96, 240]);
  }
}

// Pre-multiplies each RGBA pixel by its alpha against a black background
// and sets alpha to 255. Mirrors how the browser renders the Diff Canvas
// on top of its `background: #000` CSS.
function flattenOntoBlack(data: Buffer): void {
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3] / 255;
    data[i] = Math.round(data[i] * a);
    data[i + 1] = Math.round(data[i + 1] * a);
    data[i + 2] = Math.round(data[i + 2] * a);
    data[i + 3] = 255;
  }
}

const isEntrypoint =
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? "");

if (isEntrypoint) {
  main().catch((err) => {
    process.stderr.write(`${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
    process.exit(1);
  });
}
