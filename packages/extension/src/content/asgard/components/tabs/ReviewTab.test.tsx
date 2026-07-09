// @vitest-environment jsdom
import type { Review } from "@kvasir/runes/review";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../../muninn", () => ({ storeGet: vi.fn(), storeSet: vi.fn(), storeRemove: vi.fn() }));

import { pairingStore } from "../../pairing";
import { reviewStore } from "../../review";
import { PANEL_TABS, panelStore, state } from "../../store";
import { ReviewTab } from "./ReviewTab";

const mkReview = (): Review => ({
  version: 1,
  id: "rev-1",
  title: "Auth flow",
  steps: [
    {
      id: "a",
      title: "Guard",
      body: "guard body",
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
});

beforeEach(() => {
  state.review = mkReview();
  state.reviewStep = 0;
  state.reviewNavigating = false;
  state.panel = { open: true, tab: PANEL_TABS.WALKTHROUGH, pos: null, size: null };
  pairingStore.reset(); // "unknown" → ask enabled unless a test marks unpaired
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ReviewTab", () => {
  it("renders an empty state when no walkthrough is loaded", () => {
    state.review = null;
    render(<ReviewTab />);
    expect(screen.getByText("No walkthrough loaded.")).toBeTruthy();
  });

  it("renders the current step, its position, repo/file, and body", () => {
    render(<ReviewTab />);
    expect(screen.getByRole("heading", { name: "Guard" })).toBeTruthy();
    expect(screen.getByText("acme/web · src/a.ts")).toBeTruthy();
    expect(screen.getByText("Step 1 / 2")).toBeTruthy();
    expect(screen.getByTestId("review-step-body").textContent).toContain("guard body");
    expect(screen.queryByRole("button", { name: "Show details" })).toBeNull(); // step has no detail
  });

  it("shows a details toggle only when the step has detail, and expands it", () => {
    state.review = {
      version: 1,
      id: "rev-1",
      title: "T",
      steps: [
        {
          id: "a",
          title: "A",
          body: "summary",
          detail: "the deep detail",
          repo: { owner: "o", name: "n" },
          file: "a.ts",
        },
      ],
    };
    state.reviewStep = 0;
    render(<ReviewTab />);
    expect(screen.queryByTestId("review-step-detail")).toBeNull(); // collapsed by default
    fireEvent.click(screen.getByRole("button", { name: "Show details" }));
    expect(screen.getByTestId("review-step-detail").textContent).toContain("the deep detail");
  });

  it("disables Back at the first step and Next at the last", () => {
    render(<ReviewTab />);
    expect((screen.getByRole("button", { name: "Previous step" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Next step" }) as HTMLButtonElement).disabled).toBe(false);
    cleanup();
    state.reviewStep = 1;
    render(<ReviewTab />);
    expect((screen.getByRole("button", { name: "Next step" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Previous step" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("wires Next/Back/dots to the store and routes 'ask' to the chat tab", () => {
    // a 3-step review at the middle step → Back AND Next both enabled
    state.review = {
      version: 1,
      id: "rev-1",
      title: "T",
      steps: [
        { id: "a", title: "A", body: "x", repo: { owner: "o", name: "n" }, file: "a.ts" },
        { id: "b", title: "B", body: "x", repo: { owner: "o", name: "n" }, file: "b.ts" },
        { id: "c", title: "C", body: "x", repo: { owner: "o", name: "n" }, file: "c.ts" },
      ],
    };
    state.reviewStep = 1;
    const next = vi.spyOn(reviewStore, "next").mockImplementation(() => {});
    const back = vi.spyOn(reviewStore, "back").mockImplementation(() => {});
    const goto = vi.spyOn(reviewStore, "goto").mockImplementation(() => {});
    const ask = vi.spyOn(reviewStore, "askAboutStep").mockImplementation(() => {});
    render(<ReviewTab />);
    fireEvent.click(screen.getByRole("button", { name: "Next step" }));
    expect(next).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Previous step" }));
    expect(back).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Go to step 2: B" }));
    expect(goto).toHaveBeenCalledWith(1);
    fireEvent.click(screen.getByRole("button", { name: "Ask about this step" }));
    expect(ask).toHaveBeenCalledTimes(1);
    expect(panelStore.tab()).toBe(PANEL_TABS.CHAT);
  });

  it("arrow keys navigate steps, respect the edges, and stay quiet while navigating", () => {
    const next = vi.spyOn(reviewStore, "next").mockImplementation(() => {});
    const back = vi.spyOn(reviewStore, "back").mockImplementation(() => {});
    render(<ReviewTab />); // at the first step: Left must not fire, Right must
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft" }));
    });
    expect(back).not.toHaveBeenCalled();
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
    });
    expect(next).toHaveBeenCalledTimes(1);

    cleanup();
    state.reviewStep = 1; // at the last step: Right must not fire, Left must
    render(<ReviewTab />);
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
    });
    expect(next).toHaveBeenCalledTimes(1); // unchanged
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft" }));
    });
    expect(back).toHaveBeenCalledTimes(1);

    cleanup();
    state.reviewStep = 0;
    state.reviewNavigating = true; // a cross-file nav is in flight — keys must not stack another
    render(<ReviewTab />);
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
    });
    expect(next).toHaveBeenCalledTimes(1); // unchanged
  });

  it("names each step's dot by its title", () => {
    render(<ReviewTab />);
    expect(screen.getByRole("button", { name: "Go to step 1: Guard" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Go to step 2: Server" })).toBeTruthy();
  });

  it("shows a loading state on the nav while a cross-file step is navigating", () => {
    state.reviewNavigating = true;
    render(<ReviewTab />);
    expect((screen.getByRole("button", { name: "Next step" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Previous step" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText("Next")).toBeNull(); // label replaced by the spinner
  });

  it("disables 'ask' while unpaired", () => {
    pairingStore.markUnpaired();
    render(<ReviewTab />);
    expect((screen.getByRole("button", { name: "Ask about this step" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });
});
