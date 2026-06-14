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

    await page.getByRole("button", { name: "Open PR Walkthrough" }).click();
    await page.getByRole("tab", { name: "Chat" }).click();
    await page.getByRole("button", { name: "New chat" }).click();

    const input = page.getByRole("textbox");
    await input.fill("Where does compute happen?");
    await input.press("Enter");

    // The answer renders and the file:line mention is linkified into a .prw-ref jump.
    const citation = page.locator("a.prw-ref", { hasText: "foo.ts:2" });
    await expect(citation).toBeVisible();

    await citation.click();
    // jump:ref → jumpToRef → highlightRows paints prw-pick on the cited row.
    await expect(page.locator('#diff-foo tr.prw-pick td[data-line-number="2"]')).toBeVisible();
  });
});
