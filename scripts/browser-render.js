// Runtime injected into the Playwright page via addScriptTag.
// Kept as plain JS so tsx/esbuild never get a chance to insert helpers
// (e.g. __name) that don't exist in the browser context.
//
// Exposes window.__htmlInCanvasRender(beforeHtml, afterHtml) which draws
// both snippets onto #before / #after and returns base64-encoded RGBA
// buffers for the caller to feed into pixelmatch.
(() => {
  const waitFrames = (n) =>
    new Promise((resolve) => {
      const step = (left) => {
        if (left <= 0) resolve();
        else requestAnimationFrame(() => step(left - 1));
      };
      step(n);
    });

  const draw = async (canvas, html) => {
    const root = document.createElement("div");
    root.innerHTML = html;
    canvas.replaceChildren(root);
    await waitFrames(2);
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawElementImage(root, 0, 0);
    await waitFrames(1);
  };

  const encode = (data) => {
    const chunks = [];
    const chunkSize = 0x8000;
    for (let i = 0; i < data.length; i += chunkSize) {
      const slice = data.subarray(i, i + chunkSize);
      chunks.push(String.fromCharCode.apply(null, slice));
    }
    return btoa(chunks.join(""));
  };

  window.__htmlInCanvasRender = async (beforeHtml, afterHtml) => {
    const before = document.getElementById("before");
    const after = document.getElementById("after");
    if (!before || !after) throw new Error("canvas lookup failed");
    const beforeCtx = before.getContext("2d");
    if (!beforeCtx) throw new Error("2d context unavailable");
    if (typeof beforeCtx.drawElementImage !== "function") {
      return { supported: false, beforeBase64: "", afterBase64: "" };
    }
    await draw(before, beforeHtml);
    await draw(after, afterHtml);
    const beforeData = before
      .getContext("2d")
      .getImageData(0, 0, before.width, before.height).data;
    const afterData = after
      .getContext("2d")
      .getImageData(0, 0, after.width, after.height).data;
    return {
      supported: true,
      beforeBase64: encode(beforeData),
      afterBase64: encode(afterData),
    };
  };
})();
