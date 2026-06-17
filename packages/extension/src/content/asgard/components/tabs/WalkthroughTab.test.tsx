// @vitest-environment jsdom
import type { WalkthroughSpec } from "@kvasir/runes/spec";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../../muninn", () => ({ storeGet: vi.fn(), storeSet: vi.fn(), storeRemove: vi.fn() }));
vi.mock("../../mermaidLoader", () => ({
  loadMermaid: () =>
    Promise.resolve({ initialize: () => {}, render: () => Promise.resolve({ svg: "<svg></svg>" }) }),
}));

import { bifrost } from "../../../bifrost";
import { launcherStore } from "../../launcher";
import { pairingStore } from "../../pairing";
import { PANEL_TABS, panelStore, state } from "../../store";
import { tourStore } from "../../tour";
import { WalkthroughTab } from "./WalkthroughTab";

const mkSpec = (): WalkthroughSpec => ({
  version: 1,
  pr: { url: "u", owner: "a", repo: "b", number: 7, title: "T" },
  generatedAt: "t",
  steps: [
    {
      id: "s1",
      title: "First step",
      body: "<b>body one</b>",
      detail: "deep one",
      file: "f.ts",
      anchor: "d1",
    },
    { id: "s2", title: "Second step", body: "body two", file: "g.ts", anchor: "d2" },
  ],
});

beforeEach(() => {
  Object.defineProperty(window, "location", {
    value: new URL("https://github.com/acme/widget-api/pull/7/files"),
    writable: true,
  });
  state.spec = null;
  state.chatHistory = [];
  state.tourState = { step: 0, pos: null, size: null };
  state.panel = { open: true, tab: PANEL_TABS.WALKTHROUGH, pos: null, size: null };
  pairingStore.reset(); // "unknown" → backend actions enabled unless a test sets unpaired
  if (tourStore.open()) tourStore.close();
  tourStore.setDetailOpen(false); // detail state is module-level now — reset per test
  tourStore.setOutlineOpen(false); // outline state is module-level too — reset per test
  tourStore.setDiagramOpen(false); // diagram overlay state is module-level too
});
afterEach(() => {
  cleanup();
});

describe("WalkthroughTab", () => {
  it("empty state runs a review", () => {
    const gen = vi.spyOn(launcherStore, "requestGenerate").mockResolvedValue();
    render(<WalkthroughTab />);
    fireEvent.click(screen.getByRole("button", { name: "Run review" }));
    expect(gen).toHaveBeenCalledWith("new");
  });

  it("disables backend actions while unpaired", () => {
    pairingStore.markUnpaired();
    state.spec = mkSpec();
    render(<WalkthroughTab />);
    expect((screen.getByLabelText("Ask about this step") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText("Regenerate") as HTMLButtonElement).disabled).toBe(true);
    // local nav stays usable
    expect((screen.getByLabelText("Next step") as HTMLButtonElement).disabled).toBe(false);
  });

  it("generating state shows the timer, ticks the elapsed clock, and can stop watching", () => {
    vi.useFakeTimers();
    vi.spyOn(launcherStore, "generating").mockReturnValue(true);
    vi.spyOn(launcherStore, "genStartAt").mockReturnValue(Date.now() - 5000);
    const dismiss = vi.spyOn(launcherStore, "dismissGen").mockImplementation(() => {});
    render(<WalkthroughTab />);
    expect(screen.getByText("Generating review…")).toBeTruthy();
    expect(screen.getByText(/^0:05/)).toBeTruthy();
    // the 1s interval fires its updater, re-rendering with the next elapsed value
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByText(/^0:06/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Stop watching" }));
    expect(dismiss).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("renders the current step, navigates, and keeps the tour open across unmount", () => {
    state.spec = mkSpec();
    const { unmount } = render(<WalkthroughTab />);
    expect(tourStore.open()).toBe(true); // started on mount
    expect(screen.getByText("First step")).toBeTruthy();
    expect(screen.getByTestId("step-body").innerHTML).toContain("<b>body one</b>");

    fireEvent.click(screen.getByLabelText("Next step"));
    expect(screen.getByText("Second step")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Previous step"));
    expect(screen.getByText("First step")).toBeTruthy();

    unmount();
    expect(tourStore.open()).toBe(true); // tab switch keeps the highlight; the panel close clears it
  });

  it("disables Next on the last step and stays there", () => {
    state.spec = mkSpec();
    render(<WalkthroughTab />);
    const next = screen.getByLabelText("Next step");
    expect((next as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(next); // to the last step
    expect(screen.getByText("Second step")).toBeTruthy();
    expect((screen.getByLabelText("Next step") as HTMLButtonElement).disabled).toBe(true);
    expect(tourStore.open()).toBe(true);
  });

  it("a progress dot jumps to that step", () => {
    state.spec = mkSpec();
    render(<WalkthroughTab />);
    fireEvent.click(screen.getByLabelText("Go to step 2"));
    expect(screen.getByText("Second step")).toBeTruthy();
  });

  it("toggles step detail", () => {
    state.spec = mkSpec();
    render(<WalkthroughTab />);
    expect(screen.queryByTestId("step-detail")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show details" }));
    expect(screen.getByTestId("step-detail")).toBeTruthy();
  });

  it("keeps 'Show details' expanded across step navigation", () => {
    state.spec = {
      version: 1,
      pr: { url: "u", owner: "a", repo: "b", number: 7 },
      generatedAt: "t",
      steps: [
        { id: "s1", title: "First step", body: "b1", detail: "d1", file: "f.ts", anchor: "x1" },
        { id: "s2", title: "Second step", body: "b2", detail: "d2", file: "g.ts", anchor: "x2" },
      ],
    };
    render(<WalkthroughTab />);
    fireEvent.click(screen.getByRole("button", { name: "Show details" }));
    expect(screen.getByTestId("step-detail")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Next step"));
    expect(screen.getByText("Second step")).toBeTruthy();
    expect(screen.getByTestId("step-detail")).toBeTruthy(); // expansion persists across steps
  });

  it("keeps 'Show details' expanded across an unmount/remount (tab switch)", () => {
    state.spec = mkSpec();
    const { unmount } = render(<WalkthroughTab />);
    fireEvent.click(screen.getByRole("button", { name: "Show details" }));
    expect(screen.getByTestId("step-detail")).toBeTruthy();
    unmount(); // leaving to Chat/Settings unmounts the tab
    render(<WalkthroughTab />); // …and back
    expect(screen.getByTestId("step-detail")).toBeTruthy(); // still expanded
  });

  it("the step chat icon flips to Reopen when a chat exists for the step", () => {
    state.spec = mkSpec();
    render(<WalkthroughTab />);
    expect(screen.getByLabelText("Ask about this step")).toBeTruthy();
    // a chat linked to the first step (s1) makes the icon offer Reopen
    state.chatHistory = [
      {
        key: "step:s1",
        stepId: "s1",
        file: "f.ts",
        lines: null,
        text: "x",
        suggestions: [],
        messages: [],
      },
    ];
    cleanup();
    render(<WalkthroughTab />);
    expect(screen.getByLabelText("Reopen chat for this step")).toBeTruthy();
    expect(screen.queryByLabelText("Ask about this step")).toBeNull();
  });

  it("arrow keys navigate; Ask about this step routes to the Chat tab", () => {
    state.spec = mkSpec();
    const ask = vi.spyOn(tourStore, "askAboutStep").mockImplementation(() => {});
    render(<WalkthroughTab />);
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
    });
    expect(screen.getByText("Second step")).toBeTruthy();
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft" }));
    });
    expect(screen.getByText("First step")).toBeTruthy();
    act(() => {
      document.dispatchEvent(new Event("keydown")); // non-KeyboardEvent → guard returns, no nav
    });
    expect(screen.getByText("First step")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Ask about this step" }));
    expect(ask).toHaveBeenCalledTimes(1);
    expect(panelStore.tab()).toBe("chat");
  });

  it("a keystroke inside an editable field does not navigate", () => {
    state.spec = mkSpec();
    render(<WalkthroughTab />);
    const input = document.createElement("textarea");
    document.body.append(input);
    act(() => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    });
    expect(screen.getByText("First step")).toBeTruthy(); // unchanged
    input.remove();
  });

  it("opens the regenerate dialog and closes it", () => {
    state.spec = mkSpec();
    render(<WalkthroughTab />);
    fireEvent.click(screen.getByRole("button", { name: /Regenerate|Update/ }));
    expect(screen.getByText(/Regenerate this review|New commits/)).toBeTruthy();
    fireEvent.click(screen.getByText("Cancel"));
    expect(screen.queryByText(/Regenerate this review|New commits/)).toBeNull();
  });

  it("re-scroll redraws the current step", () => {
    state.spec = mkSpec();
    const goto = vi.spyOn(tourStore, "goto");
    render(<WalkthroughTab />);
    goto.mockClear();
    fireEvent.click(screen.getByLabelText("Scroll to this step's code"));
    expect(goto).toHaveBeenCalledWith(0);
  });

  it("arrow keys at the boundaries and inside contentEditable are no-ops", () => {
    state.spec = mkSpec();
    render(<WalkthroughTab />);
    // at the first step, ArrowLeft does nothing
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft" }));
    });
    expect(screen.getByText("First step")).toBeTruthy();
    // go to the last step, then ArrowRight does nothing
    fireEvent.click(screen.getByLabelText("Next step"));
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
    });
    expect(screen.getByText("Second step")).toBeTruthy();
    // a key from a contentEditable target is ignored
    const editable = document.createElement("div");
    Object.defineProperty(editable, "isContentEditable", { value: true });
    document.body.append(editable);
    act(() => {
      editable.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    });
    expect(screen.getByText("Second step")).toBeTruthy();
    editable.remove();
  });

  it("also binds keys on the shadow root when mounted inside one", () => {
    state.spec = mkSpec();
    const host = document.createElement("div");
    host.id = "kvasir-root";
    document.body.append(host);
    const shadow = host.attachShadow({ mode: "open" });
    const mount = document.createElement("div");
    shadow.append(mount);
    render(<WalkthroughTab />, { container: mount });
    expect(mount.textContent).toContain("First step");
    act(() => {
      shadow.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    });
    expect(mount.textContent).toContain("Second step"); // screen can't see into the shadow
    cleanup();
    host.remove();
  });

  it("shows the Update label when there are new commits", () => {
    state.spec = mkSpec();
    vi.spyOn(launcherStore, "newCommits").mockReturnValue(true);
    render(<WalkthroughTab />);
    expect(screen.getByRole("button", { name: "Update" })).toBeTruthy();
  });

  it("copies the build log and flashes a confirmation on success", async () => {
    state.spec = mkSpec();
    const copy = vi.spyOn(launcherStore, "copyBuildLog").mockResolvedValue("ok");
    render(<WalkthroughTab />);
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Copy build log"));
    });
    expect(copy).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("Copy build log").className).toContain("text-primary");
  });

  it("does not flash when the build log copy fails", async () => {
    state.spec = mkSpec();
    vi.spyOn(launcherStore, "copyBuildLog").mockResolvedValue("absent");
    render(<WalkthroughTab />);
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Copy build log"));
    });
    expect(screen.getByLabelText("Copy build log").className).not.toContain("text-primary");
  });

  it("opens the outline, groups steps by file, and a step jumps + closes the outline", () => {
    state.spec = {
      version: 1,
      pr: { url: "u", owner: "a", repo: "b", number: 7 },
      generatedAt: "t",
      steps: [
        { id: "s1", title: "First step", body: "b1", file: "f.ts", anchor: "x1" },
        { id: "s2", title: "Second step", body: "b2", file: "f.ts", anchor: "x2" },
        { id: "s3", title: "Third step", body: "b3", file: "g.ts", anchor: "x3" },
      ],
    };
    render(<WalkthroughTab />);
    fireEvent.click(screen.getByLabelText("Show outline"));
    const outline = screen.getByTestId("outline");
    // two file groups (f.ts twice consecutively → one group, then g.ts)
    expect(outline.querySelectorAll("ul").length).toBe(2);
    expect(outline.textContent).toContain("f.ts");
    expect(outline.textContent).toContain("g.ts");
    fireEvent.click(screen.getByRole("button", { name: /Third step/ }));
    expect(screen.queryByTestId("outline")).toBeNull(); // outline closed
    expect(screen.getByText("Third step")).toBeTruthy(); // jumped to step 3
  });

  it("keeps the outline open across an unmount/remount (tab switch)", () => {
    state.spec = mkSpec();
    const { unmount } = render(<WalkthroughTab />);
    fireEvent.click(screen.getByLabelText("Show outline"));
    expect(screen.getByTestId("outline")).toBeTruthy();
    unmount();
    render(<WalkthroughTab />);
    expect(screen.getByTestId("outline")).toBeTruthy(); // module-level state persisted
    expect(screen.getByLabelText("Hide outline")).toBeTruthy();
  });

  it("shows no diagram toggle when the spec has no diagram", () => {
    state.spec = mkSpec();
    render(<WalkthroughTab />);
    expect(screen.queryByLabelText("Show diagram")).toBeNull();
  });

  it("shows the diagram toggle when present; opening it renders the diagram and closes the outline", async () => {
    state.spec = { ...mkSpec(), diagram: "flowchart TD; A-->B" };
    render(<WalkthroughTab />);
    fireEvent.click(screen.getByLabelText("Show outline"));
    expect(screen.getByTestId("outline")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Show diagram")); // mutually exclusive with outline
    expect(screen.queryByTestId("outline")).toBeNull();
    expect(await screen.findByTestId("diagram")).toBeTruthy();
  });

  it("shows a jump trail of visited files once the flow crosses files, and a crumb jumps back", () => {
    state.spec = mkSpec(); // step 1 in f.ts, step 2 in g.ts
    render(<WalkthroughTab />);
    expect(screen.queryByTestId("trail")).toBeNull(); // one file so far → no trail
    fireEvent.click(screen.getByLabelText("Next step")); // cross into g.ts
    const trail = screen.getByTestId("trail");
    expect(trail.textContent).toContain("f.ts");
    expect(trail.textContent).toContain("g.ts");
    fireEvent.click(within(trail).getByRole("button", { name: "f.ts" }));
    expect(screen.getByText("First step")).toBeTruthy(); // jumped back to the f.ts step
  });

  const COVERAGE_LABEL = "Walkthrough coverage of changed files";

  it("shows partial coverage and jumps to an uncovered file", () => {
    state.spec = { ...mkSpec(), coverage: { significant: ["f.ts", "g.ts", "h.ts"], uncovered: ["h.ts"] } };
    const send = vi.spyOn(bifrost, "send").mockImplementation(() => {});
    render(<WalkthroughTab />);
    expect(screen.getByLabelText(COVERAGE_LABEL).textContent).toContain("Explains 2/3 changed files");
    fireEvent.click(screen.getByLabelText(COVERAGE_LABEL)); // expand the uncovered list
    fireEvent.click(screen.getByRole("button", { name: "h.ts" }));
    // start() also sends (highlights) on mount, so assert the one jump:ref specifically.
    const jumpCalls = send.mock.calls.filter(([message]) => message === "jump:ref");
    expect(jumpCalls).toEqual([["jump:ref", { file: "h.ts", start: null, end: null }]]);
  });

  it("shows a complete, non-expandable badge at full coverage", () => {
    state.spec = { ...mkSpec(), coverage: { significant: ["f.ts", "g.ts"], uncovered: [] } };
    render(<WalkthroughTab />);
    const badge = screen.getByLabelText(COVERAGE_LABEL) as HTMLButtonElement;
    expect(badge.textContent).toContain("Explains 2/2 changed files");
    expect(badge.disabled).toBe(true);
  });

  it("shows no coverage badge when the spec carries none", () => {
    state.spec = mkSpec();
    render(<WalkthroughTab />);
    expect(screen.queryByLabelText(COVERAGE_LABEL)).toBeNull();
  });

  it("shows no coverage badge when no changed files are significant", () => {
    state.spec = { ...mkSpec(), coverage: { significant: [], uncovered: [] } };
    render(<WalkthroughTab />);
    expect(screen.queryByLabelText(COVERAGE_LABEL)).toBeNull();
  });

  it("a step without detail shows no details toggle", () => {
    state.spec = {
      version: 1,
      pr: { url: "u", owner: "a", repo: "b", number: 7 },
      generatedAt: "t",
      steps: [{ id: "s", title: "Only step", body: "b", file: "f.ts", anchor: "d" }],
    };
    render(<WalkthroughTab />);
    expect(screen.queryByRole("button", { name: "Show details" })).toBeNull();
  });
});
