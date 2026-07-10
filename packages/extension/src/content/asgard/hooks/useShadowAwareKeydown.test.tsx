// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { useShadowAwareKeydown } from "./useShadowAwareKeydown";

const key = (target: EventTarget, k = "ArrowRight"): void => {
  target.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
};

afterEach(() => {
  document.querySelector("#kvasir-root")?.remove();
});

describe("useShadowAwareKeydown", () => {
  it("hears a document keydown and hands the handler the event", () => {
    const handler = vi.fn();
    renderHook(() => useShadowAwareKeydown(handler));
    key(document);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0]![0]).toBeInstanceOf(KeyboardEvent);
  });

  it("also binds the shadow root, where the hotkey shield stops events from reaching the document", () => {
    const host = document.createElement("div");
    host.id = "kvasir-root";
    document.body.append(host);
    const shadow = host.attachShadow({ mode: "open" });
    const inner = shadow.appendChild(document.createElement("div"));
    const handler = vi.fn();
    renderHook(() => useShadowAwareKeydown(handler));
    key(inner); // non-composed: never crosses the shadow boundary, only the shadow binding hears it
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("skips editable targets — typing must never trigger shortcuts", () => {
    const handler = vi.fn();
    renderHook(() => useShadowAwareKeydown(handler));
    for (const tag of ["input", "textarea", "select"]) {
      const field = document.body.appendChild(document.createElement(tag));
      key(field);
      field.remove();
    }
    const editable = document.body.appendChild(document.createElement("div"));
    Object.defineProperty(editable, "isContentEditable", { value: true });
    key(editable);
    editable.remove();
    expect(handler).not.toHaveBeenCalled();
  });

  it("ignores a non-KeyboardEvent named keydown", () => {
    const handler = vi.fn();
    renderHook(() => useShadowAwareKeydown(handler));
    document.dispatchEvent(new Event("keydown"));
    expect(handler).not.toHaveBeenCalled();
  });

  it("calls the LATEST handler without re-binding, and unbinds on unmount", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender, unmount } = renderHook(({ h }) => useShadowAwareKeydown(h), {
      initialProps: { h: first },
    });
    rerender({ h: second });
    key(document);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    unmount();
    key(document);
    expect(second).toHaveBeenCalledTimes(1); // no listener left behind
  });
});
