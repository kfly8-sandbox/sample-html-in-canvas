# HTML in Canvas Diff PoC

A minimal PoC that uses the experimental
[HTML in Canvas](https://github.com/WICG/html-in-canvas) API
(`ctx.drawElementImage()` + `layoutsubtree`) to render two HTML snippets onto
canvases and compute a pixel-level visual diff with
[`pixelmatch`](https://github.com/mapbox/pixelmatch) — all inside the browser,
without any PNG encode/decode round-trip.

**Live demo:** <https://kfly8-sandbox.github.io/sample-html-in-canvas/>
(Chrome Canary / Brave, with `chrome://flags/#canvas-draw-element`
enabled — see Requirements below.)

## Requirements

- Chrome Canary or Brave Stable (Chromium 147+)
- Enable the flag `chrome://flags/#canvas-draw-element`
  (Brave: `brave://flags/#canvas-draw-element`) and restart the browser.
- Node.js 20+

## Setup

```sh
npm install
npm run dev
```

Open <http://localhost:5173> in the flag-enabled browser.

## Headless CLI

A CLI wrapper (`scripts/diff.ts`) renders two HTML snippet files in a
flag-enabled Chromium via Playwright and writes `before.png`, `after.png`
and `diff.png` (with bounding-box overlays) to disk. Intended as a
feedback loop for AI agents that edit UI components.

First, install Playwright's bundled Chromium:

```sh
npx playwright install chromium
```

Then run against two HTML snippet files:

```sh
npm run diff -- examples/before.html examples/after.html -o ./diff-out
```

Options:

- `-o, --out-dir <dir>` — output directory (default: `./diff-out`)
- `--width <px>` / `--height <px>` — canvas size (default: 480 × 320)
- `--channel <name>` — use a specific Chromium channel (e.g. `chrome-canary`)
  if Playwright's bundled Chromium doesn't have the feature
- `--json` — emit machine-readable JSON on stdout (useful for agents)
- `--keep-open` — leave the browser window open for debugging

Example JSON output (truncated):

```json
{
  "diffPixels": 2670,
  "totalPixels": 153600,
  "ratio": 0.0173828125,
  "regions": [
    { "x": 13, "y": 91, "width": 92, "height": 40, "pixels": 3651 }
  ]
}
```

## How it works

1. Two `<canvas layoutsubtree>` elements host the "Before" and "After" HTML
   subtrees as real DOM children (so they participate in layout/hit-testing
   but are not rendered directly to the page).
2. On **Render & Diff**, each canvas's child root receives the user-supplied
   HTML via `innerHTML`, and the browser fires a `paint` event. Inside the
   handler we call `ctx.drawElementImage(root, 0, 0)` to rasterise the subtree
   onto the canvas bitmap.
3. `getImageData()` pulls the raw RGBA pixels out of both canvases.
4. `pixelmatch` compares the buffers and writes a diff image to a third
   canvas, reporting the number of differing pixels.

See `src/render.ts` and `src/diff.ts`.

## Demo

<img width="638" height="882" alt="image" src="https://github.com/user-attachments/assets/f5412773-17c9-43d7-b484-f163f6ca5d8b" />

## Known limitations

- The API is unshipped. The exact shape of `drawElementImage` / `paint`
  may change.
- Cross-origin resources (e.g. remote images, cross-origin `<iframe>`) are
  not drawn.
- Anti-aliasing can cause false-positive diffs; `pixelmatch` is called with
  `includeAA: false` to mitigate.
