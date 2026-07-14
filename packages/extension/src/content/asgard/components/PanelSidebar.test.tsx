// @vitest-environment jsdom
import type { WalkthroughSpec } from "@kvasir/runes/spec";
import { cleanup, render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../muninn", () => ({ storeGet: vi.fn(), storeSet: vi.fn(), storeRemove: vi.fn() }));

import { PANEL_TABS, state } from "../store";
import { tourStore } from "../tour";
import { PanelSidebar } from "./PanelSidebar";

const spec = (): WalkthroughSpec => ({
  version: 1,
  pr: { url: "u", owner: "a", repo: "b", number: 7 },
  generatedAt: "t",
  steps: [{ id: "s1", title: "First step", body: "b", file: "f.ts", anchor: "x" }],
});

beforeEach(() => {
  Object.defineProperty(window, "location", {
    value: new URL("https://github.com/a/b/pull/7/files"),
    writable: true,
  });
  state.spec = null;
  state.persistedTour = { step: 0, pos: null, size: null };
  state.review = null;
  state.reviewStep = 0;
  state.reviewVisited = [];
  state.panel = { open: true, tab: PANEL_TABS.WALKTHROUGH, pos: null, size: null };
  if (tourStore.open()) tourStore.close();
});
afterEach(() => cleanup());

describe("PanelSidebar", () => {
  it("shows the outline on the walkthrough tab", () => {
    state.spec = spec();
    tourStore.start();
    render(<PanelSidebar />);
    expect(screen.getByTestId("sidebar")).toBeTruthy();
    expect(screen.getByTestId("outline")).toBeTruthy();
  });

  it("shows the review rail on the walkthrough tab of a ?kvasir page", () => {
    Object.defineProperty(window, "location", {
      value: new URL("https://github.com/acme/web/blob/main/src/a.ts?kvasir=rev-1"),
      writable: true,
    });
    state.review = {
      version: 1,
      id: "rev-1",
      title: "Auth flow",
      steps: [{ id: "a", title: "Guard", body: "b", repo: { owner: "acme", name: "web" }, file: "src/a.ts" }],
    };
    render(<PanelSidebar />);
    const outline = screen.getByTestId("outline");
    expect(outline.textContent).toContain("acme/web"); // the repo header — the review rail, not the PR one
    expect(outline.textContent).toContain("Guard");
  });

  it("shows the chat list on the chat tab", () => {
    state.panel.tab = PANEL_TABS.CHAT;
    render(<PanelSidebar />);
    expect(screen.getByRole("button", { name: "New chat" })).toBeTruthy();
  });

  it("shows the history facets on the history tab", () => {
    state.panel.tab = PANEL_TABS.HISTORY;
    render(<PanelSidebar />);
    expect(screen.getByTestId("history-facets")).toBeTruthy();
    expect(screen.queryByTestId("outline")).toBeNull();
  });

  it("shows the settings section nav on the settings tab", () => {
    state.panel.tab = PANEL_TABS.SETTINGS;
    render(<PanelSidebar />);
    expect(screen.getByTestId("settings-nav")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Appearance" })).toBeTruthy();
  });
});
