// @vitest-environment jsdom
import type { EntrySummary } from "@kvasir/runes/history";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../muninn", () => ({ storeGet: vi.fn(), storeSet: vi.fn(), storeRemove: vi.fn() }));

import { historyStore } from "../history";
import { state } from "../store";
import { HistoryFacets } from "./HistoryFacets";

const sum = (over: Partial<EntrySummary> = {}): EntrySummary => ({
  kind: "code",
  id: "a",
  title: "Auth flow",
  source: "chat",
  steps: 2,
  repos: ["acme/web"],
  url: "https://github.com/acme/web/blob/main/a.ts?kvasir=a",
  version: 1,
  updatedAt: 1000,
  ...over,
});

beforeEach(() => {
  state.history = [
    sum({ id: "p1", kind: "pr" }),
    sum({ id: "c1", kind: "code" }),
    sum({ id: "p2", kind: "pr", version: 5 }),
  ];
  state.historyQuery = "";
  state.historyFacet = "all";
  state.seen = { p2: 2 }; // p2 is stale (version 5 > seen 2)
});
afterEach(() => cleanup());

describe("HistoryFacets", () => {
  it("lists the facets with counts and marks the active one", () => {
    render(<HistoryFacets />);
    expect(screen.getByRole("button", { name: /All/ }).getAttribute("aria-current")).toBe("true");
    expect(screen.getByRole("button", { name: /All/ }).textContent).toContain("3"); // total count
    expect(screen.getByRole("button", { name: /PR Walkthroughs/ }).textContent).toContain("2");
    expect(screen.getByRole("button", { name: /Code Walkthroughs/ }).textContent).toContain("1");
    expect(screen.getByRole("button", { name: /Needs sync/ }).textContent).toContain("1");
  });

  it("clicking a facet activates it (parent re-render reflects the new active state)", () => {
    const { rerender } = render(<HistoryFacets />);
    fireEvent.click(screen.getByRole("button", { name: /PR Walkthroughs/ }));
    expect(historyStore.facet()).toBe("pr");
    rerender(<HistoryFacets />); // the panel re-renders on store touch() in production
    expect(screen.getByRole("button", { name: /PR Walkthroughs/ }).getAttribute("aria-current")).toBe("true");
  });
});
