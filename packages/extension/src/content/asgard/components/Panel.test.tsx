// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../muninn", () => ({ storeGet: vi.fn(), storeSet: vi.fn(), storeRemove: vi.fn() }));

import { pairingStore } from "../pairing";
import * as store from "../store";
import { PANEL_TABS, panelStore, state } from "../store";
import { tourStore } from "../tour";
import { Panel } from "./Panel";

let observed: Element[];
let roCallback: (() => void) | null;
class ROStub {
  constructor(cb: () => void) {
    roCallback = cb;
  }
  observe(el: Element): void {
    observed.push(el);
  }
  disconnect(): void {}
}

beforeEach(() => {
  observed = [];
  roCallback = null;
  vi.stubGlobal("ResizeObserver", ROStub);
  // Panel auto-loads history on open; with no extension runtime the bridge call is
  // a graceful no-op, but api.ts reads `chrome` — stub it so it isn't a ReferenceError.
  vi.stubGlobal("chrome", { runtime: {} });
  Object.defineProperty(window, "location", {
    value: new URL("https://github.com/acme/widget-api/pull/7/files"),
    writable: true,
  });
  state.spec = null;
  state.review = null;
  state.reviewStep = 0;
  state.panel = { open: false, tab: PANEL_TABS.WALKTHROUGH, pos: null, size: null };
  state.history = null;
  state.seen = {};
  state.guideDeleted = false;
  tourStore.setOutlineOpen(false); // module-level rail state — reset so the panel width is clean
  pairingStore.reset(); // "unknown" → no banner unless a test sets the phase
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Panel", () => {
  it("renders nothing while closed", () => {
    const { container } = render(<Panel />);
    expect(container.innerHTML).toBe("");
  });

  it("toggles the global sidebar from the title bar", () => {
    render(<Panel />);
    act(() => panelStore.open());
    expect(screen.queryByTestId("sidebar")).toBeNull();
    fireEvent.click(screen.getByLabelText("Show sidebar"));
    expect(screen.getByTestId("sidebar")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Hide sidebar"));
    expect(screen.queryByTestId("sidebar")).toBeNull();
  });

  it("toggling on a positioned window shifts the left edge to keep the right edge fixed", () => {
    state.panel.pos = { left: 300, top: 40 };
    tourStore.setRailWidth(200); // chrome on open = 200 + DIVIDER_W(3) = 203
    render(<Panel />);
    act(() => panelStore.open());
    const setPos = vi.spyOn(panelStore, "setPos");
    fireEvent.click(screen.getByLabelText("Show sidebar")); // open → left out by 203
    expect(setPos).toHaveBeenLastCalledWith({ left: 97, top: 40 });
    expect(screen.getByTestId("sidebar")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Hide sidebar")); // close → left pulled back by 203
    expect(setPos).toHaveBeenLastCalledWith({ left: 300, top: 40 });
  });

  it("the bottom-left corner grip grows window height + sidebar; content width stays fixed", () => {
    tourStore.setOutlineOpen(true);
    tourStore.setRailWidth(200);
    render(<Panel />);
    act(() => panelStore.open());
    const setSize = vi.spyOn(panelStore, "setSize");
    const corner = screen.getByTestId("resize-corner");
    fireEvent.mouseDown(corner, { clientX: 200, clientY: 200 });
    fireEvent.mouseMove(document, { clientX: 160, clientY: 260 }); // left 40 → sidebar 240; down 60 → taller
    fireEvent.mouseUp(document);
    expect(tourStore.railWidth()).toBe(240); // sidebar grew; window extends left to fit
    expect(setSize).toHaveBeenLastCalledWith({ w: 420, h: 380 }); // content width fixed (default 420), taller
  });

  it("the corner grip on a positioned window keeps content width and shifts the left edge out", () => {
    state.panel.size = { w: 500, h: 400 }; // exercise the size-set path (not the defaults)
    state.panel.pos = { left: 100, top: 50 }; // positioned → setPos shifts the left edge
    tourStore.setOutlineOpen(true);
    tourStore.setRailWidth(200);
    render(<Panel />);
    act(() => panelStore.open());
    const setSize = vi.spyOn(panelStore, "setSize");
    const setPos = vi.spyOn(panelStore, "setPos");
    const corner = screen.getByTestId("resize-corner");
    fireEvent.mouseDown(corner, { clientX: 200, clientY: 200 });
    fireEvent.mouseMove(document, { clientX: 170, clientY: 280 }); // left 30 → sidebar 230; down 80
    fireEvent.mouseUp(document);
    expect(tourStore.railWidth()).toBe(230); // sidebar grew by 30
    expect(setSize).toHaveBeenLastCalledWith({ w: 500, h: 480 }); // content width fixed, 80 taller
    expect(setPos).toHaveBeenLastCalledWith({ left: 70, top: 50 }); // left edge out by 30, right edge fixed
  });

  it("the sidebar divider redistributes width: sidebar grows, content shrinks, window fixed", () => {
    state.panel.size = { w: 500, h: 400 };
    tourStore.setOutlineOpen(true);
    tourStore.setRailWidth(200); // deterministic start
    render(<Panel />);
    act(() => panelStore.open());
    const setSize = vi.spyOn(panelStore, "setSize");
    const setPos = vi.spyOn(panelStore, "setPos");
    const divider = screen.getByLabelText("Resize sidebar");
    fireEvent.mouseDown(divider, { clientX: 100 });
    fireEvent.mouseMove(document, { clientX: 130 }); // +30 → sidebar 230
    fireEvent.mouseUp(document);
    expect(tourStore.railWidth()).toBe(230); // sidebar grew by 30
    expect(setSize).toHaveBeenLastCalledWith({ w: 470, h: 400 }); // content shrank by 30; window 470+230+3 unchanged
    expect(setPos).not.toHaveBeenCalled(); // window position untouched
  });

  it("the divider arrow keys redistribute width; a non-arrow key is ignored", () => {
    state.panel.size = { w: 500, h: 400 };
    tourStore.setOutlineOpen(true);
    tourStore.setRailWidth(200);
    render(<Panel />);
    act(() => panelStore.open());
    const setSize = vi.spyOn(panelStore, "setSize");
    const divider = screen.getByLabelText("Resize sidebar");
    fireEvent.keyDown(divider, { key: "Enter" }); // ignored
    expect(tourStore.railWidth()).toBe(200);
    expect(setSize).not.toHaveBeenCalled();
    fireEvent.keyDown(divider, { key: "ArrowRight" }); // +16 → sidebar 216, content 484
    expect(tourStore.railWidth()).toBe(216);
    expect(setSize).toHaveBeenLastCalledWith({ w: 484, h: 400 });
  });

  it("shows no corner grip when the sidebar is closed", () => {
    render(<Panel />);
    act(() => panelStore.open());
    expect(screen.queryByTestId("resize-corner")).toBeNull();
  });

  it("attaches the resize observer only once the panel opens (so size persists across refresh)", () => {
    render(<Panel />);
    expect(observed).toEqual([]); // closed at boot — nothing to observe yet
    act(() => panelStore.open());
    expect(observed).toEqual([screen.getByRole("dialog", { name: "Kvasir" })]);
  });

  it("persists the panel size when the resize observer fires (debounced)", () => {
    vi.useFakeTimers();
    const setSize = vi.spyOn(panelStore, "setSize");
    render(<Panel />);
    act(() => panelStore.open());
    act(() => roCallback?.());
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(setSize).toHaveBeenCalledWith({ w: 0, h: 0 }); // jsdom offsetWidth/Height = 0
    expect(setSize).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("opens with the three tabs and a default title, switching tab on click", () => {
    render(<Panel />);
    act(() => panelStore.open());
    expect(screen.getByRole("dialog", { name: "Kvasir" })).toBeTruthy();
    expect(screen.getByText(/No walkthrough yet/)).toBeTruthy(); // walkthrough tab, no spec
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual([
      "Walkthrough",
      "Chat",
      "History",
      "Settings",
    ]);

    // Radix Tabs (automatic activation) selects on focus — deterministic in jsdom
    act(() => screen.getByRole("tab", { name: "Settings" }).focus());
    expect(panelStore.tab()).toBe("settings");
    expect(screen.getByText("Theme")).toBeTruthy(); // the real SettingsTab now renders here
  });

  it("ignores a tab change to an unrecognised value (the isPanelTab guard)", () => {
    vi.spyOn(store, "isPanelTab").mockReturnValue(false);
    const setTab = vi.spyOn(panelStore, "setTab");
    render(<Panel />);
    act(() => panelStore.open());
    act(() => screen.getByRole("tab", { name: "Settings" }).focus()); // Radix emits "settings"
    expect(setTab).not.toHaveBeenCalled(); // guard rejected it → no store write
    expect(panelStore.tab()).toBe(PANEL_TABS.WALKTHROUGH);
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
    expect(screen.getByRole("dialog", { name: "Kvasir" })).toBeTruthy();
    expect(screen.getByText("Fix the thing")).toBeTruthy();
  });

  it("in review-mode (?kvasir) labels the tab Review and renders the review steps + title", () => {
    Object.defineProperty(window, "location", {
      value: new URL("https://github.com/acme/web/blob/main/src/a.ts?kvasir=rev-1"),
      writable: true,
    });
    state.review = {
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
        },
      ],
    };
    render(<Panel />);
    act(() => panelStore.open());
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual([
      "Review",
      "Chat",
      "History",
      "Settings",
    ]);
    expect(screen.getByText("Auth flow")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Guard" })).toBeTruthy();
  });

  it("falls back to a default title when the review has no title", () => {
    Object.defineProperty(window, "location", {
      value: new URL("https://github.com/acme/web/blob/main/src/a.ts?kvasir=rev-1"),
      writable: true,
    });
    state.review = {
      version: 1,
      id: "rev-1",
      title: "",
      steps: [
        {
          id: "a",
          title: "Guard",
          body: "x",
          repo: { owner: "acme", name: "web" },
          ref: "main",
          file: "src/a.ts",
        },
      ],
    };
    render(<Panel />);
    act(() => panelStore.open());
    expect(screen.getByText("Kvasir")).toBeTruthy(); // header title fell back
  });

  it("closing the panel ends the tour (clears the page highlight)", () => {
    state.spec = {
      version: 1,
      pr: { url: "u", owner: "a", repo: "b", number: 7 },
      generatedAt: "t",
      steps: [{ id: "s", title: "S", body: "b", file: "f.ts", anchor: "d1" }],
    };
    render(<Panel />);
    act(() => panelStore.open()); // walkthrough tab mounts Steps → tour starts
    expect(tourStore.open()).toBe(true);
    act(() => panelStore.close());
    expect(tourStore.open()).toBe(false);
  });

  it("shows a global pair banner whenever unpaired, on any tab but Settings", () => {
    const pair = vi.spyOn(pairingStore, "pair").mockResolvedValue();
    render(<Panel />);
    act(() => panelStore.open());
    expect(screen.queryByRole("button", { name: "Pair" })).toBeNull(); // unknown → hidden
    act(() => pairingStore.markUnpaired());
    // the banner's distinct phrasing (SettingsTab's Connection block also says "Not paired")
    expect(screen.getByText(/connect to your Claude session to continue/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Pair" }));
    expect(pair).toHaveBeenCalledTimes(1);
    // hidden on Settings (its own Connection block handles pairing there)
    act(() => panelStore.setTab(PANEL_TABS.SETTINGS));
    expect(screen.queryByText(/connect to your Claude session to continue/)).toBeNull();
  });

  it("the pair banner shows the waiting code and the error message", () => {
    render(<Panel />);
    act(() => panelStore.open());
    vi.spyOn(pairingStore, "state").mockReturnValue({ phase: "waiting", code: "ABC234" });
    act(() => panelStore.setTab(PANEL_TABS.CHAT)); // any non-settings tab; forces a re-render
    expect(screen.getByText("ABC234")).toBeTruthy();
    vi.mocked(pairingStore.state).mockReturnValue({ phase: "error", message: "channel down" });
    act(() => panelStore.setTab(PANEL_TABS.WALKTHROUGH));
    expect(screen.getByText("channel down")).toBeTruthy();
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
    fireEvent.mouseDown(screen.getByText("Kvasir").parentElement!, { clientX: 40, clientY: 40 });
    fireEvent.mouseMove(document, { clientX: 60, clientY: 70 });
    fireEvent.mouseUp(document);
    expect(panelStore.pos()).toEqual({ left: 0, top: 0 }); // jsdom rects
  });

  it("badges the History tab when stored entries need syncing", () => {
    state.history = [
      {
        kind: "code",
        id: "x",
        title: "t",
        repos: ["acme/web"],
        steps: 1,
        url: "u",
        version: 2,
        updatedAt: 1,
      },
    ];
    state.seen = { x: 1 }; // backend at v2, FE last saw v1 -> one stale -> badge "1"
    render(<Panel />);
    act(() => panelStore.open());
    expect(screen.getByRole("tab", { name: /History/ }).textContent).toContain("History1");
  });

  it("shows a dismissable 'deleted' notice when the viewed walkthrough was removed", () => {
    state.guideDeleted = true; // review/spec already null from beforeEach
    render(<Panel />);
    act(() => panelStore.open());
    expect(screen.getByText("This walkthrough was deleted.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText("This walkthrough was deleted.")).toBeNull();
  });

  it("restores persisted geometry as inline styles", () => {
    state.panel = {
      open: true,
      tab: PANEL_TABS.WALKTHROUGH,
      pos: { left: 11, top: 22 },
      size: { w: 480, h: 500 },
    };
    render(<Panel />);
    const win = document.querySelector<HTMLElement>(".kvasir-panel")!;
    expect(win.style.left).toBe("11px");
    expect(win.style.width).toBe("480px");
  });
});
