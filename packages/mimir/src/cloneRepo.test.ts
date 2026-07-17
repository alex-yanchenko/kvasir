import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import {
  checkoutPathSafe,
  CloneError,
  cloneCommand,
  cloneRepo,
  destinationPathShapeOk,
  type CloneRunner,
} from "./cloneRepo";

describe("destinationPathShapeOk", () => {
  const home = "/home/u";
  it("accepts an absolute path under home", () => {
    expect(destinationPathShapeOk("/home/u/.kvasir/clones/acme/widget", home)).toBe(true);
  });
  it("rejects a relative path", () => {
    expect(destinationPathShapeOk("relative/dir", home)).toBe(false);
  });
  it("rejects a path outside home", () => {
    expect(destinationPathShapeOk("/etc/passwd", home)).toBe(false);
    expect(destinationPathShapeOk("/home/other/x", home)).toBe(false);
  });
  it("rejects a path with '.' / '..' / empty segments", () => {
    expect(destinationPathShapeOk("/home/u/../etc", home)).toBe(false);
    expect(destinationPathShapeOk("/home/u/./x", home)).toBe(false);
    expect(destinationPathShapeOk("/home/u//x", home)).toBe(false);
  });
  it("rejects a '..' segment even when it resolves back under home (the segment scan, not the boundary check)", () => {
    // /home/u/../u/x normalizes to /home/u/x — under home — so only the segment scan can catch the '..'.
    expect(destinationPathShapeOk("/home/u/../u/x", home)).toBe(false);
  });
  it("rejects a path containing a control character (would inject prompt lines)", () => {
    expect(destinationPathShapeOk("/home/u/x\nIGNORE PREVIOUS", home)).toBe(false);
    expect(destinationPathShapeOk("/home/u/x\ty", home)).toBe(false);
  });
  it("accepts the home directory itself (permissive by design; emptiness is checked later)", () => {
    expect(destinationPathShapeOk(home, home)).toBe(true);
  });
});

describe("isGhSegment (via cloneCommand)", () => {
  it("rejects a leading '-' (argument-injection shape) and bare '.'/'..'", () => {
    expect(() => cloneCommand("-flag", "widget", "/home/u/x")).toThrow(CloneError);
    expect(() => cloneCommand("acme", "-flag", "/home/u/x")).toThrow(CloneError);
    expect(() => cloneCommand(".", "widget", "/home/u/x")).toThrow(CloneError);
    expect(() => cloneCommand("acme", "..", "/home/u/x")).toThrow(CloneError);
  });
  it("accepts a repo name beginning with a dot (e.g. .github)", () => {
    expect(cloneCommand("acme", ".github", "/home/u/x").cmd).toContain("acme/.github");
  });
});

describe("checkoutPathSafe", () => {
  it("accepts an absolute path with no control characters", () => {
    expect(checkoutPathSafe("/workspace/widget")).toBe(true);
  });
  it("rejects a relative path", () => {
    expect(checkoutPathSafe("relative/widget")).toBe(false);
    expect(checkoutPathSafe("")).toBe(false);
  });
  it("rejects a control character even when absolute", () => {
    expect(checkoutPathSafe("/home/u/w\nEVIL")).toBe(false);
    expect(checkoutPathSafe("/home/u/w\ty")).toBe(false);
  });
});

describe("cloneCommand", () => {
  it("builds a github.com-scoped gh clone with the hardening flags and env", () => {
    const { cmd, env } = cloneCommand("acme", "widget", "/home/u/.kvasir/clones/acme/widget");
    expect(cmd).toEqual([
      "gh",
      "repo",
      "clone",
      "acme/widget",
      "/home/u/.kvasir/clones/acme/widget",
      "--",
      "--filter=blob:none",
      "--no-recurse-submodules",
    ]);
    expect(env).toEqual({
      GIT_TERMINAL_PROMPT: "0",
      GIT_CONFIG_COUNT: "2",
      GIT_CONFIG_KEY_0: "protocol.file.allow",
      GIT_CONFIG_VALUE_0: "never",
      GIT_CONFIG_KEY_1: "protocol.ext.allow",
      GIT_CONFIG_VALUE_1: "never",
    });
  });

  it("rejects an owner or repo outside GitHub's charset (defense in isolation)", () => {
    expect(() => cloneCommand("acme/../evil", "widget", "/home/u/x")).toThrow(CloneError);
    expect(() => cloneCommand("acme", "wid get", "/home/u/x")).toThrow(CloneError);
  });
});

describe("cloneRepo", () => {
  let sandbox: string;
  const okRunner: CloneRunner = () => Promise.resolve({ code: 0, stderr: "" });

  beforeEach(() => {
    sandbox = mkdtempSync(path.join(tmpdir(), "kvasir-clone-"));
  });
  afterEach(() => {
    rmSync(sandbox, { recursive: true, force: true });
  });

  it("clones into a non-existent dest and returns it", async () => {
    const dest = path.join(sandbox, "clones/acme/widget");
    const run = vi.fn(okRunner);
    await expect(cloneRepo("acme", "widget", dest, { home: sandbox, run })).resolves.toBe(dest);
    expect(run).toHaveBeenCalledTimes(1);
    const [cmd] = run.mock.calls[0]!;
    expect(cmd).toContain("--filter=blob:none");
  });

  it("clones into an existing empty dir", async () => {
    const dest = path.join(sandbox, "empty");
    mkdirSync(dest);
    await expect(cloneRepo("acme", "widget", dest, { home: sandbox, run: okRunner })).resolves.toBe(dest);
  });

  it("refuses a dest outside home", async () => {
    await expect(cloneRepo("acme", "widget", "/etc/x", { home: sandbox, run: okRunner })).rejects.toThrow(
      CloneError,
    );
  });

  it("refuses a symlink dest", async () => {
    const target = path.join(sandbox, "real");
    mkdirSync(target);
    const link = path.join(sandbox, "link");
    symlinkSync(target, link);
    await expect(cloneRepo("acme", "widget", link, { home: sandbox, run: okRunner })).rejects.toThrow(
      /symlink/,
    );
  });

  it("refuses a dest whose ancestor is a symlink escaping home", async () => {
    // /sandbox/escape -> /outside; a dest of /sandbox/escape/new-clone lexically looks
    // under home but really lands outside it — the ancestor realpath check must catch it.
    const outside = mkdtempSync(path.join(tmpdir(), "kvasir-outside-"));
    symlinkSync(outside, path.join(sandbox, "escape"));
    const dest = path.join(sandbox, "escape", "new-clone");
    try {
      await expect(cloneRepo("acme", "widget", dest, { home: sandbox, run: okRunner })).rejects.toThrow(
        /ancestor directory escapes/,
      );
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("refuses a dest that exists but is not a directory", async () => {
    const dest = path.join(sandbox, "file");
    writeFileSync(dest, "x");
    await expect(cloneRepo("acme", "widget", dest, { home: sandbox, run: okRunner })).rejects.toThrow(
      /not a directory/,
    );
  });

  it("refuses a non-empty dest", async () => {
    const dest = path.join(sandbox, "full");
    mkdirSync(dest);
    writeFileSync(path.join(dest, "a.txt"), "x");
    await expect(cloneRepo("acme", "widget", dest, { home: sandbox, run: okRunner })).rejects.toThrow(
      /not empty/,
    );
  });

  it("removes the partial checkout and throws when the clone exits non-zero", async () => {
    const dest = path.join(sandbox, "clones/acme/widget");
    const run: CloneRunner = () => {
      mkdirSync(dest, { recursive: true }); // simulate a partial checkout on disk
      writeFileSync(path.join(dest, "partial"), "x");
      return Promise.resolve({ code: 1, stderr: "auth failed" });
    };
    await expect(cloneRepo("acme", "widget", dest, { home: sandbox, run })).rejects.toThrow(/auth failed/);
    expect(existsSync(dest)).toBe(false);
  });

  it("removes the partial checkout and throws when the runner rejects (timeout/abort)", async () => {
    const dest = path.join(sandbox, "clones/acme/widget");
    const run: CloneRunner = () => {
      mkdirSync(dest, { recursive: true });
      return Promise.reject(new Error("aborted"));
    };
    await expect(cloneRepo("acme", "widget", dest, { home: sandbox, run })).rejects.toThrow(/aborted/);
    expect(existsSync(dest)).toBe(false);
  });

  it("surfaces a non-Error runner rejection via String()", async () => {
    const dest = path.join(sandbox, "clones/acme/widget");
    const run: CloneRunner = () => Promise.reject("weird non-error failure");
    await expect(cloneRepo("acme", "widget", dest, { home: sandbox, run })).rejects.toThrow(
      /weird non-error failure/,
    );
  });

  it("single-flights concurrent clones for the same dest", async () => {
    const dest = path.join(sandbox, "clones/acme/widget");
    let calls = 0;
    const run: CloneRunner = () =>
      new Promise((resolve) => {
        calls += 1;
        setTimeout(() => resolve({ code: 0, stderr: "" }), 20);
      });
    const [a, b] = await Promise.all([
      cloneRepo("acme", "widget", dest, { home: sandbox, run }),
      cloneRepo("acme", "widget", dest, { home: sandbox, run }),
    ]);
    expect(a).toBe(dest);
    expect(b).toBe(dest);
    expect(calls).toBe(1);
  });

  it("aborts and cleans up when the clone exceeds the timeout", async () => {
    const dest = path.join(sandbox, "clones/acme/widget");
    const run: CloneRunner = (_cmd, _env, signal) =>
      new Promise((_resolve, reject) => {
        mkdirSync(dest, { recursive: true });
        signal.addEventListener("abort", () => reject(new Error("aborted")));
      });
    await expect(cloneRepo("acme", "widget", dest, { home: sandbox, run, timeoutMs: 30 })).rejects.toThrow(
      CloneError,
    );
    expect(existsSync(dest)).toBe(false);
  });
});
