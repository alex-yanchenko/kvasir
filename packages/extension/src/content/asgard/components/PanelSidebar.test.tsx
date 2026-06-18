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
  state.tourState = { step: 0, pos: null, size: null };
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

  it("shows a placeholder on the other tabs", () => {
    state.panel.tab = PANEL_TABS.CHAT;
    render(<PanelSidebar />);
    expect(screen.getByText(/Nothing here yet/)).toBeTruthy();
    expect(screen.queryByTestId("outline")).toBeNull();
  });
});
