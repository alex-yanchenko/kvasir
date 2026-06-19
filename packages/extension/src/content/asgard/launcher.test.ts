// @vitest-environment jsdom
import type { WalkthroughSpec } from "@kvasir/runes/spec";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../api", () => ({ api: vi.fn() }));
vi.mock("../muninn", () => ({ storeGet: vi.fn(), storeSet: vi.fn(), storeRemove: vi.fn() }));

import { api } from "../api";
import { storeGet, storeRemove, storeSet } from "../muninn";
import { GEN_MAX_TRIES, GEN_POLL_INTERVAL_MS, fmtElapsed, launcherStore, specSig } from "./launcher";
import { state } from "./store";
import { tourStore } from "./tour";

const PR = "https://github.com/acme/widget-api/pull/7";

const mkSpec = (over: Partial<WalkthroughSpec> = {}): WalkthroughSpec => ({
  version: 1,
  pr: { url: PR, owner: "acme", repo: "widget-api", number: 7, headSha: "sha-1" },
  generatedAt: "2026-01-01T00:00:00Z",
  steps: [
    {
      id: "s1",
      title: "Step one",
      body: "b",
      file: "src/app.ts",
      anchor: "diff-abc",
    },
  ],
  ...over,
});

beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(window, "location", {
    value: new URL(`${PR}/files`),
    writable: true,
  });
  sessionStorage.clear();
  state.spec = null;
  state.generateDiagram = false; // default off — a test that flips it must not leak
  state.tourState = { step: 3, pos: null, size: null };
  launcherStore.resetForPr();
  vi.spyOn(tourStore, "start").mockImplementation(() => {});
  vi.spyOn(tourStore, "close").mockImplementation(() => {});
  vi.mocked(api).mockResolvedValue({ ok: false });
  vi.mocked(storeGet).mockResolvedValue(undefined);
});
afterEach(() => {
  launcherStore.resetForPr(); // stop any live poll before timers are restored
  vi.useRealTimers();
});

describe("fmtElapsed / specSig", () => {
  it("formats m:ss and clamps negatives", () => {
    expect(fmtElapsed(0)).toBe("0:00");
    expect(fmtElapsed(61500)).toBe("1:01");
    expect(fmtElapsed(-5)).toBe("0:00");
  });

  it("specSig changes on any republish and is empty for null", () => {
    const a = mkSpec();
    expect(specSig(null)).toBe("");
    expect(specSig(a)).not.toBe(specSig(mkSpec({ generatedAt: "2026-01-02T00:00:00Z" })));
  });
});

describe("requestGenerate → poll → spec lands", () => {
  it("persists the marker, closes the tour, polls, and installs the new spec", async () => {
    const fresh = mkSpec({ generatedAt: "2026-02-02T00:00:00Z" });
    let walkthroughCalls = 0;
    vi.mocked(api).mockImplementation(async (path: string) => {
      if (!path.startsWith("/walkthrough")) return { ok: true };
      // first poll tick comes back empty (not ready yet), then the fresh spec
      return ++walkthroughCalls === 1 ? { ok: false } : { ok: true, data: fresh };
    });

    await launcherStore.requestGenerate("new");
    expect(tourStore.close).toHaveBeenCalledTimes(1);
    expect(launcherStore.generating()).toBe(true);
    expect(vi.mocked(storeSet)).toHaveBeenCalledWith(`kvasir:gen:${PR}`, {
      previousSig: "",
      at: Date.now(),
    });
    expect(vi.mocked(api)).toHaveBeenCalledWith("/generate", "POST", {
      pr: PR,
      mode: "new",
      sinceSha: undefined,
      depth: "heavy",
      reposRoot: "~/code",
      diagram: false,
    });

    await vi.advanceTimersByTimeAsync(GEN_POLL_INTERVAL_MS); // empty tick — still generating
    expect(launcherStore.generating()).toBe(true);
    await vi.advanceTimersByTimeAsync(GEN_POLL_INTERVAL_MS); // spec lands
    expect(state.spec).toEqual(fresh);
    expect(launcherStore.generating()).toBe(false);
    expect(vi.mocked(storeSet)).toHaveBeenCalledWith(`kvasir:spec:${PR}`, fresh);
    expect(vi.mocked(storeRemove)).toHaveBeenCalledWith(`kvasir:gen:${PR}`);
    // new review → back to the first step, pos/size kept
    expect(state.tourState).toEqual({ step: 0, pos: null, size: null });
    expect(vi.mocked(storeSet)).toHaveBeenCalledWith(`kvasir:tour:${PR}`, state.tourState);
  });

  it("ignores a same-signature spec and gives up after the cap", async () => {
    const unchanged = mkSpec();
    state.spec = unchanged;
    vi.mocked(api).mockImplementation(async (path: string) =>
      path.startsWith("/walkthrough") ? { ok: true, data: unchanged } : { ok: true },
    );
    await launcherStore.requestGenerate("new");
    await vi.advanceTimersByTimeAsync(GEN_POLL_INTERVAL_MS * (GEN_MAX_TRIES + 1));
    expect(launcherStore.generating()).toBe(false);
    expect(state.spec).toEqual(unchanged);
    expect(vi.mocked(storeRemove)).toHaveBeenCalledWith(`kvasir:gen:${PR}`);
  });

  it("does nothing off a PR page", async () => {
    Object.defineProperty(window, "location", {
      value: new URL("https://github.com/acme/widget-api/issues"),
      writable: true,
    });
    await launcherStore.requestGenerate("new");
    expect(vi.mocked(api)).not.toHaveBeenCalled();
  });

  it("forwards diagram: true to /generate when the setting is enabled", async () => {
    state.generateDiagram = true;
    const fresh = mkSpec({ generatedAt: "2026-03-03T00:00:00Z" });
    vi.mocked(api).mockImplementation(async (path: string) =>
      path.startsWith("/walkthrough") ? { ok: true, data: fresh } : { ok: true },
    );
    await launcherStore.requestGenerate("new");
    expect(vi.mocked(api)).toHaveBeenCalledWith("/generate", "POST", {
      pr: PR,
      mode: "new",
      sinceSha: undefined,
      depth: "heavy",
      reposRoot: "~/code",
      diagram: true,
    });
    await vi.advanceTimersByTimeAsync(GEN_POLL_INTERVAL_MS); // drain the poll so generation ends
  });
});

describe("dismissGen", () => {
  it("stops watching and drops the marker; generation keeps running server-side", async () => {
    // accept /generate so a poll is actually running for dismissGen to clear
    vi.mocked(api).mockImplementation(async (p: string) =>
      p.startsWith("/walkthrough") ? { ok: false } : { ok: true },
    );
    await launcherStore.requestGenerate("new");
    launcherStore.dismissGen();
    expect(launcherStore.generating()).toBe(false);
    expect(vi.mocked(storeRemove)).toHaveBeenCalledWith(`kvasir:gen:${PR}`);
    const calls = vi.mocked(api).mock.calls.length;
    await vi.advanceTimersByTimeAsync(GEN_POLL_INTERVAL_MS * 3);
    expect(vi.mocked(api).mock.calls.length).toBe(calls); // poll really stopped
  });

  it("with no poll running is a safe no-op", () => {
    launcherStore.dismissGen();
    expect(launcherStore.generating()).toBe(false);
    expect(vi.mocked(storeRemove)).toHaveBeenCalledWith(`kvasir:gen:${PR}`);
  });

  it("off a PR page skips removing the marker", () => {
    Object.defineProperty(window, "location", {
      value: new URL("https://github.com/acme"),
      writable: true,
    });
    launcherStore.dismissGen();
    expect(launcherStore.generating()).toBe(false);
    expect(vi.mocked(storeRemove)).not.toHaveBeenCalled();
  });
});

describe("refresh", () => {
  it("uses the live spec and caches it", async () => {
    const live = mkSpec();
    vi.mocked(api).mockResolvedValue({ ok: true, data: live });
    await launcherStore.refresh();
    expect(state.spec).toEqual(live);
    expect(vi.mocked(storeSet)).toHaveBeenCalledWith(`kvasir:spec:${PR}`, live);
  });

  it("falls back to a valid cached spec, else null", async () => {
    const cached = mkSpec();
    vi.mocked(api).mockResolvedValue({ ok: false });
    vi.mocked(storeGet).mockImplementation(async (k: string) =>
      k.startsWith("kvasir:spec:") ? cached : undefined,
    );
    await launcherStore.refresh();
    expect(state.spec).toEqual(cached);

    vi.mocked(storeGet).mockResolvedValue(undefined);
    await launcherStore.refresh();
    expect(state.spec).toBeNull();
  });

  it("re-highlights the current step on a refresh while touring the diff", async () => {
    vi.mocked(api).mockResolvedValue({ ok: true, data: mkSpec() });
    vi.spyOn(tourStore, "open").mockReturnValue(true);
    vi.spyOn(tourStore, "stepIndex").mockReturnValue(2);
    const goto = vi.spyOn(tourStore, "goto").mockImplementation(() => {});
    await launcherStore.refresh();
    expect(goto).toHaveBeenCalledWith(2);
  });

  it("does not re-highlight off the diff tab", async () => {
    Object.defineProperty(window, "location", {
      value: new URL("https://github.com/acme/widget-api/pull/7"),
      writable: true,
    });
    vi.mocked(api).mockResolvedValue({ ok: true, data: mkSpec() });
    vi.spyOn(tourStore, "open").mockReturnValue(true);
    const goto = vi.spyOn(tourStore, "goto").mockImplementation(() => {});
    await launcherStore.refresh();
    expect(goto).not.toHaveBeenCalled();
  });

  it("resumes a fresh in-flight generation (timer from the original start)", async () => {
    const at = Date.now() - 60_000;
    vi.mocked(storeGet).mockImplementation(async (k: string) =>
      k.startsWith("kvasir:gen:") ? { previousSig: "", at } : undefined,
    );
    vi.mocked(api).mockResolvedValue({ ok: false });
    await launcherStore.refresh();
    expect(launcherStore.generating()).toBe(true);
    expect(launcherStore.genStartAt()).toBe(at);
  });

  it("drops a stale generation marker instead of resuming", async () => {
    vi.mocked(storeGet).mockImplementation(async (k: string) =>
      k.startsWith("kvasir:gen:")
        ? { previousSig: "", at: Date.now() - (GEN_MAX_TRIES * GEN_POLL_INTERVAL_MS + 1) }
        : undefined,
    );
    await launcherStore.refresh();
    expect(launcherStore.generating()).toBe(false);
    expect(vi.mocked(storeRemove)).toHaveBeenCalledWith(`kvasir:gen:${PR}`);
  });

  it("detects new commits since the reviewed head", async () => {
    const spec = mkSpec(); // headSha sha-1
    vi.mocked(api).mockImplementation(async (path: string) =>
      path.startsWith("/walkthrough") ? { ok: true, data: spec } : { ok: true, data: { headSha: "sha-2" } },
    );
    await launcherStore.refresh();
    expect(launcherStore.newCommits()).toBe(true);

    vi.mocked(api).mockImplementation(async (path: string) =>
      path.startsWith("/walkthrough") ? { ok: true, data: spec } : { ok: true, data: { headSha: "sha-1" } },
    );
    await launcherStore.refresh();
    expect(launcherStore.newCommits()).toBe(false);
  });

  it("does nothing off a PR page", async () => {
    Object.defineProperty(window, "location", {
      value: new URL("https://github.com/acme"),
      writable: true,
    });
    await launcherStore.refresh();
    expect(vi.mocked(api)).not.toHaveBeenCalled();
  });
});

describe("branch edges", () => {
  it("a second requestGenerate replaces the running poll", async () => {
    // /generate accepted, /walkthrough never returns a spec → the poll stays alive
    vi.mocked(api).mockImplementation(async (p: string) =>
      p.startsWith("/walkthrough") ? { ok: false } : { ok: true },
    );
    await launcherStore.requestGenerate("new");
    await launcherStore.requestGenerate("new");
    expect(launcherStore.generating()).toBe(true); // no crash, one poll alive
  });

  it("an unpaired generate (401) aborts without polling and flips to unpaired", async () => {
    const { pairingStore } = await import("./pairing");
    pairingStore.reset();
    vi.mocked(api).mockResolvedValue({ ok: false, status: 401, data: { error: "not paired" } });
    await launcherStore.requestGenerate("new");
    expect(launcherStore.generating()).toBe(false);
    expect(pairingStore.state()).toEqual({ phase: "unpaired" });
  });

  it("poll completion computes newCommits against the live head", async () => {
    // refresh() first records curHead=sha-2 against the sha-1 review
    const reviewed = mkSpec();
    vi.mocked(api).mockImplementation(async (path: string) =>
      path.startsWith("/walkthrough")
        ? { ok: true, data: reviewed }
        : { ok: true, data: { headSha: "sha-2" } },
    );
    await launcherStore.refresh();
    // the regenerated spec reviews sha-2 → no new commits any more
    const regenerated = mkSpec({
      generatedAt: "2026-03-03T00:00:00Z",
      pr: { url: PR, owner: "acme", repo: "widget-api", number: 7, headSha: "sha-2" },
    });
    vi.mocked(api).mockImplementation(async (path: string) =>
      path.startsWith("/walkthrough") ? { ok: true, data: regenerated } : { ok: true },
    );
    await launcherStore.requestGenerate("new");
    await vi.advanceTimersByTimeAsync(GEN_POLL_INTERVAL_MS);
    expect(launcherStore.newCommits()).toBe(false);

    // and a spec that still trails the head keeps the flag on
    const stale = mkSpec({ generatedAt: "2026-04-04T00:00:00Z" }); // headSha sha-1 ≠ sha-2
    vi.mocked(api).mockImplementation(async (path: string) =>
      path.startsWith("/walkthrough") ? { ok: true, data: stale } : { ok: true, data: { headSha: "sha-2" } },
    );
    await launcherStore.refresh();
    await launcherStore.requestGenerate("new");
    await vi.advanceTimersByTimeAsync(GEN_POLL_INTERVAL_MS);
    expect(launcherStore.newCommits()).toBe(true);
  });

  it("a regenerated spec without a headSha leaves newCommits off", async () => {
    const noSha = mkSpec({
      generatedAt: "2026-05-05T00:00:00Z",
      pr: { url: PR, owner: "acme", repo: "widget-api", number: 7 },
    });
    vi.mocked(api).mockImplementation(async (path: string) =>
      path.startsWith("/walkthrough") ? { ok: true, data: noSha } : { ok: true },
    );
    await launcherStore.requestGenerate("new");
    await vi.advanceTimersByTimeAsync(GEN_POLL_INTERVAL_MS);
    expect(launcherStore.newCommits()).toBe(false);
  });

  it("an empty marker object counts as stale and is dropped", async () => {
    vi.mocked(storeGet).mockImplementation(async (k: string) =>
      k.startsWith("kvasir:gen:") ? {} : undefined,
    );
    await launcherStore.refresh();
    expect(launcherStore.generating()).toBe(false);
    expect(vi.mocked(storeRemove)).toHaveBeenCalledWith(`kvasir:gen:${PR}`);
  });

  it("a fresh marker without previousSig resumes against the empty signature", async () => {
    vi.mocked(storeGet).mockImplementation(async (k: string) =>
      k.startsWith("kvasir:gen:") ? { at: Date.now() } : undefined,
    );
    await launcherStore.refresh();
    expect(launcherStore.generating()).toBe(true);
  });

  it("installs a spec that landed after the poll was already dismissed", async () => {
    const fresh = mkSpec({ generatedAt: "2026-07-07T00:00:00Z" });
    let resolveWalk: (r: { ok: boolean; data?: WalkthroughSpec }) => void = () => {};
    vi.mocked(api).mockImplementation(async (path: string) => {
      if (!path.startsWith("/walkthrough")) return { ok: true };
      return new Promise((res) => {
        resolveWalk = res;
      });
    });
    await launcherStore.requestGenerate("new");
    await vi.advanceTimersByTimeAsync(GEN_POLL_INTERVAL_MS); // tick fires, awaits /walkthrough
    launcherStore.dismissGen(); // clears the interval handle mid-await
    resolveWalk({ ok: true, data: fresh });
    await vi.advanceTimersByTimeAsync(0); // callback resumes with a null poll handle
    expect(state.spec).toEqual(fresh);
  });

  it("gives up on the cap even when the poll was already dismissed", async () => {
    const unchanged = mkSpec();
    state.spec = unchanged;
    let resolveWalk: (r: { ok: boolean; data?: WalkthroughSpec }) => void = () => {};
    let walkCalls = 0;
    vi.mocked(api).mockImplementation(async (path: string) => {
      if (!path.startsWith("/walkthrough")) return { ok: true };
      walkCalls++;
      // every tick up to the cap returns the unchanged spec; the over-cap tick hangs
      if (walkCalls <= GEN_MAX_TRIES) return { ok: true, data: unchanged };
      return new Promise((res) => {
        resolveWalk = res;
      });
    });
    await launcherStore.requestGenerate("new");
    await vi.advanceTimersByTimeAsync(GEN_POLL_INTERVAL_MS * GEN_MAX_TRIES); // burn the cap
    await vi.advanceTimersByTimeAsync(GEN_POLL_INTERVAL_MS); // over-cap tick, awaits /walkthrough
    launcherStore.dismissGen(); // clears the interval handle mid-await
    resolveWalk({ ok: true, data: unchanged });
    await vi.advanceTimersByTimeAsync(0); // callback resumes over-cap with a null poll handle
    expect(launcherStore.generating()).toBe(false);
    expect(state.spec).toEqual(unchanged);
  });

  it("refresh during an active poll skips the resume probe", async () => {
    // accept /generate so the poll is alive; /walkthrough never lands a spec
    vi.mocked(api).mockImplementation(async (p: string) =>
      p.startsWith("/walkthrough") ? { ok: false } : { ok: true },
    );
    await launcherStore.requestGenerate("new");
    vi.mocked(storeGet).mockClear();
    await launcherStore.refresh();
    expect(vi.mocked(storeGet)).not.toHaveBeenCalledWith(`kvasir:gen:${PR}`);
  });
});

describe("resume vs an existing spec", () => {
  it("resumes when the stored previousSig matches the current spec (regeneration in flight)", async () => {
    const current = mkSpec();
    vi.mocked(api).mockImplementation(async (path: string) =>
      path.startsWith("/walkthrough") ? { ok: true, data: current } : { ok: false },
    );
    vi.mocked(storeGet).mockImplementation(async (k: string) =>
      k.startsWith("kvasir:gen:") ? { previousSig: specSig(current), at: Date.now() - 1000 } : undefined,
    );
    await launcherStore.refresh();
    expect(launcherStore.generating()).toBe(true);
  });

  it("drops the marker when the spec already changed past it", async () => {
    const current = mkSpec();
    vi.mocked(api).mockImplementation(async (path: string) =>
      path.startsWith("/walkthrough") ? { ok: true, data: current } : { ok: false },
    );
    vi.mocked(storeGet).mockImplementation(async (k: string) =>
      k.startsWith("kvasir:gen:") ? { previousSig: "an-older-signature", at: Date.now() - 1000 } : undefined,
    );
    await launcherStore.refresh();
    expect(launcherStore.generating()).toBe(false);
    expect(vi.mocked(storeRemove)).toHaveBeenCalledWith(`kvasir:gen:${PR}`);
  });

  it("ignores a malformed /head response (non-string sha)", async () => {
    vi.mocked(api).mockImplementation(async (path: string) =>
      path.startsWith("/walkthrough") ? { ok: true, data: mkSpec() } : { ok: true, data: { headSha: 42 } },
    );
    await launcherStore.refresh();
    expect(launcherStore.newCommits()).toBe(false);
  });

  it("does not let a stale PR's in-flight spec clobber the current PR after an SPA switch", async () => {
    let resolveApi!: (r: { ok: boolean; data?: unknown }) => void;
    vi.mocked(api).mockReturnValueOnce(new Promise((res) => (resolveApi = res)));
    const refreshing = launcherStore.refresh(); // loadSpec(PR 7) awaits the bridge
    // SPA-navigate to a different PR before PR 7's fetch resolves.
    Object.defineProperty(window, "location", {
      value: new URL("https://github.com/acme/widget-api/pull/999/files"),
      writable: true,
    });
    resolveApi({ ok: true, data: mkSpec() }); // PR 7's spec lands late
    await refreshing;
    expect(state.spec).toBeNull(); // the stale write was dropped, not applied to PR 999
  });

  it("a generation poll tick that resolves after a PR switch doesn't write the old PR's spec", async () => {
    vi.mocked(storeGet).mockImplementation(async (k: string) =>
      k.startsWith("kvasir:gen:") ? { previousSig: "old-sig", at: Date.now() } : undefined,
    );
    let resolveTick!: (r: { ok: boolean; data?: unknown }) => void;
    vi.mocked(api)
      .mockResolvedValueOnce({ ok: false }) // loadSpec → no live spec → resumeGeneration polls
      .mockReturnValue(new Promise((res) => (resolveTick = res))); // the poll tick's /walkthrough
    await launcherStore.refresh();
    expect(launcherStore.generating()).toBe(true); // the poll took over
    vi.advanceTimersByTime(GEN_POLL_INTERVAL_MS); // fire one tick → it awaits the bridge
    Object.defineProperty(window, "location", {
      value: new URL("https://github.com/acme/widget-api/pull/999/files"),
      writable: true,
    });
    resolveTick({ ok: true, data: mkSpec({ generatedAt: "2099-01-01T00:00:00Z" }) }); // new spec lands late
    await Promise.resolve();
    await Promise.resolve();
    expect(state.spec).toBeNull(); // the stale poll write was dropped
  });
});
