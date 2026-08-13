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

  test("Locate my repositories folder sends dest-less set-default-root → /prepare → generate", async ({
    context,
    bridge,
  }) => {
    bridge.state.checkout = "absent";
    const page = await openOnPr(context, bridge);

    await page.getByRole("button", { name: /Run walkthrough/ }).click();

    const locateAction = page.getByTestId("resolve-action-set-default-root");
    await expect(locateAction).toBeVisible();
    for (const id of ["use-existing", "clone-dest", "set-default-root"]) {
      await expect(page.getByTestId(`resolve-input-${id}`)).toHaveCount(0);
    }

    await locateAction.click();
    await expect(page.getByText("Generating walkthrough…")).toBeVisible();
    await expect(locateAction).toHaveCount(0);
    expect(bridge.getLastPrepare()).toEqual({ action: "set-default-root", dest: undefined });
  });

  test("cancelling the picker keeps the card up with no error", async ({ context, bridge }) => {
    bridge.state.checkout = "absent";
    bridge.state.prepareResult = "cancelled";
    const page = await openOnPr(context, bridge);

    await page.getByRole("button", { name: /Run walkthrough/ }).click();
    const locateAction = page.getByTestId("resolve-action-set-default-root");
    await locateAction.click();

    await expect(locateAction).toBeVisible();
    await expect(page.getByText("Generating walkthrough…")).toHaveCount(0);
    await expect(page.getByTestId("resolve-error")).toHaveCount(0);
  });

  test("a locate that finds no clone under the root shows the diff plus a notice", async ({
    context,
    bridge,
  }) => {
    bridge.state.checkout = "absent";
    bridge.state.prepareResult = "declined";
    const page = await openOnPr(context, bridge);

    await page.getByRole("button", { name: /Run walkthrough/ }).click();
    await page.getByTestId("resolve-action-set-default-root").click();

    await expect(page.getByText("Generating walkthrough…")).toBeVisible();
    await expect(page.getByText(/find this repo under the folder you picked/)).toBeVisible();
  });
});
