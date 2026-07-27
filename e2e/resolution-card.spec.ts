import { test, expect, pair } from "./fixtures";
import { PR_URL, prPageHtml } from "./pr-page";

// The heavy Run→resolve→(card)→prepare→generate sequencing end to end: a resolvable
// checkout skips the card, an absent one shows it and authorizing a clone proceeds.
test.describe("resolution card (reviewer-authorized checkout)", () => {
  const openOnPr = async (context: Parameters<typeof pair>[0], bridge: { token: string }) => {
    await pair(context, bridge.token);
    const page = await context.newPage();
    await page.route("https://github.com/**", (route) =>
      route.fulfill({ contentType: "text/html", body: prPageHtml({ withDiff: false }) }),
    );
    await page.goto(PR_URL);
    await page.getByRole("button", { name: "Open Kvasir" }).click();
    return page;
  };

  test("a resolvable checkout skips the card and generates straight away", async ({ context, bridge }) => {
    bridge.state.checkout = "ready";
    const page = await openOnPr(context, bridge);

    await page.getByRole("button", { name: /Run walkthrough/ }).click();

    await expect(page.getByText("Generating walkthrough…")).toBeVisible();
    await expect(page.getByTestId("resolve-action-clone-kvasir")).toHaveCount(0);
  });

  test("an absent checkout shows the card; authorizing a clone proceeds to generate", async ({
    context,
    bridge,
  }) => {
    bridge.state.checkout = "absent";
    const page = await openOnPr(context, bridge);

    await page.getByRole("button", { name: /Run walkthrough/ }).click();

    // absent → the resolution card, not generation
    const cloneAction = page.getByTestId("resolve-action-clone-kvasir");
    await expect(cloneAction).toBeVisible();
    await expect(page.getByText("Generating walkthrough…")).toHaveCount(0);

    // authorize a clone → /prepare flips the checkout ready → /generate → generating
    await cloneAction.click();
    await expect(page.getByText("Generating walkthrough…")).toBeVisible();
    await expect(page.getByTestId("resolve-action-clone-kvasir")).toHaveCount(0);
  });
});
