// Vite's `?raw` imports (the fixtures are shared with the Playwright experiments).
declare module "*?raw" {
  const content: string;
  export default content;
}
