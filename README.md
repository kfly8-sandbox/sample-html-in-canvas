# HTML in Canvas Diff PoC

A minimal PoC that uses the experimental
[HTML in Canvas](https://github.com/WICG/html-in-canvas) API
(`ctx.drawElementImage()` + `layoutsubtree`) to render two HTML snippets onto
canvases and compute a pixel-level visual diff with
[`pixelmatch`](https://github.com/mapbox/pixelmatch) — all inside the browser,
without any PNG encode/decode round-trip.

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
