import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it, expect } from "vitest";
import type { CloneRunner } from "./cloneRepo";
import { createMemoryDefaultRootStore } from "./defaultRootStore";
import {
  adoptForeignCheckout,
  ensureCheckout,
  isUnderClonesDirectory,
  prepareCheckout,
  resolveCheckout,
  type ResolutionDeps,
} from "./resolution";
import { createMemoryResolvedRepoStore } from "./resolvedRepoStore";
import type { RepoProbes } from "./resolveRepo";

const PR = "https://github.com/acme/widget/pull/1";

const probesOver = (repos: Record<string, string | null>): RepoProbes => ({
  isDir: (candidate) => candidate in repos,
  originOf: (candidate) => repos[candidate] ?? null,
});

// Simulate both clone shapes on disk: the gh clone `gh repo clone <o/r> <dest> -- …`
// (dest is the slot before "--") and the local adoption `git … clone --local <src> <dest>`
// (dest last), plus the origin-reset step (a no-op). Each materializes the dest dir.
const okRun: CloneRunner = (cmd) => {
  const argv = [...cmd];
  if (argv.includes("--")) mkdirSync(argv[argv.indexOf("--") - 1]!, { recursive: true });
  else if (argv.includes("clone")) mkdirSync(argv[argv.length - 1]!, { recursive: true });
  return Promise.resolve({ code: 0, stderr: "" });
};

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
  let home: string;
  let clonesDir: string;

  const deps = (over: Partial<ResolutionDeps>): ResolutionDeps => ({
    probes: probesOver({}),
    store: createMemoryResolvedRepoStore(),
    defaultRootStore: createMemoryDefaultRootStore(),
    clonesDir,
    home,
    cloneRun: okRun,
    ...over,
  });

  beforeEach(() => {
    sandbox = mkdtempSync(path.join(tmpdir(), "kvasir-res-"));
    home = path.join(sandbox, "home");
    mkdirSync(home, { recursive: true });
    clonesDir = path.join(home, ".kvasir", "clones");
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
    const dest = path.join(home, "code", "widget");
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

  it("use-existing adopts a validated matching clone (outside home) into the clones dir via local clone", async () => {
    // A clone OUTSIDE home is accepted — the matching git origin is what's trusted — but
    // it is ADOPTED (local-cloned) under kvasir ownership; the returned path is the
    // kvasir clone, never the foreign one, so heavy git ops never touch the foreign .git.
    const source = path.join(sandbox, "external", "widget");
    mkdirSync(source, { recursive: true });
    const target = path.join(clonesDir, "acme", "widget");
    const store = createMemoryResolvedRepoStore();
    const d = deps({ store, probes: probesOver({ [source]: "https://github.com/acme/widget.git" }) });
    await expect(prepareCheckout(PR, "use-existing", source, d)).resolves.toEqual({
      status: "ready",
      path: target,
    });
    expect(store.get("acme/widget")).toBe(target);
    expect(existsSync(target)).toBe(true);
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

  it("set-default-root persists the root and adopts the repo found under it (ready)", async () => {
    const root = path.join(sandbox, "external", "code");
    const repoUnderRoot = path.join(root, "widget");
    mkdirSync(repoUnderRoot, { recursive: true }); // real dir: adoption local-clones it
    const target = path.join(clonesDir, "acme", "widget");
    const defaultRootStore = createMemoryDefaultRootStore();
    const store = createMemoryResolvedRepoStore();
    const d = deps({
      store,
      defaultRootStore,
      probes: probesOver({
        [root]: null, // isDir true (present as a key), no origin needed for the root itself
        [repoUnderRoot]: "https://github.com/acme/widget.git",
      }),
    });
    await expect(prepareCheckout(PR, "set-default-root", root, d)).resolves.toEqual({
      status: "ready",
      path: target, // the repo under the root is adopted into the clones dir
    });
    expect(defaultRootStore.get()).toBe(root);
    expect(store.get("acme/widget")).toBe(target);
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

describe("adoptForeignCheckout / ensureCheckout / isUnderClonesDirectory", () => {
  let sandbox: string;
  let home: string;
  let clonesDir: string;

  const deps = (over: Partial<ResolutionDeps>): ResolutionDeps => ({
    probes: probesOver({}),
    store: createMemoryResolvedRepoStore(),
    defaultRootStore: createMemoryDefaultRootStore(),
    clonesDir,
    home,
    cloneRun: okRun,
    ...over,
  });

  beforeEach(() => {
    sandbox = mkdtempSync(path.join(tmpdir(), "kvasir-adopt-"));
    home = path.join(sandbox, "home");
    mkdirSync(home, { recursive: true });
    clonesDir = path.join(home, ".kvasir", "clones");
  });
  afterEach(() => {
    rmSync(sandbox, { recursive: true, force: true });
  });

  describe("isUnderClonesDirectory", () => {
    it("is true for the dir itself and paths inside it, false otherwise", () => {
      expect(isUnderClonesDirectory(clonesDir, clonesDir)).toBe(true);
      expect(isUnderClonesDirectory(path.join(clonesDir, "acme", "widget"), clonesDir)).toBe(true);
      expect(isUnderClonesDirectory("/home/u/code/widget", clonesDir)).toBe(false);
      expect(isUnderClonesDirectory(`${clonesDir}-sneaky`, clonesDir)).toBe(false); // prefix, not a child
    });
  });

  describe("adoptForeignCheckout", () => {
    it("returns a path already under the clones dir unchanged, without cloning", async () => {
      let cloned = false;
      const cloneRun: CloneRunner = () => {
        cloned = true;
        return Promise.resolve({ code: 0, stderr: "" });
      };
      const inside = path.join(clonesDir, "acme", "widget");
      await expect(adoptForeignCheckout(inside, "acme", "widget", deps({ cloneRun }))).resolves.toBe(inside);
      expect(cloned).toBe(false);
    });

    it("local-clones a foreign checkout into <clonesDir>/<owner>/<repo> and resets origin to github", async () => {
      const source = path.join(sandbox, "external", "widget");
      mkdirSync(source, { recursive: true });
      const target = path.join(clonesDir, "acme", "widget");
      const commands: string[][] = [];
      const cloneRun: CloneRunner = (cmd) => {
        const argv = [...cmd];
        commands.push(argv);
        if (argv.includes("clone")) mkdirSync(argv[argv.length - 1]!, { recursive: true });
        return Promise.resolve({ code: 0, stderr: "" });
      };
      await expect(adoptForeignCheckout(source, "acme", "widget", deps({ cloneRun }))).resolves.toBe(target);
      expect(commands[0]).toEqual(expect.arrayContaining(["clone", "--local", source, target]));
      expect(commands[1]).toEqual(
        expect.arrayContaining(["remote", "set-url", "origin", "https://github.com/acme/widget.git"]),
      );
    });

    it("builds the target from the caller's owner/repo, never the checkout's origin casing", async () => {
      // A5 regression: resolveRepo's clones-dir lookup uses the PR-URL casing, so the
      // adopted directory must too — never the (possibly differently-cased) git origin.
      const source = path.join(sandbox, "external", "widget");
      mkdirSync(source, { recursive: true });
      const target = path.join(clonesDir, "acme", "widget"); // PR-URL casing, not "AcMe/Widget"
      const cloneRun: CloneRunner = (cmd) => {
        const argv = [...cmd];
        if (argv.includes("clone")) mkdirSync(argv[argv.length - 1]!, { recursive: true });
        return Promise.resolve({ code: 0, stderr: "" });
      };
      const d = deps({ cloneRun, probes: probesOver({ [source]: "https://github.com/AcMe/Widget.git" }) });
      await expect(adoptForeignCheckout(source, "acme", "widget", d)).resolves.toBe(target);
    });

    it("reuses an already-adopted clone without re-cloning (idempotent)", async () => {
      const source = path.join(sandbox, "external", "widget");
      const target = path.join(clonesDir, "acme", "widget");
      let cloned = false;
      const cloneRun: CloneRunner = () => {
        cloned = true;
        return Promise.resolve({ code: 0, stderr: "" });
      };
      // target already validates as a matching clone → reuse, no clone
      const d = deps({ cloneRun, probes: probesOver({ [target]: "https://github.com/acme/widget.git" }) });
      await expect(adoptForeignCheckout(source, "acme", "widget", d)).resolves.toBe(target);
      expect(cloned).toBe(false);
    });

    it("rejects an owner/repo that isn't a safe github segment (path-traversal guard)", async () => {
      const source = path.join(sandbox, "external", "widget");
      await expect(adoptForeignCheckout(source, "..", "widget", deps({}))).rejects.toThrow(
        /invalid owner\/repo/,
      );
      await expect(adoptForeignCheckout(source, "acme", "..", deps({}))).rejects.toThrow(
        /invalid owner\/repo/,
      );
    });
  });

  describe("ensureCheckout", () => {
    it("passes through an absent resolution without adopting", async () => {
      let cloned = false;
      const cloneRun: CloneRunner = () => {
        cloned = true;
        return Promise.resolve({ code: 0, stderr: "" });
      };
      await expect(ensureCheckout(PR, deps({ cloneRun }))).resolves.toEqual({ status: "absent" });
      expect(cloned).toBe(false);
    });

    it("returns a clones-dir checkout unchanged and caches it", async () => {
      const inside = path.join(clonesDir, "acme", "widget");
      const store = createMemoryResolvedRepoStore();
      const d = deps({ store, probes: probesOver({ [inside]: "https://github.com/acme/widget.git" }) });
      await expect(ensureCheckout(PR, d)).resolves.toEqual({ status: "ready", path: inside });
      expect(store.get("acme/widget")).toBe(inside);
    });

    it("adopts a foreign default-root checkout and caches the adopted path", async () => {
      const source = path.join(sandbox, "external", "widget");
      mkdirSync(source, { recursive: true });
      const target = path.join(clonesDir, "acme", "widget");
      const defaultRootStore = createMemoryDefaultRootStore();
      defaultRootStore.set(path.join(sandbox, "external"));
      const store = createMemoryResolvedRepoStore();
      const d = deps({
        store,
        defaultRootStore,
        probes: probesOver({ [source]: "https://github.com/acme/widget.git" }),
      });
      await expect(ensureCheckout(PR, d)).resolves.toEqual({ status: "ready", path: target });
      expect(store.get("acme/widget")).toBe(target);
    });
  });
});
