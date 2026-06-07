// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("../../muninn", () => ({ storeGet: vi.fn(), storeSet: vi.fn(), storeRemove: vi.fn() }));

import { PANEL_TABS, panelStore, state } from "../store";
import { Panel } from "./Panel";

class ROStub {
  observe(): void {}
  disconnect(): void {}
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ROStub);
  Object.defineProperty(window, "location", {
    value: new URL("https://github.com/acme/widget-api/pull/7/files"),
    writable: true,
  });
  state.spec = null;
  state.panel = { open: false, tab: PANEL_TABS.WALKTHROUGH, pos: null, size: null };
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("Panel", () => {
  it("renders nothing while closed", () => {
    const { container } = render(<Panel />);
    expect(container.innerHTML).toBe("");
  });

  it("opens with the four tabs and a default title, switching tab on click", () => {
    render(<Panel />);
    act(() => panelStore.open());
    expect(screen.getByRole("dialog", { name: "PR Walkthrough" })).toBeTruthy();
    expect(screen.getByText(/No walkthrough yet/)).toBeTruthy(); // walkthrough tab, no spec

    // Radix Tabs (automatic activation) selects on focus — deterministic in jsdom
    act(() => screen.getByRole("tab", { name: "Settings" }).focus());
    expect(panelStore.tab()).toBe("settings");
    expect(screen.getByText("Theme")).toBeTruthy(); // the real SettingsTab now renders here
  });

  it("uses the PR title from the spec when present", () => {
    state.spec = {
      version: 1,
      pr: { url: "u", owner: "a", repo: "b", number: 7, title: "Fix the thing" },
      generatedAt: "t",
      steps: [],
    };
    render(<Panel />);
    act(() => panelStore.open());
    expect(screen.getByRole("dialog", { name: "PR Walkthrough" })).toBeTruthy();
    expect(screen.getByText("Fix the thing")).toBeTruthy();
  });

  it("the close button hides the panel", () => {
    render(<Panel />);
    act(() => panelStore.open());
    fireEvent.click(screen.getByLabelText("Close panel"));
    expect(panelStore.isOpen()).toBe(false);
  });

  it("dragging the header persists the final position", () => {
    render(<Panel />);
    act(() => panelStore.open());
    fireEvent.mouseDown(screen.getByText("PR Walkthrough").parentElement!, { clientX: 40, clientY: 40 });
    fireEvent.mouseMove(document, { clientX: 60, clientY: 70 });
    fireEvent.mouseUp(document);
    expect(panelStore.pos()).toEqual({ left: 0, top: 0 }); // jsdom rects
  });

  it("restores persisted geometry as inline styles", () => {
    state.panel = {
      open: true,
      tab: PANEL_TABS.WALKTHROUGH,
      pos: { left: 11, top: 22 },
      size: { w: 480, h: 500 },
    };
    render(<Panel />);
    const win = document.querySelector<HTMLElement>(".prw-panel")!;
    expect(win.style.left).toBe("11px");
    expect(win.style.width).toBe("480px");
  });
});
