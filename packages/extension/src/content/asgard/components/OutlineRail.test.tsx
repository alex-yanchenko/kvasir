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

  it("renders logical groups (in first-appearance order) when steps declare a group, with global indices intact", () => {
    state.spec = {
      ...spec3("rail-grp"),
      steps: [
        { id: "s1", title: "First step", body: "b1", file: "f.ts", anchor: "x1", group: "Foundation" },
        { id: "s2", title: "Second step", body: "b2", file: "g.ts", anchor: "x2", group: "Consumers" },
        { id: "s3", title: "Third step", body: "b3", file: "f.ts", anchor: "x3", group: "Foundation" },
      ],
    };
    tourStore.start();
    render(<OutlineRail />);
    const rail = screen.getByTestId("outline");
    // non-adjacent s1 + s3 (both "Foundation") merge into ONE header, before "Consumers"
    const headers = [...rail.querySelectorAll("div.uppercase")].map((node) => node.textContent);
    expect(headers).toEqual(["Foundation", "Consumers"]);
    // the file path is shown per step now that the header is the phase
    expect(rail.textContent).toContain("f.ts");
    // clicking the second step in the "Foundation" group jumps to its GLOBAL index (s3 = 2)
    const foundation = within(rail).getAllByRole("button")[0]!.closest("div.mb-2")!;
    fireEvent.click(within(foundation as HTMLElement).getByText("Third step"));
    expect(tourStore.stepIndex()).toBe(2);
  });

  it("buckets ungrouped steps into a trailing 'Other' group when only some steps declare a group", () => {
    state.spec = {
      ...spec3("rail-grp-mixed"),
      steps: [
        { id: "s1", title: "First step", body: "b1", file: "f.ts", anchor: "x1", group: "Setup" },
        { id: "s2", title: "Second step", body: "b2", file: "g.ts", anchor: "x2", group: "Setup" },
        { id: "s3", title: "Third step", body: "b3", file: "g.ts", anchor: "x3" },
      ],
    };
    tourStore.start();
    render(<OutlineRail />);
    const headers = [...screen.getByTestId("outline").querySelectorAll("div.uppercase")].map(
      (node) => node.textContent,
    );
    expect(headers).toEqual(["Setup", "Other"]); // ungrouped lands last
  });

  it("guardrail: ignores degenerate grouping (a distinct label on every step) and falls back to the file outline", () => {
    state.spec = {
      ...spec3("rail-grp-degenerate"),
      steps: [
        { id: "s1", title: "First step", body: "b1", file: "f.ts", anchor: "x1", group: "A" },
        { id: "s2", title: "Second step", body: "b2", file: "g.ts", anchor: "x2", group: "B" },
        { id: "s3", title: "Third step", body: "b3", file: "h.ts", anchor: "x3", group: "C" },
      ],
    };
    tourStore.start();
    render(<OutlineRail />);
    const rail = screen.getByTestId("outline");
    // one-group-per-step adds no structure → no logical (uppercase) headers; file headers instead
    expect(rail.querySelectorAll("div.uppercase").length).toBe(0);
    expect(rail.querySelector("div.font-mono")?.textContent).toBe("f.ts");
  });

  it("guardrail: ignores a single all-steps group and falls back to the file outline", () => {
    state.spec = {
      ...spec3("rail-grp-single"),
      steps: [
        { id: "s1", title: "First step", body: "b1", file: "f.ts", anchor: "x1", group: "Everything" },
        { id: "s2", title: "Second step", body: "b2", file: "f.ts", anchor: "x2", group: "Everything" },
        { id: "s3", title: "Third step", body: "b3", file: "g.ts", anchor: "x3", group: "Everything" },
      ],
    };
    tourStore.start();
    render(<OutlineRail />);
    expect(screen.getByTestId("outline").querySelectorAll("div.uppercase").length).toBe(0);
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
