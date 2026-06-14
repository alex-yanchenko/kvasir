import { describe, it, expect } from "vitest";
import { lineRange, repoSlug, resolveStep, ReviewBuildError, slugify, type DraftStep, type RepoContext } from "./reviewBuild";

describe("repoSlug", () => {
  it("parses ssh and https remotes, with or without .git", () => {
    expect(repoSlug("git@github.com:acme/web.git")).toEqual({ owner: "acme", name: "web" });
    expect(repoSlug("https://github.com/acme/web")).toEqual({ owner: "acme", name: "web" });
    expect(repoSlug("https://github.com/acme/web.git\n")).toEqual({ owner: "acme", name: "web" });
  });

  it("throws on a non-GitHub remote", () => {
    expect(() => repoSlug("https://gitlab.com/a/b.git")).toThrow(ReviewBuildError);
  });
});

describe("lineRange", () => {
  const content = "alpha\nbeta\ngamma\ndelta";

  it("passes explicit lines through", () => {
    expect(lineRange(content, { lines: { start: 2, end: 3 } })).toEqual({ start: 2, end: 3 });
  });

  it("resolves a single verbatim snippet to its 1-based line", () => {
    expect(lineRange(content, { from: "gamma" })).toEqual({ start: 3, end: 3 });
  });

  it("resolves a from→to range (to searched at/after from)", () => {
    expect(lineRange(content, { from: "beta", to: "delta" })).toEqual({ start: 2, end: 4 });
  });

  it("throws when from or to is not present", () => {
    expect(() => lineRange(content, { from: "missing" })).toThrow(/locator\.from not found/);
    expect(() => lineRange(content, { from: "gamma", to: "alpha" })).toThrow(/locator\.to not found/);
  });
});

describe("slugify", () => {
  it("kebab-cases and trims, falling back to 'step' when empty", () => {
    expect(slugify("Auth Guard!")).toBe("auth-guard");
    expect(slugify("  --x--  ")).toBe("x");
    expect(slugify("!!!")).toBe("step");
  });
});

describe("resolveStep", () => {
  const context: RepoContext = {
    remote: "git@github.com:acme/web.git",
    sha: "abc123",
    content: "export function guard() {\n  return ok;\n}",
  };
  const base: DraftStep = {
    repoDir: "~/code/web",
    file: "src/guard.ts",
    locator: { from: "export function guard()", to: "}" },
    title: "The guard",
    body: "summary",
  };

  it("assembles a full ReviewStep with resolved repo/ref/lines, defaulting the id", () => {
    expect(resolveStep(base, context, 0)).toEqual({
      id: "the-guard-1",
      title: "The guard",
      body: "summary",
      repo: { owner: "acme", name: "web" },
      ref: "abc123",
      file: "src/guard.ts",
      lines: { start: 1, end: 3 },
    });
  });

  it("keeps optional fields when present and honors an explicit id", () => {
    expect(
      resolveStep(
        { ...base, id: "guard", detail: "deep", highlight: ["ok"], suggestions: ["why?"] },
        context,
        2,
      ),
    ).toEqual({
      id: "guard",
      title: "The guard",
      body: "summary",
      detail: "deep",
      repo: { owner: "acme", name: "web" },
      ref: "abc123",
      file: "src/guard.ts",
      lines: { start: 1, end: 3 },
      highlight: ["ok"],
      suggestions: ["why?"],
    });
  });
});
