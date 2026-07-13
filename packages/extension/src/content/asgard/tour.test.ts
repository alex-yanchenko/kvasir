// @vitest-environment jsdom
import type { WalkthroughSpec } from "@kvasir/runes/spec";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../muninn", () => ({ storeGet: vi.fn(), storeSet: vi.fn(), storeRemove: vi.fn() }));
// Keep the real diff readers (chatStore uses changedFilePaths); stub only stepCode.
vi.mock("../midgard/diff", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../midgard/diff")>()),
  stepCode: vi.fn(),
}));
vi.mock("./lib/nav", () => ({ softNavigate: vi.fn(), awaitSoftNav: vi.fn() }));

import { bifrost } from "../bifrost";
import { stepCode } from "../midgard/diff";
import { storeSet } from "../muninn";
import { chatStore } from "./chat";
import { awaitSoftNav, softNavigate } from "./lib/nav";
import { state } from "./store";
import { tourStore } from "./tour";

const PR = "https://github.com/acme/widget-api/pull/7";

const mkSpec = (): WalkthroughSpec => ({
  version: 1,
  pr: { url: PR, owner: "acme", repo: "widget-api", number: 7 },
  generatedAt: "2026-01-01T00:00:00Z",
  steps: [
    {
      id: "s1",
      title: "Step one",
      body: "<b>first</b> step",
      detail: "the <i>detail</i>",
      file: "src/app.ts",
      anchor: "diff-abc",
      lines: { side: "R", start: 4, end: 6 },
    },
    {
      id: "s2",
      title: "Step two",
      body: "second",
      file: "src/b.ts",
      anchor: "diff-b",
      highlight: ["b line"],
    },
  ],
});

let sent: Array<{ kind: string; payload: unknown }>;
let offs: Array<() => void>;
beforeEach(() => {
  Object.defineProperty(window, "location", { value: new URL(`${PR}/files`), writable: true });
  sessionStorage.clear();
  state.spec = mkSpec();
  state.tourState = { step: 0, pos: null, size: null };
  state.activeStep = null;
  tourStore.resetForPr(); // the whole machine slice back to defaults, not just close()
  sent = [];
  offs = [
    bifrost.handle("highlight:step", (p) => sent.push({ kind: "highlight:step", payload: p })),
    bifrost.handle("highlight:clear", () => sent.push({ kind: "highlight:clear", payload: undefined })),
    bifrost.handle("grip:context", (p) => sent.push({ kind: "grip:context", payload: p })),
  ];
  vi.spyOn(chatStore, "openSelection").mockImplementation(() => {});
});
afterEach(() => {
  offs.forEach((off) => off());
});

describe("start", () => {
  it("opens at the persisted step and shows it on the page", () => {
    state.tourState = { step: 1, pos: null, size: null };
    tourStore.start();
    expect(tourStore.open()).toBe(true);
    expect(tourStore.stepIndex()).toBe(1);
    expect(sent).toEqual([
      { kind: "grip:context", payload: { hasActiveStep: true } },
      {
        kind: "highlight:step",
        payload: { anchor: "diff-b", lines: null, highlight: ["b line"] },
      },
    ]);
    expect(state.activeStep).toEqual(state.spec!.steps[1]);
  });

  it("clamps a stale persisted step into range", () => {
    state.tourState = { step: 99, pos: null, size: null };
    tourStore.start();
    expect(tourStore.stepIndex()).toBe(1);
  });

  it("off the diff tab: opens and highlights without navigating to /files", () => {
    Object.defineProperty(window, "location", { value: new URL(PR), writable: true });
    tourStore.start();
    expect(tourStore.open()).toBe(true);
    expect(sessionStorage.getItem("kvasirAutoStart")).toBeNull();
    expect(String(window.location.href)).not.toContain("/files");
    expect(sent.some((step) => step.kind === "highlight:step")).toBe(true);
  });

  it("does nothing without a spec", () => {
    state.spec = null;
    tourStore.start();
    expect(tourStore.open()).toBe(false);
  });
});

describe("navigation", () => {
  it("goto persists the step and re-sends the page commands", () => {
    tourStore.start();
    tourStore.goto(1);
    expect(state.tourState.step).toBe(1);
    expect(vi.mocked(storeSet)).toHaveBeenCalledWith(`kvasir:tour:${PR}`, state.tourState);
  });

  it("next advances and is a no-op on the last step (it stays open)", () => {
    tourStore.start();
    tourStore.next();
    expect(tourStore.stepIndex()).toBe(1);
    tourStore.next(); // already on the last step
    expect(tourStore.stepIndex()).toBe(1);
    expect(tourStore.open()).toBe(true);
  });

  it("is safe on an empty-steps spec and with no spec", () => {
    state.spec = { ...mkSpec(), steps: [] };
    tourStore.start(); // opens, goto(0) → no step at the clamped index → guarded no-op
    expect(tourStore.step()).toBeNull();
    expect(sent.some((s) => s.kind === "highlight:step")).toBe(false);
    expect(state.tourState.visited).toEqual([]); // an out-of-range goto marks nothing

    state.spec = null;
    expect(() => tourStore.next()).not.toThrow(); // no-spec guard in next() → no-op
  });

  it("back stops at the first step", () => {
    tourStore.start();
    tourStore.back();
    expect(tourStore.stepIndex()).toBe(0);
  });

  it("close clears the page and the step context", () => {
    tourStore.start();
    tourStore.close();
    expect(sent.at(-1)).toEqual({ kind: "grip:context", payload: { hasActiveStep: false } });
  });

  it("isVisited marks opened steps and resets the set when the spec is regenerated", () => {
    tourStore.start(); // goto(0) → s1 visited
    tourStore.goto(1); // s2 visited
    expect(tourStore.isVisited("s1")).toBe(true);
    expect(tourStore.isVisited("s2")).toBe(true);
    // the marks ride the persisted tour state, so a page reload restores the dots
    expect(state.tourState.visited).toEqual(["s1", "s2"]);
    expect(state.tourState.visitedStamp).toBe("2026-01-01T00:00:00Z");
    expect(vi.mocked(storeSet)).toHaveBeenLastCalledWith(`kvasir:tour:${PR}`, state.tourState);
    // a regenerated spec carries a new generatedAt → the next goto resets the visited set
    state.spec = { ...mkSpec(), generatedAt: "2026-02-02T00:00:00Z" };
    tourStore.goto(1);
    expect(tourStore.isVisited("s1")).toBe(false); // not visited in the new session
    expect(tourStore.isVisited("s2")).toBe(true);
  });

  it("a regenerated spec shows no stale dots even before any goto (the overview path)", () => {
    tourStore.start(); // s1 visited on the old spec
    tourStore.goto(1); // s2 visited
    state.spec = { ...mkSpec(), generatedAt: "2026-02-02T00:00:00Z", overview: "<p>what changed</p>" };
    tourStore.gotoOverview(); // a regenerate lands on the overview — no goto, no stamp reconcile
    expect(tourStore.isVisited("s1")).toBe(false);
    expect(tourStore.isVisited("s2")).toBe(false);
    state.spec = null; // and no spec at all can never match a stamp
    expect(tourStore.isVisited("s1")).toBe(false);
  });

  it("a restored tour state is the source of truth for the visited dots", () => {
    expect(tourStore.isVisited("s1")).toBe(false); // nothing recorded yet
    state.tourState = {
      step: 1,
      pos: null,
      size: null,
      visited: ["s2"],
      visitedStamp: "2026-01-01T00:00:00Z",
    };
    expect(tourStore.isVisited("s1")).toBe(false);
    expect(tourStore.isVisited("s2")).toBe(true);
    // a matching stamp with no visited list (partial old persistence) reads as none
    state.tourState = { step: 0, pos: null, size: null, visitedStamp: "2026-01-01T00:00:00Z" };
    expect(tourStore.isVisited("s1")).toBe(false);
  });

  it("revisiting a step doesn't duplicate its mark; a stamp without marks starts empty", () => {
    tourStore.start(); // s1
    tourStore.goto(1); // s2
    tourStore.goto(0); // back to s1 — already marked
    expect(state.tourState.visited).toEqual(["s1", "s2"]);
    // a matching stamp with no visited list (partial old persistence) reads as empty
    state.tourState = { step: 0, pos: null, size: null, visitedStamp: "2026-01-01T00:00:00Z" };
    tourStore.goto(1);
    expect(state.tourState.visited).toEqual(["s2"]);
  });
});

describe("jumpToStep", () => {
  it("on the diff tab, selects the step without navigating", () => {
    Object.defineProperty(window, "location", { value: new URL(`${PR}/files`), writable: true });
    tourStore.start();
    tourStore.jumpToStep(1);
    expect(tourStore.stepIndex()).toBe(1);
    expect(vi.mocked(softNavigate)).not.toHaveBeenCalled();
  });

  it("off the diff tab, selects the step and soft-navigates to Files, re-applying on arrival", () => {
    Object.defineProperty(window, "location", { value: new URL(PR), writable: true });
    const reapply = vi.spyOn(tourStore, "reapply");
    tourStore.start();
    tourStore.jumpToStep(1);
    expect(tourStore.stepIndex()).toBe(1); // the step is selected regardless of the tab
    expect(vi.mocked(softNavigate)).toHaveBeenCalledWith(`${PR}/files`);
    expect(vi.mocked(softNavigate)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(awaitSoftNav)).toHaveBeenCalledWith(
      "/acme/widget-api/pull/7/files",
      expect.any(Function),
    );
    // the on-arrival callback re-applies the current step's highlight
    reapply.mockClear();
    vi.mocked(awaitSoftNav).mock.calls.at(-1)![1]();
    expect(reapply).toHaveBeenCalledTimes(1);
  });
});

describe("overview step 0", () => {
  const withOverview = (): WalkthroughSpec => ({
    ...mkSpec(),
    overview: "<p>what this PR is about</p>",
  });

  it("gotoOverview shows the overview and clears the page; canBack false / canNext true", () => {
    state.spec = withOverview();
    tourStore.start(); // opens on the first code step
    sent = [];
    tourStore.gotoOverview();
    expect(tourStore.atOverview()).toBe(true);
    expect(state.activeStep).toBeNull();
    expect(sent).toEqual([
      { kind: "highlight:clear", payload: undefined },
      { kind: "grip:context", payload: { hasActiveStep: false } },
    ]);
    expect(tourStore.canBack()).toBe(false);
    expect(tourStore.canNext()).toBe(true);
  });

  it("next from the overview advances to the first code step", () => {
    state.spec = withOverview();
    tourStore.start();
    tourStore.gotoOverview();
    tourStore.next();
    expect(tourStore.atOverview()).toBe(false);
    expect(tourStore.stepIndex()).toBe(0);
    expect(state.activeStep).toEqual(state.spec!.steps[0]);
  });

  it("back from the first code step falls into the overview, and is a no-op once there", () => {
    state.spec = withOverview();
    tourStore.start(); // step 0
    expect(tourStore.canBack()).toBe(true); // the overview is reachable
    tourStore.back();
    expect(tourStore.atOverview()).toBe(true);
    tourStore.back(); // already at the overview → no-op
    expect(tourStore.atOverview()).toBe(true);
  });

  it("gotoOverview is a no-op without an overview", () => {
    tourStore.start(); // mkSpec carries no overview
    tourStore.gotoOverview();
    expect(tourStore.atOverview()).toBe(false);
    expect(tourStore.hasOverview()).toBe(false);
    expect(tourStore.canBack()).toBe(false); // step 0, no overview to fall back into
  });

  it("hasOverview/canBack/canNext are false without a spec; back is a safe no-op", () => {
    state.spec = null;
    expect(tourStore.hasOverview()).toBe(false);
    expect(tourStore.canBack()).toBe(false);
    expect(tourStore.canNext()).toBe(false);
    expect(() => tourStore.back()).not.toThrow();
  });

  it("canBack/canNext reflect the position on the last code step", () => {
    state.spec = withOverview();
    tourStore.start();
    tourStore.goto(1); // last of two steps
    expect(tourStore.canBack()).toBe(true); // stepIndex > 0
    expect(tourStore.canNext()).toBe(false); // last step
  });

  it("gotoOverview persists the overview flag so a reopen restores it", () => {
    state.spec = withOverview();
    tourStore.start();
    vi.mocked(storeSet).mockClear();
    tourStore.gotoOverview();
    expect(state.tourState.overview).toBe(true);
    expect(vi.mocked(storeSet)).toHaveBeenCalledWith(`kvasir:tour:${PR}`, state.tourState);
  });

  it("start restores the overview when that's where we left off", () => {
    state.spec = withOverview();
    state.tourState = { step: 1, overview: true, pos: null, size: null };
    tourStore.start();
    expect(tourStore.atOverview()).toBe(true);
  });

  it("start resumes a code step when the saved overview flag has no overview in the spec", () => {
    state.spec = mkSpec(); // regenerated without an overview
    state.tourState = { step: 1, overview: true, pos: null, size: null };
    tourStore.start();
    expect(tourStore.atOverview()).toBe(false);
    expect(tourStore.stepIndex()).toBe(1);
  });

  it("goto clears the persisted overview flag", () => {
    state.spec = withOverview();
    tourStore.start();
    tourStore.gotoOverview();
    tourStore.goto(1);
    expect(state.tourState.overview).toBe(false);
  });

  it("reapply re-issues the overview when on it, and the step otherwise", () => {
    state.spec = withOverview();
    tourStore.start(); // on the first code step
    tourStore.gotoOverview();
    sent = [];
    tourStore.reapply(); // on the overview → re-clears the page, stays on the overview
    expect(tourStore.atOverview()).toBe(true);
    expect(sent.some((s) => s.kind === "highlight:clear")).toBe(true);

    tourStore.goto(1);
    sent = [];
    tourStore.reapply(); // on a step → re-highlights it
    expect(tourStore.atOverview()).toBe(false);
    expect(sent.some((s) => s.kind === "highlight:step")).toBe(true);
  });

  it("reapply is a safe no-op without a spec", () => {
    state.spec = null;
    expect(() => tourStore.reapply()).not.toThrow();
  });

  it("a 1-step spec with an overview cycles overview <-> the single code step", () => {
    state.spec = { ...withOverview(), steps: [mkSpec().steps[0]!] };
    tourStore.start(); // the only code step
    expect(tourStore.atOverview()).toBe(false);
    expect(tourStore.canBack()).toBe(true); // overview reachable
    expect(tourStore.canNext()).toBe(false); // only one code step
    tourStore.back();
    expect(tourStore.atOverview()).toBe(true);
    expect(tourStore.canNext()).toBe(true);
    tourStore.next();
    expect(tourStore.atOverview()).toBe(false);
    expect(tourStore.stepIndex()).toBe(0);
  });

  it("goto and close both leave the overview", () => {
    state.spec = withOverview();
    tourStore.start();
    tourStore.gotoOverview();
    tourStore.goto(1);
    expect(tourStore.atOverview()).toBe(false);
    tourStore.gotoOverview();
    tourStore.close();
    expect(tourStore.atOverview()).toBe(false);
  });
});

describe("step context + ask", () => {
  it("stepContext strips markup and cites the location", () => {
    tourStore.start();
    expect(tourStore.stepContext()).toBe("Step: Step one (src/app.ts:4-6)\nfirst step\nthe detail");
  });

  it("stepContext is empty without an active step", () => {
    expect(tourStore.stepContext()).toBe("");
  });

  it("askAboutStep prefers the rendered code from Midgard", () => {
    const open = vi.mocked(chatStore.openSelection);
    open.mockClear();
    vi.mocked(stepCode).mockReturnValue({
      text: "const a = 1;",
      rect: { left: 1, top: 2, bottom: 3, height: 4 },
    });
    tourStore.start();
    tourStore.askAboutStep();
    expect(open).toHaveBeenCalledWith(
      {
        selectionId: "step:s1",
        stepId: "s1",
        file: "src/app.ts",
        text: "const a = 1;",
        lines: { side: "R", start: 4, end: 6 },
        rect: { left: 1, top: 2, bottom: 3, height: 4 },
      },
      true,
    );
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("falls back to highlight strings, then to stripped body text", () => {
    const open = vi.mocked(chatStore.openSelection);
    open.mockClear();
    vi.mocked(stepCode).mockReturnValue(null);
    tourStore.start();
    tourStore.goto(1); // step two has highlight strings
    tourStore.askAboutStep();
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ text: "b line" }), true);

    state.activeStep = { ...state.spec!.steps[0] }; // step one has no highlight
    tourStore.askAboutStep();
    expect(open).toHaveBeenLastCalledWith(
      expect.objectContaining({
        text: "first step",
        rect: { left: 60, top: 90, bottom: 114, height: 24 },
      }),
      true,
    );
  });

  it("does nothing without an active step", () => {
    const open = vi.mocked(chatStore.openSelection);
    open.mockClear();
    tourStore.askAboutStep();
    expect(open).not.toHaveBeenCalled();
  });
});

describe("guard and formatting arms", () => {
  it("goto is a no-op without a spec; stepCount reads 0", () => {
    state.spec = null;
    tourStore.goto(0);
    expect(sent).toEqual([]);
    expect(tourStore.stepCount()).toBe(0);
  });

  it("stepContext without lines/detail, and without a file", () => {
    tourStore.start();
    tourStore.goto(1); // step two: file but no lines/detail
    expect(tourStore.stepContext()).toBe("Step: Step two (src/b.ts)\nsecond");
    state.activeStep = { ...state.spec!.steps[1], file: "" };
    expect(tourStore.stepContext()).toBe("Step: Step two\nsecond");
    state.activeStep = { ...state.spec!.steps[1], body: "" };
    expect(tourStore.stepContext()).toBe("Step: Step two (src/b.ts)\n");
  });

  it("askAboutStep with neither rendered code, highlights, nor body sends empty text", () => {
    const opened = vi.mocked(chatStore.openSelection);
    opened.mockClear();
    vi.mocked(stepCode).mockReturnValue(null);
    tourStore.start();
    state.activeStep = { ...state.spec!.steps[0], body: "" };
    tourStore.askAboutStep();
    expect(opened).toHaveBeenCalledWith(expect.objectContaining({ text: "" }), true);
  });
});

describe("backgroundContext", () => {
  it("distills overview + steps with locations, stripping HTML, capped", () => {
    state.spec = {
      version: 1,
      pr: { url: PR, owner: "acme", repo: "widget-api", number: 7 },
      generatedAt: "t",
      overview: "<p>Adds   <code>rate limiting</code>.</p>",
      steps: [
        {
          id: "s1",
          title: "Limiter",
          body: "<b>token bucket</b>",
          file: "src/mw.ts",
          anchor: "diff-a",
          lines: { side: "R", start: 1, end: 9 },
        },
        { id: "s2", title: "Wire-up", body: "uses it", file: "", anchor: "diff-b" },
      ],
    } as WalkthroughSpec;
    expect(tourStore.backgroundContext()).toBe(
      "Overview: Adds rate limiting.\n\n• Limiter (src/mw.ts:1-9)\n  token bucket\n• Wire-up\n  uses it",
    );
  });

  it("is empty without a spec, and skips the overview line without one", () => {
    state.spec = null;
    expect(tourStore.backgroundContext()).toBe("");
    state.spec = {
      version: 1,
      pr: { url: PR, owner: "acme", repo: "widget-api", number: 7 },
      generatedAt: "t",
      steps: [{ id: "s", title: "T", body: "b", file: "f.ts", anchor: "d" }],
    };
    expect(tourStore.backgroundContext()).toBe("• T (f.ts)\n  b");
  });
});
