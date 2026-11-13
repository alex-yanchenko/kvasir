import path from "node:path";
import { chromium, type BrowserContext, type Page } from "@playwright/test";
import { startBridge, type BridgeStub } from "../e2e/bridge-stub";
import { pair } from "../e2e/fixtures";
import { anchorFor } from "../packages/runes/src/anchor";
import { labelClassicDiffWithChangesTabMarkup } from "./classicDiff";
import { assertKvasirPortFree } from "./port";
import { ASK, PR_FILES_URL, PR_HEAD_SHA, reviewerGroupsSpec } from "./reviewerGroupsPr";

export const CAPTURE_VIEWPORT = { width: 1200, height: 780 };

export interface Captures {
  step: string;
  outline: string;
  ask: string;
}

const extensionPath = path.resolve(import.meta.dirname, "../packages/extension");
const PANEL_PREFS_KEY = "kvasir:panelPrefs.v2";
const PANEL_SIZE = { w: 660, h: 590 };

const launchWithExtension = (): Promise<BrowserContext> =>
  chromium.launchPersistentContext("", {
    channel: "chromium",
    viewport: CAPTURE_VIEWPORT,
    deviceScaleFactor: 2,
    colorScheme: "light",
    args: [
      "--headless=new",
      "--hide-scrollbars",
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });

async function waitForScrollToSettle(page: Page): Promise<void> {
  let last = -1;
  for (let stableChecks = 0; stableChecks < 3;) {
    await page.waitForTimeout(250);
    const now = await page.evaluate(() => window.scrollY);
    stableChecks = now === last ? stableChecks + 1 : 0;
    last = now;
  }
}

async function openPullRequestWithKvasir(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  await page.addInitScript(
    ([key, size]) => localStorage.setItem(key, JSON.stringify({ pos: null, size, sidebarOpen: true })),
    [PANEL_PREFS_KEY, PANEL_SIZE] as const,
  );
  await page.goto(PR_FILES_URL);
  for (const step of reviewerGroupsSpec("").steps) {
    await page.locator(`#${step.anchor} td.blob-code`).first().waitFor({ state: "attached" });
  }
  const labelled = await page.evaluate(labelClassicDiffWithChangesTabMarkup);
  if (labelled === 0)
    throw new Error(`No diff rows found on ${PR_FILES_URL}; GitHub's logged-out markup changed.`);
  await page.locator("#hide-file-tree-button").click();
  await page.getByRole("button", { name: "Open Kvasir" }).click();
  await page.getByTestId("sidebar").waitFor();
  return page;
}

async function showStep(page: Page, title: string): Promise<void> {
  await page.getByTestId("sidebar").getByRole("button", { name: title }).click();
  await page.getByRole("heading", { name: title }).waitFor();
  await page.locator("tr.diff-line-row.kvasir-line").first().waitFor();
  await waitForScrollToSettle(page);
}

const rowForLine = (page: Page, file: string, line: number) =>
  page.locator(`#${anchorFor(file)} tr.diff-line-row`, {
    has: page.locator(`td.diff-text-cell[data-line-number="${line}"]`),
  });

async function selectLines(page: Page): Promise<void> {
  await rowForLine(page, ASK.file, ASK.fromLine).hover({ position: { x: 120, y: 12 } });
  const gripLocator = page.locator(".kvasir-grip");
  await gripLocator.waitFor({ state: "visible" });
  const grip = await gripLocator.boundingBox();
  const last = await rowForLine(page, ASK.file, ASK.toLine).boundingBox();
  if (!grip || !last)
    throw new Error(`Lines ${ASK.fromLine}-${ASK.toLine} of ${ASK.file} are not on screen.`);
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2, last.y + last.height / 2, { steps: 8 });
  await page.mouse.up();
}

async function captureStep(context: BrowserContext, file: string): Promise<void> {
  const page = await openPullRequestWithKvasir(context);
  await showStep(page, "The tooltip names the review");
  await page.screenshot({ path: file });
  await page.close();
}

async function captureOutline(context: BrowserContext, file: string): Promise<void> {
  const page = await openPullRequestWithKvasir(context);
  await showStep(page, "A pending request wins");
  await page.screenshot({ path: file });
  await page.close();
}

async function captureAsk(context: BrowserContext, file: string): Promise<void> {
  const page = await openPullRequestWithKvasir(context);
  await showStep(page, "The tooltip names the review");
  await selectLines(page);
  await page.getByRole("button", { name: "Ask about these lines — plain chat" }).click();
  const input = page.getByRole("dialog", { name: "Kvasir" }).getByRole("textbox");
  await input.fill(ASK.question);
  await input.press("Enter");
  await page.locator("a.kvasir-ref", { hasText: "githubReviewers.ts:131" }).waitFor({ timeout: 20_000 });
  await page.mouse.move(CAPTURE_VIEWPORT.width - 4, 4);
  await page.waitForTimeout(500);
  await page.screenshot({ path: file });
  await page.close();
}

export async function captureKvasirOnPullRequest(rawDir: string): Promise<Captures> {
  await assertKvasirPortFree();
  const bridge: BridgeStub = await startBridge({
    headSha: PR_HEAD_SHA,
    answer: ASK.answer,
    suggestions: ASK.suggestions,
  });
  const context = await launchWithExtension();
  try {
    bridge.setSpec(reviewerGroupsSpec(new Date().toISOString()));
    await pair(context, bridge.token);
    const captures: Captures = {
      step: path.join(rawDir, "step.png"),
      outline: path.join(rawDir, "outline.png"),
      ask: path.join(rawDir, "ask.png"),
    };
    await captureStep(context, captures.step);
    await captureOutline(context, captures.outline);
    await captureAsk(context, captures.ask);
    return captures;
  } finally {
    await context.close();
    await bridge.close();
  }
}
