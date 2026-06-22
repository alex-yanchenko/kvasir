// @vitest-environment jsdom
import type { WalkthroughSpec } from "@kvasir/runes/spec";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../muninn", () => ({ storeGet: vi.fn(), storeSet: vi.fn(), storeRemove: vi.fn() }));

import { state } from "../store";
import { tourStore } from "../tour";
import { OutlineRail } from "./OutlineRail";

const spec3 = (generatedAt: string): WalkthroughSpec => ({
  version: 1,
  pr: { url: "u", owner: "a", repo: "b", number: 7 },
  generatedAt,
  steps: [
    { id: "s1", title: "First step", body: "b1", file: "f.ts", anchor: "x1" },
    { id: "s2", title: "Second step", body: "b2", file: "f.ts", anchor: "x2" },
    { id: "s3", title: "Third step", body: "b3", file: "g.ts", anchor: "x3" },
  ],
});

beforeEach(() => {
  Object.defineProperty(window, "location", {
    value: new URL("https://github.com/a/b/pull/7/files"),
    writable: true,
  });
  state.spec = null;
  state.tourState = { step: 0, pos: null, size: null };
  if (tourStore.open()) tourStore.close();
});
afterEach(() => cleanup());

describe("OutlineRail", () => {
  it("renders nothing without a spec", () => {
    const { container } = render(<OutlineRail />);
    expect(container.innerHTML).toBe("");
  });

  it("renders the flow as a file-grouped tree with status dots + connectors, and a step navigates", () => {
    state.spec = spec3("rail-1"); // unique stamp → visited set resets on first goto
    tourStore.start(); // goto(0): s1 visited + current
    tourStore.goto(1); // s2 current, s1 visited, s3 upcoming
    render(<OutlineRail />);
    const rail = screen.getByTestId("outline");
    expect(rail.querySelectorAll("ul").length).toBe(2); // f.ts (s1,s2) then g.ts (s3)
    const buttons = within(rail).getAllByRole("button");
    const dot = (button: HTMLElement): Element | null => button.querySelector("span.rounded-full");
    expect(dot(buttons[0]!)?.className).toContain("bg-muted-foreground"); // s1 visited
    expect(dot(buttons[1]!)?.className).toContain("bg-primary"); // s2 current
    expect(dot(buttons[2]!)?.className).toContain("border"); // s3 upcoming (hollow)
    expect(buttons[1]!.getAttribute("aria-current")).toBe("step");
    expect(buttons[0]!.textContent).toContain("├"); // s1 not last in the f.ts group
    expect(buttons[1]!.textContent).toContain("└"); // s2 last in the f.ts group
    fireEvent.click(buttons[2]!);
    expect(tourStore.stepIndex()).toBe(2); // jumped to s3
  });

  it("renders an Overview entry that navigates to step 0 and marks current when active", () => {
    state.spec = { ...spec3("rail-ov"), overview: "<p>ov</p>" };
    tourStore.start(); // opens on a code step, not the overview
    render(<OutlineRail />);
    const overviewBtn = within(screen.getByTestId("outline")).getByRole("button", {
      name: "Overview",
    });
    expect(overviewBtn.getAttribute("aria-current")).toBeNull();
    fireEvent.click(overviewBtn);
    expect(tourStore.atOverview()).toBe(true);
    cleanup();
    render(<OutlineRail />);
    const rail = screen.getByTestId("outline");
    expect(within(rail).getByRole("button", { name: "Overview" }).getAttribute("aria-current")).toBe("step");
    // no code step is marked current while on the overview
    expect(rail.querySelector('[aria-current="step"]')?.textContent).toContain("Overview");
  });

  it("renders no Overview entry when the spec has no overview", () => {
    state.spec = spec3("rail-no-ov");
    tourStore.start();
    render(<OutlineRail />);
    expect(within(screen.getByTestId("outline")).queryByRole("button", { name: "Overview" })).toBeNull();
  });

  it("renders a coverage chip when the spec carries coverage", () => {
    state.spec = { ...spec3("rail-cov"), coverage: { significant: ["f.ts", "g.ts"], uncovered: ["g.ts"] } };
    tourStore.start();
    render(<OutlineRail />);
    const rail = screen.getByTestId("outline");
    expect(within(rail).getByLabelText("Walkthrough coverage of key changed files").textContent).toContain(
      "1/2 key",
    );
  });
});
