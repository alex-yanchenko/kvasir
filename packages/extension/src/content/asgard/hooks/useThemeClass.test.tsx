// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { state } from "../store";
import { useThemeClass } from "./useThemeClass";

let mql: { matches: boolean; listeners: Array<() => void> };
beforeEach(() => {
  mql = { matches: false, listeners: [] };
  vi.stubGlobal("matchMedia", () => ({
    get matches() {
      return mql.matches;
    },
    addEventListener: (_: string, fn: () => void) => mql.listeners.push(fn),
    removeEventListener: (_: string, fn: () => void) => {
      mql.listeners = mql.listeners.filter((l) => l !== fn);
    },
  }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  state.theme = "auto"; // module singleton — restore so test order can't leak a .dark host
  document.body.innerHTML = "";
});

const host = () => {
  const el = document.createElement("div");
  document.body.append(el);
  return el;
};

describe("useThemeClass", () => {
  it("a null target is a safe no-op", () => {
    renderHook(() => useThemeClass(null));
    expect(document.querySelector(".dark")).toBeNull();
  });

  it("fixed light/dark toggle .dark and ignore the media query", () => {
    state.theme = "dark";
    const el = host();
    renderHook(() => useThemeClass(el));
    expect(el.classList.contains("dark")).toBe(true);

    state.theme = "light";
    const el2 = host();
    renderHook(() => useThemeClass(el2));
    expect(el2.classList.contains("dark")).toBe(false);
  });

  it("auto follows the OS and reacts to live changes, unbinding on cleanup", () => {
    state.theme = "auto";
    mql.matches = false;
    const el = host();
    const { unmount } = renderHook(() => useThemeClass(el));
    expect(el.classList.contains("dark")).toBe(false);

    mql.matches = true;
    mql.listeners.forEach((fn) => fn());
    expect(el.classList.contains("dark")).toBe(true);

    unmount();
    expect(mql.listeners).toEqual([]); // change listener removed
  });
  it("re-applies the class when the theme changes after mount", () => {
    state.theme = "light";
    const el = host();
    const { rerender } = renderHook(() => useThemeClass(el));
    expect(el.classList.contains("dark")).toBe(false);
    state.theme = "dark";
    rerender();
    expect(el.classList.contains("dark")).toBe(true);
  });
});
