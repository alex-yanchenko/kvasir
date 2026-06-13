import { describe, it, expect, vi } from "vitest";
import { createBifrost } from "./bifrost";

describe("bifrost commands (send/handle)", () => {
  it("delivers a command payload to its handler", () => {
    const b = createBifrost();
    const fn = vi.fn();
    b.handle("jump:ref", fn);
    b.send("jump:ref", { file: "src/app.ts", start: 10, end: 12 });
    expect(fn).toHaveBeenCalledWith({ file: "src/app.ts", start: 10, end: 12 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("fans a command out to every handler, in subscription order", () => {
    const b = createBifrost();
    const calls: string[] = [];
    b.handle("highlight:clear", () => calls.push("first"));
    b.handle("highlight:clear", () => calls.push("second"));
    b.send("highlight:clear", undefined);
    expect(calls).toEqual(["first", "second"]);
  });

  it("is a no-op when nothing handles the command", () => {
    const b = createBifrost();
    expect(() => b.send("pick:clear", undefined)).not.toThrow();
  });

  it("unsubscribe stops delivery and is idempotent", () => {
    const b = createBifrost();
    const fn = vi.fn();
    const off = b.handle("theme:apply", fn);
    off();
    off();
    b.send("theme:apply", { theme: "dark", hlStyle: "tint" });
    expect(fn).not.toHaveBeenCalled();
  });

  it("isolates a throwing handler: the others still run and the error is logged", () => {
    const b = createBifrost();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const after = vi.fn();
    b.handle("highlight:step", () => {
      throw new Error("boom");
    });
    b.handle("highlight:step", after);
    b.send("highlight:step", { anchor: "diff-x", lines: null, highlight: null });
    expect(after).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledTimes(1);
  });
});

describe("bifrost reports (report/on)", () => {
  it("delivers a report payload to its subscriber", () => {
    const b = createBifrost();
    const fn = vi.fn();
    b.on("selection:completed", fn);
    const payload = {
      selectionId: "src/app.ts::abc",
      file: "src/app.ts",
      text: "const a = 1;",
      lines: { start: 10, end: 10 },
      rect: { left: 1, top: 2, bottom: 3, height: 4 },
    };
    b.report("selection:completed", payload);
    expect(fn).toHaveBeenCalledWith(payload);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("keeps commands and reports on separate channels", () => {
    const b = createBifrost();
    const onReport = vi.fn();
    const onCommand = vi.fn();
    b.on("ref:missing", onReport);
    b.handle("jump:ref", onCommand);
    b.report("ref:missing", { file: "x.ts" });
    expect(onReport).toHaveBeenCalledTimes(1);
    expect(onCommand).not.toHaveBeenCalled();
  });

  it("unsubscribing one report listener leaves the others attached", () => {
    const b = createBifrost();
    const stays = vi.fn();
    const leaves = vi.fn();
    const off = b.on("pr:changed", leaves);
    b.on("pr:changed", stays);
    off();
    b.report("pr:changed", { pr: null, onFilesTab: false });
    expect(stays).toHaveBeenCalledWith({ pr: null, onFilesTab: false });
    expect(leaves).not.toHaveBeenCalled();
  });

  it("a handler that unsubscribes another mid-publish does not skip delivery (snapshot fan-out)", () => {
    const b = createBifrost();
    const second = vi.fn();
    const offs: Array<() => void> = [];
    offs.push(
      b.on("selection:cleared", () => {
        offs[1]();
      }),
    );
    offs.push(b.on("selection:cleared", second));
    b.report("selection:cleared", undefined);
    expect(second).toHaveBeenCalledTimes(1);
  });
});
