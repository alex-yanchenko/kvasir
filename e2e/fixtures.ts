import path from "node:path";
import { test as base, chromium, type BrowserContext, type Worker } from "@playwright/test";
import { startBridge, type BridgeStub } from "./bridge-stub";

// The unpacked extension root (manifest.json + dist/). Built by `pnpm build`.
const extensionPath = path.resolve(import.meta.dirname, "../packages/extension");

// MV3 extensions need the full Chromium build (not headless-shell); the new headless
// mode loads them. launchPersistentContext is required — extensions don't load in the
// default ephemeral context.
export const test = base.extend<{ context: BrowserContext; bridge: BridgeStub }>({
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
  // The local channel-server stand-in on :8799 (see bridge-stub.ts). Lazy: only
  // started for tests that request `bridge`; the boot-only smoke test skips it.
  bridge: async ({}, use) => {
    const stub = await startBridge();
    await use(stub);
    await stub.close();
  },
});

export const expect = test.expect;

// The extension's background service worker (huginn). Available as soon as the
// extension loads — before any page navigation — so token seeding can run first.
async function serviceWorker(context: BrowserContext): Promise<Worker> {
  return context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
}

// Pretend the pairing handshake already happened: drop the bridge token into the
// worker's chrome.storage so /auth answers "paired" on boot. Must run before the
// page navigates (pairingStore reads the token once, at boot).
export async function pair(context: BrowserContext, token = "e2e-token"): Promise<void> {
  const worker = await serviceWorker(context);
  await worker.evaluate((value) => chrome.storage.local.set({ "prw:token": value }), token);
}
