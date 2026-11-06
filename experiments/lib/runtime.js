// Browser-side helpers shared by the experiments. Plain JS on purpose: it is
// injected with addScriptTag, so tsx/esbuild never get to add helpers
// (e.g. __name) that do not exist in the page.
//
// API shape as shipped in Chrome 157 stable (2026-11-06):
//   <canvas layoutsubtree content="drawable"> and every element passed to
//   drawElementImage must carry the `drawable` attribute.
//   A `drawable` descendant is NOT painted when an ancestor is drawn: each
//   drawable element is its own layer.
(() => {
  const raf = () => new Promise((r) => requestAnimationFrame(r));
  const frames = async (n) => {
    for (let i = 0; i < n; i++) await raf();
  };

  const encode = (data) => {
    let s = "";
    for (let i = 0; i < data.length; i += 0x8000) {
      s += String.fromCharCode.apply(null, data.subarray(i, i + 0x8000));
    }
    return btoa(s);
  };

  /** Create (or reuse) a drawable canvas hosting `html` inside a drawable root. */
  const mount = async (id, html, width, height) => {
    let canvas = document.getElementById(id);
    if (!canvas) {
      canvas = document.createElement("canvas");
      canvas.id = id;
      canvas.setAttribute("layoutsubtree", "");
      canvas.setAttribute("content", "drawable");
      document.body.appendChild(canvas);
    }
    canvas.width = width;
    canvas.height = height;
    const root = document.createElement("div");
    root.setAttribute("drawable", "");
    root.className = "hic-root";
    root.style.cssText = `width:${width}px;height:${height}px;background:#fff;position:relative;overflow:hidden`;
    root.innerHTML = html;
    canvas.replaceChildren(root);
    await frames(2);
    return { canvas, root };
  };

  /** Draw `el` at (x, y) on a cleared canvas and return base64 RGBA. */
  const drawRGBA = (canvas, el, x = 0, y = 0) => {
    const g = canvas.getContext("2d");
    g.clearRect(0, 0, canvas.width, canvas.height);
    g.drawElementImage(el, x, y);
    return encode(g.getImageData(0, 0, canvas.width, canvas.height).data);
  };

  /** Position of `el` relative to `root`, from layout (offsetParent chain). */
  const layoutOffset = (el, root) => {
    let x = 0;
    let y = 0;
    for (let n = el; n && n !== root; n = n.offsetParent) {
      x += n.offsetLeft;
      y += n.offsetTop;
      if (n.offsetParent === null) break;
    }
    return { x, y };
  };

  /**
   * Experiment 02: mount `html`, mark every [data-vrt] element drawable, and
   * return the whole picture plus one isolated image per component.
   *
   * Because a drawable descendant is left out of its ancestor's draw, each
   * component image holds only the pixels that component itself paints —
   * a nested component's change cannot leak into its parent.
   */
  const captureComponents = async (html, width, height, styleProps) => {
    const { canvas, root } = await mount("hic-components", html, width, height);
    const els = [...root.querySelectorAll("[data-vrt]")];
    els.forEach((el) => el.setAttribute("drawable", ""));
    await frames(2);

    // Layout position comes from offset*, not getBoundingClientRect: a
    // drawable element's client rect is where it was last *drawn* (the
    // canvas origin before the first draw), not where layout put it.
    const meta = els.map((el) => {
      const pos = layoutOffset(el, root);
      const cs = getComputedStyle(el);
      const style = {};
      for (const p of styleProps) style[p] = cs.getPropertyValue(p);
      return {
        el,
        name: el.dataset.vrt,
        x: pos.x,
        y: pos.y,
        width: el.offsetWidth,
        height: el.offsetHeight,
        text: el.innerText,
        style,
      };
    });

    // Whole picture = root layer + every component layer at its own place.
    const g = canvas.getContext("2d");
    g.clearRect(0, 0, width, height);
    g.drawElementImage(root, 0, 0);
    for (const m of meta) g.drawElementImage(m.el, m.x, m.y);
    const whole = encode(g.getImageData(0, 0, width, height).data);

    // Each component alone, at the origin.
    const components = meta.map((m) => {
      const w = Math.max(1, m.width);
      const h = Math.max(1, m.height);
      canvas.width = Math.max(canvas.width, w);
      canvas.height = Math.max(canvas.height, h);
      g.clearRect(0, 0, canvas.width, canvas.height);
      g.drawElementImage(m.el, 0, 0);
      const rgba = encode(g.getImageData(0, 0, w, h).data);
      const { el, ...rest } = m;
      return { ...rest, width: w, height: h, rgba };
    });
    canvas.width = width;
    canvas.height = height;
    return { whole, components };
  };

  /**
   * Experiment 04: frame-by-frame capture of the animations inside `html`.
   *
   * mode "realtime": draw once per requestAnimationFrame for `count` frames,
   *   recording each frame's timestamp relative to the first.
   * mode "seek": pause every animation in the subtree and set its
   *   currentTime to each requested instant before drawing — no waiting on
   *   the wall clock, and the instants are exact.
   */
  const captureFrames = async (html, width, height, opts) => {
    const { canvas, root } = await mount("hic-frames", html, width, height);
    const g = canvas.getContext("2d");
    const grab = () => {
      g.clearRect(0, 0, width, height);
      g.drawElementImage(root, 0, 0);
      return g.getImageData(0, 0, width, height).data;
    };
    const out = [];
    let drawMs = 0;

    if (opts.mode === "realtime") {
      // Restart the animations so frame 0 is their start.
      const anims = root.getAnimations({ subtree: true });
      anims.forEach((a) => { a.cancel(); a.play(); });
      let t0 = null;
      for (let i = 0; i < opts.count; i++) {
        const now = await raf();
        if (t0 === null) t0 = now;
        const s = performance.now();
        const data = grab();
        drawMs += performance.now() - s;
        out.push({ atMs: now - t0, animMs: anims[0]?.currentTime ?? null, rgba: encode(data) });
      }
    } else {
      const anims = root.getAnimations({ subtree: true });
      anims.forEach((a) => a.pause());
      for (const t of opts.instants) {
        anims.forEach((a) => { a.currentTime = t; });
        if (opts.waitFrame) await raf();
        const s = performance.now();
        const data = grab();
        drawMs += performance.now() - s;
        out.push({ atMs: t, animMs: t, rgba: encode(data) });
      }
    }
    return { frames: out, drawMsPerFrame: drawMs / out.length };
  };

  // Machado, Oliveira & Fernandes (2009), severity 1.0. These are linear-RGB
  // matrices, which is what feColorMatrix uses by default
  // (color-interpolation-filters: linearRGB).
  const CVD = {
    protanopia: [0.152286, 1.052583, -0.204868, 0.114503, 0.786281, 0.099216, -0.003882, -0.048116, 1.051998],
    deuteranopia: [0.367322, 0.860646, -0.227968, 0.280085, 0.672501, 0.047413, -0.01182, 0.04294, 0.968881],
    tritanopia: [1.255528, -0.076749, -0.178779, -0.078411, 0.930809, 0.147602, 0.004733, 0.691367, 0.3039],
  };
  const ensureCvdFilters = () => {
    if (document.getElementById("hic-cvd")) return;
    const rows = (m) => `${m[0]} ${m[1]} ${m[2]} 0 0  ${m[3]} ${m[4]} ${m[5]} 0 0  ${m[6]} ${m[7]} ${m[8]} 0 0  0 0 0 1 0`;
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.id = "hic-cvd";
    svg.setAttribute("width", "0");
    svg.setAttribute("height", "0");
    svg.style.position = "absolute";
    svg.innerHTML = Object.entries(CVD)
      .map(([k, m]) => `<filter id="cvd-${k}"><feColorMatrix type="matrix" values="${rows(m)}"/></filter>`)
      .join("");
    document.body.appendChild(svg);
  };

  /**
   * Experiment 05: draw `html` once, then redraw that bitmap through each
   * canvas filter (GPU in Chrome) and return one RGBA per filter.
   * Filter names starting with "cvd-" refer to the SVG filters above.
   */
  const renderFiltered = async (html, width, height, filters) => {
    ensureCvdFilters();
    const { canvas, root } = await mount("hic-filtered", html, width, height);
    const g = canvas.getContext("2d");
    g.clearRect(0, 0, width, height);
    g.drawElementImage(root, 0, 0);
    const outCanvas = document.createElement("canvas");
    outCanvas.width = width;
    outCanvas.height = height;
    const o = outCanvas.getContext("2d");
    const result = {};
    for (const f of filters) {
      o.filter = "none";
      o.fillStyle = "#fff";
      o.fillRect(0, 0, width, height);
      o.filter = f.startsWith("cvd-") ? `url(#${f})` : f;
      o.drawImage(canvas, 0, 0);
      result[f] = encode(o.getImageData(0, 0, width, height).data);
    }
    return result;
  };

  window.__hic = { raf, frames, encode, mount, drawRGBA, captureComponents, captureFrames, renderFiltered };
})();
