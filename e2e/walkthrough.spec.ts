import { test, expect, pair } from "./fixtures";
import { PR_URL, prPageHtml, makeSpec } from "./pr-page";

test.describe("extension on a PR page", () => {
  test("boots, shows the launcher chip, and the chip opens the panel", async ({ context }) => {
    const page = await context.newPage();
    await page.route("https://github.com/**", (route) =>
      route.fulfill({ contentType: "text/html", body: prPageHtml({ withDiff: false }) }),
    );
    await page.goto(PR_URL);

    // Content script injected into a real browser → shadow-root mount + React render.
    const chip = page.getByRole("button", { name: "Open PR Walkthrough" });
    await expect(chip).toBeVisible();

    await chip.click();
    await expect(page.getByRole("dialog", { name: "PR Walkthrough" })).toBeVisible();
    await expect(chip).toBeHidden(); // chip yields to the panel header's close affordance
  });

  test("renders the walkthrough and highlights the step's diff rows", async ({ context, bridge }) => {
    bridge.setSpec(makeSpec());
    await pair(context, bridge.token);

    const page = await context.newPage();
    await page.route("https://github.com/**", (route) =>
      route.fulfill({ contentType: "text/html", body: prPageHtml() }),
    );
    await page.goto(PR_URL);

    await page.getByRole("button", { name: "Open PR Walkthrough" }).click();
    await page.getByRole("tab", { name: "Walkthrough" }).click();

    // First step renders; mounting the tab auto-starts the tour → highlight:step →
    // the controller paints prw-line on the rows the spec's line range names (2-3).
    await expect(page.getByRole("heading", { name: "Compute in foo" })).toBeVisible();
    await expect(page.locator("#diff-foo tr.diff-line-row.prw-line")).toHaveCount(2);
    await expect(page.locator('#diff-foo tr.prw-line td[data-line-number="2"]')).toBeVisible();

    // Next step moves the highlight to the other file and clears the first.
    await page.getByRole("button", { name: "Next step" }).click();
    await expect(page.getByRole("heading", { name: "Log in bar" })).toBeVisible();
    await expect(page.locator("#diff-bar tr.diff-line-row.prw-line")).toHaveCount(1);
    await expect(page.locator("#diff-foo tr.prw-line")).toHaveCount(0);
  });
});
