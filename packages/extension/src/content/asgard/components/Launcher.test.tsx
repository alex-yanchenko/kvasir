// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { WalkthroughSpec } from "@prw/runes/spec";

vi.mock("../../api", () => ({ api: vi.fn() }));
vi.mock("../../muninn", () => ({ storeGet: vi.fn(), storeSet: vi.fn(), storeRemove: vi.fn() }));

import { api } from "../../api";
import { storeGet } from "../../muninn";
import { state } from "../store";
import { launcherStore } from "../launcher";
import { tourStore } from "../tour";
import { chatStore } from "../chat";
import { Launcher } from "./Launcher";

const PR = "https://github.com/acme/widget-api/pull/7";

const mkSpec = (): WalkthroughSpec => ({
  version: 1,
  pr: { url: PR, owner: "acme", repo: "widget-api", number: 7, headSha: "sha-1" },
  generatedAt: "2026-01-01T00:00:00Z",
  steps: [{ id: "s1", title: "Step one", body: "b", file: "src/app.ts", anchor: "diff-abc" }],
});

beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(window, "location", { value: new URL(`${PR}/files`), writable: true });
  sessionStorage.clear();
  state.spec = null;
  state.tourState = { step: 0, pos: null, size: null };
  launcherStore.resetForPr();
  vi.spyOn(tourStore, "start").mockImplementation(() => {});
  vi.spyOn(tourStore, "close").mockImplementation(() => {});
  vi.spyOn(chatStore, "openPrChat").mockImplementation(() => {});
  vi.mocked(api).mockResolvedValue({ ok: false });
  vi.mocked(storeGet).mockResolvedValue(undefined);
});
afterEach(() => {
  launcherStore.resetForPr();
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("Launcher without a spec", () => {
  it("offers Run review and flips to the generating status on click", async () => {
    render(<Launcher />);
    await act(async () => {
      fireEvent.click(screen.getByText("▶ Run review"));
    });
    expect(vi.mocked(api)).toHaveBeenCalledWith("/generate", "POST", {
      pr: PR,
      mode: "new",
      sinceSha: undefined,
    });
    expect(screen.getByText(/Generating review/)).toBeTruthy();
  });
});

describe("Launcher with a spec", () => {
  beforeEach(() => {
    state.spec = mkSpec();
  });

  it("renders the three pills and routes Open/Ask through the bridges", () => {
    render(<Launcher />);
    fireEvent.click(screen.getByText("▶ Open review (1)"));
    expect(tourStore.start).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText("💬 Ask about PR"));
    expect(chatStore.openPrChat).toHaveBeenCalledTimes(1);
  });

  it("opens the regen dialog, closes on cancel and on backdrop click", () => {
    render(<Launcher />);
    fireEvent.click(screen.getByText("⟳ Regenerate"));
    expect(screen.getByText("Regenerate this review")).toBeTruthy();
    fireEvent.click(screen.getByText("Cancel"));
    expect(screen.queryByText("Regenerate this review")).toBeNull();

    fireEvent.click(screen.getByText("⟳ Regenerate"));
    const back = document.querySelector(".prw-dialog-back")!;
    fireEvent.click(back.querySelector(".prw-dialog")!); // a child click must NOT close
    expect(screen.getByText("Regenerate this review")).toBeTruthy();
    fireEvent.click(back);
    expect(screen.queryByText("Regenerate this review")).toBeNull();
  });

  it("regenerates as new from the dialog", async () => {
    render(<Launcher />);
    fireEvent.click(screen.getByText("⟳ Regenerate"));
    await act(async () => {
      fireEvent.click(screen.getByText("Regenerate as new"));
    });
    expect(vi.mocked(api)).toHaveBeenCalledWith("/generate", "POST", {
      pr: PR,
      mode: "new",
      sinceSha: undefined,
    });
  });

  it("with new commits: shows Update + the incremental option carrying the reviewed sha", async () => {
    vi.mocked(api).mockImplementation(async (path: string) =>
      path.startsWith("/walkthrough")
        ? { ok: true, data: mkSpec() }
        : { ok: true, data: { headSha: "sha-2" } },
    );
    await act(async () => {
      await launcherStore.refresh();
    });
    render(<Launcher />);
    fireEvent.click(screen.getByText("⟳ Update"));
    expect(screen.getByText("New commits since this review")).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByText("Incremental update"));
    });
    expect(vi.mocked(api)).toHaveBeenCalledWith("/generate", "POST", {
      pr: PR,
      mode: "incremental",
      sinceSha: "sha-1",
    });
  });
});

describe("generating status", () => {
  beforeEach(async () => {
    await act(async () => {
      await launcherStore.requestGenerate("new");
    });
  });

  it("shows the elapsed timer and ticks it every second", async () => {
    render(<Launcher />);
    expect(screen.getByText("0:00")).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(61_000);
    });
    expect(screen.getByText("1:01")).toBeTruthy();
  });

  it("dismiss arms first, auto-reverts, and confirms on the second click", async () => {
    render(<Launcher />);
    fireEvent.click(screen.getByText("dismiss"));
    expect(screen.getByText("click again to confirm")).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(screen.getByText("dismiss")).toBeTruthy(); // reverted, still generating

    fireEvent.click(screen.getByText("dismiss"));
    fireEvent.click(screen.getByText("click again to confirm"));
    expect(launcherStore.generating()).toBe(false);
    expect(screen.queryByText(/Generating review/)).toBeNull();
  });
});
