// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { WalkthroughSpec } from "@prw/runes/spec";

vi.mock("../../muninn", () => ({ storeGet: vi.fn(), storeSet: vi.fn(), storeRemove: vi.fn() }));

import { state } from "../store";
import { tourStore } from "../tour";
import { TourCard } from "./TourCard";

const PR = "https://github.com/acme/widget-api/pull/7";

const mkSpec = (): WalkthroughSpec => ({
  version: 1,
  pr: { url: PR, owner: "acme", repo: "widget-api", number: 7 },
  generatedAt: "2026-01-01T00:00:00Z",
  steps: [
    {
      id: "s1",
      title: "Step one",
      body: "<b>first</b> step <script>alert(1)</script>",
      detail: "deep <i>detail</i>",
      file: "src/app.ts",
      anchor: "diff-abc",
    },
    { id: "s2", title: "Step two", body: "second", file: "src/b.ts", anchor: "diff-b" },
  ],
});

// jsdom has no ResizeObserver; capture the callback so tests can fire it.
let roCallback: (() => void) | null = null;
class ROStub {
  constructor(cb: () => void) {
    roCallback = cb;
  }
  observe(): void {}
  disconnect(): void {}
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ROStub);
  Object.defineProperty(window, "location", { value: new URL(`${PR}/files`), writable: true });
  state.spec = mkSpec();
  state.tourState = { step: 0, pos: null, size: null };
  state.activeStep = null;
  if (tourStore.open()) tourStore.close();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

const open = () =>
  act(() => {
    tourStore.start();
  });

describe("TourCard", () => {
  it("renders nothing while the tour is closed", () => {
    const { container } = render(<TourCard />);
    expect(container.innerHTML).toBe("");
  });

  it("renders the step with sanitized body html and the count", () => {
    render(<TourCard />);
    open();
    expect(screen.getByText("Step one")).toBeTruthy();
    expect(document.querySelector(".prw-prose")!.innerHTML).toBe("<b>first</b> step alert(1)");
    expect(screen.getByText("1 / 2")).toBeTruthy();
    expect(screen.getByText("Next →")).toBeTruthy();
  });

  it("navigates with the footer buttons; Finish closes", () => {
    render(<TourCard />);
    open();
    fireEvent.click(screen.getByText("Next →"));
    expect(screen.getByText("Step two")).toBeTruthy();
    expect(screen.getByText("Finish ✓")).toBeTruthy();
    fireEvent.click(screen.getByText("← Back"));
    expect(screen.getByText("Step one")).toBeTruthy();
    fireEvent.click(screen.getByText("Next →"));
    fireEvent.click(screen.getByText("Finish ✓"));
    expect(tourStore.open()).toBe(false);
  });

  it("toggles the details and collapses them on a step change", () => {
    render(<TourCard />);
    open();
    fireEvent.click(screen.getByText("Show details ▾"));
    expect(document.querySelector(".prw-detail")!.innerHTML).toBe("deep <i>detail</i>");
    fireEvent.click(screen.getByText("Hide details ▴"));
    expect(document.querySelector(".prw-detail")).toBeNull();
    fireEvent.click(screen.getByText("Show details ▾"));
    fireEvent.click(screen.getByText("Next →"));
    fireEvent.click(screen.getByText("← Back"));
    expect(document.querySelector(".prw-detail")).toBeNull(); // collapsed again
  });

  it("head actions: ask-about-step, re-scroll, close", () => {
    const ask = vi.spyOn(tourStore, "askAboutStep").mockImplementation(() => {});
    const goto = vi.spyOn(tourStore, "goto");
    render(<TourCard />);
    open();
    fireEvent.click(screen.getByLabelText("Ask about this step"));
    expect(ask).toHaveBeenCalledTimes(1);
    goto.mockClear();
    fireEvent.click(screen.getByLabelText("Re-scroll and redraw"));
    expect(goto).toHaveBeenCalledWith(0);
    fireEvent.click(screen.getByLabelText("Close"));
    expect(tourStore.open()).toBe(false);
  });

  it("keyboard: arrows navigate within bounds, Escape closes", () => {
    render(<TourCard />);
    open();
    fireEvent.keyDown(document, { key: "ArrowLeft" }); // at 0 — no-op
    expect(tourStore.stepIdx()).toBe(0);
    fireEvent.keyDown(document, { key: "ArrowRight" });
    expect(tourStore.stepIdx()).toBe(1);
    fireEvent.keyDown(document, { key: "ArrowRight" }); // at end — no-op (keyboard never finishes)
    expect(tourStore.stepIdx()).toBe(1);
    fireEvent.keyDown(document, { key: "Home", metaKey: true });
    expect(tourStore.stepIdx()).toBe(0);
    fireEvent.keyDown(document, { key: "End", metaKey: true });
    expect(tourStore.stepIdx()).toBe(1);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(tourStore.open()).toBe(false);
  });

  it("restores a persisted position and size as inline styles", () => {
    state.tourState = { step: 0, pos: { left: 11, top: 22 }, size: { w: 333, h: 222 } };
    render(<TourCard />);
    open();
    const card = document.querySelector<HTMLElement>(".prw-card")!;
    expect(card.style.left).toBe("11px");
    expect(card.style.top).toBe("22px");
    expect(card.style.width).toBe("333px");
    expect(card.style.height).toBe("222px");
  });

  it("dragging the head persists the final position; clicks on the × never drag", () => {
    const setPos = vi.spyOn(tourStore, "setPos");
    render(<TourCard />);
    open();
    const head = document.querySelector<HTMLElement>(".prw-head")!;
    fireEvent.mouseDown(screen.getByLabelText("Close")); // starts on a .prw-x — ignored
    fireEvent.mouseUp(document);
    expect(setPos).not.toHaveBeenCalled();
    fireEvent.mouseDown(head, { clientX: 5, clientY: 5 });
    fireEvent.mouseMove(document, { clientX: 50, clientY: 60 });
    fireEvent.mouseUp(document);
    expect(setPos).toHaveBeenCalledWith({ left: 0, top: 0 }); // jsdom rects are zero
    expect(setPos).toHaveBeenCalledTimes(1);
  });

  it("persists a resize, debounced", async () => {
    vi.useFakeTimers();
    const setSize = vi.spyOn(tourStore, "setSize");
    render(<TourCard />);
    open();
    act(() => roCallback?.());
    expect(setSize).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(setSize).toHaveBeenCalledWith({ w: 0, h: 0 });
    vi.useRealTimers();
  });

  it("keeps the bottom edge pinned across a step change when the pointer is over the footer", () => {
    render(<TourCard />);
    open();
    const card = document.querySelector<HTMLElement>(".prw-card")!;
    vi.spyOn(card, "getBoundingClientRect").mockReturnValue(
      // the only field the anchor reads
      { bottom: 500, top: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => null },
    );
    // mark as user-moved, then hover the footer so the anchor snapshot arms
    fireEvent.mouseDown(document.querySelector(".prw-head")!);
    fireEvent.mouseMove(document, { clientX: 1, clientY: 1 });
    fireEvent.mouseUp(document);
    fireEvent.mouseMove(card.querySelector(".prw-foot")!);
    fireEvent.click(screen.getByText("Next →"));
    expect(card.style.top).toBe("500px"); // prevBottom 500 - offsetHeight 0
    expect(card.style.bottom).toBe("auto");
    // off the card, the anchor disarms: the next change must not re-pin
    card.style.top = "1px";
    fireEvent.mouseLeave(card);
    fireEvent.click(screen.getByText("← Back"));
    expect(card.style.top).toBe("1px");
  });
});
