// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useScrollLock } from "./useScrollLock";

// jsdom reports 0 for scroll metrics; pin them so canScroll has something to read.
function scrollable(
  el: HTMLElement,
  over: { scrollHeight?: number; clientHeight?: number; scrollTop?: number },
) {
  el.style.overflowY = "auto";
  Object.defineProperty(el, "scrollHeight", { value: over.scrollHeight ?? 1000, configurable: true });
  Object.defineProperty(el, "clientHeight", { value: over.clientHeight ?? 200, configurable: true });
  Object.defineProperty(el, "scrollTop", { value: over.scrollTop ?? 0, writable: true, configurable: true });
}

const wheel = (target: Element, deltaY: number): WheelEvent => {
  const e = new WheelEvent("wheel", { deltaY, bubbles: true, cancelable: true });
  target.dispatchEvent(e);
  return e;
};

let root: HTMLDivElement;
afterEach(() => root?.remove());

describe("useScrollLock", () => {
  const mount = (): HTMLDivElement => {
    root = document.createElement("div");
    document.body.appendChild(root);
    renderHook(() => useScrollLock({ current: root }));
    return root;
  };

  it("swallows the wheel over a non-scrolling area so the page can't scroll", () => {
    const r = mount();
    const inert = r.appendChild(document.createElement("div"));
    expect(wheel(inert, 40).defaultPrevented).toBe(true);
  });

  it("lets an inner scroller with room consume the wheel (page untouched)", () => {
    const r = mount();
    const list = r.appendChild(document.createElement("div"));
    scrollable(list, { scrollTop: 50 }); // room above and below
    expect(wheel(list, 40).defaultPrevented).toBe(false); // down: room below
    expect(wheel(list, -40).defaultPrevented).toBe(false); // up: room above
  });

  it("swallows the wheel when the inner scroller is already at the edge", () => {
    const r = mount();
    const atTop = r.appendChild(document.createElement("div"));
    scrollable(atTop, { scrollTop: 0 });
    expect(wheel(atTop, -40).defaultPrevented).toBe(true); // up at the top
    const atBottom = r.appendChild(document.createElement("div"));
    scrollable(atBottom, { scrollTop: 800, scrollHeight: 1000, clientHeight: 200 });
    expect(wheel(atBottom, 40).defaultPrevented).toBe(true); // down at the bottom
  });

  it("ignores a non-overflowing element and a content-shorter-than-box one", () => {
    const r = mount();
    const short = r.appendChild(document.createElement("div"));
    short.style.overflowY = "auto";
    Object.defineProperty(short, "scrollHeight", { value: 100, configurable: true });
    Object.defineProperty(short, "clientHeight", { value: 200, configurable: true });
    expect(wheel(short, 40).defaultPrevented).toBe(true); // not actually scrollable
  });

  it("detaches the listener on unmount", () => {
    root = document.createElement("div");
    document.body.appendChild(root);
    const { unmount } = renderHook(() => useScrollLock({ current: root }));
    unmount();
    expect(wheel(root, 40).defaultPrevented).toBe(false); // no handler left to prevent
  });

  it("is a no-op when the ref is empty", () => {
    renderHook(() => useScrollLock({ current: null }));
    // nothing to assert beyond not throwing — the effect returns early
  });
});
