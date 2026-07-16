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
    // Global mock lifecycle (before every test) so no suite can leak state into the
    // next: clear call records, restore spied originals, and undo vi.stubGlobal.
    // Replaces per-file afterEach(restoreAllMocks/clearAllMocks) boilerplate.
    clearMocks: true,
    restoreMocks: true,
    unstubGlobals: true,
    coverage: {
      provider: "v8",
      include: ["packages/*/src/**"],
      exclude: [
        "**/*.test.*",
        "**/*.d.ts",
        // entry + mount glue: DOM/React bootstrapping with no logic (the watch
        // logic lives in heimdall/watch.ts, which IS covered)
        "packages/extension/src/content/index.tsx",
        "packages/extension/src/content/heimdall/boot.tsx",
        // 30-line worker fetch proxy; no service-worker harness
        "packages/extension/src/huginn.ts",
        // Lazy-load glue: a runtime dynamic import() of the web-accessible mermaid
        // chunk via chrome.runtime.getURL — can't resolve/run under vitest. The
        // Diagram component that uses it IS covered (loadMermaid is mocked there).
        "packages/extension/src/content/asgard/mermaidLoader.ts",
        // Genuine glue only — every branch of decision logic has been extracted to a
        // covered module: channel.ts is the Bun entrypoint (McpServer wiring +
        // Bun.serve + StdioServerTransport; can't import under vitest), with its
        // handlers' logic in specInput.ts / publish.ts / bridge.ts / broker.ts; diff.ts
        // is the gh subprocess shell, its transforms in manifest.ts. All ARE covered.
        "packages/mimir/src/channel.ts",
        "packages/mimir/src/diff.ts",
        // Argv-routing Bun entry + its IO glue: main.ts dispatches parsed commands
        // (the parse is parseCli in cliArgs.ts, covered), launcher.ts execs `claude`
        // / frees the port via Bun.spawn + lsof (its pure argv/config builders are
        // verified by launcher.test.ts), and runBuild.ts shells out to git + fetches
        // the mailbox (its resolution logic is reviewBuild.ts, gated at 100%). The
        // glue itself has no vitest harness — same tier as channel.ts.
        "packages/mimir/src/main.ts",
        "packages/mimir/src/launcher.ts",
        "packages/mimir/src/runBuild.ts",
        // bun:sqlite store: Bun-only (can't import under vitest); all its logic
        // mirrors the node-tested createMemoryGuideStore and is verified by
        // guideStore.sqlite.buntest.ts under `bun test`.
        "packages/mimir/src/guideStore.sqlite.ts",
        "packages/mimir/src/sessionStore.sqlite.ts",
        // Bun.spawn git ops (can't import under vitest); verified against real git
        // repos by contextWorktree.buntest.ts under `bun test`.
        "packages/mimir/src/contextWorktree.ts",
        "packages/mimir/src/**/*.buntest.ts",
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
        "packages/mimir/src/bridge.ts": {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
        "packages/mimir/src/broker.ts": {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
        "packages/mimir/src/manifest.ts": {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
        "packages/mimir/src/specInput.ts": {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
        "packages/mimir/src/publish.ts": {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
        "packages/mimir/src/review.ts": {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
        "packages/mimir/src/reviewBuild.ts": {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
        "packages/mimir/src/sessionStore.ts": {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
        "packages/mimir/src/guideStore.ts": {
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
