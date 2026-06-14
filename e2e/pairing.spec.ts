import { test, expect } from "./fixtures";
import { PR_URL, prPageHtml } from "./pr-page";

// The full pairing handshake driven through the UI (no seeded token): the panel
// surfaces the Pair prompt, /pair hands back a code, and the claim poll lands the
// token and flips the banner to paired.
test.describe("pairing flow", () => {
  test("Pair → shows the code → token lands → banner clears", async ({ context, bridge }) => {
    void bridge; // started so the worker's /pair + /pair/claim calls reach the stub

    const page = await context.newPage();
    await page.route("https://github.com/**", (route) =>
      route.fulfill({ contentType: "text/html", body: prPageHtml({ withDiff: false }) }),
    );
    await page.goto(PR_URL);

    await page.getByRole("button", { name: "Open PR Walkthrough" }).click();

    // Unpaired on boot → the panel's PairBanner offers the Pair action.
    const pairButton = page.getByRole("button", { name: "Pair", exact: true });
    await expect(pairButton).toBeVisible();
    await pairButton.click();

    // /pair → a one-time code; the banner shows "Confirm code <code>" while it polls.
    await expect(page.getByText(/Confirm code/)).toBeVisible();

    // The (auto-approved) claim returns the token on the next poll (~1s) → paired → banner gone.
    await expect(page.getByText(/Confirm code|Not paired/)).toBeHidden({ timeout: 5000 });
  });
});
