// @vitest-environment jsdom
import type { WalkthroughSpec } from "@kvasir/runes/spec";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../../muninn", () => ({ storeGet: vi.fn(), storeSet: vi.fn(), storeRemove: vi.fn() }));
vi.mock("../../mermaidLoader", () => ({
  loadMermaid: () =>
    Promise.resolve({ initialize: () => {}, render: () => Promise.resolve({ svg: "<svg></svg>" }) }),
}));

import { chatStore } from "../../chat";
import { launcherStore } from "../../launcher";
import { pairingStore } from "../../pairing";
import { PANEL_TABS, panelStore, state, touch } from "../../store";
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
  state.persistedTour = { step: 0, pos: null, size: null };
  state.panel = { open: true, tab: PANEL_TABS.WALKTHROUGH, pos: null, size: null };
  pairingStore.reset(); // "unknown" → backend actions enabled unless a test sets unpaired
  vi.spyOn(launcherStore, "specLoading").mockReturnValue(false); // probes are done unless a test says otherwise
  state.firstRun = false; // onboarding dismissed unless a test opts in
  if (tourStore.open()) tourStore.close();
  tourStore.setDetailOpen(false); // detail state is module-level now — reset per test
  panelStore.setSidebarOpen(false); // sidebar state lives in panelStore — reset per test
  tourStore.setDiagramOpen(false); // diagram overlay state is module-level too
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks(); // drop per-test launcherStore/pairingStore spies
});

describe("generate errors", () => {
  it("a failed generate shows the inline error; Retry re-issues, Dismiss clears", () => {
    vi.spyOn(launcherStore, "genError").mockReturnValue(
      "Can't reach the channel — is your Claude session running?",
    );
    const retry = vi.spyOn(launcherStore, "retryGenerate").mockResolvedValue();
    const dismiss = vi.spyOn(launcherStore, "dismissGenError").mockImplementation(() => {});
    render(<WalkthroughTab />);
    expect(screen.getByText(/Can't reach the channel/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(dismiss).toHaveBeenCalledTimes(1);
  });

  it("the error renders above an existing walkthrough too (a failed regenerate)", () => {
    state.spec = mkSpec();
    vi.spyOn(launcherStore, "genError").mockReturnValue("This took too long — check your terminal.");
    render(<WalkthroughTab />);
    expect(screen.getByText(/took too long/)).toBeTruthy();
    expect(screen.getByText("First step")).toBeTruthy(); // the steps stay usable
  });
});

describe("WalkthroughTab", () => {
  it("empty state runs a walkthrough", () => {
    const gen = vi.spyOn(launcherStore, "requestGenerate").mockResolvedValue();
    render(<WalkthroughTab />);
    fireEvent.click(screen.getByRole("button", { name: "Run walkthrough" }));
    expect(gen).toHaveBeenCalledWith("new");
  });

  it("first run: the empty state shows the three-step card until dismissed forever", () => {
    state.firstRun = true;
    render(<WalkthroughTab />);
    expect(screen.getByText(/Start the channel/)).toBeTruthy();
    expect(screen.getByText(/Settings → Pair/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Run walkthrough" })).toBeTruthy(); // step 3 is the real button
    fireEvent.click(screen.getByRole("button", { name: "Got it" }));
    expect(screen.queryByText(/Start the channel/)).toBeNull();
    expect(screen.getByText("No walkthrough yet for this PR.")).toBeTruthy();
    expect(localStorage.getItem("kvasirFirstRunDone")).toBe("true"); // never comes back
  });

  it("running the first walkthrough retires the card too — completing the steps IS the dismissal", () => {
    state.firstRun = true;
    localStorage.removeItem("kvasirFirstRunDone");
    vi.spyOn(launcherStore, "requestGenerate").mockResolvedValue();
    render(<WalkthroughTab />);
    fireEvent.click(screen.getByRole("button", { name: "Run walkthrough" }));
    expect(localStorage.getItem("kvasirFirstRunDone")).toBe("true");
    expect(screen.queryByText(/Start the channel/)).toBeNull();
  });

  it("after the first run the empty state is the plain one", () => {
    render(<WalkthroughTab />);
    expect(screen.queryByText(/Start the channel/)).toBeNull();
    expect(screen.getByText("No walkthrough yet for this PR.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Got it" })).toBeNull();
  });

  it("shows a checking state, not the empty state, while the spec probe is in flight", () => {
    vi.mocked(launcherStore.specLoading).mockReturnValue(true);
    render(<WalkthroughTab />);
    expect(screen.getByText("Checking this PR for a walkthrough…")).toBeTruthy();
    expect(screen.queryByText("No walkthrough yet for this PR.")).toBeNull();
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
    expect(screen.getByText("Generating walkthrough…")).toBeTruthy();
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
    expect(screen.getByText(/Regenerate this walkthrough|New commits/)).toBeTruthy();
    fireEvent.click(screen.getByText("Cancel"));
    expect(screen.queryByText(/Regenerate this walkthrough|New commits/)).toBeNull();
  });

  it("re-scroll redraws the current step", () => {
    state.spec = mkSpec();
    const goto = vi.spyOn(tourStore, "goto");
    render(<WalkthroughTab />);
    goto.mockClear();
    fireEvent.click(screen.getByLabelText("Scroll to this step's code"));
    expect(goto).toHaveBeenCalledWith(0);
  });

  it("shows the changes-since button only when there are new commits, and it opens the range diff", () => {
    state.spec = mkSpec();
    const open = vi.spyOn(launcherStore, "openChangesSinceReview").mockImplementation(() => {});

    vi.spyOn(launcherStore, "newCommits").mockReturnValue(false);
    const view = render(<WalkthroughTab />);
    expect(screen.queryByLabelText("View changes since this walkthrough")).toBeNull();
    view.unmount();

    vi.spyOn(launcherStore, "newCommits").mockReturnValue(true);
    render(<WalkthroughTab />);
    fireEvent.click(screen.getByLabelText("View changes since this walkthrough"));
    expect(open).toHaveBeenCalledTimes(1);
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

  it("re-syncs the tour when the live probe swaps in a different spec under a mounted tab", () => {
    state.spec = mkSpec(); // the cached spec renders first (cache-first load)
    render(<WalkthroughTab />);
    fireEvent.click(screen.getByLabelText("Next step")); // stepIndex → 1
    const fresh: WalkthroughSpec = {
      ...mkSpec(),
      generatedAt: "2026-09-09T00:00:00Z",
      steps: [{ id: "n1", title: "Only step", body: "b", file: "f.ts", anchor: "d9" }],
    };
    act(() => {
      state.spec = fresh; // the live probe lands a regenerated, shorter spec
      touch();
    });
    expect(screen.getByText("Only step")).toBeTruthy(); // not the empty state
    expect(screen.queryByText("No walkthrough yet for this PR.")).toBeNull();
    expect(tourStore.stepIndex()).toBe(0); // re-clamped against the new spec
  });

  it("shows the Update label when there are new commits", () => {
    state.spec = mkSpec();
    vi.spyOn(launcherStore, "newCommits").mockReturnValue(true);
    render(<WalkthroughTab />);
    expect(screen.getByRole("button", { name: "Update" })).toBeTruthy();
  });

  it("shows no diagram toggle when the spec has no diagram", () => {
    state.spec = mkSpec();
    render(<WalkthroughTab />);
    expect(screen.queryByLabelText("Show diagram")).toBeNull();
  });

  it("the diagram toggle opens then hides the diagram view", async () => {
    state.spec = { ...mkSpec(), diagram: "flowchart TD; A-->B" };
    render(<WalkthroughTab />);
    fireEvent.click(screen.getByLabelText("Show diagram"));
    expect(await screen.findByTestId("diagram")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Hide diagram")); // toggle back off → step body returns
    expect(screen.queryByTestId("diagram")).toBeNull();
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

  it("Back from the first code step falls into the overview step 0", () => {
    state.spec = { ...mkSpec(), overview: "<p>what this PR is about</p>" };
    render(<WalkthroughTab />);
    // opens on the first code step, not the overview
    expect(screen.getByText("First step")).toBeTruthy();
    expect(screen.queryByTestId("overview-body")).toBeNull();
    // with an overview, Back is enabled on step 1 and lands on the overview: prose in the
    // main pane, footer reads "Overview", Back disabled, Next returns to the first step
    // on a code step, the step-scoped tools are present
    expect(screen.getByLabelText("Ask about this step")).toBeTruthy();
    expect((screen.getByLabelText("Previous step") as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByLabelText("Previous step"));
    expect(screen.getByTestId("overview-body").innerHTML).toContain("what this PR is about");
    // the overview shows how many code steps follow (mkSpec has two)
    expect(screen.getByTestId("overview-step-count").textContent).toBe("2 steps");
    // footer counter reads "Overview" (the OverviewView heading is the other match)
    expect(screen.getAllByText("Overview")).toHaveLength(2);
    expect((screen.getByLabelText("Previous step") as HTMLButtonElement).disabled).toBe(true);
    // the overview offers its own whole-PR chat; scroll-to-code is shown but disabled (no code target)
    expect(screen.queryByLabelText("Ask about this step")).toBeNull();
    expect(screen.getByLabelText("Ask about the overview")).toBeTruthy();
    expect((screen.getByLabelText("Scroll to this step's code") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText("Next step"));
    expect(screen.getByText("First step")).toBeTruthy();
    expect(screen.queryByTestId("overview-body")).toBeNull();
  });

  it("Ask about the overview opens a whole-PR overview chat in the Chat tab", () => {
    vi.spyOn(pairingStore, "recheck").mockResolvedValue();
    state.spec = { ...mkSpec(), overview: "<p>what this PR is about</p>" };
    render(<WalkthroughTab />);
    fireEvent.click(screen.getByLabelText("Previous step")); // into the overview
    expect(chatStore.overviewChat()).toBeNull();
    fireEvent.click(screen.getByLabelText("Ask about the overview"));
    expect(panelStore.tab()).toBe("chat");
    const chat = chatStore.overviewChat();
    expect(chat).toEqual({
      key: "overview",
      general: true,
      file: null,
      lines: null,
      text: "",
      suggestions: [],
      messages: [],
    });
  });

  it("the overview step count reads singular for a one-step walkthrough", () => {
    state.spec = {
      ...mkSpec(),
      overview: "<p>tiny</p>",
      steps: [{ id: "s1", title: "Only step", body: "b", file: "f.ts", anchor: "d1" }],
    };
    render(<WalkthroughTab />);
    fireEvent.click(screen.getByLabelText("Previous step")); // into the overview
    expect(screen.getByTestId("overview-step-count").textContent).toBe("1 step");
  });

  it("restores the overview step across an unmount/remount (close + reopen)", () => {
    state.spec = { ...mkSpec(), overview: "<p>ov text</p>" };
    const { unmount } = render(<WalkthroughTab />);
    fireEvent.click(screen.getByLabelText("Previous step")); // into the overview
    expect(screen.getByTestId("overview-body")).toBeTruthy();
    unmount();
    tourStore.close(); // the panel close resets the in-memory flag — only the persisted one restores
    render(<WalkthroughTab />); // …reopen
    expect(screen.getByTestId("overview-body")).toBeTruthy(); // still on the overview, not step 1
  });

  it("ArrowLeft from the first step opens the overview; ArrowRight returns", () => {
    state.spec = { ...mkSpec(), overview: "<p>ov text</p>" };
    render(<WalkthroughTab />);
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft" }));
    });
    expect(screen.getByTestId("overview-body")).toBeTruthy();
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
    });
    expect(screen.getByText("First step")).toBeTruthy();
  });

  it("without an overview, Back is disabled on the first step (no step 0)", () => {
    state.spec = mkSpec();
    render(<WalkthroughTab />);
    expect((screen.getByLabelText("Previous step") as HTMLButtonElement).disabled).toBe(true);
  });
});
