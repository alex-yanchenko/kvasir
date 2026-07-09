// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { describe, it, expect, afterEach } from "vitest";
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

function scrollableX(
  el: HTMLElement,
  over: { scrollWidth?: number; clientWidth?: number; scrollLeft?: number },
) {
  el.style.overflowX = "auto";
  Object.defineProperty(el, "scrollWidth", { value: over.scrollWidth ?? 1000, configurable: true });
  Object.defineProperty(el, "clientWidth", { value: over.clientWidth ?? 200, configurable: true });
  Object.defineProperty(el, "scrollLeft", {
    value: over.scrollLeft ?? 0,
    writable: true,
    configurable: true,
  });
}

const wheel = (target: Element, deltaY: number): WheelEvent => {
  const e = new WheelEvent("wheel", { deltaY, bubbles: true, cancelable: true });
  target.dispatchEvent(e);
  return e;
};

const wheelX = (target: Element, deltaX: number): WheelEvent => {
  const e = new WheelEvent("wheel", { deltaX, deltaY: 0, bubbles: true, cancelable: true });
  target.dispatchEvent(e);
  return e;
};

let root: HTMLDivElement;
afterEach(() => root?.remove());

describe("useScrollLock", () => {
  const mount = (): HTMLDivElement => {
    root = document.createElement("div");
    document.body.append(root);
    renderHook(() => useScrollLock({ current: root }));
    return root;
  };

  it("swallows the wheel over a non-scrolling area so the page can't scroll", () => {
    const r = mount();
    const inert = r.appendChild(document.createElement("div"));
    expect(wheel(inert, 40).defaultPrevented).toBe(true);
  });

  it("swallows the wheel when the target isn't an element (no scroller to find)", () => {
    const r = mount();
    const textNode = r.appendChild(document.createTextNode("x"));
    const e = new WheelEvent("wheel", { deltaY: 40, bubbles: true, cancelable: true });
    textNode.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
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

  it("swallows the wheel when only sub-pixel phantom room remains (zoomed layouts)", () => {
    // Under browser zoom / display scaling, scrollTop is fractional while
    // scrollHeight/clientHeight round to integers — a scroller at its true end
    // reports <1px of "room". Counting that as scrollable lets the wheel through,
    // and the browser (finding nothing that actually moves) chains it to the PAGE.
    // Metrics reproduced from a real zoomed panel: 816/516 with max scrollTop 299.09….
    const r = mount();
    const zoomedBottom = r.appendChild(document.createElement("div"));
    scrollable(zoomedBottom, { scrollTop: 299.0909, scrollHeight: 816, clientHeight: 516 });
    expect(wheel(zoomedBottom, 40).defaultPrevented).toBe(true); // down: 0.9px phantom room
    const zoomedTop = r.appendChild(document.createElement("div"));
    scrollable(zoomedTop, { scrollTop: 0.4545 });
    expect(wheel(zoomedTop, -40).defaultPrevented).toBe(true); // up: sub-pixel above the top
  });

  it("ignores a non-overflowing element and a content-shorter-than-box one", () => {
    const r = mount();
    const short = r.appendChild(document.createElement("div"));
    short.style.overflowY = "auto";
    Object.defineProperty(short, "scrollHeight", { value: 100, configurable: true });
    Object.defineProperty(short, "clientHeight", { value: 200, configurable: true });
    expect(wheel(short, 40).defaultPrevented).toBe(true); // not actually scrollable
  });

  it("lets an inner horizontal scroller consume a horizontal wheel (page untouched)", () => {
    const r = mount();
    const row = r.appendChild(document.createElement("div"));
    scrollableX(row, { scrollLeft: 50 }); // room left and right
    expect(wheelX(row, 40).defaultPrevented).toBe(false); // right: room ahead
    expect(wheelX(row, -40).defaultPrevented).toBe(false); // left: room behind
  });

  it("swallows a horizontal wheel when the inner scroller is at the horizontal edge", () => {
    const r = mount();
    const atLeft = r.appendChild(document.createElement("div"));
    scrollableX(atLeft, { scrollLeft: 0 });
    expect(wheelX(atLeft, -40).defaultPrevented).toBe(true); // left at the start
    const atRight = r.appendChild(document.createElement("div"));
    scrollableX(atRight, { scrollLeft: 800, scrollWidth: 1000, clientWidth: 200 });
    expect(wheelX(atRight, 40).defaultPrevented).toBe(true); // right at the end
  });

  it("detaches the listener on unmount", () => {
    root = document.createElement("div");
    document.body.append(root);
    const { unmount } = renderHook(() => useScrollLock({ current: root }));
    unmount();
    expect(wheel(root, 40).defaultPrevented).toBe(false); // no handler left to prevent
  });

  it("is a no-op when the ref is empty", () => {
    renderHook(() => useScrollLock({ current: null }));
    // No element to bind to → no wheel handler is installed, so the page still scrolls.
    expect(wheel(document.body, 40).defaultPrevented).toBe(false);
  });
});
