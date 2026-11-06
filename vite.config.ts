import { resolve } from "node:path";

import { defineConfig } from "vite";

// Repository is published at https://kfly8-sandbox.github.io/sample-html-in-canvas/
// so assets must resolve under that subpath in production.
const pages = ["index", "diff", "attribution", "frames", "gpu-lens"];

export default defineConfig({
  base: process.env.GITHUB_PAGES ? "/sample-html-in-canvas/" : "/",
  server: {
    port: 5173,
    strictPort: false,
  },
  build: {
    rollupOptions: {
      input: Object.fromEntries(pages.map((p) => [p, resolve(__dirname, `${p}.html`)])),
    },
  },
});
