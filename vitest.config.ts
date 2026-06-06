import { defineConfig } from "vitest/config";

// Coverage philosophy (MIGRATION.md): Asgard (the React app) and the Bifrost are
// gated at 100% — all branching lives in reducers/hooks, so full coverage is a
// design constraint, not a chase. Midgard (the page controller) is fixture-driven
// and gated at 90%; its scroll/observer glue may carry explained v8-ignores.
// Excluded files are either legacy (die with the islands), runtime-boot glue, or
// need a harness that's an E3 stretch — each is listed with its reason.
export default defineConfig({
  test: {
    include: ["packages/**/src/**/*.test.{ts,tsx}"],
    environment: "node",
    coverage: {
      provider: "v8",
      include: ["packages/*/src/**"],
      exclude: [
        "**/*.test.*",
        "**/*.d.ts",
        // mutable-state shim wrapped by the store, deleted in E2
        "packages/extension/src/content/state.ts",
        // entry + mount glue: DOM/React bootstrapping with no logic (the watch
        // logic lives in heimdall/watch.ts, which IS covered)
        "packages/extension/src/content/index.tsx",
        "packages/extension/src/content/heimdall/boot.tsx",
        // 30-line worker fetch proxy; no service-worker harness
        "packages/extension/src/huginn.ts",
        // Mimir's channel + gh wrappers need a boot-the-server harness (E3 stretch)
        "packages/mimir/src/channel.ts",
        "packages/mimir/src/diff.ts",
      ],
      thresholds: {
        "packages/extension/src/content/asgard/**": {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
        "packages/extension/src/content/bifrost.ts": {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
        "packages/extension/src/content/muninn.ts": {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
        "packages/extension/src/content/heimdall/**": {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
        "packages/extension/src/content/midgard/**": {
          statements: 90,
          branches: 90,
          functions: 90,
          lines: 90,
        },
      },
    },
  },
});
