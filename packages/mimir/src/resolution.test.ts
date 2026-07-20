import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it, expect } from "vitest";
import type { CloneRunner } from "./cloneRepo";
import { createMemoryDefaultRootStore } from "./defaultRootStore";
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
    defaultRootStore: createMemoryDefaultRootStore(),
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

  it("consults the default root from the store when clones dir and saved path miss", () => {
    const defaultRootStore = createMemoryDefaultRootStore();
    defaultRootStore.set("/home/u/code");
    const d = deps({
      defaultRootStore,
      probes: probesOver({ "/home/u/code/widget": "https://github.com/acme/widget.git" }),
    });
    expect(resolveCheckout(PR, d)).toEqual({ status: "ready", path: "/home/u/code/widget" });
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
    defaultRootStore: createMemoryDefaultRootStore(),
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

  it("use-existing accepts a validated matching clone (anywhere, origin-match is the trust check)", async () => {
    // A clone OUTSIDE home is accepted — the matching git origin is what's trusted.
    const dest = "/workspace/widget";
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
    await expect(prepareCheckout(PR, "use-existing", dest, d)).rejects.toThrow(/is not a git clone of/);
  });

  it("use-existing rejects a relative path or one with control characters (prompt safety)", async () => {
    await expect(prepareCheckout(PR, "use-existing", "relative/widget", deps({}))).rejects.toThrow(
      /absolute path with no control characters/,
    );
    await expect(prepareCheckout(PR, "use-existing", "/home/u/w\nEVIL", deps({}))).rejects.toThrow(
      /absolute path with no control characters/,
    );
  });

  it("use-existing without a path throws", async () => {
    await expect(prepareCheckout(PR, "use-existing", undefined, deps({}))).rejects.toThrow(/requires a path/);
  });

  it("set-default-root persists the root and resolves the repo under it (ready)", async () => {
    const root = path.join(sandbox, "code");
    const defaultRootStore = createMemoryDefaultRootStore();
    const store = createMemoryResolvedRepoStore();
    const d = deps({
      store,
      defaultRootStore,
      probes: probesOver({
        [root]: null, // isDir true (present as a key), no origin needed for the root itself
        [path.join(root, "widget")]: "https://github.com/acme/widget.git",
      }),
    });
    await expect(prepareCheckout(PR, "set-default-root", root, d)).resolves.toEqual({
      status: "ready",
      path: path.join(root, "widget"),
    });
    expect(defaultRootStore.get()).toBe(root);
  });

  it("set-default-root still persists the root but declines when the repo isn't under it", async () => {
    const root = path.join(sandbox, "code");
    const defaultRootStore = createMemoryDefaultRootStore();
    const d = deps({ defaultRootStore, probes: probesOver({ [root]: null }) }); // root is a dir, repo not under it
    await expect(prepareCheckout(PR, "set-default-root", root, d)).resolves.toEqual({ status: "declined" });
    expect(defaultRootStore.get()).toBe(root); // remembered for future repos
  });

  it("set-default-root rejects a missing path, a non-directory, or a control-char path", async () => {
    await expect(prepareCheckout(PR, "set-default-root", undefined, deps({}))).rejects.toThrow(
      /requires a path/,
    );
    await expect(prepareCheckout(PR, "set-default-root", "/home/u/x\nEVIL", deps({}))).rejects.toThrow(
      /no control characters/,
    );
    // absolute + control-char-free but not an existing directory
    await expect(
      prepareCheckout(PR, "set-default-root", "/home/u/nope", deps({ probes: probesOver({}) })),
    ).rejects.toThrow(/is not a directory/);
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
