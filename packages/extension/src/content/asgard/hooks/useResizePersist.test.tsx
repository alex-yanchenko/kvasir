// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { useRef } from "react";
import { useResizePersist } from "./useResizePersist";

let roCallback: (() => void) | null = null;
class ROStub {
  constructor(cb: () => void) {
    roCallback = cb;
  }
  observe(): void {}
  disconnect(): void {}
}

function Panel({ onSize }: { onSize: (s: { w: number; h: number }) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useResizePersist(ref, onSize);
  return <div ref={ref}>panel</div>;
}

function Detached({ onSize }: { onSize: (s: { w: number; h: number }) => void }) {
  const ref = useRef<HTMLDivElement>(null); // never attached
  useResizePersist(ref, onSize);
  return <span>no panel</span>;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("ResizeObserver", ROStub);
  roCallback = null;
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("useResizePersist", () => {
  it("debounces bursts of resize callbacks into one persist", async () => {
    const onSize = vi.fn();
    render(<Panel onSize={onSize} />);
    act(() => roCallback?.());
    act(() => roCallback?.()); // second fire clears the pending timer
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(onSize).toHaveBeenCalledWith({ w: 0, h: 0 });
    expect(onSize).toHaveBeenCalledTimes(1);
  });

  it("a pending persist is dropped on unmount", async () => {
    const onSize = vi.fn();
    const { unmount } = render(<Panel onSize={onSize} />);
    act(() => roCallback?.());
    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(onSize).not.toHaveBeenCalled();
  });

  it("does nothing when the ref has no element", () => {
    const onSize = vi.fn();
    render(<Detached onSize={onSize} />);
    expect(roCallback).toBeNull();
  });
});
