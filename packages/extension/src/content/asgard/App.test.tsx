// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { App } from "./App";
import { PANEL_TABS, settingsStore, state } from "./store";

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

  it("re-applies the theme live when the store changes (no refresh needed)", () => {
    state.theme = "light";
    const host = document.createElement("div");
    render(<App themeTarget={host} />);
    expect(host.classList.contains("dark")).toBe(false);
    act(() => settingsStore.setTheme("dark"));
    expect(host.classList.contains("dark")).toBe(true);
  });
});
