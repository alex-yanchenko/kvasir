// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { shieldHotkeys } from "./shield";

let host: HTMLDivElement;
afterEach(() => {
  host.remove();
});

const press = (target: EventTarget, type = "keydown"): KeyboardEvent => {
  const e = new KeyboardEvent(type, { key: "/", bubbles: true, composed: true });
  target.dispatchEvent(e);
  return e;
};

describe("shieldHotkeys", () => {
  it("keeps keyboard events from inside the shadow root away from the document", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: "open" });
    const input = document.createElement("textarea");
    shadow.appendChild(input);

    const seen: string[] = [];
    const spy = (e: Event): void => {
      seen.push(e.type);
    };
    (["keydown", "keypress", "keyup"] as const).forEach((t) => document.addEventListener(t, spy));

    const unbind = shieldHotkeys(host);
    press(input, "keydown");
    press(input, "keypress");
    press(input, "keyup");
    expect(seen).toEqual([]);

    unbind();
    press(input, "keydown");
    expect(seen).toEqual(["keydown"]);
    (["keydown", "keypress", "keyup"] as const).forEach((t) => document.removeEventListener(t, spy));
  });

  it("leaves keys pressed outside the host alone", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    const seen: Event[] = [];
    const spy = (e: Event): void => {
      seen.push(e);
    };
    document.addEventListener("keydown", spy);
    const unbind = shieldHotkeys(host);
    press(document.body);
    expect(seen.length).toBe(1);
    unbind();
    document.removeEventListener("keydown", spy);
  });
});
