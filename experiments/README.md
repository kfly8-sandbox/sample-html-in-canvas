# Experiments: what HTML in Canvas could do for VRT

Thought experiments turned into measurements, on Chrome 157 stable
(HTML in Canvas shipped, no flag) via Playwright, DPR 1. Run on 2026-11-06.

```sh
npm run exp        # all three; outputs land in experiments/out/ (gitignored)
npm run exp:02     # or one at a time
HIC_CHANNEL=chrome-canary npm run exp:04   # another browser channel
```

## What the shipped API looks like

Found while building these; the WICG explainer's earlier shape no longer works.

- The canvas needs `content="drawable"` (not just `layoutsubtree`), and every
  element passed to `drawElementImage` needs the `drawable` attribute.
  Without them it throws.
- **A `drawable` descendant is left out when an ancestor is drawn.** Each
  drawable element is its own layer, drawn separately.
- **A drawable element's `getBoundingClientRect()` is where it was last drawn**
  (the canvas origin before the first draw), not where layout put it. Use
  `offsetLeft` / `offsetTop` for the layout position.
- `drawElementImage(el, x, y)` returns `undefined`. The canvas also has
  `captureElementImage(el)` (returns an `ElementImage`, synchronously),
  `getElementTransform`, `getElementImageDefaultSize`, `requestPaint` and an
  `onpaint` handler.
- Pixels match `page.screenshot` byte for byte: 13 cases (text, 11px text,
  shadow, gradient, rotate, opacity, blur, sub-pixel position, emoji, form
  controls, SVG…) had 0 differing pixels.
- Media queries are evaluated against the page viewport, not the canvas size.
- **The drawing is scaled by bitmap size / CSS size.** A 480px-wide canvas
  shown at 240px CSS draws an element at x = 100 at bitmap x = 200, twice as
  wide. A global `canvas { width: 100% }` rule made the stop-motion error jump
  from 0.4px to 79px on a 390px-wide phone. Pin the canvas CSS size to its
  bitmap.
- **The page's CSS applies to the canvas subtree** — it is ordinary DOM. On
  the lab page, its `.lab button` rule recoloured the fixture's button and
  hid a real change. Putting the HTML in the drawable root's shadow root
  isolates it (even page `!important` rules stop applying), and drawable
  elements inside the shadow root can still be drawn on their own.
- **The canvas must be painted to be drawn from.** Pushed off-screen to the
  left (`left: -10000px`), `drawElementImage` returns a fully transparent
  picture *with no error*. `visibility: hidden` throws "No cached paint
  record for element". Below the fold, `opacity: 0`, `z-index: -1`,
  `clip-path: inset(50%)` and a 1px clipping box all draw correctly.

## Live demo

`npm run dev`, then <http://localhost:5173/>: an index page linking one page
per experiment — `attribution.html` (02), `frames.html` (04) and
`gpu-lens.html` (a GPU version of 05) — plus the original `diff.html`. All run
in the browser tab, no Playwright.

The GPU lens uploads both drawings to WebGL2 as textures; one fragment shader
applies the CVD matrix in linear RGB, quantises back to 8 bits, and computes
pixelmatch's YIQ colour delta per pixel. The same arithmetic in JS followed by
pixelmatch itself (`includeAA: true`, since the shader does no anti-aliasing
detection) gives the same count in every case × lens cell. In headless Chrome
on an M2 Pro the renderer is `ANGLE Metal Renderer: Apple M2 Pro`, a real GPU;
at 320x120, upload + shader + readback took ~1.1 ms against ~5 ms on the CPU.
(The counts differ from 05's table because AA detection is off and the page
context differs; the ratios tell the same story.)

The CLI experiment 05 used canvas 2D `ctx.filter` and Node's pixelmatch, which
is not a demonstrated GPU path.

## 02 — Attribute a diff to the component that caused it

`02-attribution/run.ts`. Every `[data-vrt]` element is marked `drawable` and
drawn alone, so it is judged on its own pixels and its position separately.
Because drawable descendants are left out of their ancestor's layer, a nested
component's change does not leak into its parent.

The fixture changes three things: the heading text, a second line in the
notice (which pushes everything below down 21px), and the button colour.

| component | verdict | moved | own diff px | detail |
|---|---|---|---:|---|
| header | changed |  | 287 | text "Welcome" → "Welcome back" |
| notice | changed |  | size | size 448x37 → 448x58; text gained a line; height 21px → 42px |
| card | moved | 0,21 |  |  |
| price | moved | 0,21 |  |  |
| buy | changed | 0,21 | 2430 | background-color rgb(37, 99, 235) → rgb(22, 163, 74) |
| footer | moved | 0,21 |  |  |

The whole-image diff paints 8162 px (4.72%) red, everything below the notice.
Per component, the three causes are named and the three consequences are
"moved 0,21" with their own pixels unchanged.

## 04 — Stop-motion capture of animations

`04-frames/run.ts`. Four 1s CSS animations (a compositor `transform` slide
with `ease-out`, an opacity fade, a layout `width` animation with
`ease-in-out`, a spinning bar). 61 frames over 0..1000ms. Each frame is
measured from its pixels and compared with what the timing function says at
that instant (median / max error).

The table is one run; numbers moved little across 3 runs except where noted.

| mode | distinct frames | wall ms/frame | draw+read ms/frame | slide x | fade opacity | grow width | spin angle |
|---|---:|---:|---:|---|---|---|---|
| realtime (draw in rAF) | 61 | 23.0 | 0.50 | 5.4 / 8.4px | 0.017 / 0.019 | 4.8 / 8.2px | 6.0 / 6.1° |
| seek, draw at once | **1** | 7.1 | 0.15 | 205 / 300px | 0.5 / 1.0 | 140 / 280px | 42 / 90° |
| seek, wait 1 frame, draw | 61 | 22.2 | 0.41 | **0.1 / 0.4px** | 0.001 / 0.002 | 0.3 / 0.5px | 0.0 / 0.1° |
| page.screenshot after seek | 60 | 33.3 | 33.3 | 0.1 / **8.5px** | 0.002 / 0.020 | 0.3 / 0.5px | 0.1 / 6.0° |

- Drawing right after setting `currentTime` gives the same picture every
  time: `drawElementImage` draws the last *painted* state. One rendering
  frame after the seek, it is exact.
- In realtime, every frame is **exactly one frame behind** the rAF timestamp:
  compared with the seek capture one frame earlier, the slide error is
  0.00px. A drawing made inside a rAF callback shows the previous frame.
- Both compositor (`transform`, `opacity`) and main-thread (`width`)
  animations are captured.
- `page.screenshot` was 1.4-1.8x slower per frame. In 2 of 3 runs its first
  frame after the seek was stale (8.5px off, one frame), the "capture lands
  before the compositor applies the seek" problem; seek + 1 frame was exact
  in all 3 runs.
- Realtime capture is at the mercy of the frame cadence: in 1 of 3 runs one
  frame came 5 frames late (spin error 30°). Seeking has no such failure.
- Reading back one 480x220 frame costs well under a millisecond; the wall
  time is the 16.7ms frame cadence.

## 05 — Diff after a perceptual filter

`05-perceptual/run.ts`. Each pair is drawn once, then redrawn through a canvas
`filter` (GPU): blur, grayscale, and colour-vision-deficiency simulation
(Machado et al. 2009, severity 1.0, via SVG `feColorMatrix` in linear RGB).
pixelmatch threshold 0.1; (n%) relative to the unfiltered diff.

| case | none | blur 1px | blur 2px | gray | protan | deutan | tritan |
|---|---:|---:|---:|---:|---:|---:|---:|
| red→green badge (hue only) | 1838 | 109% | 123% | 99% | 100% | **0%** | 100% |
| blue→purple badge | 1837 | 107% | 124% | 100% | 100% | 99% | 100% |
| red→green + ✕/✓ label | 2519 | 108% | 122% | 99% | 100% | **23%** | 100% |
| text #333→#777 (contrast loss) | 508 | 125% | **4%** | 100% | 100% | 100% | 100% |
| letter-spacing +0.05px (invisible) | 789 | 108% | **4%** | 100% | 100% | 100% | 100% |
| text 1px down | 607 | 168% | **0%** | 100% | 100% | 100% | 100% |
| box 12px right | 932 | 109% | 136% | 100% | 100% | 100% | 100% |

- **CVD lens works as a detector of colour-only changes.** The red→green
  status badge disappears entirely for deuteranopia; with a ✕/✓ label, 23% of
  the diff survives (the label). Protanopia keeps it: protans see the red as
  much darker (relative luminance 0.10 vs 0.22), so brightness still tells
  the two apart. That matches the Machado model, checked by hand.
- **Blur does not separate noise from real change.** blur(2px) drops the
  invisible sub-pixel change to 4%, but drops a real contrast loss on text to
  the same 4% and a 1px text shift to 0%. Only the box move survives. As a
  noise filter for text, it throws the baby out with the bathwater.
- blur(1px) *increases* every diff: the blur spreads each difference.

## 06 — Can an AI "see" the change?

02's output is written for an agent: `report.md` (one row per component,
verdict + text / computed-style deltas) and `components/<name>-{before,after,diff}.png`
crops of only the changed components, each the size of the component.

Reading them as the agent (this experiment was run by one): the table alone
says what changed, and each crop is small enough to read at a glance
(`buy-after.png` is 83x33). The whole-image diff, by contrast, needs the
reader to work out that most of its red is the 21px push.

## Not tried yet

DPR 2, web fonts, cross-origin images, `position: fixed`, scrolled states,
container queries at several canvas widths in one page, and drawing in a
Worker through `ElementImage`.
