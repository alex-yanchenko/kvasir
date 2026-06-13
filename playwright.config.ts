import { defineConfig } from "@playwright/test";

// Real-browser smoke tests: load the built extension into Chromium and drive it on
// a GitHub-like PR page. Covers what jsdom can't — actual content-script injection,
// shadow-DOM mount, CSS injection, React render. Run with `pnpm e2e` (needs a build).
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: { actionTimeout: 10_000 },
});
