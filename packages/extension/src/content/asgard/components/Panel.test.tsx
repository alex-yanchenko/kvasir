// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../muninn", () => ({ storeGet: vi.fn(), storeSet: vi.fn(), storeRemove: vi.fn() }));

import { launcherStore } from "../launcher";
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
  state.reviewMissing = null;
  state.panel = { open: false, tab: PANEL_TABS.WALKTHROUGH, pos: null, size: null };
  state.history = null;
  state.seen = {};
  state.guideDeleted = false;
  panelStore.setSidebarOpen(true); // module-level nav-column intent — reset to the default (open)
  pairingStore.reset(); // "unknown" → no banner unless a test sets the phase
  // The panel rechecks the connection on open; neutralize the bridge round-trip so
  // unrelated tests don't drift to "down" (the stubbed chrome has no messaging).
  vi.spyOn(pairingStore, "recheck").mockResolvedValue(undefined);
  vi.spyOn(launcherStore, "specLoading").mockReturnValue(false); // spec probes are done in these tests
  state.firstRun = false; // onboarding dismissed — Panel tests assert the plain empty state
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Panel", () => {
  it("renders nothing while closed", () => {
    const { container } = render(<Panel />);
    expect(container.innerHTML).toBe("");
  });

  // The rail's active icon is the nav-column toggle (VS Code activity-bar
  // semantics). Real pointer activation captures the pressed tab on pointerdown —
  // BEFORE Radix's focus-activation can switch it — so tests toggle via
  // pointerDown + click and switch via focus().
  const clickTab = (name: string): void => {
    const tab = screen.getByRole("tab", { name });
    fireEvent.pointerDown(tab);
    fireEvent.click(tab);
  };

  it("shows the nav column by default; clicking the ACTIVE rail icon toggles it", () => {
    panelStore.setSidebarWidth(190); // pin: the fold math reads the module-level width
    render(<Panel />);
    act(() => panelStore.open()); // default 860 wide → the column fits
    expect(screen.getByTestId("sidebar")).toBeTruthy();
    clickTab("Walkthrough"); // already active → toggles the column away
    expect(screen.queryByTestId("sidebar")).toBeNull();
    expect(panelStore.sidebarOpen()).toBe(false); // the intent is persisted
    clickTab("Walkthrough");
    expect(screen.getByTestId("sidebar")).toBeTruthy();
  });

  it("clicking a DIFFERENT rail icon switches the tab without toggling the column", () => {
    panelStore.setSidebarWidth(190);
    render(<Panel />);
    act(() => panelStore.open());
    // focus() drives Radix's automatic activation (what a real pointerdown does)
    const chat = screen.getByRole("tab", { name: "Chat" });
    fireEvent.pointerDown(chat); // captured tab = walkthrough (pre-switch)
    act(() => chat.focus()); // Radix switches on focus
    fireEvent.click(chat);
    expect(panelStore.tab()).toBe("chat");
    expect(screen.getByTestId("sidebar")).toBeTruthy(); // column untouched
    expect(panelStore.sidebarOpen()).toBe(true);
  });

  it("a narrow window folds the nav column; the active rail icon shows it as an overlay", () => {
    panelStore.setSidebarWidth(190); // pin: the fold math reads the module-level width
    state.panel.size = { w: 400, h: 400 }; // below the 520 fold width
    render(<Panel />);
    act(() => panelStore.open());
    expect(screen.queryByTestId("sidebar")).toBeNull(); // folded — even though sidebarOpen is true
    clickTab("Walkthrough");
    expect(screen.getByTestId("sidebar")).toBeTruthy(); // the transient overlay
    expect(panelStore.sidebarOpen()).toBe(true); // the persisted intent is untouched
    clickTab("Walkthrough");
    expect(screen.queryByTestId("sidebar")).toBeNull();
  });

  it("keyboard: Enter on the ALREADY-ACTIVE icon toggles; Enter right after arriving only switches", () => {
    panelStore.setSidebarWidth(190);
    render(<Panel />);
    act(() => panelStore.open());
    const walkthrough = screen.getByRole("tab", { name: "Walkthrough" });
    act(() => walkthrough.focus()); // keyboard arrival on the active icon — captured as active
    fireEvent.click(walkthrough); // Enter's synthetic click
    expect(screen.queryByTestId("sidebar")).toBeNull(); // toggled off
    fireEvent.click(walkthrough); // Enter again (pressed tab refreshed after each click)
    expect(screen.getByTestId("sidebar")).toBeTruthy();

    // keyboard arrival on an INACTIVE icon: focus switches it (Radix automatic
    // activation); the first Enter must NOT also toggle — that's the switch
    const chat = screen.getByRole("tab", { name: "Chat" });
    act(() => chat.focus());
    expect(panelStore.tab()).toBe("chat");
    fireEvent.click(chat); // Enter right after arriving
    expect(screen.getByTestId("sidebar")).toBeTruthy(); // column untouched
    fireEvent.click(chat); // a second Enter IS the deliberate toggle
    expect(screen.queryByTestId("sidebar")).toBeNull();
  });

  it("a real mousedown-driven switch (Radix's actual activation path) doesn't toggle the column", () => {
    panelStore.setSidebarWidth(190);
    render(<Panel />);
    act(() => panelStore.open());
    const chat = screen.getByRole("tab", { name: "Chat" });
    fireEvent.pointerDown(chat); // captures the pre-switch tab
    fireEvent.mouseDown(chat); // Radix switches here on real clicks
    fireEvent.click(chat);
    expect(panelStore.tab()).toBe("chat");
    expect(screen.getByTestId("sidebar")).toBeTruthy(); // switched, not toggled
  });

  it("the transient overlay resets when the window grows past the fold", () => {
    panelStore.setSidebarWidth(190);
    state.panel.size = { w: 400, h: 400 };
    render(<Panel />);
    act(() => panelStore.open());
    clickTab("Walkthrough"); // overlay on
    expect(screen.getByTestId("sidebar")).toBeTruthy();
    act(() => panelStore.setSize({ w: 900, h: 400 })); // unfolds → inline column
    expect(screen.getByTestId("sidebar")).toBeTruthy();
    act(() => panelStore.setSize({ w: 400, h: 400 })); // folds again — overlay did not persist
    expect(screen.queryByTestId("sidebar")).toBeNull();
  });

  it("fits exactly at the fold-width boundary (>=, not >)", () => {
    panelStore.setSidebarWidth(190); // threshold = max(520, 48 + 190 + 3 + 240 = 481) = 520
    state.panel.size = { w: 520, h: 400 };
    render(<Panel />);
    act(() => panelStore.open());
    expect(screen.getByTestId("sidebar")).toBeTruthy();
  });

  it("unfolding needs FOLD_HYSTERESIS more width than folding (no flap at the boundary)", () => {
    panelStore.setSidebarWidth(190); // fold threshold 520 → unfold at 560
    state.panel.size = { w: 560, h: 400 };
    render(<Panel />);
    act(() => panelStore.open());
    expect(screen.getByTestId("sidebar")).toBeTruthy();
    act(() => panelStore.setSize({ w: 510, h: 400 })); // below 520 → folds
    expect(screen.queryByTestId("sidebar")).toBeNull();
    act(() => panelStore.setSize({ w: 555, h: 400 })); // above 520 but inside the band → stays folded
    expect(screen.queryByTestId("sidebar")).toBeNull();
    act(() => panelStore.setSize({ w: 560, h: 400 })); // clears the band → unfolds
    expect(screen.getByTestId("sidebar")).toBeTruthy();
  });

  it("Escape closes the folded overlay first; the next press closes the panel", () => {
    state.panel.size = { w: 400, h: 400 }; // folded
    render(<Panel />);
    act(() => panelStore.open());
    clickTab("Walkthrough");
    expect(screen.getByTestId("sidebar")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("sidebar")).toBeNull(); // overlay dismissed
    expect(state.panel.open).toBe(true); // panel survived
    fireEvent.keyDown(document, { key: "Escape" });
    expect(state.panel.open).toBe(false);
  });

  it("folds the nav column when a wide sidebar leaves no room for minimum content", () => {
    state.panel.size = { w: 560, h: 400 }; // ≥ 520, but 48 + 300 + 3 + 240 = 591 > 560
    panelStore.setSidebarWidth(300);
    render(<Panel />);
    act(() => panelStore.open());
    expect(screen.queryByTestId("sidebar")).toBeNull();
  });

  it("the bottom-left corner grip resizes the window from its left edge (width + height)", () => {
    state.panel.size = { w: 600, h: 400 };
    panelStore.setSidebarWidth(200);
    render(<Panel />);
    act(() => panelStore.open());
    const setSize = vi.spyOn(panelStore, "setSize");
    const setPos = vi.spyOn(panelStore, "setPos");
    const corner = screen.getByTestId("resize-corner");
    fireEvent.mouseDown(corner, { clientX: 200, clientY: 200 });
    fireEvent.mouseMove(document, { clientX: 160, clientY: 260 }); // left 40 → wider; down 60 → taller
    fireEvent.mouseUp(document);
    expect(setSize).toHaveBeenLastCalledWith({ w: 640, h: 460 });
    expect(panelStore.sidebarWidth()).toBe(200); // the sidebar split is the divider's job
    expect(setPos).not.toHaveBeenCalled(); // no stored pos (bottom-right anchored) → grows left on its own
  });

  it("the corner grip visually resizes the window during the drag (render, not just store)", () => {
    state.panel.size = { w: 600, h: 400 };
    render(<Panel />);
    act(() => panelStore.open());
    const win = document.querySelector<HTMLElement>(".kvasir-panel")!;
    expect(win.style.width).toBe("600px");
    fireEvent.mouseDown(screen.getByTestId("resize-corner"), { clientX: 200, clientY: 200 });
    fireEvent.mouseMove(document, { clientX: 160, clientY: 260 }); // left 40, down 60
    fireEvent.mouseUp(document);
    expect(win.style.width).toBe("640px"); // the inline style followed the store
    expect(win.style.height).toBe("460px");
  });

  it("the corner grip on a positioned window shifts the left edge out (right edge fixed)", () => {
    state.panel.size = { w: 500, h: 400 };
    state.panel.pos = { left: 100, top: 50 };
    render(<Panel />);
    act(() => panelStore.open());
    const setSize = vi.spyOn(panelStore, "setSize");
    const setPos = vi.spyOn(panelStore, "setPos");
    const corner = screen.getByTestId("resize-corner");
    fireEvent.mouseDown(corner, { clientX: 200, clientY: 200 });
    fireEvent.mouseMove(document, { clientX: 170, clientY: 280 }); // left 30 → wider; down 80 → taller
    fireEvent.mouseUp(document);
    expect(setSize).toHaveBeenLastCalledWith({ w: 530, h: 480 });
    expect(setPos).toHaveBeenLastCalledWith({ left: 70, top: 50 }); // left edge out by 30, right edge fixed
  });

  it("the corner grip floors the window at rail + minimum content", () => {
    state.panel.size = { w: 300, h: 400 };
    state.panel.pos = { left: 100, top: 50 };
    render(<Panel />);
    act(() => panelStore.open());
    const setSize = vi.spyOn(panelStore, "setSize");
    const setPos = vi.spyOn(panelStore, "setPos");
    const corner = screen.getByTestId("resize-corner");
    fireEvent.mouseDown(corner, { clientX: 200, clientY: 200 });
    fireEvent.mouseMove(document, { clientX: 240, clientY: 200 }); // right 40: wants 260, floored at 288
    fireEvent.mouseUp(document);
    expect(setSize).toHaveBeenLastCalledWith({ w: 288, h: 400 }); // 48 rail + 240 content
    expect(setPos).toHaveBeenLastCalledWith({ left: 112, top: 50 }); // only the applied 12 shrink moves the edge
  });

  it("the sidebar divider redistributes width; the window stays put", () => {
    state.panel.size = { w: 600, h: 400 };
    panelStore.setSidebarWidth(200); // deterministic start
    render(<Panel />);
    act(() => panelStore.open());
    const setSize = vi.spyOn(panelStore, "setSize");
    const setPos = vi.spyOn(panelStore, "setPos");
    const divider = screen.getByLabelText("Resize sidebar");
    fireEvent.mouseDown(divider, { clientX: 100 });
    fireEvent.mouseMove(document, { clientX: 130 }); // +30 → sidebar 230
    fireEvent.mouseUp(document);
    expect(panelStore.sidebarWidth()).toBe(230); // sidebar grew by 30; content absorbed it
    expect(setSize).not.toHaveBeenCalled(); // window untouched
    expect(setPos).not.toHaveBeenCalled(); // window position untouched
  });

  it("the divider arrow keys nudge the split; a non-arrow key is ignored", () => {
    state.panel.size = { w: 600, h: 400 };
    panelStore.setSidebarWidth(200);
    render(<Panel />);
    act(() => panelStore.open());
    const setSize = vi.spyOn(panelStore, "setSize");
    const divider = screen.getByLabelText("Resize sidebar");
    fireEvent.keyDown(divider, { key: "Enter" }); // ignored
    expect(panelStore.sidebarWidth()).toBe(200);
    fireEvent.keyDown(divider, { key: "ArrowRight" }); // +16
    expect(panelStore.sidebarWidth()).toBe(216);
    fireEvent.keyDown(divider, { key: "ArrowLeft" }); // −16
    expect(panelStore.sidebarWidth()).toBe(200);
    expect(setSize).not.toHaveBeenCalled(); // the split never resizes the window
  });

  it("the divider stops where content would drop below its minimum", () => {
    state.panel.size = { w: 520, h: 400 }; // max sidebar = 520 − 48 − 3 − 240 = 229
    panelStore.setSidebarWidth(220);
    render(<Panel />);
    act(() => panelStore.open());
    const divider = screen.getByLabelText("Resize sidebar");
    fireEvent.keyDown(divider, { key: "ArrowRight" }); // wants 236, capped to 229
    expect(panelStore.sidebarWidth()).toBe(229);
  });

  it("the corner grip is available even while the nav column is folded", () => {
    state.panel.size = { w: 400, h: 400 };
    render(<Panel />);
    act(() => panelStore.open());
    expect(screen.getByTestId("resize-corner")).toBeTruthy();
  });

  it("attaches the resize observer only once the panel opens (so size persists across refresh)", () => {
    render(<Panel />);
    expect(observed).toEqual([]); // closed at boot — nothing to observe yet
    act(() => panelStore.open());
    expect(observed).toEqual([screen.getByRole("dialog", { name: "Kvasir" })]);
  });

  // jsdom reports 0 for offsetWidth/Height; pin them so the observer math is testable.
  const pinSize = (w: number, h: number): void => {
    const dialog = screen.getByRole("dialog", { name: "Kvasir" });
    Object.defineProperty(dialog, "offsetWidth", { value: w, configurable: true });
    Object.defineProperty(dialog, "offsetHeight", { value: h, configurable: true });
  };

  it("persists the panel size when the resize observer fires (debounced)", () => {
    vi.useFakeTimers();
    const setSize = vi.spyOn(panelStore, "setSize");
    render(<Panel />);
    act(() => panelStore.open());
    pinSize(600, 400);
    act(() => roCallback?.());
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(setSize).toHaveBeenCalledWith({ w: 600, h: 400 }); // the observed size IS the stored window size
    expect(setSize).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("floors the stored width at rail + minimum content so a narrow window self-heals", () => {
    vi.useFakeTimers();
    const setSize = vi.spyOn(panelStore, "setSize");
    render(<Panel />);
    act(() => panelStore.open());
    pinSize(200, 400); // below the 288 window minimum
    act(() => roCallback?.());
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(setSize).toHaveBeenCalledWith({ w: 288, h: 400 }); // 48 rail + 240 content
    vi.useRealTimers();
  });

  it("opens with the four rail sections and a default title, switching tab on click", () => {
    render(<Panel />);
    act(() => panelStore.open());
    expect(screen.getByRole("dialog", { name: "Kvasir" })).toBeTruthy();
    expect(screen.getByText(/No walkthrough yet/)).toBeTruthy(); // walkthrough tab, no spec
    expect(screen.getAllByRole("tab").map((t) => t.getAttribute("aria-label"))).toEqual([
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
    expect(screen.getAllByRole("tab").map((t) => t.getAttribute("aria-label"))).toEqual([
      "Walkthrough",
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

  it("rechecks the connection when the panel opens", () => {
    render(<Panel />);
    expect(pairingStore.recheck).not.toHaveBeenCalled(); // closed → no probe
    act(() => panelStore.open());
    expect(pairingStore.recheck).toHaveBeenCalledTimes(1);
  });

  it("the banner names a down channel and Retry re-probes it", () => {
    render(<Panel />);
    act(() => panelStore.open());
    vi.spyOn(pairingStore, "state").mockReturnValue({ phase: "down" });
    act(() => panelStore.setTab(PANEL_TABS.CHAT)); // any non-settings tab; forces a re-render
    expect(screen.getByText(/Channel not running/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Pair" })).toBeNull(); // pairing can't help a dead channel
    vi.mocked(pairingStore.recheck).mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(pairingStore.recheck).toHaveBeenCalledTimes(1);
  });

  it("the rail-foot status dot names and colors each connection phase", () => {
    render(<Panel />);
    act(() => panelStore.open());
    const stateSpy = vi.spyOn(pairingStore, "state");
    for (const [phase, label, dotClass] of [
      [{ phase: "paired" }, "Connected to your Claude session", "bg-success kvasir-dot-glow"],
      [{ phase: "down" }, "Channel not running", "bg-destructive"],
      [{ phase: "unpaired" }, "Not paired", "bg-warning"],
      [{ phase: "waiting", code: "ABC234" }, "Pairing…", "bg-warning"],
      [{ phase: "error", message: "x" }, "Pairing failed", "bg-warning"],
      [{ phase: "unknown" }, "Checking connection…", "bg-muted-foreground/40"],
    ] as const) {
      stateSpy.mockReturnValue(phase);
      act(() => store.touch());
      expect(screen.getByLabelText(label).className).toContain(dotClass);
    }
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

  it("badges the History rail icon when stored entries need syncing", () => {
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
    expect(screen.getByRole("tab", { name: "History" }).textContent).toBe("1"); // the icon is aria-hidden; the badge is the only text
    expect(screen.getByLabelText("1 need sync")).toBeTruthy();
  });

  it("shows a dismissable 'deleted' notice when the viewed walkthrough was removed", () => {
    state.guideDeleted = true; // review/spec already null from beforeEach
    render(<Panel />);
    act(() => panelStore.open());
    expect(screen.getByText("This walkthrough was deleted.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText("This walkthrough was deleted.")).toBeNull();
  });

  it("explains a ?kvasir link this channel doesn't have (machine-local links)", () => {
    state.reviewMissing = "notfound";
    render(<Panel />);
    act(() => panelStore.open());
    expect(screen.getByText(/only open on the machine that built them/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(state.reviewMissing).toBeNull();
  });

  it("a machine-local miss never doubles up with the connection banner's down message", () => {
    vi.spyOn(pairingStore, "state").mockReturnValue({ phase: "down" });
    state.reviewMissing = "notfound";
    render(<Panel />);
    act(() => panelStore.open());
    expect(screen.getAllByText(/in your terminal/)).toHaveLength(1); // PairBanner only
    expect(screen.getByText(/only open on the machine that built them/)).toBeTruthy();
  });

  it("Escape closes the panel; other keys don't", () => {
    render(<Panel />);
    act(() => panelStore.open());
    fireEvent.keyDown(document, { key: "a" });
    expect(state.panel.open).toBe(true);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(state.panel.open).toBe(false);
  });

  it("Escape with the real regen dialog open closes only the dialog, not the panel", () => {
    state.spec = {
      version: 1,
      pr: { url: "https://github.com/acme/widget-api/pull/7", owner: "acme", repo: "widget-api", number: 7 },
      generatedAt: "t",
      steps: [{ id: "s1", title: "First step", body: "b", file: "f.ts", anchor: "d1" }],
    };
    render(<Panel />);
    act(() => panelStore.open());
    fireEvent.click(screen.getByRole("button", { name: "Regenerate" }));
    expect(screen.getByText(/Regenerate this walkthrough/)).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByText(/Regenerate this walkthrough/)).toBeNull(); // dialog closed
    expect(state.panel.open).toBe(true); // panel survived the first press
    fireEvent.keyDown(document, { key: "Escape" });
    expect(state.panel.open).toBe(false); // the second press closes the panel
  });

  it("Escape from inside the shadow root also closes the panel", () => {
    const host = document.createElement("div");
    host.id = "kvasir-root";
    document.body.append(host);
    const shadow = host.attachShadow({ mode: "open" });
    const mount = document.createElement("div");
    shadow.append(mount);
    render(<Panel />, { container: mount });
    act(() => panelStore.open());
    act(() => {
      shadow.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(state.panel.open).toBe(false);
    cleanup();
    host.remove();
  });

  it("Escape in a text field or with a modal open leaves the panel alone", () => {
    render(<Panel />);
    act(() => panelStore.open());
    const input = document.createElement("input");
    document.body.append(input);
    fireEvent.keyDown(input, { key: "Escape" });
    expect(state.panel.open).toBe(true);
    input.remove();

    const editable = document.createElement("div");
    Object.defineProperty(editable, "isContentEditable", { value: true });
    document.body.append(editable);
    fireEvent.keyDown(editable, { key: "Escape" });
    expect(state.panel.open).toBe(true);
    editable.remove();

    const plain = document.createElement("div");
    document.body.append(plain); // a non-editable element target still closes
    fireEvent.keyDown(plain, { key: "Escape" });
    expect(state.panel.open).toBe(false);
    act(() => panelStore.open());
    plain.remove();

    const modal = document.createElement("div");
    modal.className = "kvasir-dialog-back";
    document.body.append(modal);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(state.panel.open).toBe(true); // the modal owns Escape
    modal.remove();
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
