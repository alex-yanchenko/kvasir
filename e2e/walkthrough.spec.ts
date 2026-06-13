import { test, expect } from "./fixtures";

// A GitHub PR "Files changed" URL the content script matches (manifest + prUrl()).
const PR_URL = "https://github.com/acme/widget/pull/1/files";

// Minimal stand-in for the PR page — the launcher chip mounts on any matched PR URL,
// independent of diff content (which only drives walkthrough rendering). We intercept
// github.com and serve this so the real manifest content-script injects.
const FIXTURE_HTML = `<!doctype html><html><head><title>PR</title></head>
<body><div id="repo-content">Files changed</div></body></html>`;

test.describe("extension on a PR page", () => {
  test("boots, shows the launcher chip, and the chip opens the panel", async ({ context }) => {
    const page = await context.newPage();
    await page.route("https://github.com/**", (route) =>
      route.fulfill({ contentType: "text/html", body: FIXTURE_HTML }),
    );
    await page.goto(PR_URL);

    // Content script injected into a real browser → shadow-root mount + React render.
    const chip = page.getByRole("button", { name: "Open PR Walkthrough" });
    await expect(chip).toBeVisible();

    await chip.click();
    await expect(page.getByRole("dialog", { name: "PR Walkthrough" })).toBeVisible();
    await expect(chip).toBeHidden(); // chip yields to the panel header's close affordance
  });
});
