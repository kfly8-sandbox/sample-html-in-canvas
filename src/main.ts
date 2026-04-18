import {
  DrawElementUnsupportedError,
  isDrawElementSupported,
  renderHtmlToCanvas,
  type RenderTarget,
} from "./render";
import { diffCanvases } from "./diff";

const SAMPLE_BEFORE = `<div style="padding: 16px; font-family: system-ui; color: #333;">
  <h2 style="margin: 0 0 8px;">Welcome</h2>
  <p>This is the before version.</p>
  <button style="padding: 8px 16px;">Click me</button>
</div>`;

const SAMPLE_AFTER = `<div style="padding: 16px; font-family: system-ui; color: #333;">
  <h2 style="margin: 0 0 8px;">Welcome!</h2>
  <p>This is the after version.</p>
  <button style="padding: 8px 16px; background: #0070f3; color: white; border: none; border-radius: 4px;">Click me</button>
</div>`;

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as T;
}

const beforeTextarea = byId<HTMLTextAreaElement>("before-html");
const afterTextarea = byId<HTMLTextAreaElement>("after-html");
const beforeCanvas = byId<HTMLCanvasElement>("before-canvas");
const afterCanvas = byId<HTMLCanvasElement>("after-canvas");
const diffCanvas = byId<HTMLCanvasElement>("diff-canvas");
const beforeRoot = byId<HTMLElement>("before-root");
const afterRoot = byId<HTMLElement>("after-root");
const renderBtn = byId<HTMLButtonElement>("render-btn");
const status = byId<HTMLSpanElement>("status");
const supportBanner = byId<HTMLDivElement>("support-banner");
const diffStats = byId<HTMLParagraphElement>("diff-stats");

beforeTextarea.value = SAMPLE_BEFORE;
afterTextarea.value = SAMPLE_AFTER;

if (!isDrawElementSupported()) {
  supportBanner.textContent =
    "ctx.drawElementImage is not available in this browser. Open this page " +
    "in Chrome Canary or Brave (Chromium 147+) with " +
    "chrome://flags/#canvas-draw-element enabled.";
  supportBanner.classList.remove("hidden");
  supportBanner.classList.add("error");
  renderBtn.disabled = true;
}

const beforeTarget: RenderTarget = {
  canvas: beforeCanvas,
  root: beforeRoot,
};
const afterTarget: RenderTarget = { canvas: afterCanvas, root: afterRoot };

renderBtn.addEventListener("click", () => {
  void runDiff();
});

async function runDiff(): Promise<void> {
  renderBtn.disabled = true;
  setStatus("Rendering…");
  try {
    await Promise.all([
      renderHtmlToCanvas(beforeTarget, beforeTextarea.value),
      renderHtmlToCanvas(afterTarget, afterTextarea.value),
    ]);

    const result = diffCanvases(beforeCanvas, afterCanvas, diffCanvas);
    const pct = (result.ratio * 100).toFixed(2);
    const regionSummary =
      result.regions.length === 0
        ? "no regions"
        : `${result.regions.length} region${result.regions.length === 1 ? "" : "s"}`;
    diffStats.textContent =
      `Diff pixels: ${result.diffPixels.toLocaleString()} / ${result.totalPixels.toLocaleString()} (${pct}%) · ` +
      regionSummary;
    setStatus("Done.");
  } catch (err) {
    const message =
      err instanceof DrawElementUnsupportedError
        ? err.message
        : err instanceof Error
          ? err.message
          : String(err);
    setStatus(message, true);
  } finally {
    renderBtn.disabled = false;
  }
}

function setStatus(text: string, isError = false): void {
  status.textContent = text;
  status.classList.toggle("error", isError);
}
