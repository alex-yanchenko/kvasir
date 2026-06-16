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
    {
      id: "b",
      title: "Server",
      body: "server body",
      repo: { owner: "acme", name: "api" },
      ref: "main",
      file: "src/b.ts",
    },
  ],
  ...over,
});

// Three steps all in the same file → step nav stays on the page (hash only).
const sameFileReview = (): Review => ({
  version: 1,
  id: "rev-1",
  title: "Auth flow",
  steps: [
    {
      id: "a",
      title: "A",
      body: "b",
      repo: { owner: "acme", name: "web" },
      ref: "main",
      file: "src/a.ts",
      lines: { start: 1, end: 2 },
    },
    {
      id: "b",
      title: "B",
      body: "b",
      repo: { owner: "acme", name: "web" },
      ref: "main",
      file: "src/a.ts",
      lines: { start: 5, end: 6 },
    },
    {
      id: "c",
      title: "C",
      body: "b",
      repo: { owner: "acme", name: "web" },
      ref: "main",
      file: "src/a.ts",
      lines: { start: 9, end: 10 },
    },
  ],
});

// Two steps in the SAME repo but DIFFERENT files → GitHub soft-navigates between them.
const sameRepoReview = (): Review => ({
  version: 1,
  id: "rev-1",
  title: "Auth flow",
  steps: [
    {
      id: "a",
      title: "A",
      body: "b",
      repo: { owner: "acme", name: "web" },
      ref: "main",
      file: "src/a.ts",
      lines: { start: 1, end: 2 },
    },
    {
      id: "b",
      title: "B",
      body: "b",
      repo: { owner: "acme", name: "web" },
      ref: "main",
      file: "src/b.ts",
      lines: { start: 5, end: 6 },
    },
  ],
});

let assign: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers(); // reveal defers the cross-file navigation via setTimeout
  sessionStorage.clear();
  state.review = null;
  state.reviewStep = 0;
  state.reviewNavigating = false;
  state.reviewSync = true; // synced is the default
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
    expect(state.panel.open).toBe(false);
    expect(reviewStore.steps()).toEqual([]);
    expect(reviewStore.stepCount()).toBe(0);
    expect(reviewStore.stepIndex()).toBe(0);
    expect(reviewStore.step()).toBeNull();
    expect(reviewStore.title()).toBe("");
  });

  it("expose the loaded steps", async () => {
    await loadOk();
    expect(reviewStore.steps()).toEqual(mkReview().steps);
  });
});

describe("reviewStore.load", () => {
  it("pulls the review, opens the panel, defaults the step to 0", async () => {
    await loadOk();
    expect(state.panel.open).toBe(true);
    expect(reviewStore.title()).toBe("Auth flow");
    expect(reviewStore.stepCount()).toBe(2);
    expect(reviewStore.stepIndex()).toBe(0);
    expect(reviewStore.step()).toEqual(mkReview().steps[0]);
    expect(state.panel.open).toBe(true);
    expect(state.panel.tab).toBe("walkthrough"); // a direct ?prw open shows the review
    expect(api).toHaveBeenCalledWith("/review?id=rev-1");
    expect(storeSet).toHaveBeenCalledWith("prw:review:rev-1", { step: 0, review: mkReview() });
    expect(storeSet).toHaveBeenCalledTimes(1); // only the review cache (panel state persists to sessionStorage)
  });

  it("keeps the panel on History when the hydrated tab is History (a History jump)", async () => {
    state.panel.tab = "history"; // hydratePanel restored this from the per-tab state
    await loadOk();
    expect(state.panel.open).toBe(true);
    expect(state.panel.tab).toBe("history");
  });

  it("restores a saved step and clamps a stale one past the end", async () => {
    await loadOk(mkReview(), { step: 1 });
    expect(reviewStore.stepIndex()).toBe(1);
    await loadOk(mkReview(), { step: 9 }); // only 2 steps → clamp to 1
    expect(reviewStore.stepIndex()).toBe(1);
  });

  it("renders instantly from the cached walk even when the mailbox is unreachable", async () => {
    vi.mocked(storeGet).mockResolvedValue({ step: 1, review: mkReview() });
    vi.mocked(api).mockResolvedValue({ ok: false }); // daemon down / 404
    await reviewStore.load("rev-1");
    expect(state.panel.open).toBe(true); // shown from cache despite the failed fetch
    expect(reviewStore.stepIndex()).toBe(1);
    expect(reviewStore.title()).toBe("Auth flow");
  });

  it("stays closed when the mailbox returns nothing or an invalid review", async () => {
    vi.mocked(api).mockResolvedValue({ ok: false });
    await reviewStore.load("rev-1");
    expect(state.panel.open).toBe(false);
    vi.mocked(api).mockResolvedValue({ ok: true, data: { not: "a review" } });
    await reviewStore.load("rev-1");
    expect(state.panel.open).toBe(false);
    expect(reviewStore.steps()).toEqual([]);
  });
});

describe("reviewStore navigation", () => {
  it("same repo, synced (default): soft-navigates, keeps the current step + loading, advances when the page lands", async () => {
    await loadOk(sameRepoReview());
    globalThis.location.pathname = "/acme/web/blob/main/src/a.ts"; // on step a's file
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    reviewStore.goto(1); // src/b.ts — same repo
    expect(clickSpy).toHaveBeenCalledTimes(1); // soft nav fired
    expect(assign).not.toHaveBeenCalled(); // not a hard load
    expect(reviewStore.navigating()).toBe(true); // loading; step not advanced yet
    expect(reviewStore.stepIndex()).toBe(0);
    globalThis.location.pathname = "/acme/web/blob/main/src/b.ts"; // GitHub landed
    vi.advanceTimersByTime(80);
    expect(reviewStore.stepIndex()).toBe(1);
    expect(reviewStore.navigating()).toBe(false);
  });

  it("same repo, synced: advances after a timeout if the page never lands", async () => {
    await loadOk(sameRepoReview());
    globalThis.location.pathname = "/acme/web/blob/main/src/a.ts";
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    reviewStore.goto(1); // URL never changes to the target
    vi.advanceTimersByTime(80 * 41); // poll times out (> 40 ticks)
    expect(reviewStore.stepIndex()).toBe(1);
    expect(reviewStore.navigating()).toBe(false);
  });

  it("same repo, instant mode: advances the panel immediately", async () => {
    await loadOk(sameRepoReview());
    state.reviewSync = false;
    globalThis.location.pathname = "/acme/web/blob/main/src/a.ts";
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    reviewStore.goto(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(reviewStore.stepIndex()).toBe(1);
    expect(reviewStore.navigating()).toBe(false);
  });

  it("a different REPO keeps the current step on this page, flags loading, then hard-navigates", async () => {
    await loadOk(); // mkReview: step a = acme/web, step b = acme/api (different repos), on /elsewhere
    reviewStore.goto(1);
    expect(reviewStore.stepIndex()).toBe(0); // the current step stays on THIS page
    expect(reviewStore.navigating()).toBe(true);
    expect(storeSet).toHaveBeenCalledWith("prw:review:rev-1", { step: 1, review: mkReview() }); // target cached
    expect(assign).not.toHaveBeenCalled(); // deferred so the loading state paints first
    vi.runAllTimers();
    expect(assign).toHaveBeenCalledWith("https://github.com/acme/api/blob/main/src/b.ts?prw=rev-1");
  });

  it("a step in the current file switches in place + moves the #L highlight (no reload)", async () => {
    await loadOk(sameFileReview());
    globalThis.location.pathname = "/acme/web/blob/main/src/a.ts";
    reviewStore.goto(1); // step b, same file
    expect(reviewStore.stepIndex()).toBe(1);
    expect(globalThis.location.hash).toBe("#L5-L6");
    expect(reviewStore.navigating()).toBe(false);
    expect(assign).not.toHaveBeenCalled();
  });

  it("next/back move within bounds and no-op at the edges (same-file, in place)", async () => {
    await loadOk(sameFileReview());
    globalThis.location.pathname = "/acme/web/blob/main/src/a.ts";
    reviewStore.back(); // at first → no-op
    expect(reviewStore.stepIndex()).toBe(0);
    reviewStore.next();
    expect(reviewStore.stepIndex()).toBe(1);
    reviewStore.next();
    expect(reviewStore.stepIndex()).toBe(2);
    reviewStore.next(); // at last → no-op
    expect(reviewStore.stepIndex()).toBe(2);
    reviewStore.back();
    expect(reviewStore.stepIndex()).toBe(1);
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
    expect(storeSet).toHaveBeenCalledWith("prw:review:", { step: 0, review: mkReview({ id: undefined }) });
    expect(assign).not.toHaveBeenCalled();
  });

  it("goto writes a content-only sessionStorage snapshot (review + step) for the next page", async () => {
    await loadOk();
    reviewStore.goto(1); // cross-file
    const snap: unknown = JSON.parse(sessionStorage.getItem("prw:session:rev-1") ?? "null");
    expect(snap).toEqual({ step: 1, review: mkReview() }); // geometry lives in the per-tab panel state
  });

  it("goto survives a sessionStorage write failure", async () => {
    await loadOk();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage disabled");
    });
    expect(() => reviewStore.goto(1)).not.toThrow();
  });
});

describe("reviewStore.hydrate", () => {
  const atReviewUrl = (): void => {
    globalThis.location.href = "https://github.com/acme/web/blob/main/src/a.ts?prw=rev-1";
  };

  it("synchronously restores review + step and opens the panel from the session snapshot", () => {
    atReviewUrl();
    sessionStorage.setItem("prw:session:rev-1", JSON.stringify({ step: 1, review: mkReview() }));
    reviewStore.hydrate();
    expect(state.panel.open).toBe(true);
    expect(state.panel.tab).toBe("walkthrough"); // a review page shows the review
    expect(reviewStore.stepIndex()).toBe(1);
    expect(reviewStore.title()).toBe("Auth flow");
  });

  it("keeps the panel on History when hydrate runs after a History-jump hydratePanel", () => {
    atReviewUrl();
    state.panel.tab = "history"; // hydratePanel restored History
    sessionStorage.setItem("prw:session:rev-1", JSON.stringify({ step: 0, review: mkReview() }));
    reviewStore.hydrate();
    expect(state.panel.open).toBe(true);
    expect(state.panel.tab).toBe("history");
  });

  it("is a no-op off a review page, with no snapshot, on garbled JSON, or with no review", () => {
    reviewStore.hydrate(); // location has no ?prw
    expect(state.panel.open).toBe(false);

    atReviewUrl();
    reviewStore.hydrate(); // no snapshot stored
    expect(state.panel.open).toBe(false);

    sessionStorage.setItem("prw:session:rev-1", "{not json");
    reviewStore.hydrate(); // parse throws → caught
    expect(state.panel.open).toBe(false);

    sessionStorage.setItem("prw:session:rev-1", JSON.stringify({ step: 1 })); // no review
    reviewStore.hydrate();
    expect(state.panel.open).toBe(false);
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
    state.reviewStep = 1;
    expect(reviewStore.stepContext()).toBe("Step: Server (src/b.ts)\nserver body");
  });

  it("askAboutStep opens a chat from the step body, falls back to highlight, no-ops without a step", async () => {
    const opened = vi.mocked(chatStore.openSelection);
    reviewStore.askAboutStep(); // no review
    expect(opened).not.toHaveBeenCalled();

    await loadOk();
    reviewStore.askAboutStep();
    expect(opened).toHaveBeenCalledWith(
      {
        selectionId: "src/a.ts::guard body",
        file: "src/a.ts",
        text: "guard body",
        lines: { start: 10, end: 20 },
        rect: { left: 60, top: 90, bottom: 114, height: 24 },
      },
      true,
    );
    expect(opened).toHaveBeenCalledTimes(1);

    opened.mockClear();
    state.review = mkReview({
      steps: [
        {
          id: "h",
          title: "H",
          body: "",
          repo: { owner: "a", name: "b" },
          file: "f.ts",
          highlight: ["hint one"],
        },
      ],
    });
    state.reviewStep = 0;
    reviewStore.askAboutStep();
    expect(opened).toHaveBeenCalledWith(
      {
        selectionId: "f.ts::hint one",
        file: "f.ts",
        text: "hint one",
        lines: null,
        rect: { left: 60, top: 90, bottom: 114, height: 24 },
      },
      true,
    );
    expect(opened).toHaveBeenCalledTimes(1);

    opened.mockClear();
    state.review = mkReview({
      steps: [{ id: "e", title: "E", body: "", repo: { owner: "a", name: "b" }, file: "f.ts" }],
    }); // no body, no highlight
    state.reviewStep = 0;
    reviewStore.askAboutStep();
    expect(opened).toHaveBeenCalledWith(
      {
        selectionId: "f.ts::",
        file: "f.ts",
        text: "",
        lines: null,
        rect: { left: 60, top: 90, bottom: 114, height: 24 },
      },
      true,
    );
    expect(opened).toHaveBeenCalledTimes(1);
  });
});
