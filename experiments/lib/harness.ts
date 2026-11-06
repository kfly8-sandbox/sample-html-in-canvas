// Node-side helpers shared by the experiments: launch a Chromium that ships
// HTML in Canvas, inject the runtime, and read/write RGBA buffers as PNG.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium, type Browser, type Page } from "playwright";
import { PNG } from "pngjs";

const here = path.dirname(fileURLToPath(import.meta.url));

export interface Rgba {
  width: number;
  height: number;
  data: Buffer;
}

/**
 * Launch Chrome stable by default (HTML in Canvas shipped in 157).
 * Override with HIC_CHANNEL=chromium / chrome-canary.
 */
export async function launch(): Promise<Browser> {
  const channel = process.env.HIC_CHANNEL ?? "chrome";
  return chromium.launch({ channel: channel === "chromium" ? undefined : channel });
}

export async function openPage(
  browser: Browser,
  viewport = { width: 1280, height: 800 },
): Promise<Page> {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.on("pageerror", (e) => process.stderr.write(`[pageerror] ${e.message}\n`));
  await page.setContent(
    `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:#fff;font-family:system-ui}canvas{display:block}</style><body></body>`,
  );
  await page.addScriptTag({ path: path.join(here, "runtime.js") });
  const ok = await page.evaluate(
    () => typeof (document.createElement("canvas").getContext("2d") as any).drawElementImage === "function",
  );
  if (!ok) throw new Error("drawElementImage is not available in this browser (need Chrome 157+)");
  return page;
}

export function fromBase64(b64: string, width: number, height: number): Rgba {
  const data = Buffer.from(b64, "base64");
  if (data.length !== width * height * 4) {
    throw new Error(`buffer is ${data.length} bytes, expected ${width * height * 4}`);
  }
  return { width, height, data };
}

export function writePng(file: string, img: Rgba): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const png = new PNG({ width: img.width, height: img.height });
  img.data.copy(png.data);
  fs.writeFileSync(file, PNG.sync.write(png));
}

/** Lay images out in a grid on white, with `gap` px between cells. */
export function contactSheet(images: Rgba[], columns: number, gap = 4): Rgba {
  const cw = Math.max(...images.map((i) => i.width));
  const ch = Math.max(...images.map((i) => i.height));
  const rows = Math.ceil(images.length / columns);
  const width = columns * cw + (columns + 1) * gap;
  const height = rows * ch + (rows + 1) * gap;
  const data = Buffer.alloc(width * height * 4, 255);
  images.forEach((img, n) => {
    const ox = gap + (n % columns) * (cw + gap);
    const oy = gap + Math.floor(n / columns) * (ch + gap);
    for (let y = 0; y < img.height; y++) {
      for (let x = 0; x < img.width; x++) {
        const s = (y * img.width + x) * 4;
        const d = ((oy + y) * width + ox + x) * 4;
        // Flatten transparency onto white so empty canvas reads as paper.
        const a = img.data[s + 3] / 255;
        data[d] = Math.round(img.data[s] * a + 255 * (1 - a));
        data[d + 1] = Math.round(img.data[s + 1] * a + 255 * (1 - a));
        data[d + 2] = Math.round(img.data[s + 2] * a + 255 * (1 - a));
        data[d + 3] = 255;
      }
    }
  });
  return { width, height, data };
}

export function outDir(experiment: string): string {
  return path.join(here, "..", "out", experiment);
}

export function readFixture(experiment: string, name: string): string {
  return fs.readFileSync(path.join(here, "..", experiment, name), "utf8");
}
