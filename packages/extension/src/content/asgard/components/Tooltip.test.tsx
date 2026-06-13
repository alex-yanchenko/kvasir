// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { TIP_DELAY_MS, Tooltips } from "./Tooltip";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

const setup = (rect?: Partial<DOMRect>) => {
  vi.useFakeTimers();
  render(<Tooltips />);
  const btn = document.createElement("button");
  btn.setAttribute("data-prw-tip", "Hello tip");
  document.body.append(btn);
  if (rect) {
    vi.spyOn(btn, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      right: 0,
      bottom: 0,
      width: 0,
      height: 0,
      x: 0,
      y: 0,
      toJSON: () => null,
      ...rect,
    });
  }
  return btn;
};

describe("Tooltips", () => {
  it("shows the tip after the hover delay, flipped below a top-edge anchor", () => {
    const btn = setup();
    fireEvent.mouseOver(btn);
    expect(document.querySelector(".prw-tip")).toBeNull();
    act(() => {
      vi.advanceTimersByTime(TIP_DELAY_MS);
    });
    const tip = document.querySelector<HTMLElement>(".prw-tip")!;
    expect(tip.textContent).toBe("Hello tip");
    // zero-height anchor at the viewport top: above would poke past, so below
    expect(tip.style.top).toBe("6px");
    expect(tip.style.left).toBe("6px");
  });

  it("positions above and centers when there is room", () => {
    const btn = setup({ left: 200, top: 300, bottom: 320, width: 40 });
    fireEvent.mouseOver(btn);
    act(() => {
      vi.advanceTimersByTime(TIP_DELAY_MS);
    });
    const tip = document.querySelector<HTMLElement>(".prw-tip")!;
    expect(tip.style.top).toBe("294px"); // 300 - 0 (jsdom tip height) - 6
    expect(tip.style.left).toBe("220px"); // anchor center, zero tip width
  });

  it("re-hovering restarts the delay instead of stacking timers", () => {
    const btn = setup();
    fireEvent.mouseOver(btn);
    act(() => {
      vi.advanceTimersByTime(TIP_DELAY_MS - 50);
    });
    fireEvent.mouseOver(btn);
    act(() => {
      vi.advanceTimersByTime(TIP_DELAY_MS - 50);
    });
    expect(document.querySelector(".prw-tip")).toBeNull();
    act(() => {
      vi.advanceTimersByTime(50);
    });
    expect(document.querySelector(".prw-tip")).toBeTruthy();
  });

  it("mouseout and mousedown hide the tip and cancel a pending one", () => {
    const btn = setup();
    fireEvent.mouseOver(btn);
    act(() => {
      vi.advanceTimersByTime(TIP_DELAY_MS);
    });
    fireEvent.mouseOut(btn);
    expect(document.querySelector(".prw-tip")).toBeNull();

    fireEvent.mouseOver(btn); // pending again
    fireEvent.mouseDown(document.body);
    act(() => {
      vi.advanceTimersByTime(TIP_DELAY_MS);
    });
    expect(document.querySelector(".prw-tip")).toBeNull();
  });

  it("ignores hovers and outs on untipped elements and non-element targets", () => {
    setup();
    const plain = document.createElement("div");
    document.body.append(plain);
    fireEvent.mouseOver(plain);
    fireEvent.mouseOut(plain);
    document.dispatchEvent(new Event("mouseover")); // target: document, not an Element
    document.dispatchEvent(new Event("mouseout"));
    act(() => {
      vi.advanceTimersByTime(TIP_DELAY_MS);
    });
    expect(document.querySelector(".prw-tip")).toBeNull();
  });

  it("unbinds its listeners on unmount", () => {
    const btn = setup();
    cleanup();
    fireEvent.mouseOver(btn);
    act(() => {
      vi.advanceTimersByTime(TIP_DELAY_MS);
    });
    expect(document.querySelector(".prw-tip")).toBeNull();
  });
});
