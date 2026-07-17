import { describe, it, expect } from "vitest";
import { originMatches, resolveRepo, type RepoProbes } from "./resolveRepo";

describe("originMatches", () => {
  it("matches https, https+.git, ssh scp-form, and ssh:// origins for github.com", () => {
    for (const origin of [
      "https://github.com/acme/widget",
      "https://github.com/acme/widget.git",
      "git@github.com:acme/widget.git",
      "ssh://git@github.com/acme/widget.git",
    ]) {
      expect(originMatches(origin, "acme", "widget")).toBe(true);
    }
  });

  it("is case-insensitive on owner/repo (GitHub treats them so)", () => {
    expect(originMatches("https://github.com/AcMe/Widget.git", "acme", "widget")).toBe(true);
  });

  it("rejects a different owner, repo, or host", () => {
    expect(originMatches("https://github.com/other/widget.git", "acme", "widget")).toBe(false);
    expect(originMatches("https://github.com/acme/other.git", "acme", "widget")).toBe(false);
    expect(originMatches("https://gitlab.com/acme/widget.git", "acme", "widget")).toBe(false);
    expect(originMatches("https://evil.com/github.com/acme/widget", "acme", "widget")).toBe(false);
  });

  it("rejects a blank or malformed origin", () => {
    expect(originMatches("", "acme", "widget")).toBe(false);
    expect(originMatches("not a url", "acme", "widget")).toBe(false);
  });
});

const probesOver = (repos: Record<string, string | null>): RepoProbes => ({
  isDir: (path) => path in repos,
  originOf: (path) => repos[path] ?? null,
});

describe("resolveRepo", () => {
  const clonesDir = "/home/u/.kvasir/clones";
  const defaultPath = "/home/u/.kvasir/clones/acme/widget";

  it("resolves the server-owned clones path when it is a matching git repo", () => {
    const probes = probesOver({ [defaultPath]: "https://github.com/acme/widget.git" });
    expect(resolveRepo("acme", "widget", { clonesDir, savedPath: null, probes })).toEqual({
      status: "ready",
      path: defaultPath,
    });
  });

  it("falls back to a saved path when the clones path is absent", () => {
    const saved = "/home/u/code/widget";
    const probes = probesOver({ [saved]: "git@github.com:acme/widget.git" });
    expect(resolveRepo("acme", "widget", { clonesDir, savedPath: saved, probes })).toEqual({
      status: "ready",
      path: saved,
    });
  });

  it("prefers the clones path over a saved path when both are valid", () => {
    const saved = "/home/u/code/widget";
    const probes = probesOver({
      [defaultPath]: "https://github.com/acme/widget",
      [saved]: "https://github.com/acme/widget",
    });
    expect(resolveRepo("acme", "widget", { clonesDir, savedPath: saved, probes })).toEqual({
      status: "ready",
      path: defaultPath,
    });
  });

  it("is absent when a saved path is no longer a git repo (dir present, no origin)", () => {
    const saved = "/home/u/code/widget";
    const probes = probesOver({ [saved]: null });
    expect(resolveRepo("acme", "widget", { clonesDir, savedPath: saved, probes })).toEqual({
      status: "absent",
    });
  });

  it("is absent when a saved path's origin points at a different repo", () => {
    const saved = "/home/u/code/widget";
    const probes = probesOver({ [saved]: "https://github.com/acme/other.git" });
    expect(resolveRepo("acme", "widget", { clonesDir, savedPath: saved, probes })).toEqual({
      status: "absent",
    });
  });

  it("is absent when neither the clones path nor a saved path exists", () => {
    expect(resolveRepo("acme", "widget", { clonesDir, savedPath: null, probes: probesOver({}) })).toEqual({
      status: "absent",
    });
  });

  it("ignores a clones path that exists but is the wrong repo, falling through to absent", () => {
    const probes = probesOver({ [defaultPath]: "https://github.com/acme/other.git" });
    expect(resolveRepo("acme", "widget", { clonesDir, savedPath: null, probes })).toEqual({
      status: "absent",
    });
  });
});
