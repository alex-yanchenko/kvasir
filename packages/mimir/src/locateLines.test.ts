import { describe, it, expect } from "vitest";
import { locateLines } from "./locateLines";

describe("locateLines", () => {
  it("derives an R range from a highlighted added line (new-side numbering off the @@ header)", () => {
    // hunk starts at new-side line 12; the two '+' lines are 14 and 15.
    const patch = "@@ -10,3 +12,5 @@ ctx\n old\n old2\n+added-one\n+added-two";
    expect(locateLines(["added-two"], patch)).toEqual({ side: "R", start: 15, end: 15 });
  });

  it("derives an L range from a highlighted removed line (old-side numbering)", () => {
    // old side starts at 3; the two '-' lines are 3 and 4.
    const patch = "@@ -3,2 +2,0 @@\n-removed-x\n-removed-y";
    expect(locateLines(["removed-y"], patch)).toEqual({ side: "L", start: 4, end: 4 });
  });

  it("spans min..max of all matched added lines (non-adjacent matches fill the gap)", () => {
    const patch = "@@ -1,0 +1,4 @@\n+alpha\n+beta\n+gamma\n+delta";
    expect(locateLines(["alpha", "delta"], patch)).toEqual({ side: "R", start: 1, end: 4 });
  });

  it("prefers the added side when a hunk matches both an added and a removed line (a modification)", () => {
    // old 'was' at line 5 (L), new 'now' at line 5 (R); both match, R wins.
    const patch = "@@ -5,1 +5,1 @@\n-value = was\n+value = now";
    expect(locateLines(["value ="], patch)).toEqual({ side: "R", start: 5, end: 5 });
  });

  it("clamps to the added run when a highlight spans context and added lines", () => {
    // 'shared' appears on a context line (12) and an added line (14); only the added
    // line counts, so the range is the added run, not 12..14.
    const patch = "@@ -10,2 +12,3 @@\n shared context\n old\n+shared added";
    expect(locateLines(["shared"], patch)).toEqual({ side: "R", start: 14, end: 14 });
  });

  it("takes the first changed hunk when a substring matches changed lines in more than one", () => {
    const patch = "@@ -1,1 +1,1 @@\n-dup\n+dup line\n@@ -20,1 +20,2 @@\n ctx\n+dup line";
    expect(locateLines(["dup line"], patch)).toEqual({ side: "R", start: 1, end: 1 });
  });

  it("falls back to a context line (R side) when no changed line matches", () => {
    // The signature is unchanged context (new line 12); the change is below it.
    const patch = "@@ -10,3 +12,4 @@\n export function foo() {\n old\n+added\n old2";
    expect(locateLines(["export function foo"], patch)).toEqual({ side: "R", start: 12, end: 12 });
  });

  it("prefers a changed-line match over a context match in an earlier hunk", () => {
    const patch = "@@ -1,1 +1,1 @@\n keep marker\n@@ -20,0 +20,1 @@\n+marker added";
    expect(locateLines(["marker"], patch)).toEqual({ side: "R", start: 20, end: 20 });
  });

  it("lets an earlier hunk's removed-only match win over a later hunk's added match (hunk order beats side preference)", () => {
    // The needle matches a removed line in hunk 1 and an added line in hunk 2; the
    // first changed hunk wins outright, so side is L even though a later R match exists.
    const patch = "@@ -1,1 +1,0 @@\n-shared\n@@ -20,0 +20,1 @@\n+shared";
    expect(locateLines(["shared"], patch)).toEqual({ side: "L", start: 1, end: 1 });
  });

  it("spans only the first matching region when distinct substrings match different hunks", () => {
    // The derived range covers the first region the substrings hit; a substring that
    // only matches a later hunk is left out (the prompt scopes a step to one region).
    const patch = "@@ -1,1 +1,1 @@\n+alpha\n@@ -20,1 +20,1 @@\n+zulu";
    expect(locateLines(["alpha", "zulu"], patch)).toEqual({ side: "R", start: 1, end: 1 });
  });

  it("returns undefined when the highlight matches nothing in the patch", () => {
    const patch = "@@ -1,0 +1,2 @@\n+alpha\n+beta";
    expect(locateLines(["not here"], patch)).toBeUndefined();
  });

  it("returns undefined for an absent patch or empty/blank highlight", () => {
    expect(locateLines(["x"], undefined)).toBeUndefined();
    expect(locateLines([], "@@ -1,0 +1,1 @@\n+x")).toBeUndefined();
    expect(locateLines(undefined, "@@ -1,0 +1,1 @@\n+x")).toBeUndefined();
    expect(locateLines(["  "], "@@ -1,0 +1,1 @@\n+x")).toBeUndefined();
  });

  it("matches on the trimmed needle but against full line content (indentation-insensitive needle)", () => {
    const patch = "@@ -1,0 +1,1 @@\n+    indented();";
    expect(locateLines([" indented(); "], patch)).toEqual({ side: "R", start: 1, end: 1 });
  });

  it("handles a header whose count is omitted (defaults to 1)", () => {
    const patch = "@@ -5 +6 @@\n-old\n+new";
    expect(locateLines(["new"], patch)).toEqual({ side: "R", start: 6, end: 6 });
  });

  it("skips preamble before the first hunk and body lines that aren't +/-/space", () => {
    // A leading "diff --git" line (no current hunk yet) and a trailing "\ No newline"
    // marker are both ignored without shifting the derived range.
    const patch = "diff --git a/x b/x\n@@ -1,0 +1,1 @@\n+added\n\\ No newline at end of file";
    expect(locateLines(["added"], patch)).toEqual({ side: "R", start: 1, end: 1 });
  });
});
