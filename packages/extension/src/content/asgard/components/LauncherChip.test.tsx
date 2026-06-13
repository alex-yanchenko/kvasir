// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { launcherStore } from "../launcher";
import { PANEL_TABS, panelStore, state } from "../store";
import { LauncherChip } from "./LauncherChip";

beforeEach(() => {
  state.panel = { open: false, tab: PANEL_TABS.WALKTHROUGH, pos: null, size: null };
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("LauncherChip", () => {
  it("shows the idle label and opens the panel on click", () => {
    render(<LauncherChip />);
    fireEvent.click(screen.getByText("PR Walkthrough"));
    expect(panelStore.isOpen()).toBe(true);
  });

  it("is hidden while the panel is open (the header owns the close)", () => {
    state.panel.open = true;
    const { container } = render(<LauncherChip />);
    expect(container.innerHTML).toBe("");
  });

  it("shows a live elapsed timer while generating", () => {
    vi.useFakeTimers();
    vi.spyOn(launcherStore, "generating").mockReturnValue(true);
    vi.spyOn(launcherStore, "genStartAt").mockReturnValue(Date.now() - 65_000);
    render(<LauncherChip />);
    expect(screen.getByText(/Generating/)).toBeTruthy();
    expect(screen.getByText("1:05")).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByText("1:06")).toBeTruthy();
  });
});
