// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { useRef } from "react";
import { useDrag } from "./useDrag";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

function Plain({ onEnd }: { onEnd: (p: { left: number; top: number }) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const down = useDrag(ref, { onEnd }); // no ignore selector
  return (
    <div ref={ref} data-testid="panel" onMouseDown={down}>
      drag me
    </div>
  );
}

function Detached({ onEnd }: { onEnd: (p: { left: number; top: number }) => void }) {
  const ref = useRef<HTMLDivElement>(null); // never attached
  const down = useDrag(ref, { onEnd });
  return (
    <button data-testid="loose" onMouseDown={down}>
      no panel
    </button>
  );
}

describe("useDrag", () => {
  it("moves by style writes and reports the final position once", () => {
    const onEnd = vi.fn();
    const { getByTestId } = render(<Plain onEnd={onEnd} />);
    const panel = getByTestId("panel");
    fireEvent.mouseDown(panel, { clientX: 10, clientY: 10 });
    fireEvent.mouseMove(document, { clientX: 30, clientY: 40 });
    expect(panel.style.right).toBe("auto");
    fireEvent.mouseUp(document);
    expect(onEnd).toHaveBeenCalledWith({ left: 0, top: 0 }); // jsdom rects are zero
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it("does nothing when the ref has no element", () => {
    const onEnd = vi.fn();
    const { getByTestId } = render(<Detached onEnd={onEnd} />);
    fireEvent.mouseDown(getByTestId("loose"));
    fireEvent.mouseUp(document);
    expect(onEnd).not.toHaveBeenCalled();
  });
});
