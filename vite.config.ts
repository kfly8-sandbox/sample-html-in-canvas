import { defineConfig } from "vite";

// Repository is published at https://kfly8-sandbox.github.io/sample-html-in-canvas/
// so assets must resolve under that subpath in production.
export default defineConfig({
  base: process.env.GITHUB_PAGES ? "/sample-html-in-canvas/" : "/",
  server: {
    port: 5173,
    strictPort: false,
  },
});
