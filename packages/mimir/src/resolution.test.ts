import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it, expect } from "vitest";
import { CloneError, type CloneRunner } from "./cloneRepo";
import { prepareCheckout, resolveCheckout, type ResolutionDeps } from "./resolution";
import { createMemoryResolvedRepoStore } from "./resolvedRepoStore";
import type { RepoProbes } from "./resolveRepo";

const PR = "https://github.com/acme/widget/pull/1";

const probesOver = (repos: Record<string, string | null>): RepoProbes => ({
  isDir: (candidate) => candidate in repos,
  originOf: (candidate) => repos[candidate] ?? null,
});

describe("resolveCheckout", () => {
  const clonesDir = "/home/u/.kvasir/clones";
  const clonesPath = "/home/u/.kvasir/clones/acme/widget";

  const deps = (over: Partial<ResolutionDeps>): ResolutionDeps => ({
    probes: probesOver({}),
    store: createMemoryResolvedRepoStore(),
    clonesDir,
    home: "/home/u",
    cloneRun: () => Promise.resolve({ code: 0, stderr: "" }),
    ...over,
  });

  it("returns ready with the clones path when it is a matching clone", () => {
    const d = deps({ probes: probesOver({ [clonesPath]: "https://github.com/acme/widget.git" }) });
    expect(resolveCheckout(PR, d)).toEqual({ status: "ready", path: clonesPath });
  });

  it("returns ready with a stored saved path when the clones path is absent", () => {
    const store = createMemoryResolvedRepoStore();
    store.set("acme/widget", "/home/u/code/widget");
    const d = deps({
      store,
      probes: probesOver({ "/home/u/code/widget": "git@github.com:acme/widget.git" }),
    });
    expect(resolveCheckout(PR, d)).toEqual({ status: "ready", path: "/home/u/code/widget" });
  });

  it("returns absent and drops a saved path that no longer validates", () => {
    const store = createMemoryResolvedRepoStore();
    store.set("acme/widget", "/home/u/code/widget");
    const d = deps({
      store,
      probes: probesOver({ "/home/u/code/widget": "https://github.com/acme/other.git" }),
    });
    expect(resolveCheckout(PR, d)).toEqual({ status: "absent" });
    expect(store.get("acme/widget")).toBeNull(); // stale entry dropped
  });

  it("returns absent when nothing resolves and there was no saved entry to drop", () => {
    expect(resolveCheckout(PR, deps({}))).toEqual({ status: "absent" });
  });
});

describe("prepareCheckout", () => {
  let sandbox: string;
  let clonesDir: string;

  const okRun: CloneRunner = (cmd) => {
    // The gh clone dest is the argv slot before the "--" separator.
    const dest = cmd[cmd.indexOf("--") - 1]!;
    mkdirSync(dest, { recursive: true });
    return Promise.resolve({ code: 0, stderr: "" });
  };

  const deps = (over: Partial<ResolutionDeps>): ResolutionDeps => ({
    probes: probesOver({}),
    store: createMemoryResolvedRepoStore(),
    clonesDir,
    home: sandbox,
    cloneRun: okRun,
    ...over,
  });

  beforeEach(() => {
    sandbox = mkdtempSync(path.join(tmpdir(), "kvasir-res-"));
    clonesDir = path.join(sandbox, ".kvasir", "clones");
  });
  afterEach(() => {
    rmSync(sandbox, { recursive: true, force: true });
  });

  it("clone-kvasir clones into the server clones dir, remembers the path, returns ready", async () => {
    const store = createMemoryResolvedRepoStore();
    const target = path.join(clonesDir, "acme", "widget");
    await expect(prepareCheckout(PR, "clone-kvasir", undefined, deps({ store }))).resolves.toEqual({
      status: "ready",
      path: target,
    });
    expect(store.get("acme/widget")).toBe(target);
    expect(existsSync(target)).toBe(true);
  });

  it("clone-dest clones into the given dest and remembers it", async () => {
    const store = createMemoryResolvedRepoStore();
    const dest = path.join(sandbox, "code", "widget");
    await expect(prepareCheckout(PR, "clone-dest", dest, deps({ store }))).resolves.toEqual({
      status: "ready",
      path: dest,
    });
    expect(store.get("acme/widget")).toBe(dest);
  });

  it("clone-dest without a dest throws", async () => {
    await expect(prepareCheckout(PR, "clone-dest", undefined, deps({}))).rejects.toThrow(
      /requires a destination path/,
    );
  });

  it("use-existing accepts a validated matching clone under home and remembers it", async () => {
    const dest = path.join(sandbox, "code", "widget");
    const store = createMemoryResolvedRepoStore();
    const d = deps({ store, probes: probesOver({ [dest]: "https://github.com/acme/widget.git" }) });
    await expect(prepareCheckout(PR, "use-existing", dest, d)).resolves.toEqual({
      status: "ready",
      path: dest,
    });
    expect(store.get("acme/widget")).toBe(dest);
  });

  it("use-existing rejects a path that isn't a matching clone", async () => {
    const dest = path.join(sandbox, "code", "widget");
    const d = deps({ probes: probesOver({ [dest]: "https://github.com/acme/other.git" }) });
    await expect(prepareCheckout(PR, "use-existing", dest, d)).rejects.toThrow(CloneError);
  });

  it("use-existing rejects a path outside home before probing (guard fires, not the probe)", async () => {
    // Probes say /etc/widget WOULD be a matching clone if reached — so a green test
    // proves the outside-home guard rejects it before isUsableClone is consulted.
    const d = deps({ probes: probesOver({ "/etc/widget": "https://github.com/acme/widget.git" }) });
    await expect(prepareCheckout(PR, "use-existing", "/etc/widget", d)).rejects.toThrow(
      /must be an absolute path under your home directory/,
    );
  });

  it("use-existing without a path throws", async () => {
    await expect(prepareCheckout(PR, "use-existing", undefined, deps({}))).rejects.toThrow(/requires a path/);
  });

  it("diff-only declines without touching the store or cloning", async () => {
    const store = createMemoryResolvedRepoStore();
    let cloned = false;
    const cloneRun: CloneRunner = () => {
      cloned = true;
      return Promise.resolve({ code: 0, stderr: "" });
    };
    await expect(prepareCheckout(PR, "diff-only", undefined, deps({ store, cloneRun }))).resolves.toEqual({
      status: "declined",
    });
    expect(store.get("acme/widget")).toBeNull();
    expect(cloned).toBe(false);
  });

  it("propagates a clone failure as CloneError without remembering a path", async () => {
    const store = createMemoryResolvedRepoStore();
    const cloneRun: CloneRunner = () => Promise.resolve({ code: 1, stderr: "network down" });
    await expect(prepareCheckout(PR, "clone-kvasir", undefined, deps({ store, cloneRun }))).rejects.toThrow(
      /network down/,
    );
    expect(store.get("acme/widget")).toBeNull();
  });
});
