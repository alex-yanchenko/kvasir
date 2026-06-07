// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { PANEL_TABS, state } from "./store";
import { App } from "./App";

beforeEach(() => {
  state.panel = { open: false, tab: PANEL_TABS.WALKTHROUGH, pos: null, size: null };
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("App", () => {
  it("mounts the launcher chip", () => {
    render(<App />);
    expect(screen.getByLabelText("Open PR Walkthrough")).toBeTruthy();
  });

  it("toggles the theme class on the given target", () => {
    state.theme = "dark";
    const host = document.createElement("div");
    render(<App themeTarget={host} />);
    expect(host.classList.contains("dark")).toBe(true);
  });
});
