import { describe, it, expect } from "vitest";
import { uncoveredFiles, COVERAGE_MIN_ADDS, type PrManifest } from "./diff";

const mkManifest = (files: Partial<PrManifest["files"][number]>[]): PrManifest => ({
  owner: "a",
  repo: "b",
  number: 1,
  title: "t",
  description: "",
  headSha: "sha",
  discussion: [],
  files: files.map((f, i) => ({
    path: f.path ?? `f${i}.ts`,
    anchor: f.anchor ?? `diff-${i}`,
    status: f.status ?? "modified",
    additions: f.additions ?? 0,
    deletions: f.deletions ?? 0,
    patch: f.patch,
  })),
});

describe("uncoveredFiles", () => {
  it("flags a significant changed file with no step", () => {
    const m = mkManifest([{ path: "src/big.ts", additions: COVERAGE_MIN_ADDS }]);
    expect(uncoveredFiles(m, [])).toEqual(["src/big.ts"]);
  });

  it("clears a file once a step covers it (exact or boundary-lenient path match)", () => {
    const m = mkManifest([{ path: "src/big.ts", additions: 100 }]);
    expect(uncoveredFiles(m, ["src/big.ts"])).toEqual([]);
    expect(uncoveredFiles(m, ["big.ts"])).toEqual([]); // step used the short path
  });

  it("ignores small, removed, and generated/lockfile changes", () => {
    const m = mkManifest([
      { path: "src/tiny.ts", additions: COVERAGE_MIN_ADDS - 1 }, // below threshold
      { path: "src/gone.ts", additions: 500, status: "removed" }, // deleted
      { path: "package-lock.json", additions: 5000 }, // lockfile
      { path: "dist/bundle.js", additions: 9000 }, // generated dir
      { path: "app.min.js", additions: 2000 }, // minified
    ]);
    expect(uncoveredFiles(m, [])).toEqual([]);
  });

  it("returns only the still-uncovered significant files", () => {
    const m = mkManifest([
      { path: "src/a.ts", additions: 40 },
      { path: "src/b.ts", additions: 60 },
      { path: "src/c.ts", additions: 80 },
    ]);
    expect(uncoveredFiles(m, ["src/b.ts"])).toEqual(["src/a.ts", "src/c.ts"]);
  });
});
