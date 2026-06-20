// @vitest-environment jsdom
import type { ReviewSummary } from "@prw/runes/review";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../reviews", () => ({
  reviewsStore: {
    load: vi.fn(),
    all: vi.fn(),
    filtered: vi.fn(),
    query: vi.fn(),
    setQuery: vi.fn(),
    open: vi.fn(),
  },
}));

import { reviewsStore } from "../../reviews";
import { ReviewsTab } from "./ReviewsTab";

const sum = (over: Partial<ReviewSummary> = {}): ReviewSummary => ({
  id: "a",
  title: "Auth flow",
  source: "chat",
  steps: 2,
  repos: ["acme/web", "acme/api"],
  url: "https://github.com/acme/web/blob/main/a.ts?prw=a",
  ...over,
});

beforeEach(() => {
  vi.mocked(reviewsStore.query).mockReturnValue("");
  vi.mocked(reviewsStore.all).mockReturnValue([]);
  vi.mocked(reviewsStore.filtered).mockReturnValue([]);
});
afterEach(() => cleanup());

describe("ReviewsTab", () => {
  it("loads on mount and shows a spinner before the list arrives", () => {
    vi.mocked(reviewsStore.all).mockReturnValue(null);
    render(<ReviewsTab />);
    expect(reviewsStore.load).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Loading reviews…")).toBeTruthy();
  });

  it("renders rows (title · repos · steps · source) and opens one on click", () => {
    vi.mocked(reviewsStore.all).mockReturnValue([sum()]);
    vi.mocked(reviewsStore.filtered).mockReturnValue([sum()]);
    render(<ReviewsTab />);
    expect(screen.getByText("Auth flow")).toBeTruthy();
    expect(screen.getByText("acme/web, acme/api · 2 steps · chat")).toBeTruthy();
    fireEvent.click(screen.getByText("Auth flow"));
    expect(reviewsStore.open).toHaveBeenCalledWith("https://github.com/acme/web/blob/main/a.ts?prw=a");
    expect(reviewsStore.open).toHaveBeenCalledTimes(1);
  });

  it("singularizes a one-step review and omits an absent source", () => {
    vi.mocked(reviewsStore.all).mockReturnValue([sum()]);
    vi.mocked(reviewsStore.filtered).mockReturnValue([
      sum({ steps: 1, source: undefined, repos: ["acme/web"] }),
    ]);
    render(<ReviewsTab />);
    expect(screen.getByText("acme/web · 1 step")).toBeTruthy();
  });

  it("typing drives setQuery", () => {
    vi.mocked(reviewsStore.all).mockReturnValue([sum()]);
    vi.mocked(reviewsStore.filtered).mockReturnValue([sum()]);
    render(<ReviewsTab />);
    fireEvent.change(screen.getByLabelText("Search reviews"), { target: { value: "auth" } });
    expect(reviewsStore.setQuery).toHaveBeenCalledWith("auth");
  });

  it("shows the empty hint, or a no-match hint when searching", () => {
    vi.mocked(reviewsStore.all).mockReturnValue([]);
    vi.mocked(reviewsStore.filtered).mockReturnValue([]);
    const { rerender } = render(<ReviewsTab />);
    expect(screen.getByText("No reviews yet — push one with /kvasir.")).toBeTruthy();
    vi.mocked(reviewsStore.query).mockReturnValue("zzz");
    rerender(<ReviewsTab />);
    expect(screen.getByText("No reviews match that search.")).toBeTruthy();
  });
});
