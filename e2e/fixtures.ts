import path from "node:path";
import { test as base, chromium, type BrowserContext } from "@playwright/test";

// The unpacked extension root (manifest.json + dist/). Built by `pnpm build`.
const extensionPath = path.resolve(import.meta.dirname, "../packages/extension");

// MV3 extensions need the full Chromium build (not headless-shell); the new headless
// mode loads them. launchPersistentContext is required — extensions don't load in the
// default ephemeral context.
export const test = base.extend<{ context: BrowserContext }>({
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext("", {
      channel: "chromium",
      args: [
        "--headless=new",
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
      ],
    });
    await use(context);
    await context.close();
  },
});

export const expect = test.expect;
