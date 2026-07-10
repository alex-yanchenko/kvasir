import type { Review } from "@kvasir/runes/review";
import { describe, it, expect } from "vitest";
import { parsePanelPrefs, parsePanelState, parseReviewCache, parseTourState } from "./persisted";

const review: Review = {
  version: 1,
  id: "rev-1",
  title: "Auth flow",
  steps: [{ id: "a", title: "Guard", body: "b", repo: { owner: "acme", name: "web" }, file: "src/a.ts" }],
};

describe("parseTourState", () => {
  it("drops a visited array with non-string elements", () => {
    expect(parseTourState({ visited: [1, 2], visitedStamp: "g1" })).toEqual({
      step: 0,
      overview: false,
      pos: null,
      size: null,
      visited: [],
      visitedStamp: "g1",
    });
  });

  it("drops a non-array visited value and a non-string stamp", () => {
    expect(parseTourState({ visited: "s1,s2", visitedStamp: 7 })).toEqual({
      step: 0,
      overview: false,
      pos: null,
      size: null,
      visited: [],
      visitedStamp: "",
    });
  });
});

describe("parsePanelState", () => {
  it("reads open + sidebarOpen + tab + geometry, dropping mismatches and non-records", () => {
    expect(
      parsePanelState({
        open: true,
        sidebarOpen: true,
        tab: "history",
        pos: { left: 1, top: 2 },
        size: { w: 3, h: 4 },
      }),
    ).toEqual({
      open: true,
      sidebarOpen: true,
      tab: "history",
      pos: { left: 1, top: 2 },
      size: { w: 3, h: 4 },
    });
    expect(parsePanelState({ open: "yes", sidebarOpen: "x", tab: 5, pos: { left: "x" }, size: 9 })).toEqual({
      open: false,
      sidebarOpen: false,
      tab: null,
      pos: null,
      size: null,
    });
    expect(parsePanelState(null)).toEqual({
      open: false,
      sidebarOpen: false,
      tab: null,
      pos: null,
      size: null,
    });
  });
});

describe("parsePanelPrefs", () => {
  it("reads the global window shape (pos + size + sidebarOpen), dropping mismatches and non-records", () => {
    expect(parsePanelPrefs({ pos: { left: 1, top: 2 }, size: { w: 3, h: 4 }, sidebarOpen: true })).toEqual({
      pos: { left: 1, top: 2 },
      size: { w: 3, h: 4 },
      sidebarOpen: true,
    });
    expect(parsePanelPrefs({ pos: { left: "x" }, size: 9, sidebarOpen: "yes" })).toEqual({
      pos: null,
      size: null,
      sidebarOpen: false,
    });
    expect(parsePanelPrefs(null)).toEqual({ pos: null, size: null, sidebarOpen: false });
  });
});

describe("parseReviewCache", () => {
  it("returns the step + review + visited from a valid cache object", () => {
    expect(parseReviewCache({ step: 2, review, visited: ["a"] })).toEqual({
      step: 2,
      review,
      visited: ["a"],
    });
  });

  it("defaults the step to 0 when it's missing or not a number", () => {
    expect(parseReviewCache({ review })).toEqual({ step: 0, review, visited: [] });
    expect(parseReviewCache({ step: "x", review })).toEqual({ step: 0, review, visited: [] });
  });

  it("keeps only string entries of a malformed visited list", () => {
    expect(parseReviewCache({ step: 0, review, visited: ["a", 7, null, "b"] })).toEqual({
      step: 0,
      review,
      visited: ["a", "b"],
    });
    expect(parseReviewCache({ step: 0, review, visited: "a" })).toEqual({ step: 0, review, visited: [] });
  });

  it("drops an invalid review and yields step 0 for non-objects", () => {
    expect(parseReviewCache({ step: 3, review: { not: "a review" } })).toEqual({
      step: 3,
      review: null,
      visited: [],
    });
    expect(parseReviewCache(null)).toEqual({ step: 0, review: null, visited: [] });
    expect(parseReviewCache(42)).toEqual({ step: 0, review: null, visited: [] });
  });
});
