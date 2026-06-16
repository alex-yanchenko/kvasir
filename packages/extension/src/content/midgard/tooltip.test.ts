// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { initTooltips } from "./tooltip";

// initTooltips binds document listeners once per import; the module keeps its
// own tip element across tests, so assertions read the shared .kvasir-tip node.
let inited = false;
let btn: HTMLButtonElement;
beforeEach(() => {
  vi.useFakeTimers();
  if (!inited) {
    initTooltips();
    inited = true;
  }
  btn = document.createElement("button");
  btn.setAttribute("data-kvasir-tip", "Hi there");
  document.body.append(btn);
});
afterEach(() => {
  document.dispatchEvent(new Event("mousedown")); // hide + clear the shared timer
  btn.remove();
  vi.useRealTimers();
});

const hover = (el: Element) => el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
const unhover = (el: Element) => el.dispatchEvent(new MouseEvent("mouseout", { bubbles: true }));
const tip = () => document.querySelector<HTMLElement>(".kvasir-tip");

describe("initTooltips", () => {
  it("shows the tip after the delay, flipped below a top-edge anchor", () => {
    hover(btn);
    expect(tip()?.style.display ?? "none").toBe("none");
    vi.advanceTimersByTime(350);
    expect(tip()!.textContent).toBe("Hi there");
    expect(tip()!.style.display).toBe("block");
    expect(tip()!.style.top).toBe("6px"); // zero-rect anchor: above pokes past, flip below
    expect(tip()!.style.left).toBe("6px");
  });

  it("positions above and centered when there is room", () => {
    vi.spyOn(btn, "getBoundingClientRect").mockReturnValue({
      left: 200,
      top: 300,
      right: 240,
      bottom: 320,
      width: 40,
      height: 20,
      x: 200,
      y: 300,
      toJSON: () => null,
    });
    hover(btn);
    vi.advanceTimersByTime(350);
    expect(tip()!.style.top).toBe("294px");
    expect(tip()!.style.left).toBe("220px");
  });

  it("a tipless ancestor chain and re-hovers behave: no tip, restarted timer", () => {
    const plain = document.createElement("div");
    document.body.append(plain);
    hover(plain);
    unhover(plain);
    vi.advanceTimersByTime(350);
    expect(tip()?.style.display ?? "none").toBe("none");

    hover(btn);
    vi.advanceTimersByTime(300);
    hover(btn); // restart
    vi.advanceTimersByTime(300);
    expect(tip()?.style.display ?? "none").toBe("none");
    vi.advanceTimersByTime(50);
    expect(tip()!.style.display).toBe("block");
    plain.remove();
  });

  it("mouseout and mousedown hide a shown or pending tip", () => {
    hover(btn);
    vi.advanceTimersByTime(350);
    expect(tip()!.style.display).toBe("block");
    unhover(btn);
    expect(tip()!.style.display).toBe("none");

    hover(btn);
    document.dispatchEvent(new Event("mousedown"));
    vi.advanceTimersByTime(350);
    expect(tip()!.style.display).toBe("none");
  });

  it("an element that loses its attribute before the timer fires shows nothing", () => {
    hover(btn);
    btn.removeAttribute("data-kvasir-tip");
    vi.advanceTimersByTime(350);
    expect(tip()!.style.display).toBe("none");
  });
  it("ignores non-element and non-MouseEvent hovers/outs", () => {
    document.dispatchEvent(new MouseEvent("mouseover")); // target: document, not an Element
    document.dispatchEvent(new MouseEvent("mouseout")); // MouseEvent, non-Element target
    document.dispatchEvent(new Event("mouseout")); // not a MouseEvent at all
    vi.advanceTimersByTime(350);
    expect(tip()?.style.display ?? "none").toBe("none");
  });

  it("hides safely before any tip element exists (no-op on a null tip)", async () => {
    vi.resetModules();
    const fresh = await import("./tooltip");
    fresh.initTooltips();
    document.querySelector(".kvasir-tip")?.remove(); // drop any tip left by the shared module
    document.dispatchEvent(new Event("mousedown")); // hideTip runs with the fresh module's null tip
    expect(tip()).toBeNull(); // hideTip created nothing
  });

  it("does not hide when the cursor crosses from the tipped element into its own child", () => {
    const icon = document.createElement("span");
    btn.append(icon);
    hover(btn);
    vi.advanceTimersByTime(350);
    expect(tip()!.style.display).toBe("block");
    btn.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, relatedTarget: icon }));
    expect(tip()!.style.display).toBe("block"); // child-enter is not a real leave
  });
});
