// @vitest-environment jsdom
import type { EntrySummary } from "@kvasir/runes/history";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../history", () => ({
  historyStore: {
    all: vi.fn(),
    error: vi.fn(),
    dismissError: vi.fn(),
    query: vi.fn(),
    setQuery: vi.fn(),
    facet: vi.fn(),
    load: vi.fn(),
    prItems: vi.fn(),
    codeItems: vi.fn(),
    driftFor: vi.fn(),
    staleCount: vi.fn(),
    open: vi.fn(),
    sync: vi.fn(),
    remove: vi.fn(),
    syncAll: vi.fn(),
  },
}));

import { historyStore } from "../../history";
import { pairingStore } from "../../pairing";
import { HistoryTab } from "./HistoryTab";

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
  vi.mocked(historyStore.error).mockReturnValue(null);
  vi.mocked(historyStore.query).mockReturnValue("");
  vi.mocked(historyStore.facet).mockReturnValue("all");
  vi.mocked(historyStore.all).mockReturnValue([]);
  vi.mocked(historyStore.prItems).mockReturnValue([]);
  vi.mocked(historyStore.codeItems).mockReturnValue([]);
  vi.mocked(historyStore.driftFor).mockReturnValue("current");
  vi.mocked(historyStore.staleCount).mockReturnValue(0);
  pairingStore.reset(); // module singleton — "unknown" unless a test sets the phase
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks(); // drop per-test pairingStore.state spies
});

describe("HistoryTab", () => {
  it("loads on mount and shows a loading state until the list arrives", () => {
    vi.mocked(historyStore.all).mockReturnValue(null);
    render(<HistoryTab />);
    expect(screen.getByText(/Loading history/)).toBeTruthy();
    expect(historyStore.load).toHaveBeenCalledTimes(1);
  });

  it("names a down channel instead of loading forever when nothing is cached", () => {
    vi.mocked(historyStore.all).mockReturnValue(null);
    vi.spyOn(pairingStore, "state").mockReturnValue({ phase: "down" });
    render(<HistoryTab />);
    expect(screen.getByText(/Channel not running/)).toBeTruthy();
    expect(screen.queryByText(/Loading history/)).toBeNull();
  });

  it("names a down channel in the empty state instead of claiming None yet", () => {
    vi.spyOn(pairingStore, "state").mockReturnValue({ phase: "down" });
    render(<HistoryTab />); // loaded [] + both sections empty
    expect(screen.getAllByText(/Channel not running/).length).toBeGreaterThan(0);
    expect(screen.queryByText("None yet.")).toBeNull();
  });

  it("surfaces a failed delete above the list, with a dismiss", () => {
    vi.mocked(historyStore.error).mockReturnValue(
      "Can't reach the channel — is your Claude session running?",
    );
    render(<HistoryTab />);
    expect(screen.getByText(/Can't reach the channel/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(historyStore.dismissError).toHaveBeenCalledTimes(1);
  });

  it("renders both sections; a row opens its entry; step count + source format", () => {
    const pr = sum({
      id: "p1",
      kind: "pr",
      title: "PR one",
      steps: 1,
      source: undefined,
      repos: ["acme/web"],
    });
    const code = sum({ id: "c1", kind: "code", title: "Code one", steps: 2, source: "chat" });
    vi.mocked(historyStore.all).mockReturnValue([pr, code]);
    vi.mocked(historyStore.prItems).mockReturnValue([pr]);
    vi.mocked(historyStore.codeItems).mockReturnValue([code]);
    render(<HistoryTab />);
    expect(screen.getByText("PR Walkthroughs")).toBeTruthy();
    expect(screen.getByText("Code Walkthroughs")).toBeTruthy();
    expect(screen.getByText("acme/web · 1 step")).toBeTruthy();
    expect(screen.getByText("acme/web · 2 steps · chat")).toBeTruthy();
    fireEvent.click(screen.getByText("PR one"));
    expect(historyStore.open).toHaveBeenCalledWith(pr);
    expect(historyStore.open).toHaveBeenCalledTimes(1);
  });

  it("the active facet hides the section it excludes", () => {
    vi.mocked(historyStore.all).mockReturnValue([sum({ id: "p1", kind: "pr" })]);
    vi.mocked(historyStore.prItems).mockReturnValue([sum({ id: "p1", kind: "pr" })]);
    vi.mocked(historyStore.facet).mockReturnValue("pr");
    const { unmount } = render(<HistoryTab />);
    expect(screen.getByText("PR Walkthroughs")).toBeTruthy();
    expect(screen.queryByText("Code Walkthroughs")).toBeNull(); // hidden under "pr"
    unmount();
    vi.mocked(historyStore.facet).mockReturnValue("code");
    render(<HistoryTab />);
    expect(screen.queryByText("PR Walkthroughs")).toBeNull(); // hidden under "code"
    expect(screen.getByText("Code Walkthroughs")).toBeTruthy();
  });

  it("shows the PR number and author on a PR Walkthrough row", () => {
    const pr = sum({
      id: "p1",
      kind: "pr",
      title: "Add limit",
      steps: 12,
      source: undefined,
      repos: ["acme/web"],
      prNumber: 7,
      author: "alice",
    });
    vi.mocked(historyStore.all).mockReturnValue([pr]);
    vi.mocked(historyStore.prItems).mockReturnValue([pr]);
    render(<HistoryTab />);
    expect(screen.getByText("acme/web #7 · 12 steps · by alice")).toBeTruthy();
  });

  it("shows a ↻ for a drifted entry (sync one) and trash (remove); none for current", () => {
    const stale = sum({ id: "c1", title: "Stale one" });
    const fresh = sum({ id: "c2", title: "Fresh one" });
    vi.mocked(historyStore.all).mockReturnValue([stale, fresh]);
    vi.mocked(historyStore.codeItems).mockReturnValue([stale, fresh]);
    vi.mocked(historyStore.driftFor).mockImplementation((entry) =>
      entry.id === "c1" ? "update" : "current",
    );
    render(<HistoryTab />);
    expect(screen.queryByLabelText("Sync Fresh one")).toBeNull();
    fireEvent.click(screen.getByLabelText("Sync Stale one"));
    expect(historyStore.sync).toHaveBeenCalledWith("c1");
    fireEvent.click(screen.getByLabelText("Delete Fresh one"));
    expect(historyStore.remove).toHaveBeenCalledWith("c2");
  });

  it("offers Sync all when entries are stale, wired to syncAll", () => {
    vi.mocked(historyStore.all).mockReturnValue([sum()]);
    vi.mocked(historyStore.codeItems).mockReturnValue([sum()]);
    vi.mocked(historyStore.staleCount).mockReturnValue(2);
    render(<HistoryTab />);
    const button = screen.getByRole("button", { name: /Sync all/ });
    expect(button.textContent).toContain("Sync all (2)");
    fireEvent.click(button);
    expect(historyStore.syncAll).toHaveBeenCalledTimes(1);
  });

  it("shows per-section empty copy: 'None yet.' with no query, 'No matches.' with one", () => {
    render(<HistoryTab />);
    expect(screen.getAllByText("None yet.")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: /Sync all/ })).toBeNull();
    cleanup();
    vi.mocked(historyStore.query).mockReturnValue("zzz");
    render(<HistoryTab />);
    expect(screen.getAllByText("No matches.")).toHaveLength(2);
  });

  it("reads 'None in this filter.' (not 'None yet.') when a facet empties a kind that has entries", () => {
    vi.mocked(historyStore.facet).mockReturnValue("stale"); // both sections show, only stale items
    vi.mocked(historyStore.all).mockReturnValue([sum({ id: "p1", kind: "pr" })]); // entries exist…
    vi.mocked(historyStore.prItems).mockReturnValue([]); // …but none are stale
    vi.mocked(historyStore.codeItems).mockReturnValue([]);
    render(<HistoryTab />);
    expect(screen.getAllByText("None in this filter.")).toHaveLength(2);
    expect(screen.queryByText("None yet.")).toBeNull();
  });

  it("typing in the search box sets the query", () => {
    render(<HistoryTab />);
    fireEvent.change(screen.getByLabelText("Search history"), { target: { value: "auth" } });
    expect(historyStore.setQuery).toHaveBeenCalledWith("auth");
  });
});
