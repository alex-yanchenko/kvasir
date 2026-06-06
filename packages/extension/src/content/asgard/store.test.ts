// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getSnapshot, settingsStore, subscribe, touch } from "./store";
import { state } from "../state";
import { bifrost } from "./../bifrost";

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
  offApply();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("settingsStore", () => {
  it("reads live values from the backing state", () => {
    expect(settingsStore.theme()).toBe("auto");
    expect(settingsStore.hlStyle()).toBe("tint");
  });

  it("setTheme writes through: state, localStorage, theme:apply, and a version bump", () => {
    const before = getSnapshot();
    settingsStore.setTheme("dark");
    expect(state.theme).toBe("dark");
    expect(localStorage.getItem("prwTheme")).toBe("dark");
    expect(applied).toHaveBeenCalledWith({ theme: "dark", hlStyle: "tint" });
    expect(applied).toHaveBeenCalledTimes(1);
    expect(getSnapshot()).toBe(before + 1);
  });

  it("setHlStyle writes through the same path", () => {
    settingsStore.setHlStyle("github");
    expect(state.hlStyle).toBe("github");
    expect(localStorage.getItem("prwHl")).toBe("github");
    expect(applied).toHaveBeenCalledWith({ theme: "auto", hlStyle: "github" });
    expect(applied).toHaveBeenCalledTimes(1);
  });
});

describe("subscriptions", () => {
  it("notifies subscribers on touch and stops after unsubscribe", () => {
    const listener = vi.fn();
    const off = subscribe(listener);
    touch();
    expect(listener).toHaveBeenCalledTimes(1);
    off();
    touch();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
