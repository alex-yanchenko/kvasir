import { test, expect, pair } from "./fixtures";
import { PR_URL, prPageHtml, makeSpec } from "./pr-page";

// Ask → streamed answer bubble → the answer's `file:line` mention becomes a
// clickable citation that jumps to (and highlights) the cited diff row.
test.describe("chat flow", () => {
  test("answers a question and its citation highlights the cited code", async ({ context, bridge }) => {
    bridge.setSpec(makeSpec());
    bridge.state.answer = "The change lands in src/foo.ts:2, where compute() is first called.";
    await pair(context, bridge.token);

    const page = await context.newPage();
    await page.route("https://github.com/**", (route) =>
      route.fulfill({ contentType: "text/html", body: prPageHtml() }),
    );
    await page.goto(PR_URL);

    await page.getByRole("button", { name: "Open Kvasir" }).click();
    await page.getByRole("tab", { name: "Chat" }).click();
    // the chat list's New chat lives in the nav column — assert the column is
    // there (open by default at the default width) so a default change fails
    // here, not at a missing button
    await expect(page.getByTestId("sidebar")).toBeVisible();
    await page.getByRole("button", { name: "New chat" }).first().click();

    const input = page.getByRole("textbox");
    await input.fill("Where does compute happen?");
    await input.press("Enter");

    // The answer renders and the file:line mention is linkified into a .kvasir-ref jump.
    const citation = page.locator("a.kvasir-ref", { hasText: "foo.ts:2" });
    await expect(citation).toBeVisible();

    await citation.click();
    // jump:ref → jumpToRef → highlightRows paints kvasir-pick on the cited row.
    await expect(page.locator('#diff-foo tr.kvasir-pick td[data-line-number="2"]')).toBeVisible();
  });
});
