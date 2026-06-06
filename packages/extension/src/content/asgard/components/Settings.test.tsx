// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Settings } from "./Settings";
import { state } from "../../state";
import { bifrost } from "../../bifrost";

let applied: ReturnType<typeof vi.fn>;
let offApply: () => void;
beforeEach(() => {
  state.theme = "auto";
  state.hlStyle = "tint";
  localStorage.clear();
  applied = vi.fn();
  offApply = bifrost.handle("theme:apply", applied);
});
afterEach(() => {
  cleanup();
  offApply();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("Settings", () => {
  it("renders the gear with the popover closed", () => {
    render(<Settings />);
    expect(screen.getByLabelText("Settings")).toBeTruthy();
    expect(screen.queryByLabelText("theme")).toBeNull();
  });

  it("toggles the popover open and closed from the gear", () => {
    render(<Settings />);
    fireEvent.click(screen.getByLabelText("Settings"));
    expect(screen.getByLabelText("theme")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Settings"));
    expect(screen.queryByLabelText("theme")).toBeNull();
  });

  it("shows the current choices and applies a theme change end to end", () => {
    state.theme = "light";
    render(<Settings />);
    fireEvent.click(screen.getByLabelText("Settings"));
    const themeSel = screen.getByLabelText("theme") as HTMLSelectElement;
    expect(themeSel.value).toBe("light");
    fireEvent.change(themeSel, { target: { value: "dark" } });
    expect(state.theme).toBe("dark");
    expect(localStorage.getItem("prwTheme")).toBe("dark");
    expect(applied).toHaveBeenCalledWith({ theme: "dark", hlStyle: "tint" });
    expect(themeSel.value).toBe("dark"); // re-rendered from the store
  });

  it("applies a highlight-style change", () => {
    render(<Settings />);
    fireEvent.click(screen.getByLabelText("Settings"));
    const hlSel = screen.getByLabelText("highlight") as HTMLSelectElement;
    fireEvent.change(hlSel, { target: { value: "github" } });
    expect(state.hlStyle).toBe("github");
    expect(applied).toHaveBeenCalledWith({ theme: "auto", hlStyle: "github" });
    expect(hlSel.value).toBe("github");
  });
});
