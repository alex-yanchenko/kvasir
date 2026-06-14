// @vitest-environment jsdom
import type { Review } from "@prw/runes/review";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../api", () => ({ api: vi.fn() }));
vi.mock("../muninn", () => ({ storeGet: vi.fn(), storeSet: vi.fn(), storeRemove: vi.fn() }));

import { api } from "../api";
import { storeGet, storeSet } from "../muninn";
import { chatStore } from "./chat";
import { reviewStore } from "./review";
import { state } from "./store";

const mkReview = (over: Partial<Review> = {}): Review => ({
  version: 1,
  id: "rev-1",
  title: "Auth flow",
  steps: [
    {
      id: "a",
      title: "Guard",
      body: "<b>guard</b> body",
      repo: { owner: "acme", name: "web" },
      ref: "main",
      file: "src/a.ts",
      lines: { start: 10, end: 20 },
    },
    { id: "b", title: "Server", body: "server body", repo: { owner: "acme", name: "api" }, ref: "main", file: "src/b.ts" },
  ],
  ...over,
});

let assign: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers(); // reveal defers the cross-file navigation via setTimeout
  state.review = null;
  state.reviewStep = 0;
  state.reviewOpen = false;
  state.reviewNavigating = false;
  state.panel = { open: false, tab: "walkthrough", pos: null, size: null };
  vi.mocked(storeGet).mockResolvedValue(null);
  assign = vi.fn();
  // A page whose path matches no step's blob → reveal treats every step as cross-file.
  Object.defineProperty(window, "location", {
    value: { pathname: "/elsewhere", hash: "", href: "https://github.com/elsewhere", assign },
    writable: true,
    configurable: true,
  });
  vi.spyOn(chatStore, "openSelection").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
});

const loadOk = async (review = mkReview(), saved: unknown = null): Promise<void> => {
  vi.mocked(storeGet).mockResolvedValue(saved);
  vi.mocked(api).mockResolvedValue({ ok: true, data: review });
  await reviewStore.load("rev-1");
};

describe("reviewStore getters", () => {
  it("are safe before any review is loaded", () => {
    expect(reviewStore.isOpen()).toBe(false);
    expect(reviewStore.steps()).toEqual([]);
    expect(reviewStore.stepCount()).toBe(0);
    expect(reviewStore.stepIndex()).toBe(0);
    expect(reviewStore.step()).toBeNull();
    expect(reviewStore.title()).toBe("");
  });

  it("expose the loaded steps", async () => {
    await loadOk();
    expect(reviewStore.steps()).toHaveLength(2);
  });
});

describe("reviewStore.load", () => {
  it("pulls the review, opens the panel, defaults the step to 0", async () => {
    await loadOk();
    expect(reviewStore.isOpen()).toBe(true);
    expect(reviewStore.title()).toBe("Auth flow");
    expect(reviewStore.stepCount()).toBe(2);
    expect(reviewStore.stepIndex()).toBe(0);
    expect(reviewStore.step()).toMatchObject({ id: "a" });
    expect(state.panel.open).toBe(true);
    expect(api).toHaveBeenCalledWith("/review?id=rev-1");
  });

  it("restores a saved step and clamps a stale one past the end", async () => {
    await loadOk(mkReview(), 1);
    expect(reviewStore.stepIndex()).toBe(1);
    await loadOk(mkReview(), 9); // only 2 steps → clamp to 1
    expect(reviewStore.stepIndex()).toBe(1);
  });

  it("stays closed when the mailbox returns nothing or an invalid review", async () => {
    vi.mocked(api).mockResolvedValue({ ok: false });
    await reviewStore.load("rev-1");
    expect(reviewStore.isOpen()).toBe(false);
    vi.mocked(api).mockResolvedValue({ ok: true, data: { not: "a review" } });
    await reviewStore.load("rev-1");
    expect(reviewStore.isOpen()).toBe(false);
    expect(reviewStore.steps()).toEqual([]);
  });
});

describe("reviewStore navigation", () => {
  it("goto a cross-file step flags loading, then navigates on the next tick", async () => {
    await loadOk();
    reviewStore.goto(1); // step b is a different file → cross-page
    expect(reviewStore.stepIndex()).toBe(1);
    expect(storeSet).toHaveBeenCalledWith("prw:review:rev-1", 1);
    expect(reviewStore.navigating()).toBe(true);
    expect(assign).not.toHaveBeenCalled(); // deferred so the loading state paints first
    vi.runAllTimers();
    expect(assign).toHaveBeenCalledWith("https://github.com/acme/api/blob/main/src/b.ts?prw=rev-1");
  });

  it("goto a step in the current file just moves the #L highlight (no reload)", async () => {
    await loadOk();
    globalThis.location.pathname = "/acme/web/blob/main/src/a.ts"; // we're already on step a's file
    reviewStore.goto(0);
    expect(globalThis.location.hash).toBe("#L10-L20");
    expect(reviewStore.navigating()).toBe(false);
    expect(assign).not.toHaveBeenCalled();
  });

  it("next/back move within bounds and no-op at the edges", async () => {
    await loadOk();
    reviewStore.back(); // at first → no-op
    expect(reviewStore.stepIndex()).toBe(0);
    reviewStore.next();
    expect(reviewStore.stepIndex()).toBe(1);
    reviewStore.next(); // at last → no-op
    expect(reviewStore.stepIndex()).toBe(1);
    reviewStore.back();
    expect(reviewStore.stepIndex()).toBe(0);
  });

  it("goto is a no-op without a review", () => {
    reviewStore.goto(1);
    expect(assign).not.toHaveBeenCalled();
    expect(reviewStore.stepIndex()).toBe(0);
  });

  it("clears the navigating flag on a fresh page load", async () => {
    await loadOk();
    reviewStore.goto(1);
    expect(reviewStore.navigating()).toBe(true);
    await loadOk(); // boot on the new page
    expect(reviewStore.navigating()).toBe(false);
  });

  it("does not navigate when the review has no id (still persists)", () => {
    state.review = mkReview({ id: undefined });
    state.reviewStep = 0;
    reviewStore.goto(0);
    expect(storeSet).toHaveBeenCalledWith("prw:review:", 0);
    expect(assign).not.toHaveBeenCalled();
  });

  it("close clears the open flag", async () => {
    await loadOk();
    reviewStore.close();
    expect(reviewStore.isOpen()).toBe(false);
  });
});

describe("reviewStore context (Guide)", () => {
  it("backgroundContext distills title + steps across repos, '' without a review", async () => {
    expect(reviewStore.backgroundContext()).toBe("");
    await loadOk();
    expect(reviewStore.backgroundContext()).toBe(
      "Review: Auth flow\n\n• Guard (acme/web/src/a.ts:10-20)\n  guard body\n• Server (acme/api/src/b.ts)\n  server body",
    );
  });

  it("stepContext frames the current step (with/without lines), '' when none", async () => {
    expect(reviewStore.stepContext()).toBe("");
    await loadOk();
    expect(reviewStore.stepContext()).toBe("Step: Guard (src/a.ts:10-20)\nguard body");
    reviewStore.next();
    expect(reviewStore.stepContext()).toBe("Step: Server (src/b.ts)\nserver body");
  });

  it("askAboutStep opens a chat from the step body, falls back to highlight, no-ops without a step", async () => {
    const opened = vi.mocked(chatStore.openSelection);
    reviewStore.askAboutStep(); // no review
    expect(opened).not.toHaveBeenCalled();

    await loadOk();
    reviewStore.askAboutStep();
    expect(opened).toHaveBeenCalledWith(
      expect.objectContaining({ file: "src/a.ts", text: "guard body", lines: { start: 10, end: 20 } }),
      true,
    );

    opened.mockClear();
    state.review = mkReview({ steps: [{ id: "h", title: "H", body: "", repo: { owner: "a", name: "b" }, file: "f.ts", highlight: ["hint one"] }] });
    state.reviewStep = 0;
    reviewStore.askAboutStep();
    expect(opened).toHaveBeenCalledWith(expect.objectContaining({ text: "hint one" }), true);

    opened.mockClear();
    state.review = mkReview({ steps: [{ id: "e", title: "E", body: "", repo: { owner: "a", name: "b" }, file: "f.ts" }] }); // no body, no highlight
    state.reviewStep = 0;
    reviewStore.askAboutStep();
    expect(opened).toHaveBeenCalledWith(expect.objectContaining({ text: "" }), true);
  });
});
