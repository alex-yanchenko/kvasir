import { test, expect } from "./fixtures";
import { PR_URL, prPageHtml } from "./pr-page";

test.describe("panel scroll lock", () => {
  test("a wheel over the panel never scrolls the page — even zoomed with the scroller bottomed out", async ({
    context,
  }) => {
    const page = await context.newPage();
    // A page tall enough to scroll, so a leak is observable as window.scrollY > 0.
    const tall = prPageHtml({ withDiff: false }).replace(
      "</body>",
      `<div style="height:5000px">spacer</div></body>`,
    );
    await page.route("https://github.com/**", (route) =>
      route.fulfill({ contentType: "text/html", body: tall }),
    );
    await page.goto(PR_URL);
    await page.getByRole("button", { name: "Open Kvasir" }).click();
    await page.getByRole("tab", { name: "Settings" }).click();

    // Zoom makes layout metrics fractional — the exact condition where phantom
    // sub-pixel scroll room used to let the wheel chain through to the page.
    await page.evaluate(() => {
      document.documentElement.style.zoom = "1.1";
    });
    // toBeVisible first so a panel that failed to render reads as "dialog not
    // visible", not a null boundingBox exploding mid-test.
    const dialog = page.getByRole("dialog", { name: "Kvasir" });
    await expect(dialog).toBeVisible();
    const box = (await dialog.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.5);

    // Wheel far past the settings scroller's end, then probe several positions.
    for (let index = 0; index < 10; index++) await page.mouse.wheel(0, 500);
    for (const frac of [0.15, 0.5, 0.85]) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height * frac);
      await page.mouse.wheel(0, 300);
    }
    await page.waitForTimeout(150);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);

    // The lock must not break inner scrolling: the settings body did scroll.
    const settingsTop = await page.evaluate(() => {
      const shadow = document.querySelector("#kvasir-root")?.shadowRoot;
      return shadow?.querySelector('[role="tabpanel"][data-state="active"]')?.scrollTop ?? -1;
    });
    expect(settingsTop).toBeGreaterThan(0);
  });
});
