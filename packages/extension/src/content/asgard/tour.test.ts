// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { WalkthroughSpec } from "@prw/runes/spec";

vi.mock("../muninn", () => ({ storeGet: vi.fn(), storeSet: vi.fn(), storeRemove: vi.fn() }));
vi.mock("../midgard/midgard", () => ({ stepCode: vi.fn() }));

import { storeSet } from "../muninn";
import { stepCode } from "../midgard/midgard";
import { bifrost } from "../bifrost";
import { state } from "../state";
import { legacyChatBridge } from "./store";
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
  if (tourStore.open()) tourStore.close();
  sent = [];
  offs = [
    bifrost.handle("highlight:step", (p) => sent.push({ kind: "highlight:step", payload: p })),
    bifrost.handle("highlight:clear", () => sent.push({ kind: "highlight:clear", payload: undefined })),
    bifrost.handle("grip:context", (p) => sent.push({ kind: "grip:context", payload: p })),
  ];
  legacyChatBridge.openSelection = undefined;
});
afterEach(() => {
  offs.forEach((off) => off());
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("start", () => {
  it("opens at the persisted step and shows it on the page", () => {
    state.tourState = { step: 1, pos: null, size: null };
    tourStore.start();
    expect(tourStore.open()).toBe(true);
    expect(tourStore.stepIdx()).toBe(1);
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
    expect(tourStore.stepIdx()).toBe(1);
  });

  it("off the diff tab: flags auto-start and hops to /files instead of opening", () => {
    Object.defineProperty(window, "location", { value: new URL(PR), writable: true });
    tourStore.start();
    expect(tourStore.open()).toBe(false);
    expect(sessionStorage.getItem("prwAutoStart")).toBe("1");
    expect(String(window.location.href)).toContain("/files");
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
    expect(vi.mocked(storeSet)).toHaveBeenCalledWith(`prw:tour:${PR}`, state.tourState);
  });

  it("next advances; on the last step it finishes (closes)", () => {
    tourStore.start();
    tourStore.next();
    expect(tourStore.stepIdx()).toBe(1);
    tourStore.next();
    expect(tourStore.open()).toBe(false);
    expect(sent.some((s) => s.kind === "highlight:clear")).toBe(true);
    expect(state.activeStep).toBeNull();
  });

  it("back stops at the first step", () => {
    tourStore.start();
    tourStore.back();
    expect(tourStore.stepIdx()).toBe(0);
  });

  it("close clears the page and the step context", () => {
    tourStore.start();
    tourStore.close();
    expect(sent.at(-1)).toEqual({ kind: "grip:context", payload: { hasActiveStep: false } });
  });
});

describe("persisted geometry", () => {
  it("setPos / setSize write through", () => {
    tourStore.setPos({ left: 10, top: 20 });
    tourStore.setSize({ w: 300, h: 200 });
    expect(state.tourState.pos).toEqual({ left: 10, top: 20 });
    expect(state.tourState.size).toEqual({ w: 300, h: 200 });
    expect(vi.mocked(storeSet)).toHaveBeenCalledTimes(2);
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
    const open = vi.fn();
    legacyChatBridge.openSelection = open;
    vi.mocked(stepCode).mockReturnValue({
      text: "const a = 1;",
      rect: { left: 1, top: 2, bottom: 3, height: 4 },
    });
    tourStore.start();
    tourStore.askAboutStep();
    expect(open).toHaveBeenCalledWith(
      {
        selectionId: "src/app.ts::const a = 1;",
        file: "src/app.ts",
        text: "const a = 1;",
        lines: { side: "R", start: 4, end: 6 },
        rect: { left: 1, top: 2, bottom: 3, height: 4 },
      },
      true,
    );
  });

  it("falls back to highlight strings, then to stripped body text", () => {
    const open = vi.fn();
    legacyChatBridge.openSelection = open;
    vi.mocked(stepCode).mockReturnValue(null);
    tourStore.start();
    tourStore.goto(1); // step two has highlight strings
    tourStore.askAboutStep();
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ text: "b line" }), true);

    state.activeStep = { ...state.spec!.steps[0], highlight: undefined };
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
    const open = vi.fn();
    legacyChatBridge.openSelection = open;
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
    const opened = vi.fn();
    legacyChatBridge.openSelection = opened;
    vi.mocked(stepCode).mockReturnValue(null);
    tourStore.start();
    state.activeStep = { ...state.spec!.steps[0], highlight: undefined, body: "" };
    tourStore.askAboutStep();
    expect(opened).toHaveBeenCalledWith(expect.objectContaining({ text: "" }), true);
  });
});
