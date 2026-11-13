import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "images.spec.ts",
  globalSetup: "./globalSetup.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 180_000,
  reporter: "list",
  outputDir: "../test-results/screenshots",
  use: { actionTimeout: 15_000 },
});
